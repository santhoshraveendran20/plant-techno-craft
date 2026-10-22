from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Settlement, SettlementItem, User, WebhookEvent
from ..schemas import BankCreditIn
from ..security import require_owner
from ..serializers import iso
from ..services import recon
from ..services.audit import log_audit
from ..services.upi import retry_webhook_event
from ..utils import money, today

router = APIRouter(prefix="/api/recon", tags=["reconciliation"])


@router.get("")
def recon_report(for_date: date | None = None, _: User = Depends(require_owner), db: Session = Depends(get_db)):
    return recon.report(db, for_date or today())


@router.get("/summary")
def recon_summary(days: int = Query(default=14, ge=1, le=60), _: User = Depends(require_owner), db: Session = Depends(get_db)):
    return recon.summary(db, days)


@router.post("/fetch")
def fetch_settlement(for_date: date, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    if for_date > today():
        raise HTTPException(400, "Cannot reconcile a future date")
    try:
        stored = recon.fetch_settlements(db, for_date)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, f"Could not fetch the settlement report: {exc}") from exc
    log_audit(db, owner, "recon_fetch", "settlement", None,
              f"Fetched {len(stored)} settlement report(s) for {for_date.isoformat()}")
    db.commit()
    return recon.report(db, for_date)


@router.post("/settlements/{settlement_id}/bank-credit")
def confirm_bank_credit(settlement_id: int, body: BankCreditIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    s = db.get(Settlement, settlement_id)
    if s is None:
        raise HTTPException(404, "Settlement not found")
    s.bank_credit_amount = money(body.amount)
    s.bank_credit_date = body.credit_date or today()
    s.bank_credit_ref = body.reference or s.bank_utr
    log_audit(db, owner, "bank_credit", "settlement", s.id,
              f"Bank credit Rs. {s.bank_credit_amount} for {s.gateway_settlement_id} (net Rs. {s.net})")
    db.commit()
    return recon.report(db, s.payments_date)


@router.post("/items/{item_id}/import")
def import_item(item_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    item = db.get(SettlementItem, item_id)
    if item is None:
        raise HTTPException(404, "Settlement item not found")
    if item.match_status != "missing_in_app":
        raise HTTPException(400, "This item is already matched")
    payment = recon.import_missing_item(db, item)
    log_audit(db, owner, "recon_import", "payment", payment.id if payment else None,
              f"Imported missed gateway payment {item.gateway_payment_id} (Rs. {item.amount})")
    db.commit()
    return recon.report(db, item.settlement.payments_date)


@router.get("/webhooks")
def webhook_log(failed_only: bool = False, limit: int = Query(default=100, le=500),
                _: User = Depends(require_owner), db: Session = Depends(get_db)):
    q = select(WebhookEvent).order_by(WebhookEvent.id.desc()).limit(limit)
    if failed_only:
        q = q.where(WebhookEvent.processed.is_(False))
    return [
        {"id": e.id, "gateway": e.gateway, "event_id": e.event_id, "event_type": e.event_type,
         "signature_valid": e.signature_valid, "processed": e.processed, "error": e.error,
         "received_at": iso(e.received_at), "processed_at": iso(e.processed_at), "payload": e.payload[:2000]}
        for e in db.execute(q).scalars()
    ]


@router.post("/webhooks/{event_id}/retry")
def retry_webhook(event_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    e = db.get(WebhookEvent, event_id)
    if e is None:
        raise HTTPException(404, "Webhook event not found")
    if not e.signature_valid:
        raise HTTPException(400, "Events with an invalid signature are never processed")
    if e.processed:
        return {"status": "already_processed"}
    result = retry_webhook_event(db, e)
    log_audit(db, owner, "webhook_retry", "webhook", e.id, f"Retried webhook {e.event_id}")
    db.commit()
    return result
