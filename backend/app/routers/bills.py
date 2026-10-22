from datetime import date, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db, lock
from ..models import Bill, Customer, Payment, UpiRequest, User
from ..schemas import BillIn, CheckoutIn, DraftSyncIn, ManualUpiIn, ReturnIn
from ..security import get_current_user, require_owner
from ..serializers import bill_detail, bill_summary
from ..services import app_settings
from ..services.audit import log_audit
from ..services.billing import (
    apply_discount,
    cancel_active_requests,
    cancel_bill,
    checkout,
    complete_bill,
    create_return,
    record_payment,
    set_customer,
    set_items,
    stock_problems,
)
from ..services.ledger import bill_payments_total, post_payment_ledger, refresh_bill_and_customer
from ..services.upi import create_upi_request, request_dict
from ..utils import D, money

router = APIRouter(prefix="/api/bills", tags=["billing"])


def _load(db: Session, bill_id: int, for_update: bool = False) -> Bill:
    bill = lock(db, Bill, bill_id) if for_update else db.get(Bill, bill_id)
    if bill is None:
        raise HTTPException(404, "Bill not found")
    return bill


def _detail(db: Session, bill: Bill) -> dict:
    db.refresh(bill)
    return bill_detail(db, bill)


@router.get("")
def list_bills(
    status: str | None = None,
    q: str | None = None,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    bill_type: str = Query(default="sale", pattern="^(sale|opening|all)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Bill)
    if bill_type != "all":
        query = query.where(Bill.bill_type == bill_type)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        query = query.where(Bill.status.in_(statuses))
    if customer_id:
        query = query.where(Bill.customer_id == customer_id)
    if q:
        term = q.strip()
        query = query.outerjoin(Customer, Customer.id == Bill.customer_id).where(
            or_(Bill.bill_no.like(f"%{term}%"), Customer.name.like(f"%{term}%"), Customer.mobile.like(f"%{term}%"))
        )
    if date_from:
        query = query.where(Bill.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(Bill.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar()
    rows = db.execute(
        query.options(selectinload(Bill.items), selectinload(Bill.customer), selectinload(Bill.creator))
        .order_by(Bill.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).scalars()
    return {"rows": [bill_summary(b) for b in rows], "total": total, "page": page, "page_size": page_size}


def _create_draft(db: Session, body: BillIn, user: User) -> Bill:
    bill = Bill(bill_type="sale", status="draft", created_by=user.id, notes=body.notes, client_ref=body.client_ref)
    db.add(bill)
    set_customer(db, bill, body.customer_id)
    set_items(db, bill, body.items, user)
    apply_discount(db, bill, body.discount, user)
    db.flush()
    return bill


@router.post("")
def create_bill(body: BillIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.client_ref:
        existing = db.execute(select(Bill).where(Bill.client_ref == body.client_ref)).scalar_one_or_none()
        if existing:
            return _detail(db, existing)
    bill = _create_draft(db, body, user)
    db.commit()
    return _detail(db, bill)


@router.post("/sync-drafts")
def sync_offline_drafts(body: DraftSyncIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Drafts saved while the counter was offline are pushed here once the connection is back."""
    synced = []
    for draft in body.drafts:
        if draft.client_ref:
            existing = db.execute(select(Bill).where(Bill.client_ref == draft.client_ref)).scalar_one_or_none()
            if existing:
                synced.append({"client_ref": draft.client_ref, "bill_id": existing.id, "status": "exists"})
                continue
        try:
            bill = _create_draft(db, draft, user)
            db.commit()
            synced.append({"client_ref": draft.client_ref, "bill_id": bill.id, "status": "created"})
        except HTTPException as exc:
            db.rollback()
            synced.append({"client_ref": draft.client_ref, "bill_id": None, "status": "error", "error": exc.detail})
    return {"results": synced}


@router.get("/{bill_id}")
def get_bill(bill_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return bill_detail(db, _load(db, bill_id))


@router.put("/{bill_id}")
def update_bill(bill_id: int, body: BillIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bill = _load(db, bill_id, for_update=True)
    if bill.status == "pending":
        if bill_payments_total(db, bill.id) > 0:
            raise HTTPException(400, "Payment already received on this bill; it cannot be edited")
        cancel_active_requests(db, bill.id, "Bill edited")
        bill.status = "draft"
    if bill.status != "draft":
        raise HTTPException(400, f"Only draft bills can be edited (this bill is {bill.status})")
    set_customer(db, bill, body.customer_id)
    set_items(db, bill, body.items, user)
    apply_discount(db, bill, body.discount, user)
    bill.notes = body.notes
    db.commit()
    return _detail(db, bill)


@router.delete("/{bill_id}")
def delete_or_cancel_bill(bill_id: int, reason: str | None = None, user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    bill = _load(db, bill_id, for_update=True)
    customer_id = bill.customer_id
    result = cancel_bill(db, bill, user, reason)
    if result == "cancelled":
        refresh_bill_and_customer(db, bill, customer_id)
    db.commit()
    return {"result": result}


@router.post("/{bill_id}/checkout")
def checkout_bill(bill_id: int, body: CheckoutIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bill = _load(db, bill_id, for_update=True)
    warnings = stock_problems(db, bill)
    req = checkout(db, bill, body.cash_amount, body.upi_amount, user)
    db.commit()
    data = {"bill": _detail(db, bill), "upi_request": None, "stock_warnings": warnings}
    if req is not None:
        db.refresh(req)
        data["upi_request"] = request_dict(req)
    return data


@router.post("/{bill_id}/upi-qr")
def new_qr(bill_id: int, amount: float | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """FR-13: retry with a fresh QR after a failed / expired / part payment."""
    bill = _load(db, bill_id, for_update=True)
    if bill.status in ("draft", "cancelled"):
        raise HTTPException(400, "Checkout the bill first")
    if bill.completed_at is not None:
        remaining = money(bill.due_amount)
    else:
        remaining = money(D(bill.total) - bill_payments_total(db, bill.id))
    if remaining <= 0:
        raise HTTPException(400, "Nothing is due on this bill")
    if amount is None:
        last = db.execute(
            select(UpiRequest).where(UpiRequest.bill_id == bill.id).order_by(UpiRequest.id.desc()).limit(1)
        ).scalar_one_or_none()
        amount = float(money(D(last.amount) - D(last.received_amount))) if last and D(last.amount) > D(last.received_amount) else float(remaining)
    if money(amount) > remaining:
        raise HTTPException(400, f"Amount is more than the bill's remaining Rs. {remaining}")
    cancel_active_requests(db, bill.id, "Replaced by a new QR")
    if bill.completed_at is None:
        bill.status = "pending"
    req = create_upi_request(db, amount=amount, purpose="bill", bill=bill, customer_id=bill.customer_id, user=user)
    db.commit()
    db.refresh(req)
    return request_dict(req)


@router.post("/{bill_id}/manual-upi")
def manual_upi(bill_id: int, body: ManualUpiIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    """Risk mitigation: customer paid to the old static QR - owner records it with the UTR."""
    bill = _load(db, bill_id, for_update=True)
    if bill.status in ("draft", "cancelled"):
        raise HTTPException(400, f"Cannot record a payment on a {bill.status} bill")
    utr = body.utr.strip()
    if db.execute(select(Payment.id).where(Payment.utr == utr)).scalar():
        raise HTTPException(400, "This UTR is already recorded")
    p = record_payment(db, amount=body.amount, mode="upi", bill=bill, user=owner, source="manual", utr=utr,
                       payer_vpa=(body.payer_vpa or "").strip().lower() or None, payer_name=body.payer_name,
                       match_status="manual", note="Marked paid manually with UTR")
    if bill.completed_at is None and bill_payments_total(db, bill.id) >= D(bill.total):
        cancel_active_requests(db, bill.id, "Paid manually")
        complete_bill(db, bill, owner)
    else:
        post_payment_ledger(db, p)
        refresh_bill_and_customer(db, bill)
    log_audit(db, owner, "manual_payment", "bill", bill.id, f"Marked Rs. {p.amount} UPI (UTR {utr}) on {bill.bill_no}",
              new={"amount": p.amount, "utr": utr})
    db.commit()
    return _detail(db, bill)


@router.post("/{bill_id}/returns")
def bill_return(bill_id: int, body: ReturnIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    bill = _load(db, bill_id, for_update=True)
    ret = create_return(db, bill, body.items, body.refund_mode, body.reason, owner)
    db.commit()
    return {"return_id": ret.id, "return_no": ret.return_no, "amount": float(ret.amount),
            "refund_amount": float(ret.refund_amount), "bill": _detail(db, bill)}


@router.get("/{bill_id}/share")
def share_bill(bill_id: int, channel: str = Query(default="whatsapp", pattern="^(whatsapp|sms)$"),
               mobile: str | None = None, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """FR-08: bill text for WhatsApp / SMS (opened on the counter device)."""
    bill = _load(db, bill_id)
    cfg = app_settings.get_all(db)
    number = "".join(ch for ch in (mobile or (bill.customer.mobile if bill.customer else "")) if ch.isdigit())[-10:]
    if len(number) != 10:
        raise HTTPException(400, "Enter the customer's 10-digit mobile number")
    if bill.customer is not None and not bill.customer.whatsapp_consent and not mobile:
        raise HTTPException(400, f"{bill.customer.name} has not consented to WhatsApp / SMS messages")
    lines = [f"*{cfg['shop_name']}*", f"Bill {bill.bill_no} - {bill.created_at:%d %b %Y %I:%M %p}", ""]
    for i in bill.items:
        lines.append(f"{i.product_name} x {D(i.qty).normalize()} = Rs. {money(i.line_total)}")
    lines.append("")
    if D(bill.discount) > 0:
        lines.append(f"Discount: Rs. {money(bill.discount)}")
    lines.append(f"Total: Rs. {money(bill.total)}")
    lines.append(f"Paid: Rs. {money(bill.paid_amount)}")
    if bill.completed_at and bill.due_amount > 0:
        lines.append(f"Due: Rs. {money(bill.due_amount)}")
    if cfg["receipt_footer"]:
        lines += ["", cfg["receipt_footer"]]
    message = "\n".join(lines)
    url = (f"https://wa.me/91{number}?text={quote(message)}" if channel == "whatsapp"
           else f"sms:+91{number}?body={quote(message)}")
    return {"message": message, "url": url}
