"""Customer ledger and bill settlement.

The ledger is append-only: every completed bill is a debit, every payment / return / write-off a
credit, refunds a debit. Bill-level paid amounts are recomputed from payments: a payment made for a
specific bill settles that bill first, and anything else (part payments, advances, excess) settles
the oldest open bill first (FR-16).
"""

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import lock
from ..models import Bill, Customer, LedgerEntry, Payment
from ..utils import D, ZERO, money

COMPLETED_STATUSES = ("paid", "part_paid", "credit", "returned")


def add_ledger(
    db: Session,
    customer_id: int,
    entry_type: str,
    debit=0,
    credit=0,
    description: str = "",
    bill_id: int | None = None,
    payment_id: int | None = None,
    return_id: int | None = None,
) -> LedgerEntry:
    customer = lock(db, Customer, customer_id)
    last = db.execute(
        select(LedgerEntry.balance_after)
        .where(LedgerEntry.customer_id == customer_id)
        .order_by(LedgerEntry.id.desc())
        .limit(1)
    ).scalar()
    balance = money(D(last) + D(debit) - D(credit))
    entry = LedgerEntry(
        customer_id=customer_id,
        entry_type=entry_type,
        bill_id=bill_id,
        payment_id=payment_id,
        return_id=return_id,
        description=description[:255],
        debit=money(debit),
        credit=money(credit),
        balance_after=balance,
    )
    db.add(entry)
    customer.balance = balance
    return entry


def payment_description(p: Payment) -> str:
    if p.kind == "writeoff":
        return "Due written off" + (f" - {p.note}" if p.note else "")
    if p.kind == "refund":
        return f"Refund ({p.mode.upper()})" + (f" - {p.note}" if p.note else "")
    label = "UPI payment" if p.mode == "upi" else "Cash payment"
    if p.utr:
        label += f" UTR {p.utr}"
    if p.bill_id and p.bill is not None and p.bill.bill_no:
        label += f" for {p.bill.bill_no}"
    return label


def post_payment_ledger(db: Session, p: Payment) -> None:
    """Post a successful payment to the customer's ledger once its bill (if any) is completed."""
    if p.ledger_posted or not p.customer_id or p.gateway_status != "success":
        return
    if p.bill_id:
        bill = db.get(Bill, p.bill_id)
        if bill is None or bill.completed_at is None:
            return
    amount = D(p.amount)
    if amount >= 0:
        entry_type = "writeoff" if p.kind == "writeoff" else "payment"
        add_ledger(db, p.customer_id, entry_type, credit=amount, description=payment_description(p),
                   bill_id=p.bill_id, payment_id=p.id)
    else:
        add_ledger(db, p.customer_id, "refund", debit=-amount, description=payment_description(p),
                   bill_id=p.bill_id, payment_id=p.id)
    p.ledger_posted = True


def derive_status(bill: Bill) -> str:
    if bill.completed_at is None:
        return bill.status
    net = D(bill.total) - D(bill.returned_amount)
    paid = D(bill.paid_amount)
    if D(bill.returned_amount) > 0 and net <= 0:
        return "returned"
    if paid >= net:
        return "paid"
    if paid > 0:
        return "part_paid"
    return "credit"


def _successful_bill_payments(db: Session, bill_id: int) -> Decimal:
    rows = db.execute(
        select(Payment.amount).where(Payment.bill_id == bill_id, Payment.gateway_status == "success")
    ).scalars()
    return sum((D(a) for a in rows), ZERO)


def bill_payments_total(db: Session, bill_id: int) -> Decimal:
    return money(_successful_bill_payments(db, bill_id))


def recompute_walkin_bill(db: Session, bill: Bill) -> None:
    net = D(bill.total) - D(bill.returned_amount)
    paid = _successful_bill_payments(db, bill.id)
    bill.paid_amount = money(min(max(paid, ZERO), max(net, ZERO)))
    bill.status = derive_status(bill)


def recompute_customer(db: Session, customer_id: int) -> Decimal:
    """Re-allocate a customer's payments to their completed bills. Returns the unallocated advance."""
    bills = list(
        db.execute(
            select(Bill)
            .where(Bill.customer_id == customer_id, Bill.completed_at.is_not(None), Bill.status != "cancelled")
            .order_by(Bill.completed_at, Bill.id)
        ).scalars()
    )
    bill_ids = {b.id for b in bills}
    payments = db.execute(
        select(Payment).where(Payment.customer_id == customer_id, Payment.gateway_status == "success")
    ).scalars()

    tagged: dict[int, Decimal] = defaultdict(lambda: ZERO)
    pool = ZERO
    for p in payments:
        if p.bill_id in bill_ids:
            tagged[p.bill_id] += D(p.amount)
        elif p.bill_id is None or p.ledger_posted:
            pool += D(p.amount)
        # payments for bills that are not completed yet (pending UPI) wait for completion

    for b in bills:
        net = max(D(b.total) - D(b.returned_amount), ZERO)
        t = tagged[b.id]
        paid = min(max(t, ZERO), net)
        pool += t - paid
        b.paid_amount = paid

    for b in bills:
        if pool <= 0:
            break
        net = max(D(b.total) - D(b.returned_amount), ZERO)
        need = net - D(b.paid_amount)
        if need > 0:
            take = min(need, pool)
            b.paid_amount = D(b.paid_amount) + take
            pool -= take

    for b in bills:
        b.paid_amount = money(b.paid_amount)
        b.status = derive_status(b)
    return money(max(pool, ZERO))


def refresh_bill_and_customer(db: Session, bill: Bill | None = None, customer_id: int | None = None) -> None:
    db.flush()
    cid = customer_id or (bill.customer_id if bill is not None else None)
    if cid:
        recompute_customer(db, cid)
    if bill is not None and bill.customer_id is None:
        recompute_walkin_bill(db, bill)


def customer_advance(db: Session, customer_id: int) -> Decimal:
    customer = db.get(Customer, customer_id)
    bal = D(customer.balance) if customer else ZERO
    return money(-bal) if bal < 0 else ZERO
