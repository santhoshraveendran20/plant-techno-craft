from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Bill, BillItem, Customer, Payment, Product, SalesReturn, SalesReturnItem, UpiRequest, User
from ..utils import D, ZERO, money, now, qty
from . import app_settings
from .audit import log_audit
from .ledger import add_ledger, bill_payments_total, post_payment_ledger, refresh_bill_and_customer
from .stock import post_movement

OPEN_STATUSES = ("draft", "pending")


def assign_bill_no(db: Session, bill: Bill) -> None:
    db.flush()
    if not bill.bill_no:
        prefix = "OB" if bill.bill_type == "opening" else "B"
        bill.bill_no = f"{prefix}{bill.id:06d}"


def set_items(db: Session, bill: Bill, items_in: list, user: User) -> None:
    """Replace a draft's items. Prices always come from the catalogue unless the owner overrides them."""
    merged: dict[int, dict] = {}
    for it in items_in:
        pid = int(it.product_id)
        q = qty(it.qty)
        if q <= 0:
            raise HTTPException(400, "Quantity must be greater than zero")
        if pid in merged:
            merged[pid]["qty"] += q
        else:
            merged[pid] = {"qty": q, "unit_price": getattr(it, "unit_price", None)}

    bill.items.clear()
    db.flush()
    subtotal = ZERO
    for pid, data in merged.items():
        product = db.get(Product, pid)
        if product is None or not product.is_active:
            raise HTTPException(400, f"Product #{pid} not found or inactive")
        price = D(product.selling_price)
        override = data["unit_price"]
        if override is not None and money(override) != money(price):
            if user.role != "owner":
                raise HTTPException(403, "Only the owner can change an item's price at billing")
            price = money(override)
        line = money(data["qty"] * price)
        subtotal += line
        bill.items.append(
            BillItem(
                product_id=product.id,
                product_name=product.name,
                barcode=product.barcode,
                unit=product.unit,
                qty=data["qty"],
                unit_price=money(price),
                cost_price=money(product.cost_price),
                line_total=line,
            )
        )
    bill.subtotal = money(subtotal)


def apply_discount(db: Session, bill: Bill, discount, user: User) -> None:
    disc = money(discount or 0)
    if disc < 0:
        raise HTTPException(400, "Discount cannot be negative")
    if disc > D(bill.subtotal):
        raise HTTPException(400, "Discount cannot exceed the bill subtotal")
    if user.role != "owner" and disc > 0 and D(bill.subtotal) > 0:
        max_pct = D(app_settings.get_value(db, "cashier_max_discount_pct"))
        if disc > money(D(bill.subtotal) * max_pct / Decimal("100")):
            raise HTTPException(403, f"Discount above {max_pct}% needs the owner")
    bill.discount = disc
    bill.total = money(D(bill.subtotal) - disc)


def set_customer(db: Session, bill: Bill, customer_id: int | None) -> None:
    if customer_id:
        if db.get(Customer, customer_id) is None:
            raise HTTPException(400, "Customer not found")
    bill.customer_id = customer_id or None


def stock_problems(db: Session, bill: Bill) -> list[dict]:
    problems = []
    for item in bill.items:
        product = db.get(Product, item.product_id)
        if product is not None and D(product.stock_qty) < D(item.qty):
            problems.append(
                {"product_id": product.id, "name": product.name,
                 "in_stock": float(product.stock_qty), "requested": float(item.qty)}
            )
    return problems


def cancel_active_requests(db: Session, bill_id: int, reason: str) -> None:
    from .gateway import get_gateway

    reqs = db.execute(
        select(UpiRequest).where(
            UpiRequest.bill_id == bill_id, UpiRequest.status.in_(("active", "failed", "partially_paid"))
        )
    ).scalars()
    for req in reqs:
        req.status = "cancelled"
        req.closed_reason = reason
        if req.gateway_qr_id:
            try:
                get_gateway(req.gateway).close_qr(db, req.gateway_qr_id)
            except Exception:  # closing is best effort; the QR also expires on its own
                pass


def complete_bill(db: Session, bill: Bill, user: User | None) -> None:
    """Paid / credit bill: reduce stock (FR-28), post to the customer ledger, settle payments."""
    if bill.completed_at is not None:
        return
    for item in bill.items:
        post_movement(db, item.product_id, "sale", qty_out=item.qty, ref_type="bill", ref_id=bill.id,
                      ref_label=bill.bill_no, user=user)
    bill.completed_at = now()
    bill.status = "credit"
    db.flush()
    if bill.customer_id:
        add_ledger(db, bill.customer_id, "bill", debit=bill.total, description=f"Bill {bill.bill_no}",
                   bill_id=bill.id)
        payments = db.execute(
            select(Payment).where(Payment.bill_id == bill.id, Payment.gateway_status == "success").order_by(Payment.id)
        ).scalars()
        for p in payments:
            if p.customer_id is None:
                p.customer_id = bill.customer_id
            post_payment_ledger(db, p)
    refresh_bill_and_customer(db, bill)


def record_payment(
    db: Session,
    *,
    amount,
    mode: str,
    bill: Bill | None = None,
    customer_id: int | None = None,
    user: User | None = None,
    kind: str = "payment",
    source: str = "counter",
    utr: str | None = None,
    payer_vpa: str | None = None,
    payer_name: str | None = None,
    match_status: str = "matched",
    note: str | None = None,
) -> Payment:
    p = Payment(
        bill_id=bill.id if bill else None,
        customer_id=customer_id if customer_id else (bill.customer_id if bill else None),
        kind=kind,
        mode=mode,
        amount=money(amount),
        utr=utr or None,
        payer_vpa=payer_vpa or None,
        payer_name=payer_name or None,
        gateway_status="success",
        match_status=match_status,
        source=source,
        note=note,
        created_by=user.id if user else None,
    )
    db.add(p)
    db.flush()
    return p


def checkout(db: Session, bill: Bill, cash_amount, upi_amount, user: User) -> UpiRequest | None:
    """FR-07: UPI, cash, credit or any split. Returns the QR request when UPI is part of the payment."""
    from .upi import create_upi_request

    if bill.status not in OPEN_STATUSES:
        raise HTTPException(400, f"Bill is already {bill.status}")
    if not bill.items:
        raise HTTPException(400, "Add at least one item before checkout")

    problems = stock_problems(db, bill)
    if problems and not app_settings.get_value(db, "allow_zero_stock_sale"):
        names = ", ".join(p["name"] for p in problems)
        raise HTTPException(400, f"Not enough stock for: {names}. Selling without stock is blocked in settings.")

    cash, upi = money(cash_amount or 0), money(upi_amount or 0)
    if cash < 0 or upi < 0:
        raise HTTPException(400, "Amounts cannot be negative")
    paid_so_far = bill_payments_total(db, bill.id)
    remaining = money(D(bill.total) - paid_so_far)
    if cash + upi > remaining + Decimal("0.009"):
        raise HTTPException(400, f"Cash + UPI ({cash + upi}) is more than the amount due ({remaining})")
    credit = money(remaining - cash - upi)
    if credit > 0 and not bill.customer_id:
        raise HTTPException(400, "Walk-in bills must be fully paid. Select a customer to sell on credit.")

    cancel_active_requests(db, bill.id, "Replaced at checkout")
    assign_bill_no(db, bill)

    if D(bill.discount) > 0:
        log_audit(db, user, "discount", "bill", bill.id,
                  f"Discount Rs. {bill.discount} on {bill.bill_no} (subtotal Rs. {bill.subtotal})",
                  new={"discount": bill.discount, "subtotal": bill.subtotal})

    if cash > 0:
        record_payment(db, amount=cash, mode="cash", bill=bill, user=user)

    if upi > 0:
        bill.status = "pending"
        req = create_upi_request(db, amount=upi, purpose="bill", bill=bill, customer_id=bill.customer_id, user=user)
        return req

    complete_bill(db, bill, user)
    return None


def cancel_bill(db: Session, bill: Bill, user: User, reason: str | None) -> str:
    """Draft -> deleted. Pending -> cancelled (money already taken is refunded). Completed -> use returns."""
    if bill.completed_at is not None:
        raise HTTPException(400, "Completed bills cannot be cancelled. Record a sales return instead.")
    if bill.status == "cancelled":
        raise HTTPException(400, "Bill is already cancelled")
    label = bill.bill_no or f"draft #{bill.id}"
    if bill.status == "draft":
        log_audit(db, user, "delete", "bill", bill.id, f"Deleted draft {label}",
                  old={"total": bill.total, "items": len(bill.items)})
        cancel_active_requests(db, bill.id, "Draft deleted")
        db.delete(bill)
        return "deleted"

    taken = bill_payments_total(db, bill.id)
    if taken > 0 and user.role != "owner":
        raise HTTPException(403, "This bill already has payments. Only the owner can cancel it.")
    cancel_active_requests(db, bill.id, "Bill cancelled")
    if taken > 0:
        by_mode: dict[str, Decimal] = {}
        payments = db.execute(
            select(Payment).where(Payment.bill_id == bill.id, Payment.gateway_status == "success")
        ).scalars()
        for p in payments:
            by_mode[p.mode] = by_mode.get(p.mode, ZERO) + D(p.amount)
        for mode, mode_total in sorted(by_mode.items()):
            if mode_total > 0:
                record_payment(db, amount=-money(mode_total), mode=mode, bill=bill, user=user, kind="refund",
                               note=f"Refund on cancelling {label}")
    bill.status = "cancelled"
    bill.cancelled_at = now()
    log_audit(db, user, "cancel", "bill", bill.id, f"Cancelled pending bill {label}" + (f": {reason}" if reason else ""),
              old={"total": bill.total, "paid": taken})
    return "cancelled"


def create_return(db: Session, bill: Bill, items_in: list, refund_mode: str, reason: str | None, user: User) -> SalesReturn:
    """FR-29: returned items go back to stock; the bill amount is reversed by refund or ledger credit."""
    if bill.completed_at is None or bill.bill_type != "sale":
        raise HTTPException(400, "Only completed sale bills can have returns")
    if refund_mode not in ("cash", "upi", "ledger"):
        raise HTTPException(400, "Refund mode must be cash, upi or ledger")
    if refund_mode == "ledger" and not bill.customer_id:
        raise HTTPException(400, "Walk-in returns must be refunded (no customer ledger)")
    if not items_in:
        raise HTTPException(400, "Select at least one item to return")

    by_id = {i.id: i for i in bill.items}
    ratio = (D(bill.total) / D(bill.subtotal)) if D(bill.subtotal) > 0 else Decimal("1")
    ret = SalesReturn(bill_id=bill.id, customer_id=bill.customer_id, amount=ZERO, refund_mode=refund_mode,
                      reason=reason, created_by=user.id)
    db.add(ret)
    db.flush()
    ret.return_no = f"R{ret.id:06d}"
    amount = ZERO
    for it in items_in:
        item = by_id.get(int(it.bill_item_id))
        if item is None:
            raise HTTPException(400, f"Item #{it.bill_item_id} is not on this bill")
        q = qty(it.qty)
        if q <= 0:
            continue
        available = D(item.qty) - D(item.returned_qty)
        if q > available:
            raise HTTPException(400, f"Only {available.normalize()} of {item.product_name} can be returned")
        line_amount = money(q * D(item.unit_price) * ratio)
        item.returned_qty = qty(D(item.returned_qty) + q)
        amount += line_amount
        ret.items.append(SalesReturnItem(bill_item_id=item.id, product_id=item.product_id,
                                         product_name=item.product_name, qty=q, amount=line_amount))
        post_movement(db, item.product_id, "return", qty_in=q, ref_type="return", ref_id=ret.id,
                      ref_label=f"{ret.return_no} / {bill.bill_no}", reason=reason, user=user)
    if amount <= 0:
        raise HTTPException(400, "Nothing to return")
    amount = min(money(amount), money(D(bill.total) - D(bill.returned_amount)))
    ret.amount = amount

    paid_before = D(bill.paid_amount)
    bill.returned_amount = money(D(bill.returned_amount) + amount)
    new_net = D(bill.total) - D(bill.returned_amount)
    refund = ZERO
    if refund_mode in ("cash", "upi"):
        refund = money(max(ZERO, min(amount, paid_before - new_net)))
    ret.refund_amount = refund
    db.flush()

    if bill.customer_id:
        add_ledger(db, bill.customer_id, "return", credit=amount,
                   description=f"Return {ret.return_no} on {bill.bill_no}", bill_id=bill.id, return_id=ret.id)
    if refund > 0:
        p = record_payment(db, amount=-refund, mode=refund_mode, bill=bill, user=user, kind="refund",
                           note=f"Return {ret.return_no}")
        post_payment_ledger(db, p)
    refresh_bill_and_customer(db, bill)
    log_audit(db, user, "return", "bill", bill.id,
              f"Return {ret.return_no} on {bill.bill_no}: Rs. {amount} ({refund_mode}, refunded Rs. {refund})",
              new={"amount": amount, "refund": refund, "reason": reason})
    return ret
