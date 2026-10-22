from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings as env
from ..database import get_db
from ..models import Bill, UpiRequest, User
from ..schemas import SimulateIn
from ..security import get_current_user
from ..serializers import bill_summary
from ..services import app_settings
from ..services.gateway import get_gateway
from ..services.upi import expire_if_needed, handle_webhook, poll_request, request_dict
from ..utils import D, money, now

router = APIRouter(prefix="/api", tags=["upi"])


def _get_request(db: Session, request_id: int) -> UpiRequest:
    req = db.get(UpiRequest, request_id)
    if req is None:
        raise HTTPException(404, "UPI request not found")
    return req


def _refresh_status(db: Session, req: UpiRequest) -> None:
    poll_request(db, req)
    expire_if_needed(db, req)
    db.commit()
    db.refresh(req)


def _status_payload(db: Session, req: UpiRequest) -> dict:
    data = request_dict(req)
    if req.bill_id:
        bill = db.get(Bill, req.bill_id)
        db.refresh(bill)
        data["bill"] = bill_summary(bill)
    return data


@router.get("/upi/requests")
def list_requests(status: str | None = None, limit: int = 50, _: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    q = select(UpiRequest).order_by(UpiRequest.id.desc()).limit(min(limit, 500))
    if status:
        q = q.where(UpiRequest.status.in_([s.strip() for s in status.split(",")]))
    return [request_dict(r) for r in db.execute(q).scalars()]


@router.get("/upi/requests/{request_id}")
def request_status(request_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Polled by the counter every 3 s while the QR is on screen (webhook fallback)."""
    req = _get_request(db, request_id)
    _refresh_status(db, req)
    return _status_payload(db, req)


@router.post("/upi/requests/{request_id}/cancel")
def cancel_request(request_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    req = _get_request(db, request_id)
    if req.status in ("active", "failed"):
        req.status = "cancelled"
        req.closed_reason = "Cancelled at counter"
        try:
            get_gateway(req.gateway).close_qr(db, req.gateway_qr_id)
        except Exception:
            pass
        db.commit()
    return request_dict(req)


def _simulate(db: Session, req: UpiRequest, body: SimulateIn) -> dict:
    if not env.is_mock_gateway or req.gateway != "mock":
        raise HTTPException(400, "The payment simulator only works with PAYMENT_GATEWAY=mock")
    from ..services.gateway.mock import MockGateway

    gateway: MockGateway = get_gateway("mock")  # type: ignore[assignment]
    left = money(D(req.amount) - D(req.received_amount))
    amount = money(body.amount) if body.amount else (left if left > 0 else money(req.amount))
    txn = gateway.record_txn(
        db, gateway_qr_id=req.gateway_qr_id, reference=req.ref, amount=amount, status=body.outcome,
        payer_vpa=(body.payer_vpa or "").strip().lower() or None, payer_name=body.payer_name,
        error_reason=None if body.outcome == "success" else "Payment declined by the payer's bank (simulated)",
    )
    db.commit()
    result = {"gateway_payment_id": txn.gateway_payment_id, "utr": txn.utr, "webhook": None}
    if body.deliver_webhook:
        raw = gateway.webhook_body(txn)
        result["webhook"] = handle_webhook(db, "mock", raw, {"x-mock-signature": gateway.sign(raw)})
    return result


@router.post("/upi/requests/{request_id}/simulate")
def simulate_payment(request_id: int, body: SimulateIn, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mock gateway only: pretend the customer paid / failed in their UPI app.

    With deliver_webhook=false the webhook is 'lost' and the status poll has to pick the payment up.
    """
    req = _get_request(db, request_id)
    result = _simulate(db, req, body)
    db.refresh(req)
    return {"simulation": result, "request": _status_payload(db, req)}


@router.get("/upi/active")
def active_request(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """For the customer-facing display: the QR currently on the counter (or one just paid)."""
    cfg = app_settings.get_all(db)
    recent = db.execute(
        select(UpiRequest)
        .where(UpiRequest.is_link.is_(False), UpiRequest.created_at >= now() - timedelta(minutes=30))
        .order_by(UpiRequest.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    data = None
    if recent is not None:
        if recent.status in ("active", "failed", "partially_paid"):
            _refresh_status(db, recent)
        show = recent.status in ("active", "failed", "partially_paid") or (
            recent.status == "paid" and recent.paid_at and recent.paid_at >= now() - timedelta(seconds=20)
        )
        if show:
            data = request_dict(recent)
    return {"shop_name": cfg["shop_name"], "shop_tagline": cfg["shop_tagline"], "request": data}


@router.post("/upi/webhook/{gateway_name}")
async def gateway_webhook(gateway_name: str, request: Request, db: Session = Depends(get_db)):
    """Public endpoint for the payment gateway. Signature-verified and idempotent."""
    if gateway_name.lower() != env.PAYMENT_GATEWAY.lower():
        raise HTTPException(404, "Unknown gateway")
    raw = await request.body()
    return handle_webhook(db, gateway_name.lower(), raw, dict(request.headers))


# ------------------------------------------------------------------ public payment page (no login)


def _public_payload(db: Session, req: UpiRequest) -> dict:
    cfg = app_settings.get_all(db)
    customer = req.customer or (req.bill.customer if req.bill else None)
    return {
        "shop_name": cfg["shop_name"],
        "shop_tagline": cfg["shop_tagline"],
        "customer_name": customer.name.split(" ")[0] if customer else None,
        "purpose": req.purpose,
        "bill_no": req.bill.bill_no if req.bill else None,
        "amount": float(req.amount),
        "received_amount": float(req.received_amount),
        "status": req.status,
        "payload": req.payload,
        "image_url": req.image_url,
        "expires_at": req.expires_at.isoformat(),
        "seconds_left": max(0, int((req.expires_at - now()).total_seconds())),
        "gateway_is_mock": env.is_mock_gateway,
    }


def _public_request(db: Session, token: str) -> UpiRequest:
    req = db.execute(select(UpiRequest).where(UpiRequest.public_token == token)).scalar_one_or_none()
    if req is None:
        raise HTTPException(404, "Payment link not found")
    return req


@router.get("/public/pay/{token}")
def public_pay(token: str, db: Session = Depends(get_db)):
    req = _public_request(db, token)
    _refresh_status(db, req)
    return _public_payload(db, req)


@router.post("/public/pay/{token}/simulate")
def public_simulate(token: str, body: SimulateIn, db: Session = Depends(get_db)):
    req = _public_request(db, token)
    if req.status not in ("active", "failed", "partially_paid"):
        raise HTTPException(400, f"This payment link is {req.status}")
    _simulate(db, req, body)
    db.refresh(req)
    return _public_payload(db, req)
