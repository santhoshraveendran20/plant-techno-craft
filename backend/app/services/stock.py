from decimal import Decimal

from sqlalchemy.orm import Session

from ..database import lock
from ..models import Product, StockMovement, User
from ..utils import D, qty


def post_movement(
    db: Session,
    product_id: int,
    movement_type: str,
    qty_in=0,
    qty_out=0,
    ref_type: str | None = None,
    ref_id: int | None = None,
    ref_label: str | None = None,
    reason: str | None = None,
    user: User | None = None,
) -> StockMovement:
    """The only place stock_qty changes, so every unit on hand is explained by a movement."""
    product = lock(db, Product, product_id)
    q_in, q_out = qty(qty_in), qty(qty_out)
    product.stock_qty = qty(D(product.stock_qty) + q_in - q_out)
    movement = StockMovement(
        product_id=product.id,
        movement_type=movement_type,
        qty_in=q_in,
        qty_out=q_out,
        balance_after=product.stock_qty,
        ref_type=ref_type,
        ref_id=ref_id,
        ref_label=ref_label,
        reason=reason,
        user_id=user.id if user else None,
    )
    db.add(movement)
    return movement


def signed_change(qty_change) -> tuple[Decimal, Decimal]:
    change = qty(qty_change)
    return (change, Decimal("0")) if change >= 0 else (Decimal("0"), -change)
