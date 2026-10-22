from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AuditLog, Payment, StockAdjustment, UpiRequest, User, WebhookEvent
from ..security import get_current_user, require_owner
from ..serializers import iso
from ..services import analytics
from ..utils import now

router = APIRouter(prefix="/api", tags=["audit & notifications"])


@router.get("/audit")
def audit_log(
    action: str | None = None,
    entity: str | None = None,
    user_id: int | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    _: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action == action)
    if entity:
        query = query.where(AuditLog.entity == entity)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    if q:
        query = query.where(or_(AuditLog.summary.like(f"%{q}%"), AuditLog.username.like(f"%{q}%")))
    if date_from:
        query = query.where(AuditLog.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar()
    rows = db.execute(query.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).scalars()
    actions = [a for (a,) in db.execute(select(AuditLog.action).distinct().order_by(AuditLog.action)).all()]
    return {
        "rows": [
            {"id": a.id, "username": a.username, "role": a.role, "action": a.action, "entity": a.entity,
             "entity_id": a.entity_id, "summary": a.summary, "old_value": a.old_value, "new_value": a.new_value,
             "created_at": iso(a.created_at)}
            for a in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "actions": actions,
    }


@router.get("/notifications")
def notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Low / out of stock (FR-32), pending approvals, UPI problems, near-expiry batches."""
    items = []
    low = analytics.low_stock(db)
    out = [p for p in low if p["status"] == "out"]
    if out:
        items.append({"type": "out_of_stock", "severity": "critical", "title": f"{len(out)} products out of stock",
                       "detail": ", ".join(p["name"] for p in out[:4]) + ("..." if len(out) > 4 else ""),
                       "link": "/products?stock=out"})
    low_only = [p for p in low if p["status"] == "low"]
    if low_only:
        items.append({"type": "low_stock", "severity": "warning", "title": f"{len(low_only)} products running low",
                      "detail": ", ".join(p["name"] for p in low_only[:4]) + ("..." if len(low_only) > 4 else ""),
                      "link": "/products?stock=low"})
    since = now() - timedelta(hours=24)
    problems = db.execute(
        select(func.count(Payment.id)).where(
            Payment.created_at >= since, Payment.match_status.in_(("mismatch", "overpaid", "unlinked", "failed"))
        )
    ).scalar()
    if problems:
        items.append({"type": "upi_review", "severity": "serious",
                      "title": f"{problems} UPI payments need review",
                      "detail": "Failed, part-paid, overpaid or unlinked in the last 24 hours",
                      "link": "/payments?review=1"})
    if user.role == "owner":
        pending_adj = db.execute(
            select(func.count(StockAdjustment.id)).where(StockAdjustment.status == "pending")
        ).scalar()
        if pending_adj:
            items.append({"type": "approval", "severity": "warning",
                          "title": f"{pending_adj} stock adjustments awaiting approval",
                          "detail": "Requested by staff", "link": "/stock/adjustments"})
        failed_hooks = db.execute(
            select(func.count(WebhookEvent.id)).where(WebhookEvent.processed.is_(False),
                                                      WebhookEvent.signature_valid.is_(True))
        ).scalar()
        if failed_hooks:
            items.append({"type": "webhook", "severity": "serious",
                          "title": f"{failed_hooks} webhooks failed to process",
                          "detail": "Retry them from Reconciliation", "link": "/reconciliation"})
        expiring = analytics.expiry_report(db)
        if expiring:
            expired = sum(1 for e in expiring if e["status"] == "expired")
            items.append({"type": "expiry", "severity": "critical" if expired else "warning",
                          "title": f"{len(expiring)} batches expired or expiring soon",
                          "detail": ", ".join(e["name"] for e in expiring[:3]) + ("..." if len(expiring) > 3 else ""),
                          "link": "/reports?tab=expiry"})
    active_qr = db.execute(select(func.count(UpiRequest.id)).where(UpiRequest.status == "active",
                                                                   UpiRequest.is_link.is_(False))).scalar()
    return {"count": len(items), "items": items, "active_qr": active_qr}
