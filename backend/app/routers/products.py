import random

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Category, Product, PurchaseItem, StockMovement, User
from ..schemas import CategoryIn, ProductIn
from ..security import get_current_user, require_owner
from ..serializers import movement_dict, product_dict
from ..services.audit import log_audit
from ..services.stock import post_movement
from ..utils import ean13_check_digit, f, money, qty

router = APIRouter(prefix="/api", tags=["catalogue"])


# ------------------------------------------------------------------ categories


@router.get("/categories")
def list_categories(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Category, func.count(Product.id))
        .outerjoin(Product, (Product.category_id == Category.id) & (Product.is_active.is_(True)))
        .group_by(Category.id)
        .order_by(Category.name)
    ).all()
    return [{"id": c.id, "name": c.name, "product_count": n} for c, n in rows]


@router.post("/categories")
def create_category(body: CategoryIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    name = body.name.strip()
    if db.execute(select(Category).where(Category.name == name)).scalar_one_or_none():
        raise HTTPException(400, "Category already exists")
    c = Category(name=name)
    db.add(c)
    db.flush()
    log_audit(db, owner, "create", "category", c.id, f"Added category {name}")
    db.commit()
    return {"id": c.id, "name": c.name, "product_count": 0}


@router.put("/categories/{category_id}")
def rename_category(category_id: int, body: CategoryIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    c = db.get(Category, category_id)
    if c is None:
        raise HTTPException(404, "Category not found")
    clash = db.execute(select(Category).where(Category.name == body.name.strip(), Category.id != c.id)).scalar_one_or_none()
    if clash:
        raise HTTPException(400, "Another category has this name")
    old = c.name
    c.name = body.name.strip()
    log_audit(db, owner, "update", "category", c.id, f"Renamed category {old} -> {c.name}")
    db.commit()
    return {"id": c.id, "name": c.name}


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    c = db.get(Category, category_id)
    if c is None:
        raise HTTPException(404, "Category not found")
    for p in db.execute(select(Product).where(Product.category_id == c.id)).scalars():
        p.category_id = None
    log_audit(db, owner, "delete", "category", c.id, f"Deleted category {c.name}")
    db.delete(c)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ products


def _ensure_unique_barcode(db: Session, barcode: str | None, exclude_id: int | None = None) -> None:
    if not barcode:
        return
    q = select(Product).where(Product.barcode == barcode)
    if exclude_id:
        q = q.where(Product.id != exclude_id)
    other = db.execute(q).scalar_one_or_none()
    if other:
        raise HTTPException(400, f"Barcode {barcode} is already used by {other.name}")


def _shop_barcode(db: Session) -> str:
    """In-store EAN-13 (prefix 2 is reserved for shop-internal codes)."""
    for _ in range(50):
        first12 = "2" + "".join(random.choices("0123456789", k=11))
        code = first12 + ean13_check_digit(first12)
        if not db.execute(select(Product.id).where(Product.barcode == code)).scalar():
            return code
    raise HTTPException(500, "Could not generate a unique barcode")


@router.get("/products")
def list_products(
    q: str | None = None,
    category_id: int | None = None,
    stock: str | None = Query(default=None, pattern="^(low|out|ok)$"),
    active: str = Query(default="active", pattern="^(active|inactive|all)$"),
    no_barcode: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Product).options(selectinload(Product.category)).order_by(Product.name)
    if active == "active":
        query = query.where(Product.is_active.is_(True))
    elif active == "inactive":
        query = query.where(Product.is_active.is_(False))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Product.name.like(like), Product.barcode == q.strip()))
    if category_id:
        query = query.where(Product.category_id == category_id)
    if stock == "out":
        query = query.where(Product.stock_qty <= 0)
    elif stock == "low":
        query = query.where(Product.stock_qty <= Product.reorder_level)
    elif stock == "ok":
        query = query.where(Product.stock_qty > Product.reorder_level)
    if no_barcode:
        query = query.where(or_(Product.barcode.is_(None), Product.barcode == ""))
    include_cost = user.role == "owner"
    return [product_dict(p, include_cost) for p in db.execute(query).scalars()]


@router.get("/products/barcode/{code}")
def find_by_barcode(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.execute(select(Product).where(Product.barcode == code.strip())).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, f"No product with barcode {code}")
    if not p.is_active:
        raise HTTPException(400, f"{p.name} is inactive")
    return product_dict(p, user.role == "owner")


@router.get("/products/{product_id}")
def get_product(product_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(404, "Product not found")
    data = product_dict(p, user.role == "owner")
    batches = db.execute(
        select(PurchaseItem).where(PurchaseItem.product_id == p.id, PurchaseItem.expiry_date.is_not(None))
        .order_by(PurchaseItem.expiry_date.desc()).limit(10)
    ).scalars()
    data["batches"] = [
        {"batch_no": b.batch_no, "expiry_date": b.expiry_date.isoformat(), "qty": f(b.qty)} for b in batches
    ]
    return data


@router.post("/products")
def create_product(body: ProductIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    _ensure_unique_barcode(db, body.barcode)
    if body.category_id and db.get(Category, body.category_id) is None:
        raise HTTPException(400, "Category not found")
    p = Product(
        name=body.name.strip(), category_id=body.category_id, barcode=body.barcode, unit=body.unit.strip() or "pcs",
        cost_price=money(body.cost_price), selling_price=money(body.selling_price), stock_qty=qty(0),
        reorder_level=qty(body.reorder_level), track_expiry=body.track_expiry, is_active=body.is_active,
    )
    db.add(p)
    db.flush()
    if body.stock_qty > 0:
        post_movement(db, p.id, "opening", qty_in=body.stock_qty, reason="Opening stock", user=owner)
    log_audit(db, owner, "create", "product", p.id, f"Added product {p.name} at Rs. {p.selling_price}",
              new={"selling_price": p.selling_price, "cost_price": p.cost_price, "barcode": p.barcode})
    db.commit()
    db.refresh(p)
    return product_dict(p)


@router.put("/products/{product_id}")
def update_product(product_id: int, body: ProductIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(404, "Product not found")
    _ensure_unique_barcode(db, body.barcode, exclude_id=p.id)
    if body.category_id and db.get(Category, body.category_id) is None:
        raise HTTPException(400, "Category not found")
    fields = ("name", "category_id", "barcode", "unit", "cost_price", "selling_price", "reorder_level", "track_expiry", "is_active")
    old = {k: getattr(p, k) for k in fields}
    p.name = body.name.strip()
    p.category_id = body.category_id
    p.barcode = body.barcode
    p.unit = body.unit.strip() or "pcs"
    p.cost_price = money(body.cost_price)
    p.selling_price = money(body.selling_price)
    p.reorder_level = qty(body.reorder_level)
    p.track_expiry = body.track_expiry
    p.is_active = body.is_active
    new = {k: getattr(p, k) for k in fields}
    changed = {k: (old[k], new[k]) for k in fields if str(old[k]) != str(new[k])}
    if changed:
        action = "price_change" if "selling_price" in changed or "cost_price" in changed else "update"
        log_audit(db, owner, action, "product", p.id, f"Edited {p.name}: " + ", ".join(changed.keys()),
                  old={k: v[0] for k, v in changed.items()}, new={k: v[1] for k, v in changed.items()})
    db.commit()
    db.refresh(p)
    return product_dict(p)


@router.delete("/products/{product_id}")
def deactivate_product(product_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(404, "Product not found")
    p.is_active = False
    log_audit(db, owner, "delete", "product", p.id, f"Deactivated product {p.name}")
    db.commit()
    return {"ok": True}


@router.post("/products/{product_id}/generate-barcode")
def generate_barcode(product_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(404, "Product not found")
    if p.barcode:
        raise HTTPException(400, f"{p.name} already has barcode {p.barcode}")
    p.barcode = _shop_barcode(db)
    log_audit(db, owner, "update", "product", p.id, f"Generated shop barcode {p.barcode} for {p.name}")
    db.commit()
    db.refresh(p)
    return product_dict(p)


@router.post("/products/generate-barcodes")
def generate_missing_barcodes(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    products = list(db.execute(
        select(Product).where(Product.is_active.is_(True), or_(Product.barcode.is_(None), Product.barcode == ""))
    ).scalars())
    for p in products:
        p.barcode = _shop_barcode(db)
        db.flush()
    if products:
        log_audit(db, owner, "update", "product", None, f"Generated shop barcodes for {len(products)} products")
    db.commit()
    return {"updated": [product_dict(p) for p in products]}


@router.get("/products/{product_id}/movements")
def product_movements(product_id: int, limit: int = 200, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.get(Product, product_id) is None:
        raise HTTPException(404, "Product not found")
    rows = db.execute(
        select(StockMovement).options(selectinload(StockMovement.product), selectinload(StockMovement.user))
        .where(StockMovement.product_id == product_id)
        .order_by(StockMovement.id.desc()).limit(min(limit, 1000))
    ).scalars()
    return [movement_dict(m) for m in rows]

