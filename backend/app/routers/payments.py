from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Bill, Customer, Payment, User
from ..security import get_current_user, require_owner
from ..serializers import payment_dict
from ..services.audit import log_audit
from ..services.ledger import post_payment_ledger, refresh_bill_and_customer
from ..services.upi import remember_vpa
from ..utils import D, f, money, now

router = APIRouter(prefix="/api/payments", tags=["payments"])


class LinkCustomerIn(BaseModel):
    customer_id: int
    remember_vpa: bool = True


@router.get("")
def list_payments(
    mode: str | None = Query(default=None, pattern="^(upi|cash|writeoff)$"),
    kind: str | None = Query(default=None, pattern="^(payment|refund|writeoff)$"),
    gateway_status: str | None = Query(default=None, pattern="^(success|failed|pending)$"),
    match_status: str | None = None,
    source: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Payment)
    if mode:
        query = query.where(Payment.mode == mode)
    if kind:
        query = query.where(Payment.kind == kind)
    if gateway_status:
        query = query.where(Payment.gateway_status == gateway_status)
    if match_status:
        query = query.where(Payment.match_status.in_([m.strip() for m in match_status.split(",")]))
    if source:
        query = query.where(Payment.source == source)
    if q:
        term = q.strip()
        query = (
            query.outerjoin(Bill, Bill.id == Payment.bill_id)
            .outerjoin(Customer, Customer.id == Payment.customer_id)
            .where(or_(
                Payment.utr.like(f"%{term}%"), Payment.payer_vpa.like(f"%{term}%"),
                Payment.payer_name.like(f"%{term}%"), Bill.bill_no.like(f"%{term}%"),
                Customer.name.like(f"%{term}%"), Customer.mobile.like(f"%{term}%"),
                Payment.gateway_payment_id.like(f"%{term}%"),
            ))
        )
    if date_from:
        query = query.where(Payment.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(Payment.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))

    sub = query.subquery()
    total_count = db.execute(select(func.count()).select_from(sub)).scalar()
    sums = db.execute(
        select(sub.c.mode, func.sum(sub.c.amount)).where(sub.c.gateway_status == "success").group_by(sub.c.mode)
    ).all()
    rows = db.execute(
        query.options(selectinload(Payment.bill), selectinload(Payment.customer))
        .order_by(Payment.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).scalars()
    return {
        "rows": [payment_dict(p) for p in rows],
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "sum_by_mode": {m: f(money(a)) for m, a in sums},
    }


@router.get("/daily")
def daily_collections(
    date_from: date | None = None,
    date_to: date | None = None,
    _: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Money received per day by mode (UPI / cash), for the payments chart."""
    date_to = date_to or now().date()
    date_from = date_from or (date_to - timedelta(days=13))
    if date_from > date_to:
        raise HTTPException(400, "date_from must be on or before date_to")
    if (date_to - date_from).days > 366:
        raise HTTPException(400, "Choose a range of one year or less")
    days = [date_from + timedelta(days=i) for i in range((date_to - date_from).days + 1)]
    sums = {d: {"upi": D(0), "cash": D(0), "refunds": D(0)} for d in days}
    rows = db.execute(
        select(Payment.created_at, Payment.mode, Payment.kind, Payment.amount).where(
            Payment.gateway_status == "success",
            Payment.kind.in_(("payment", "refund")),
            Payment.created_at >= datetime.combine(date_from, datetime.min.time()),
            Payment.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()),
        )
    ).all()
    for created_at, mode, kind, amount in rows:
        bucket = sums.get(created_at.date())
        if bucket is None:
            continue
        if kind == "refund":
            bucket["refunds"] += -D(amount)
        elif mode in ("upi", "cash"):
            bucket[mode] += D(amount)
    return {
        "labels": [d.isoformat() for d in days],
        "upi": [f(money(sums[d]["upi"])) for d in days],
        "cash": [f(money(sums[d]["cash"])) for d in days],
        "refunds": [f(money(sums[d]["refunds"])) for d in days],
        "totals": {
            "upi": f(money(sum((s["upi"] for s in sums.values()), D(0)))),
            "cash": f(money(sum((s["cash"] for s in sums.values()), D(0)))),
            "refunds": f(money(sum((s["refunds"] for s in sums.values()), D(0)))),
        },
    }


@router.get("/review")
def needs_review(days: int = 7, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Failed, part-paid, overpaid and unlinked UPI payments that a person should look at."""
    since = now() - timedelta(days=days)
    rows = db.execute(
        select(Payment).options(selectinload(Payment.bill), selectinload(Payment.customer))
        .where(Payment.created_at >= since,
               Payment.match_status.in_(("mismatch", "overpaid", "unlinked", "failed")))
        .order_by(Payment.id.desc())
    ).scalars()
    return [payment_dict(p) for p in rows]


@router.post("/{payment_id}/link-customer")
def link_customer(payment_id: int, body: LinkCustomerIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    """Attach an unlinked UPI credit (e.g. paid to a static QR) to a customer; it then settles their oldest dues."""
    p = db.get(Payment, payment_id)
    if p is None:
        raise HTTPException(404, "Payment not found")
    if p.gateway_status != "success" or p.kind != "payment":
        raise HTTPException(400, "Only successful payments can be linked")
    if p.customer_id is not None:
        raise HTTPException(400, "Payment is already linked to a customer")
    c = db.get(Customer, body.customer_id)
    if c is None:
        raise HTTPException(404, "Customer not found")
    if p.bill_id:
        from ..services.upi import link_bill_to_customer

        bill = db.get(Bill, p.bill_id)
        link_bill_to_customer(db, bill, c.id)
    else:
        p.customer_id = c.id
        post_payment_ledger(db, p)
    p.match_status = "matched"
    if body.remember_vpa:
        remember_vpa(db, c.id, p.payer_vpa)
    refresh_bill_and_customer(db, customer_id=c.id)
    log_audit(db, owner, "link_payment", "payment", p.id, f"Linked Rs. {p.amount} (UTR {p.utr}) to {c.name}")
    db.commit()
    db.refresh(p)
    return payment_dict(p)

