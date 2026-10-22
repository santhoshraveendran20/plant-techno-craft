from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings as env
from ..database import get_db
from ..models import Bill, Customer, CustomerVPA, LedgerEntry, Payment, Reminder, User
from ..schemas import AmountIn, CustomerIn, CustomerUpdate, DuePaymentIn, ReminderIn, VpaIn, WriteOffIn
from ..security import get_current_user, require_owner
from ..serializers import bill_summary, customer_dict, iso, payment_dict
from ..services import app_settings
from ..services.audit import log_audit
from ..services.billing import assign_bill_no, record_payment
from ..services.ledger import add_ledger, post_payment_ledger, refresh_bill_and_customer
from ..services.upi import create_upi_request, request_dict
from ..utils import D, ZERO, f, money, now, today

router = APIRouter(prefix="/api", tags=["customers & collections"])


def _get_customer(db: Session, customer_id: int) -> Customer:
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, "Customer not found")
    return c


def _oldest_due_dates(db: Session, customer_ids: list[int] | None = None) -> dict[int, object]:
    q = (
        select(Bill.customer_id, func.min(Bill.completed_at))
        .where(Bill.customer_id.is_not(None), Bill.status.in_(("credit", "part_paid")))
        .group_by(Bill.customer_id)
    )
    if customer_ids is not None:
        if not customer_ids:
            return {}
        q = q.where(Bill.customer_id.in_(customer_ids))
    return {cid: dt for cid, dt in db.execute(q).all()}


@router.get("/customers")
def list_customers(
    q: str | None = None,
    has_due: bool = False,
    limit: int = Query(default=500, le=2000),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Customer).options(selectinload(Customer.vpas)).order_by(Customer.name).limit(limit)
    if q:
        term = q.strip()
        query = query.where(or_(Customer.name.like(f"%{term}%"), Customer.mobile.like(f"%{term}%")))
    if has_due:
        query = query.where(Customer.balance > 0)
    return [customer_dict(c) for c in db.execute(query).scalars()]


@router.post("/customers")
def create_customer(body: CustomerIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.execute(select(Customer).where(Customer.mobile == body.mobile)).scalar_one_or_none():
        raise HTTPException(400, f"A customer with mobile {body.mobile} already exists")
    if body.opening_balance > 0 and user.role != "owner":
        raise HTTPException(403, "Only the owner can set an opening balance")
    c = Customer(
        name=body.name.strip(), mobile=body.mobile, email=body.email or None, address=body.address or None,
        opening_balance=money(body.opening_balance), whatsapp_consent=body.whatsapp_consent, notes=body.notes or None,
    )
    db.add(c)
    db.flush()
    for vpa in body.vpas:
        vpa = vpa.strip().lower()
        if vpa and not db.execute(select(CustomerVPA.id).where(CustomerVPA.vpa == vpa)).scalar():
            db.add(CustomerVPA(customer_id=c.id, vpa=vpa))
    if body.opening_balance > 0:
        ob = Bill(bill_type="opening", customer_id=c.id, status="credit", subtotal=money(body.opening_balance),
                  total=money(body.opening_balance), created_by=user.id, notes="Opening balance (paper book)")
        db.add(ob)
        assign_bill_no(db, ob)
        ob.completed_at = now()
        add_ledger(db, c.id, "opening", debit=ob.total, description="Opening balance", bill_id=ob.id)
        refresh_bill_and_customer(db, ob)
    log_audit(db, user, "create", "customer", c.id, f"Added customer {c.name} ({c.mobile})",
              new={"opening_balance": body.opening_balance})
    db.commit()
    db.refresh(c)
    return customer_dict(c)


@router.get("/customers/lookup")
def lookup_customer(mobile: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    digits = "".join(ch for ch in mobile if ch.isdigit())[-10:]
    c = db.execute(select(Customer).where(Customer.mobile == digits)).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "No customer with this mobile")
    return customer_dict(c)


@router.get("/customers/{customer_id}")
def get_customer(customer_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _get_customer(db, customer_id)
    data = customer_dict(c)
    stats = db.execute(
        select(func.count(Bill.id), func.coalesce(func.sum(Bill.total - Bill.returned_amount), 0), func.max(Bill.completed_at))
        .where(Bill.customer_id == c.id, Bill.bill_type == "sale", Bill.completed_at.is_not(None))
    ).one()
    oldest = _oldest_due_dates(db, [c.id]).get(c.id)
    data.update({
        "bill_count": int(stats[0]),
        "total_spent": f(money(stats[1])),
        "last_visit": iso(stats[2]),
        "oldest_due_date": oldest.date().isoformat() if oldest else None,
        "days_overdue": (today() - oldest.date()).days if oldest else 0,
        "reminder_count": db.execute(select(func.count(Reminder.id)).where(Reminder.customer_id == c.id)).scalar(),
    })
    return data


@router.put("/customers/{customer_id}")
def update_customer(customer_id: int, body: CustomerUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _get_customer(db, customer_id)
    old = {"name": c.name, "mobile": c.mobile, "whatsapp_consent": c.whatsapp_consent}
    if body.mobile and body.mobile != c.mobile:
        if db.execute(select(Customer).where(Customer.mobile == body.mobile, Customer.id != c.id)).scalar_one_or_none():
            raise HTTPException(400, "Another customer has this mobile number")
        c.mobile = body.mobile
    if body.name and body.name.strip():
        c.name = body.name.strip()
    for field in ("email", "address", "notes"):
        value = getattr(body, field)
        if value is not None:
            setattr(c, field, value.strip() or None)
    if body.whatsapp_consent is not None:
        c.whatsapp_consent = body.whatsapp_consent
    log_audit(db, user, "update", "customer", c.id, f"Edited customer {c.name}", old=old,
              new={"name": c.name, "mobile": c.mobile, "whatsapp_consent": c.whatsapp_consent})
    db.commit()
    db.refresh(c)
    return customer_dict(c)


@router.post("/customers/{customer_id}/vpas")
def add_vpa(customer_id: int, body: VpaIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _get_customer(db, customer_id)
    vpa = body.vpa.strip().lower()
    existing = db.execute(select(CustomerVPA).where(CustomerVPA.vpa == vpa)).scalar_one_or_none()
    if existing:
        owner = db.get(Customer, existing.customer_id)
        raise HTTPException(400, f"{vpa} is already linked to {owner.name if owner else 'another customer'}")
    db.add(CustomerVPA(customer_id=c.id, vpa=vpa))
    log_audit(db, user, "update", "customer", c.id, f"Linked UPI ID {vpa} to {c.name}")
    db.commit()
    db.refresh(c)
    return customer_dict(c)


@router.delete("/customers/{customer_id}/vpas/{vpa_id}")
def remove_vpa(customer_id: int, vpa_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _get_customer(db, customer_id)
    row = db.get(CustomerVPA, vpa_id)
    if row is None or row.customer_id != c.id:
        raise HTTPException(404, "UPI ID not found")
    log_audit(db, user, "update", "customer", c.id, f"Unlinked UPI ID {row.vpa} from {c.name}")
    db.delete(row)
    db.commit()
    db.refresh(c)
    return customer_dict(c)


@router.get("/customers/{customer_id}/ledger")
def customer_ledger(customer_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _get_customer(db, customer_id)
    entries = db.execute(
        select(LedgerEntry).where(LedgerEntry.customer_id == c.id).order_by(LedgerEntry.id)
    ).scalars()
    rows = [
        {
            "id": e.id, "entry_type": e.entry_type, "description": e.description, "debit": f(e.debit),
            "credit": f(e.credit), "balance_after": f(e.balance_after), "bill_id": e.bill_id,
            "payment_id": e.payment_id, "created_at": iso(e.created_at),
        }
        for e in entries
    ]
    return {"customer": customer_dict(c), "entries": rows}


@router.get("/customers/{customer_id}/bills")
def customer_bills(customer_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_customer(db, customer_id)
    bills = db.execute(
        select(Bill).options(selectinload(Bill.items), selectinload(Bill.customer), selectinload(Bill.creator))
        .where(Bill.customer_id == customer_id, Bill.status != "draft").order_by(Bill.id.desc())
    ).scalars()
    return [bill_summary(b) for b in bills]


@router.get("/customers/{customer_id}/payments")
def customer_payments(customer_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_customer(db, customer_id)
    rows = db.execute(
        select(Payment).options(selectinload(Payment.bill), selectinload(Payment.customer))
        .where(Payment.customer_id == customer_id).order_by(Payment.id.desc())
    ).scalars()
    return [payment_dict(p) for p in rows]


@router.post("/customers/{customer_id}/payments")
def receive_due_payment(customer_id: int, body: DuePaymentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Part / full / advance payment against dues; settles the oldest bill first (FR-16)."""
    c = _get_customer(db, customer_id)
    if body.mode == "upi":
        if user.role != "owner":
            raise HTTPException(403, "Only the owner can mark a UPI payment as received manually. Use a QR instead.")
        if not body.utr:
            raise HTTPException(400, "Enter the UTR / transaction ID of the UPI payment")
        if db.execute(select(Payment.id).where(Payment.utr == body.utr.strip())).scalar():
            raise HTTPException(400, "This UTR is already recorded")
    p = record_payment(
        db, amount=body.amount, mode=body.mode, customer_id=c.id, user=user,
        source="manual" if body.mode == "upi" else "counter",
        utr=body.utr.strip() if body.utr else None, payer_vpa=(body.payer_vpa or "").strip().lower() or None,
        match_status="manual" if body.mode == "upi" else "matched", note=body.note,
    )
    post_payment_ledger(db, p)
    refresh_bill_and_customer(db, customer_id=c.id)
    log_audit(db, user, "payment", "customer", c.id, f"Received Rs. {p.amount} ({body.mode}) from {c.name}",
              new={"amount": p.amount, "mode": body.mode, "utr": p.utr})
    db.commit()
    db.refresh(c)
    return {"payment": payment_dict(p), "customer": customer_dict(c)}


@router.post("/customers/{customer_id}/upi-qr")
def due_qr(customer_id: int, body: AmountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Dynamic QR at the counter for paying dues."""
    c = _get_customer(db, customer_id)
    req = create_upi_request(db, amount=body.amount, purpose="due", customer_id=c.id, user=user)
    db.commit()
    db.refresh(req)
    return request_dict(req)


def _link_url(token: str) -> str:
    return f"{env.PUBLIC_APP_URL.rstrip('/')}/pay/{token}"


@router.post("/customers/{customer_id}/payment-link")
def payment_link(customer_id: int, body: AmountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """FR-14: a UPI pay link the customer can open remotely."""
    c = _get_customer(db, customer_id)
    req = create_upi_request(db, amount=body.amount, purpose="due", customer_id=c.id, user=user, as_link=True)
    db.commit()
    db.refresh(req)
    data = request_dict(req)
    data["url"] = _link_url(req.public_token)
    return data


@router.post("/customers/{customer_id}/reminders")
def send_reminder(customer_id: int, body: ReminderIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    """FR-19: one-tap reminder. Returns a wa.me / sms: link that the owner's phone opens to send it."""
    c = _get_customer(db, customer_id)
    if not c.whatsapp_consent:
        raise HTTPException(400, f"{c.name} has not given consent for WhatsApp / SMS messages (DPDP Act). "
                                 "Record consent on the customer first.")
    due = D(c.balance)
    if due <= 0:
        raise HTTPException(400, f"{c.name} has no pending dues")
    cfg = app_settings.get_all(db)
    link = None
    if body.include_link:
        req = create_upi_request(db, amount=due, purpose="due", customer_id=c.id, user=owner, as_link=True)
        link = _link_url(req.public_token)
    oldest = _oldest_due_dates(db, [c.id]).get(c.id)
    message = cfg["reminder_template"]
    for key, value in {
        "name": c.name, "shop": cfg["shop_name"], "amount": f"{money(due):,.2f}",
        "since": oldest.strftime("%d %b %Y") if oldest else "-", "link": link or "",
    }.items():
        message = message.replace("{" + key + "}", str(value))
    message = message.strip()
    if body.channel == "whatsapp":
        url = f"https://wa.me/91{c.mobile}?text={quote(message)}"
    else:
        url = f"sms:+91{c.mobile}?body={quote(message)}"
    db.add(Reminder(customer_id=c.id, channel=body.channel, amount_due=money(due), message=message, link=link,
                    sent_by=owner.id))
    c.last_reminder_at = now()
    log_audit(db, owner, "reminder", "customer", c.id, f"{body.channel} reminder to {c.name} for Rs. {money(due)}")
    db.commit()
    return {"channel": body.channel, "url": url, "message": message, "payment_link": link}


@router.get("/customers/{customer_id}/reminders")
def list_reminders(customer_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Reminder).where(Reminder.customer_id == customer_id).order_by(Reminder.id.desc())).scalars()
    return [
        {"id": r.id, "channel": r.channel, "amount_due": f(r.amount_due), "message": r.message, "link": r.link,
         "created_at": iso(r.created_at)}
        for r in rows
    ]


@router.post("/customers/{customer_id}/writeoff")
def write_off(customer_id: int, body: WriteOffIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    c = _get_customer(db, customer_id)
    if money(body.amount) > money(c.balance):
        raise HTTPException(400, f"Write-off is more than the amount due (Rs. {money(c.balance)})")
    p = record_payment(db, amount=body.amount, mode="writeoff", customer_id=c.id, user=owner, kind="writeoff",
                       source="manual", note=body.reason)
    post_payment_ledger(db, p)
    refresh_bill_and_customer(db, customer_id=c.id)
    log_audit(db, owner, "writeoff", "customer", c.id, f"Wrote off Rs. {p.amount} for {c.name}: {body.reason}",
              new={"amount": p.amount, "reason": body.reason})
    db.commit()
    db.refresh(c)
    return customer_dict(c)


# ------------------------------------------------------------------ collections


@router.get("/dues")
def dues_list(
    q: str | None = None,
    min_days: int = 0,
    min_amount: float = 0,
    bucket: str | None = Query(default=None, pattern="^(0-30|31-60|60\\+)$"),
    sort: str = Query(default="amount", pattern="^(amount|days|name|last_reminder)$"),
    _: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """FR-18: customer, amount due, oldest due date, days overdue; sort and filter."""
    query = select(Customer).where(Customer.balance > 0)
    if q:
        query = query.where(or_(Customer.name.like(f"%{q.strip()}%"), Customer.mobile.like(f"%{q.strip()}%")))
    customers = list(db.execute(query).scalars())
    oldest = _oldest_due_dates(db, [c.id for c in customers])
    rows = []
    for c in customers:
        od = oldest.get(c.id)
        days = (today() - od.date()).days if od else 0
        if days < min_days or money(c.balance) < money(min_amount):
            continue
        b = "0-30" if days <= 30 else ("31-60" if days <= 60 else "60+")
        if bucket and b != bucket:
            continue
        rows.append({
            "customer_id": c.id, "name": c.name, "mobile": c.mobile, "amount_due": f(c.balance),
            "oldest_due_date": od.date().isoformat() if od else None, "days_overdue": days, "bucket": b,
            "whatsapp_consent": c.whatsapp_consent, "last_reminder_at": iso(c.last_reminder_at),
        })
    keys = {
        "amount": lambda r: -r["amount_due"],
        "days": lambda r: -r["days_overdue"],
        "name": lambda r: r["name"].lower(),
        "last_reminder": lambda r: r["last_reminder_at"] or "",
    }
    rows.sort(key=keys[sort])
    total = sum((D(r["amount_due"]) for r in rows), ZERO)
    return {"rows": rows, "total_due": f(money(total)), "customers": len(rows)}
