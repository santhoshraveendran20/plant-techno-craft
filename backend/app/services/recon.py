"""Daily reconciliation (FR-20): app payments vs gateway settlement report vs bank credit."""

from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import Payment, Settlement, SettlementItem
from ..utils import D, ZERO, day_bounds, money, today
from .gateway import get_gateway
from .gateway.base import NormalizedPayment
from .upi import process_gateway_payment


def _match_item(db: Session, item: SettlementItem) -> None:
    conds = [Payment.gateway_payment_id == item.gateway_payment_id]
    if item.utr:
        conds.append(Payment.utr == item.utr)
    payment = db.execute(
        select(Payment).where(or_(*conds), Payment.gateway_status == "success").limit(1)
    ).scalar_one_or_none()
    if payment is None:
        item.payment_id = None
        item.match_status = "missing_in_app"
        return
    item.payment_id = payment.id
    payment.settlement_id = item.settlement_id
    item.match_status = "matched" if money(payment.amount) == money(item.amount) else "amount_mismatch"


def fetch_settlements(db: Session, payments_date: date) -> list[Settlement]:
    gateway = get_gateway()
    stored = []
    for gs in gateway.fetch_settlements(db, payments_date):
        s = db.execute(
            select(Settlement).where(Settlement.gateway_settlement_id == gs.gateway_settlement_id)
        ).scalar_one_or_none()
        if s is None:
            s = Settlement(gateway=gateway.name, gateway_settlement_id=gs.gateway_settlement_id)
            db.add(s)
        s.settlement_date = gs.settlement_date
        s.payments_date = payments_date
        s.gross, s.fees, s.tax, s.net = gs.gross, gs.fees, gs.tax, gs.net
        s.bank_utr = gs.bank_utr
        s.items.clear()
        db.flush()
        for gi in gs.items:
            s.items.append(
                SettlementItem(
                    gateway_payment_id=gi.gateway_payment_id,
                    utr=gi.utr,
                    amount=gi.amount,
                    fee=gi.fee,
                    reference=gi.reference,
                    payer_vpa=gi.payer_vpa,
                    payer_name=gi.payer_name,
                    captured_at=gi.captured_at,
                )
            )
        db.flush()
        for item in s.items:
            _match_item(db, item)
        stored.append(s)
    db.flush()
    return stored


def import_missing_item(db: Session, item: SettlementItem) -> Payment | None:
    """A payment the gateway settled but the app never heard about (lost webhook): record it now."""
    n = NormalizedPayment(
        status="success",
        gateway_payment_id=item.gateway_payment_id,
        amount=money(item.amount),
        reference=item.reference,
        utr=item.utr,
        payer_vpa=item.payer_vpa,
        payer_name=item.payer_name,
        paid_at=item.captured_at,
    )
    payment, _ = process_gateway_payment(db, n, source="recon")
    if payment is not None and item.captured_at is not None:
        payment.created_at = item.captured_at
    db.flush()
    _match_item(db, item)
    return payment


def _payment_row(p: Payment) -> dict:
    return {
        "id": p.id,
        "bill_no": p.bill.bill_no if p.bill else None,
        "customer_name": p.customer.name if p.customer else None,
        "amount": float(p.amount),
        "utr": p.utr,
        "gateway_payment_id": p.gateway_payment_id,
        "payer_vpa": p.payer_vpa,
        "source": p.source,
        "settlement_id": p.settlement_id,
        "created_at": p.created_at.isoformat(),
    }


def report(db: Session, for_date: date) -> dict:
    start, end = day_bounds(for_date)
    app_payments = list(
        db.execute(
            select(Payment)
            .where(
                Payment.mode == "upi",
                Payment.kind == "payment",
                Payment.gateway_status == "success",
                Payment.created_at >= start,
                Payment.created_at < end,
            )
            .order_by(Payment.created_at)
        ).scalars()
    )
    gateway_payments = [p for p in app_payments if p.source != "manual"]
    manual_payments = [p for p in app_payments if p.source == "manual"]
    settlements = list(
        db.execute(select(Settlement).where(Settlement.payments_date == for_date).order_by(Settlement.id)).scalars()
    )
    items = [i for s in settlements for i in s.items]
    settled_ids = {i.payment_id for i in items if i.payment_id}

    gaps = []
    for i in items:
        if i.match_status == "missing_in_app":
            gaps.append({
                "type": "missing_in_app", "severity": "critical", "item_id": i.id,
                "amount": float(i.amount), "reference": i.reference, "gateway_payment_id": i.gateway_payment_id,
                "message": f"Gateway settled Rs. {money(i.amount)} ({i.gateway_payment_id}) that the app never recorded",
            })
        elif i.match_status == "amount_mismatch":
            gaps.append({
                "type": "amount_mismatch", "severity": "serious", "item_id": i.id, "amount": float(i.amount),
                "message": f"Amount differs between app and gateway for {i.gateway_payment_id}",
            })
    settlement_due = for_date < today()
    if settlements or settlement_due:
        for p in gateway_payments:
            if p.id not in settled_ids:
                gaps.append({
                    "type": "not_settled", "severity": "serious" if settlements else "warning",
                    "payment_id": p.id, "amount": float(p.amount),
                    "message": f"App payment Rs. {money(p.amount)} (UTR {p.utr or '-'}) is not in the settlement report"
                    + ("" if settlements else " - fetch the settlement report"),
                })
    for s in settlements:
        if s.bank_credit_amount is None:
            if s.settlement_date <= today():
                gaps.append({
                    "type": "bank_unconfirmed", "severity": "warning", "settlement_id": s.id,
                    "amount": float(s.net),
                    "message": f"Bank credit for settlement {s.gateway_settlement_id} (Rs. {money(s.net)}) not confirmed yet",
                })
        elif money(s.bank_credit_amount) != money(s.net):
            gaps.append({
                "type": "bank_mismatch", "severity": "critical", "settlement_id": s.id,
                "amount": float(D(s.bank_credit_amount) - D(s.net)),
                "message": f"Bank credited Rs. {money(s.bank_credit_amount)} but settlement net is Rs. {money(s.net)}",
            })

    app_total = money(sum((D(p.amount) for p in gateway_payments), ZERO))
    gross = money(sum((D(s.gross) for s in settlements), ZERO))
    fees = money(sum((D(s.fees) + D(s.tax) for s in settlements), ZERO))
    net = money(sum((D(s.net) for s in settlements), ZERO))
    bank = money(sum((D(s.bank_credit_amount) for s in settlements if s.bank_credit_amount is not None), ZERO))
    blocking = [g for g in gaps if g["severity"] in ("critical", "serious")]
    if not app_payments and not settlements:
        status = "no_activity"
    elif blocking:
        status = "gaps"
    elif gaps or (gateway_payments and not settlements):
        status = "pending"  # waiting for the T+1 settlement report or the bank credit
    else:
        status = "matched"
    return {
        "date": for_date.isoformat(),
        "status": status,
        "totals": {
            "app_upi": float(app_total),
            "app_count": len(gateway_payments),
            "manual_upi": float(money(sum((D(p.amount) for p in manual_payments), ZERO))),
            "gateway_gross": float(gross),
            "gateway_fees": float(fees),
            "gateway_net": float(net),
            "bank_credit": float(bank),
            "difference_app_vs_gateway": float(app_total - gross),
        },
        "settlements": [
            {
                "id": s.id,
                "gateway_settlement_id": s.gateway_settlement_id,
                "settlement_date": s.settlement_date.isoformat(),
                "gross": float(s.gross), "fees": float(s.fees), "tax": float(s.tax), "net": float(s.net),
                "bank_utr": s.bank_utr,
                "bank_credit_amount": float(s.bank_credit_amount) if s.bank_credit_amount is not None else None,
                "bank_credit_date": s.bank_credit_date.isoformat() if s.bank_credit_date else None,
                "bank_credit_ref": s.bank_credit_ref,
                "items": [
                    {
                        "id": i.id, "gateway_payment_id": i.gateway_payment_id, "utr": i.utr,
                        "amount": float(i.amount), "fee": float(i.fee), "reference": i.reference,
                        "payment_id": i.payment_id, "match_status": i.match_status,
                    }
                    for i in s.items
                ],
            }
            for s in settlements
        ],
        "app_payments": [_payment_row(p) for p in app_payments],
        "gaps": gaps,
    }


def summary(db: Session, days: int) -> list[dict]:
    rows = []
    for offset in range(days):
        d = today() - timedelta(days=offset)
        r = report(db, d)
        rows.append({
            "date": r["date"], "status": r["status"], "app_upi": r["totals"]["app_upi"],
            "gateway_gross": r["totals"]["gateway_gross"], "gateway_net": r["totals"]["gateway_net"],
            "bank_credit": r["totals"]["bank_credit"], "gaps": len(r["gaps"]),
            "settlements": len(r["settlements"]),
        })
    return rows

