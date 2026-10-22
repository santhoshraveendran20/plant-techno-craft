from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import (
    Product,
    Purchase,
    PurchaseItem,
    StockAdjustment,
    StockCount,
    StockCountItem,
    StockMovement,
    Supplier,
    SupplierPayment,
    User,
)
from ..schemas import (
    AdjustmentIn,
    PurchaseIn,
    StockCountCreate,
    StockCountItemIn,
    SupplierIn,
    SupplierPaymentIn,
)
from ..security import get_current_user, require_owner
from ..serializers import iso, movement_dict
from ..services.audit import log_audit
from ..services.stock import post_movement, signed_change
from ..utils import D, ZERO, f, money, now, qty, today

router = APIRouter(prefix="/api", tags=["inventory"])


# ------------------------------------------------------------------ suppliers (FR-34)


def _supplier_totals(db: Session, supplier_id: int) -> dict:
    purchased = db.execute(
        select(func.coalesce(func.sum(Purchase.total), 0)).where(Purchase.supplier_id == supplier_id)
    ).scalar()
    paid = db.execute(
        select(func.coalesce(func.sum(SupplierPayment.amount), 0)).where(SupplierPayment.supplier_id == supplier_id)
    ).scalar()
    return {"purchased": f(money(purchased)), "paid": f(money(paid)), "payable": f(money(D(purchased) - D(paid)))}


def _supplier_dict(db: Session, s: Supplier) -> dict:
    return {
        "id": s.id, "name": s.name, "mobile": s.mobile, "gstin": s.gstin, "email": s.email,
        "address": s.address, "is_active": s.is_active, "created_at": iso(s.created_at),
        **_supplier_totals(db, s.id),
    }


@router.get("/suppliers")
def list_suppliers(_: User = Depends(require_owner), db: Session = Depends(get_db)):
    return [_supplier_dict(db, s) for s in db.execute(select(Supplier).order_by(Supplier.name)).scalars()]


@router.post("/suppliers")
def create_supplier(body: SupplierIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    s = Supplier(**body.model_dump())
    db.add(s)
    db.flush()
    log_audit(db, owner, "create", "supplier", s.id, f"Added supplier {s.name}")
    db.commit()
    return _supplier_dict(db, s)


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, body: SupplierIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, "Supplier not found")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    log_audit(db, owner, "update", "supplier", s.id, f"Edited supplier {s.name}")
    db.commit()
    return _supplier_dict(db, s)


@router.get("/suppliers/{supplier_id}")
def supplier_detail(supplier_id: int, _: User = Depends(require_owner), db: Session = Depends(get_db)):
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, "Supplier not found")
    data = _supplier_dict(db, s)
    purchases = db.execute(
        select(Purchase).options(selectinload(Purchase.items)).where(Purchase.supplier_id == s.id)
        .order_by(Purchase.invoice_date.desc(), Purchase.id.desc())
    ).scalars()
    data["purchases"] = [
        {"id": p.id, "invoice_no": p.invoice_no, "invoice_date": p.invoice_date.isoformat(), "total": f(p.total),
         "items": len(p.items)}
        for p in purchases
    ]
    products = db.execute(
        select(Product.id, Product.name, func.sum(PurchaseItem.qty), func.max(Purchase.invoice_date))
        .join(PurchaseItem, PurchaseItem.product_id == Product.id)
        .join(Purchase, Purchase.id == PurchaseItem.purchase_id)
        .where(Purchase.supplier_id == s.id)
        .group_by(Product.id, Product.name)
        .order_by(Product.name)
    ).all()
    data["products"] = [
        {"product_id": pid, "name": name, "total_qty": f(q), "last_purchase": d.isoformat() if d else None}
        for pid, name, q, d in products
    ]
    payments = db.execute(
        select(SupplierPayment).where(SupplierPayment.supplier_id == s.id).order_by(SupplierPayment.paid_on.desc())
    ).scalars()
    data["payments"] = [
        {"id": p.id, "amount": f(p.amount), "mode": p.mode, "reference": p.reference, "note": p.note,
         "paid_on": p.paid_on.isoformat()}
        for p in payments
    ]
    return data


@router.post("/suppliers/{supplier_id}/payments")
def pay_supplier(supplier_id: int, body: SupplierPaymentIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, "Supplier not found")
    p = SupplierPayment(supplier_id=s.id, amount=money(body.amount), mode=body.mode, reference=body.reference,
                        note=body.note, paid_on=body.paid_on or today(), created_by=owner.id)
    db.add(p)
    log_audit(db, owner, "payment", "supplier", s.id, f"Paid supplier {s.name} Rs. {p.amount} ({body.mode})")
    db.commit()
    return _supplier_dict(db, s)


# ------------------------------------------------------------------ purchases / stock-in (FR-27)


def _purchase_dict(p: Purchase, with_items: bool = False) -> dict:
    data = {
        "id": p.id, "supplier_id": p.supplier_id, "supplier_name": p.supplier.name if p.supplier else None,
        "invoice_no": p.invoice_no, "invoice_date": p.invoice_date.isoformat(), "total": f(p.total),
        "notes": p.notes, "item_count": len(p.items), "created_at": iso(p.created_at),
    }
    if with_items:
        data["items"] = [
            {"id": i.id, "product_id": i.product_id, "product_name": i.product.name if i.product else None,
             "qty": f(i.qty), "cost_price": f(i.cost_price), "line_total": f(i.line_total),
             "batch_no": i.batch_no, "expiry_date": i.expiry_date.isoformat() if i.expiry_date else None}
            for i in p.items
        ]
    return data


@router.get("/purchases")
def list_purchases(supplier_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
                   _: User = Depends(require_owner), db: Session = Depends(get_db)):
    q = select(Purchase).options(selectinload(Purchase.items), selectinload(Purchase.supplier)).order_by(
        Purchase.invoice_date.desc(), Purchase.id.desc())
    if supplier_id:
        q = q.where(Purchase.supplier_id == supplier_id)
    if date_from:
        q = q.where(Purchase.invoice_date >= date_from)
    if date_to:
        q = q.where(Purchase.invoice_date <= date_to)
    return [_purchase_dict(p) for p in db.execute(q.limit(500)).scalars()]


@router.get("/purchases/{purchase_id}")
def get_purchase(purchase_id: int, _: User = Depends(require_owner), db: Session = Depends(get_db)):
    p = db.get(Purchase, purchase_id)
    if p is None:
        raise HTTPException(404, "Purchase not found")
    return _purchase_dict(p, with_items=True)


@router.post("/purchases")
def create_purchase(body: PurchaseIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    supplier = db.get(Supplier, body.supplier_id)
    if supplier is None:
        raise HTTPException(400, "Supplier not found")
    invoice_no = body.invoice_no.strip()
    dup = db.execute(
        select(Purchase.id).where(Purchase.supplier_id == supplier.id, Purchase.invoice_no == invoice_no)
    ).scalar()
    if dup:
        raise HTTPException(400, f"Invoice {invoice_no} from {supplier.name} is already entered")
    purchase = Purchase(supplier_id=supplier.id, invoice_no=invoice_no, invoice_date=body.invoice_date,
                        notes=body.notes, created_by=owner.id)
    db.add(purchase)
    db.flush()
    total = ZERO
    for it in body.items:
        product = db.get(Product, it.product_id)
        if product is None:
            raise HTTPException(400, f"Product #{it.product_id} not found")
        line = money(qty(it.qty) * money(it.cost_price))
        total += line
        purchase.items.append(PurchaseItem(
            product_id=product.id, qty=qty(it.qty), cost_price=money(it.cost_price), line_total=line,
            batch_no=(it.batch_no or "").strip() or None, expiry_date=it.expiry_date,
        ))
        post_movement(db, product.id, "purchase", qty_in=it.qty, ref_type="purchase", ref_id=purchase.id,
                      ref_label=f"{supplier.name} / {invoice_no}", user=owner)
        if body.update_cost_price and money(it.cost_price) > 0:
            product.cost_price = money(it.cost_price)
    purchase.total = money(total)
    log_audit(db, owner, "create", "purchase", purchase.id,
              f"Stock-in {invoice_no} from {supplier.name}: {len(body.items)} items, Rs. {purchase.total}")
    db.commit()
    db.refresh(purchase)
    return _purchase_dict(purchase, with_items=True)


# ------------------------------------------------------------------ stock movements (FR-31)


@router.get("/stock/movements")
def list_movements(
    product_id: int | None = None,
    movement_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=300, le=2000),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(StockMovement).options(selectinload(StockMovement.product), selectinload(StockMovement.user))
    if product_id:
        q = q.where(StockMovement.product_id == product_id)
    if movement_type:
        q = q.where(StockMovement.movement_type == movement_type)
    if date_from:
        q = q.where(StockMovement.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.where(StockMovement.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    return [movement_dict(m) for m in db.execute(q.order_by(StockMovement.id.desc()).limit(limit)).scalars()]


# ------------------------------------------------------------------ adjustments (FR-30)


def _adjustment_dict(a: StockAdjustment) -> dict:
    return {
        "id": a.id, "product_id": a.product_id, "product_name": a.product.name if a.product else None,
        "unit": a.product.unit if a.product else None, "stock_qty": f(a.product.stock_qty) if a.product else None,
        "qty_change": f(a.qty_change), "reason": a.reason, "note": a.note, "status": a.status,
        "requested_by": a.requester.name if a.requester else None,
        "approved_by": a.approver.name if a.approver else None,
        "created_at": iso(a.created_at), "decided_at": iso(a.decided_at),
    }


def _apply_adjustment(db: Session, a: StockAdjustment, owner: User) -> None:
    q_in, q_out = signed_change(a.qty_change)
    post_movement(db, a.product_id, "adjustment", qty_in=q_in, qty_out=q_out, ref_type="adjustment", ref_id=a.id,
                  ref_label=f"ADJ{a.id}", reason=f"{a.reason}" + (f": {a.note}" if a.note else ""), user=owner)
    a.status = "approved"
    a.approved_by = owner.id
    a.decided_at = now()


@router.get("/stock/adjustments")
def list_adjustments(status: str | None = None, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(StockAdjustment).options(
        selectinload(StockAdjustment.product), selectinload(StockAdjustment.requester),
        selectinload(StockAdjustment.approver),
    ).order_by(StockAdjustment.id.desc()).limit(500)
    if status:
        q = q.where(StockAdjustment.status == status)
    return [_adjustment_dict(a) for a in db.execute(q).scalars()]


@router.post("/stock/adjustments")
def create_adjustment(body: AdjustmentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    product = db.get(Product, body.product_id)
    if product is None:
        raise HTTPException(400, "Product not found")
    a = StockAdjustment(product_id=product.id, qty_change=qty(body.qty_change), reason=body.reason, note=body.note,
                        status="pending", requested_by=user.id)
    db.add(a)
    db.flush()
    if user.role == "owner":
        _apply_adjustment(db, a, user)
    log_audit(db, user, "adjustment", "product", product.id,
              f"Stock adjustment {body.qty_change:+g} {product.unit} of {product.name} ({body.reason})"
              + (" - awaiting owner approval" if a.status == "pending" else ""),
              new={"qty_change": body.qty_change, "reason": body.reason, "note": body.note})
    db.commit()
    db.refresh(a)
    return _adjustment_dict(a)


@router.post("/stock/adjustments/{adjustment_id}/{decision}")
def decide_adjustment(adjustment_id: int, decision: str, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    if decision not in ("approve", "reject"):
        raise HTTPException(404, "Unknown action")
    a = db.get(StockAdjustment, adjustment_id)
    if a is None:
        raise HTTPException(404, "Adjustment not found")
    if a.status != "pending":
        raise HTTPException(400, f"Adjustment is already {a.status}")
    if decision == "approve":
        _apply_adjustment(db, a, owner)
    else:
        a.status = "rejected"
        a.approved_by = owner.id
        a.decided_at = now()
    log_audit(db, owner, f"adjustment_{decision}", "product", a.product_id,
              f"{decision.title()}d stock adjustment #{a.id} ({f(a.qty_change):+g})")
    db.commit()
    db.refresh(a)
    return _adjustment_dict(a)


# ------------------------------------------------------------------ physical stock count (FR-35)


def _count_dict(c: StockCount) -> dict:
    items = []
    for i in c.items:
        system = D(i.system_qty) if i.system_qty is not None else D(i.product.stock_qty)
        items.append({
            "id": i.id, "product_id": i.product_id, "product_name": i.product.name, "barcode": i.product.barcode,
            "unit": i.product.unit, "counted_qty": f(i.counted_qty), "system_qty": f(system),
            "difference": f(D(i.counted_qty) - system),
        })
    return {
        "id": c.id, "status": c.status, "note": c.note, "created_at": iso(c.created_at),
        "posted_at": iso(c.posted_at), "items": items,
        "mismatches": sum(1 for i in items if i["difference"] != 0),
        "accuracy_pct": round(100 * sum(1 for i in items if i["difference"] == 0) / len(items), 1) if items else None,
    }


def _load_count(db: Session, count_id: int) -> StockCount:
    c = db.execute(
        select(StockCount).options(selectinload(StockCount.items).selectinload(StockCountItem.product))
        .where(StockCount.id == count_id)
    ).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "Stock count not found")
    return c


@router.get("/stock/counts")
def list_counts(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    counts = db.execute(
        select(StockCount).options(selectinload(StockCount.items).selectinload(StockCountItem.product))
        .order_by(StockCount.id.desc()).limit(100)
    ).scalars()
    return [{k: v for k, v in _count_dict(c).items() if k != "items"} | {"item_count": len(c.items)} for c in counts]


@router.post("/stock/counts")
def create_count(body: StockCountCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = StockCount(note=body.note, created_by=user.id)
    db.add(c)
    db.commit()
    return _count_dict(_load_count(db, c.id))


@router.get("/stock/counts/{count_id}")
def get_count(count_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _count_dict(_load_count(db, count_id))


@router.post("/stock/counts/{count_id}/items")
def count_item(count_id: int, body: StockCountItemIn, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _load_count(db, count_id)
    if c.status != "open":
        raise HTTPException(400, "This count is closed")
    if body.product_id:
        product = db.get(Product, body.product_id)
    elif body.barcode:
        product = db.execute(select(Product).where(Product.barcode == body.barcode.strip())).scalar_one_or_none()
    else:
        product = None
    if product is None:
        raise HTTPException(404, "Product not found")
    item = next((i for i in c.items if i.product_id == product.id), None)
    if item is None:
        item = StockCountItem(product_id=product.id, counted_qty=qty(0))
        c.items.append(item)
    if body.counted_qty is not None:
        item.counted_qty = qty(body.counted_qty)
    else:
        item.counted_qty = qty(max(D(item.counted_qty) + D(body.increment if body.increment is not None else 1), 0))
    db.commit()
    return _count_dict(_load_count(db, count_id))


@router.delete("/stock/counts/{count_id}/items/{item_id}")
def remove_count_item(count_id: int, item_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _load_count(db, count_id)
    if c.status != "open":
        raise HTTPException(400, "This count is closed")
    item = next((i for i in c.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(404, "Item not found")
    c.items.remove(item)
    db.commit()
    return _count_dict(_load_count(db, count_id))


@router.post("/stock/counts/{count_id}/post")
def post_count(count_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    """Post differences between counted and system stock as 'count' movements."""
    c = _load_count(db, count_id)
    if c.status != "open":
        raise HTTPException(400, f"Count is already {c.status}")
    if not c.items:
        raise HTTPException(400, "Scan at least one item before posting")
    changed = 0
    for i in c.items:
        system = D(db.get(Product, i.product_id).stock_qty)
        diff = qty(D(i.counted_qty) - system)
        i.system_qty = qty(system)
        i.difference = diff
        if diff != 0:
            q_in, q_out = signed_change(diff)
            post_movement(db, i.product_id, "count", qty_in=q_in, qty_out=q_out, ref_type="count", ref_id=c.id,
                          ref_label=f"COUNT{c.id}", reason="Physical stock count", user=owner)
            changed += 1
    c.status = "posted"
    c.posted_at = now()
    c.posted_by = owner.id
    log_audit(db, owner, "stock_count", "stock_count", c.id, f"Posted stock count #{c.id}: {changed} differences")
    db.commit()
    return _count_dict(_load_count(db, count_id))


@router.post("/stock/counts/{count_id}/cancel")
def cancel_count(count_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _load_count(db, count_id)
    if c.status != "open":
        raise HTTPException(400, f"Count is already {c.status}")
    c.status = "cancelled"
    db.commit()
    return _count_dict(_load_count(db, count_id))
