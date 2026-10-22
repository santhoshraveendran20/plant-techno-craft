"""Dynamic UPI QR requests, gateway payment processing and webhooks.

Every QR carries a reference that contains the bill (or customer) id. When the gateway reports a
payment - by webhook, by status polling, or later from the settlement report - it is matched back
to that bill and customer automatically (FR-09 .. FR-13, FR-17).
"""

import secrets
from datetime import timedelta
from typing import Mapping

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Bill, Customer, CustomerVPA, Payment, UpiRequest, User, WebhookEvent
from ..utils import D, money, now
from . import app_settings
from .gateway import get_gateway
from .gateway.base import NormalizedPayment
from .ledger import add_ledger, post_payment_ledger, refresh_bill_and_customer

POLLABLE = ("active", "partially_paid", "failed")


def create_upi_request(
    db: Session,
    *,
    amount,
    purpose: str,
    bill: Bill | None = None,
    customer_id: int | None = None,
    user: User | None = None,
    as_link: bool = False,
) -> UpiRequest:
    amount = money(amount)
    if amount <= 0:
        raise HTTPException(400, "UPI amount must be greater than zero")
    cfg = app_settings.get_all(db)
    if as_link:
        expires_at = now() + timedelta(days=cfg["payment_link_expiry_days"])
    else:
        expires_at = now() + timedelta(minutes=cfg["qr_expiry_minutes"])

    if bill is not None:
        ref = f"BILL{bill.id}-{secrets.token_hex(3).upper()}"
        description = f"Bill {bill.bill_no}"
    else:
        customer = db.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(400, "Customer not found")
        ref = f"CUST{customer_id}-{secrets.token_hex(3).upper()}"
        description = f"Dues {customer.name}"[:50]

    gateway = get_gateway()
    try:
        gq = gateway.create_qr(
            db,
            ref=ref,
            amount=amount,
            description=description,
            expires_at=expires_at,
            payee_vpa=cfg["upi_vpa"],
            payee_name=cfg["upi_payee_name"] or cfg["shop_name"],
            notes={"bill_id": bill.id if bill else "", "customer_id": customer_id or ""},
        )
    except HTTPException:
        raise
    except Exception as exc:  # network / auth errors from the provider
        raise HTTPException(502, f"Payment gateway error: {exc}") from exc

    req = UpiRequest(
        ref=ref,
        purpose=purpose,
        bill_id=bill.id if bill else None,
        customer_id=customer_id,
        amount=amount,
        status="active",
        gateway=gateway.name,
        gateway_qr_id=gq.gateway_qr_id,
        payload=gq.payload,
        image_url=gq.image_url,
        public_token=secrets.token_urlsafe(24),
        is_link=as_link,
        expires_at=expires_at,
        created_by=user.id if user else None,
    )
    db.add(req)
    db.flush()
    return req


def expire_if_needed(db: Session, req: UpiRequest) -> None:
    if req.status in ("active", "failed") and now() >= req.expires_at:
        req.status = "expired"
        req.closed_reason = "Link expired" if req.is_link else "QR expired"
        if req.gateway_qr_id:
            try:
                get_gateway(req.gateway).close_qr(db, req.gateway_qr_id)
            except Exception:
                pass


def poll_request(db: Session, req: UpiRequest) -> None:
    """Fallback when a webhook is late or lost: ask the gateway what it has for this QR."""
    if req.status not in POLLABLE or not req.gateway_qr_id:
        return
    try:
        found = get_gateway(req.gateway).fetch_qr_payments(db, req.gateway_qr_id)
    except Exception:
        return  # gateway unreachable - try again on the next poll
    for n in found:
        process_gateway_payment(db, n, source="poll")


def find_customer_by_vpa(db: Session, vpa: str | None) -> int | None:
    if not vpa:
        return None
    row = db.execute(select(CustomerVPA).where(CustomerVPA.vpa == vpa.strip().lower())).scalar_one_or_none()
    return row.customer_id if row else None


def remember_vpa(db: Session, customer_id: int, vpa: str | None) -> None:
    if not vpa:
        return
    vpa = vpa.strip().lower()
    exists = db.execute(select(CustomerVPA.id).where(CustomerVPA.vpa == vpa)).scalar()
    if not exists:
        db.add(CustomerVPA(customer_id=customer_id, vpa=vpa))


def link_bill_to_customer(db: Session, bill: Bill, customer_id: int) -> None:
    """A walk-in bill paid from a known VPA becomes part of that customer's history (FR-17)."""
    if bill.customer_id is not None:
        return
    bill.customer_id = customer_id
    payments = list(db.execute(select(Payment).where(Payment.bill_id == bill.id)).scalars())
    for p in payments:
        p.customer_id = customer_id
    db.flush()
    if bill.completed_at is not None:
        add_ledger(db, customer_id, "bill", debit=bill.total, description=f"Bill {bill.bill_no} (linked by UPI ID)",
                   bill_id=bill.id)
        for p in payments:
            post_payment_ledger(db, p)


def _find_request(db: Session, n: NormalizedPayment) -> UpiRequest | None:
    conds = []
    if n.gateway_qr_id:
        conds.append(UpiRequest.gateway_qr_id == n.gateway_qr_id)
    if n.reference:
        conds.append(UpiRequest.ref == n.reference)
    if not conds:
        return None
    return db.execute(select(UpiRequest).where(or_(*conds)).order_by(UpiRequest.id.desc()).limit(1)).scalar_one_or_none()


def _existing_payment(db: Session, n: NormalizedPayment) -> Payment | None:
    conds = [Payment.gateway_payment_id == n.gateway_payment_id]
    if n.utr:
        conds.append(Payment.utr == n.utr)
    return db.execute(select(Payment).where(or_(*conds)).limit(1)).scalar_one_or_none()


def process_gateway_payment(db: Session, n: NormalizedPayment, source: str = "webhook") -> tuple[Payment | None, bool]:
    """Idempotent: the same gateway payment id / UTR is never counted twice."""
    existing = _existing_payment(db, n)
    if existing is not None:
        return existing, False

    req = _find_request(db, n)
    bill = db.get(Bill, req.bill_id) if req and req.bill_id else None
    customer_id = (bill.customer_id if bill else None) or (req.customer_id if req else None)

    if n.status != "success":
        p = Payment(
            bill_id=bill.id if bill else None, customer_id=customer_id, upi_request_id=req.id if req else None,
            kind="payment", mode="upi", amount=money(n.amount), gateway_payment_id=n.gateway_payment_id,
            utr=n.utr, payer_vpa=n.payer_vpa, payer_name=n.payer_name, gateway_status="failed",
            match_status="failed", source=source, note=(n.error_reason or "Payment failed")[:255],
        )
        try:
            with db.begin_nested():
                db.add(p)
                db.flush()
        except IntegrityError:
            return _existing_payment(db, n), False
        if req is not None and req.status == "active":
            req.status = "failed"
            req.closed_reason = n.error_reason or "Payment failed in the UPI app"
        return p, True

    if customer_id is None:
        known = find_customer_by_vpa(db, n.payer_vpa)
        if known:
            customer_id = known
            if bill is not None:
                link_bill_to_customer(db, bill, known)

    amount = money(n.amount)
    match_status = "matched"
    if req is not None:
        expected_left = money(D(req.amount) - D(req.received_amount))
        if amount < expected_left:
            match_status = "mismatch"
        elif amount > expected_left:
            match_status = "overpaid"
        if bill is not None and bill.status == "cancelled":
            match_status = "mismatch"
    elif customer_id is None:
        match_status = "unlinked"

    p = Payment(
        bill_id=bill.id if bill else None,
        customer_id=customer_id,
        upi_request_id=req.id if req else None,
        kind="payment",
        mode="upi",
        amount=amount,
        utr=n.utr,
        gateway_payment_id=n.gateway_payment_id,
        payer_vpa=(n.payer_vpa or "").lower() or None,
        payer_name=n.payer_name,
        gateway_status="success",
        match_status=match_status,
        source=source,
        note="Payment received after the bill was cancelled - refund or re-bill" if bill is not None and bill.status == "cancelled" else None,
    )
    try:
        with db.begin_nested():
            db.add(p)
            db.flush()
    except IntegrityError:
        return _existing_payment(db, n), False

    if customer_id:
        remember_vpa(db, customer_id, n.payer_vpa)

    if req is not None:
        req.received_amount = money(D(req.received_amount) + amount)
        req.status = "paid" if D(req.received_amount) >= D(req.amount) else "partially_paid"
        req.paid_at = now()
        if req.status == "partially_paid":
            req.closed_reason = f"Received Rs. {req.received_amount} of Rs. {req.amount}"

    if bill is not None and bill.completed_at is None and bill.status == "pending" and req is not None and req.status == "paid":
        from .billing import complete_bill

        complete_bill(db, bill, None)
    else:
        post_payment_ledger(db, p)
        refresh_bill_and_customer(db, bill, customer_id)
    return p, True


def _lower_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {k.lower(): v for k, v in headers.items()}


def handle_webhook(db: Session, gateway_name: str, raw_body: bytes, headers: Mapping[str, str]) -> dict:
    """Verify signature, store the event, then process it. Safe to receive the same event many times."""
    gateway = get_gateway(gateway_name)
    hdrs = _lower_headers(headers)
    valid = gateway.verify_webhook(raw_body, hdrs)
    try:
        parsed = gateway.parse_webhook(raw_body, hdrs)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(400, f"Malformed webhook: {exc}") from exc

    if not valid:
        # Logged for the owner to see, but never processed. event_id stays empty so a forged
        # copy can never block the genuine event from being stored.
        db.add(WebhookEvent(
            gateway=gateway.name, event_id=None, event_type=parsed.event_type, signature_valid=False,
            payload=raw_body.decode("utf-8", "replace"),
            error=f"Invalid signature - ignored (claimed event id {parsed.event_id})",
        ))
        db.commit()
        raise HTTPException(401, "Invalid webhook signature")

    seen = None
    if parsed.event_id:
        seen = db.execute(select(WebhookEvent).where(WebhookEvent.event_id == parsed.event_id)).scalar_one_or_none()
        if seen is not None and seen.processed:
            return {"status": "duplicate", "event_id": parsed.event_id}

    event = seen or WebhookEvent(
        gateway=gateway.name,
        event_id=parsed.event_id,
        event_type=parsed.event_type,
        signature_valid=True,
        payload=raw_body.decode("utf-8", "replace"),
    )
    if seen is None:
        db.add(event)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return {"status": "duplicate", "event_id": parsed.event_id}

    return process_webhook_event(db, event, parsed.payments)


def process_webhook_event(db: Session, event: WebhookEvent, payments: list[NormalizedPayment]) -> dict:
    event_pk = event.id
    try:
        results = []
        for n in payments:
            p, created = process_gateway_payment(db, n, source="webhook")
            results.append({"payment_id": p.id if p else None, "created": created})
        event.processed = True
        event.processed_at = now()
        event.error = None
        db.commit()
        return {"status": "processed", "payments": results}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        failed = db.get(WebhookEvent, event_pk)
        if failed is not None:
            failed.error = f"{type(exc).__name__}: {exc}"[:2000]
            db.commit()
        raise HTTPException(500, "Webhook processing failed; it is queued for retry") from exc


def retry_webhook_event(db: Session, event: WebhookEvent) -> dict:
    gateway = get_gateway(event.gateway)
    raw = event.payload.encode("utf-8")
    parsed = gateway.parse_webhook(raw, {})
    return process_webhook_event(db, event, parsed.payments)


def request_dict(req: UpiRequest) -> dict:
    return {
        "id": req.id,
        "ref": req.ref,
        "purpose": req.purpose,
        "bill_id": req.bill_id,
        "bill_no": req.bill.bill_no if req.bill else None,
        "customer_id": req.customer_id,
        "customer_name": req.customer.name if req.customer else (
            req.bill.customer.name if req.bill and req.bill.customer else None),
        "amount": float(req.amount),
        "received_amount": float(req.received_amount),
        "status": req.status,
        "gateway": req.gateway,
        "payload": req.payload,
        "image_url": req.image_url,
        "public_token": req.public_token,
        "is_link": req.is_link,
        "expires_at": req.expires_at.isoformat(),
        "seconds_left": max(0, int((req.expires_at - now()).total_seconds())),
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "paid_at": req.paid_at.isoformat() if req.paid_at else None,
        "closed_reason": req.closed_reason,
        "bill_status": req.bill.status if req.bill else None,
    }

