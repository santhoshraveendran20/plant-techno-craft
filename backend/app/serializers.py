from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Bill,
    Customer,
    Payment,
    Product,
    SalesReturn,
    StockMovement,
    UpiRequest,
    User,
)
from .services.upi import request_dict
from .utils import D, f


def iso(dt):
    return dt.isoformat() if dt else None


def user_dict(u: User) -> dict:
    return {
        "id": u.id, "name": u.name, "username": u.username, "role": u.role, "is_active": u.is_active,
        "created_at": iso(u.created_at), "last_login_at": iso(u.last_login_at),
    }


def product_dict(p: Product, include_cost: bool = True) -> dict:
    stock = D(p.stock_qty)
    data = {
        "id": p.id,
        "name": p.name,
        "category_id": p.category_id,
        "category": p.category.name if p.category else None,
        "barcode": p.barcode,
        "unit": p.unit,
        "selling_price": f(p.selling_price),
        "stock_qty": f(p.stock_qty),
        "reorder_level": f(p.reorder_level),
        "track_expiry": p.track_expiry,
        "is_active": p.is_active,
        "stock_status": "out" if stock <= 0 else ("low" if stock <= D(p.reorder_level) else "ok"),
        "created_at": iso(p.created_at),
    }
    if include_cost:
        data["cost_price"] = f(p.cost_price)
    return data


def customer_dict(c: Customer) -> dict:
    bal = D(c.balance)
    return {
        "id": c.id,
        "name": c.name,
        "mobile": c.mobile,
        "email": c.email,
        "address": c.address,
        "opening_balance": f(c.opening_balance),
        "balance": f(bal),
        "due": f(bal) if bal > 0 else 0.0,
        "advance": f(-bal) if bal < 0 else 0.0,
        "whatsapp_consent": c.whatsapp_consent,
        "notes": c.notes,
        "vpas": [{"id": v.id, "vpa": v.vpa} for v in c.vpas],
        "last_reminder_at": iso(c.last_reminder_at),
        "created_at": iso(c.created_at),
    }


def bill_summary(b: Bill) -> dict:
    return {
        "id": b.id,
        "bill_no": b.bill_no,
        "bill_type": b.bill_type,
        "status": b.status,
        "customer_id": b.customer_id,
        "customer_name": b.customer.name if b.customer else None,
        "customer_mobile": b.customer.mobile if b.customer else None,
        "subtotal": f(b.subtotal),
        "discount": f(b.discount),
        "total": f(b.total),
        "paid_amount": f(b.paid_amount),
        "returned_amount": f(b.returned_amount),
        "due_amount": f(b.due_amount) if b.completed_at else f(D(b.total) - D(b.paid_amount)),
        "item_count": len(b.items),
        "created_by": b.creator.name if b.creator else None,
        "created_at": iso(b.created_at),
        "completed_at": iso(b.completed_at),
        "notes": b.notes,
    }


def payment_dict(p: Payment) -> dict:
    return {
        "id": p.id,
        "bill_id": p.bill_id,
        "bill_no": p.bill.bill_no if p.bill else None,
        "customer_id": p.customer_id,
        "customer_name": p.customer.name if p.customer else None,
        "kind": p.kind,
        "mode": p.mode,
        "amount": f(p.amount),
        "utr": p.utr,
        "gateway_payment_id": p.gateway_payment_id,
        "payer_vpa": p.payer_vpa,
        "payer_name": p.payer_name,
        "gateway_status": p.gateway_status,
        "match_status": p.match_status,
        "source": p.source,
        "settlement_id": p.settlement_id,
        "note": p.note,
        "created_at": iso(p.created_at),
    }


def bill_detail(db: Session, b: Bill) -> dict:
    data = bill_summary(b)
    data["items"] = [
        {
            "id": i.id, "product_id": i.product_id, "product_name": i.product_name, "barcode": i.barcode,
            "unit": i.unit, "qty": f(i.qty), "unit_price": f(i.unit_price), "line_total": f(i.line_total),
            "returned_qty": f(i.returned_qty),
            "stock_qty": f(i.product.stock_qty) if i.product else None,
        }
        for i in b.items
    ]
    payments = db.execute(select(Payment).where(Payment.bill_id == b.id).order_by(Payment.id)).scalars()
    data["payments"] = [payment_dict(p) for p in payments]
    reqs = db.execute(select(UpiRequest).where(UpiRequest.bill_id == b.id).order_by(UpiRequest.id.desc())).scalars()
    data["upi_requests"] = [request_dict(r) for r in reqs]
    returns = db.execute(select(SalesReturn).where(SalesReturn.bill_id == b.id).order_by(SalesReturn.id)).scalars()
    data["returns"] = [
        {
            "id": r.id, "return_no": r.return_no, "amount": f(r.amount), "refund_amount": f(r.refund_amount),
            "refund_mode": r.refund_mode, "reason": r.reason, "created_at": iso(r.created_at),
            "items": [{"product_name": i.product_name, "qty": f(i.qty), "amount": f(i.amount)} for i in r.items],
        }
        for r in returns
    ]
    if b.customer is not None:
        data["customer"] = {
            "id": b.customer.id, "name": b.customer.name, "mobile": b.customer.mobile,
            "balance": f(b.customer.balance), "whatsapp_consent": b.customer.whatsapp_consent,
        }
    return data


def movement_dict(m: StockMovement) -> dict:
    return {
        "id": m.id,
        "product_id": m.product_id,
        "product_name": m.product.name if m.product else None,
        "movement_type": m.movement_type,
        "qty_in": f(m.qty_in),
        "qty_out": f(m.qty_out),
        "balance_after": f(m.balance_after),
        "ref_type": m.ref_type,
        "ref_id": m.ref_id,
        "ref_label": m.ref_label,
        "reason": m.reason,
        "user": m.user.name if m.user else None,
        "created_at": iso(m.created_at),
    }
