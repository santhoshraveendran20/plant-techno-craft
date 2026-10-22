from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..security import require_owner
from ..services import analytics
from ..utils import today

router = APIRouter(prefix="/api", tags=["dashboard & reports"])


@router.get("/dashboard/summary")
def dashboard_summary(for_date: date | None = None, _: User = Depends(require_owner), db: Session = Depends(get_db)):
    return analytics.summary(db, for_date)


@router.get("/dashboard/trend")
def dashboard_trend(
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    periods: int | None = Query(default=None, ge=2, le=60),
    _: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return analytics.trend(db, granularity, periods)


@router.get("/dashboard/insights")
def dashboard_insights(days: int = Query(default=30, ge=1, le=365), _: User = Depends(require_owner),
                       db: Session = Depends(get_db)):
    return analytics.insights(db, days)


@router.get("/reports/stock")
def report_stock(_: User = Depends(require_owner), db: Session = Depends(get_db)):
    return analytics.stock_report(db)


@router.get("/reports/sales-by-product")
def report_sales_by_product(date_from: date | None = None, date_to: date | None = None,
                            _: User = Depends(require_owner), db: Session = Depends(get_db)):
    date_to = date_to or today()
    date_from = date_from or (date_to - timedelta(days=29))
    return analytics.sales_by_product(db, date_from, date_to)


@router.get("/reports/movement-class")
def report_movement_class(_: User = Depends(require_owner), db: Session = Depends(get_db)):
    return analytics.movement_classes(db)


@router.get("/reports/reorder")
def report_reorder(_: User = Depends(require_owner), db: Session = Depends(get_db)):
    return analytics.reorder_suggestions(db)


@router.get("/reports/expiry")
def report_expiry(within_days: int | None = Query(default=None, ge=0, le=365), _: User = Depends(require_owner),
                  db: Session = Depends(get_db)):
    return analytics.expiry_report(db, within_days)
