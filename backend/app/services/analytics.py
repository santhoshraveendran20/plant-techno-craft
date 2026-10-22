"""Dashboard analytics (FR-21..FR-24) and stock / sales reports (FR-32, FR-36..FR-38)."""

import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    Bill,
    BillItem,
    Category,
    Customer,
    Payment,
    Product,
    PurchaseItem,
    SalesReturn,
    UpiRequest,
)
from ..utils import D, ZERO, add_months, day_bounds, f, money, today
from . import app_settings


def _sale_bills_between(db: Session, start: datetime, end: datetime):
    return list(
        db.execute(
            select(Bill.id, Bill.customer_id, Bill.total, Bill.returned_amount, Bill.paid_amount, Bill.completed_at)
            .where(
                Bill.bill_type == "sale",
                Bill.completed_at.is_not(None),
                Bill.completed_at >= start,
                Bill.completed_at < end,
                Bill.status != "cancelled",
            )
        ).all()
    )


def _mode_split(db: Session, bill_rows) -> dict:
    ids = [b.id for b in bill_rows]
    total = sum((D(b.total) for b in bill_rows), ZERO)
    upi = cash = ZERO
    if ids:
        for chunk_start in range(0, len(ids), 1000):
            chunk = ids[chunk_start:chunk_start + 1000]
            rows = db.execute(
                select(Payment.mode, func.sum(Payment.amount))
                .where(
                    Payment.bill_id.in_(chunk),
                    Payment.gateway_status == "success",
                    Payment.kind == "payment",
                )
                .group_by(Payment.mode)
            ).all()
            for mode, amount in rows:
                if mode == "upi":
                    upi += D(amount)
                elif mode == "cash":
                    cash += D(amount)
    upi, cash = min(upi, total), min(cash, max(total - upi, ZERO))
    credit = max(total - upi - cash, ZERO)
    return {"upi": f(money(upi)), "cash": f(money(cash)), "credit": f(money(credit))}


def total_outstanding(db: Session) -> tuple[Decimal, int]:
    row = db.execute(
        select(func.coalesce(func.sum(Customer.balance), 0), func.count(Customer.id)).where(Customer.balance > 0)
    ).one()
    return money(row[0]), int(row[1])


def summary(db: Session, for_date: date | None = None) -> dict:
    d = for_date or today()
    start, end = day_bounds(d)
    bills = _sale_bills_between(db, start, end)
    sales = money(sum((D(b.total) for b in bills), ZERO))
    count = len(bills)

    y_start, y_end = day_bounds(d - timedelta(days=1))
    y_bills = _sale_bills_between(db, y_start, y_end)
    y_sales = money(sum((D(b.total) for b in y_bills), ZERO))

    collected = defaultdict(lambda: ZERO)
    for mode, kind, amount in db.execute(
        select(Payment.mode, Payment.kind, func.sum(Payment.amount))
        .where(Payment.gateway_status == "success", Payment.created_at >= start, Payment.created_at < end)
        .group_by(Payment.mode, Payment.kind)
    ).all():
        collected[(mode, kind)] += D(amount)
    upi_in = collected[("upi", "payment")]
    cash_in = collected[("cash", "payment")]
    refunds = -(collected[("cash", "refund")] + collected[("upi", "refund")])

    returns_today = db.execute(
        select(func.coalesce(func.sum(SalesReturn.amount), 0)).where(
            SalesReturn.created_at >= start, SalesReturn.created_at < end
        )
    ).scalar()
    outstanding, due_customers = total_outstanding(db)
    credit_today = money(sum((max(D(b.total) - D(b.returned_amount) - D(b.paid_amount), ZERO) for b in bills), ZERO))
    pending_upi = db.execute(select(func.count(UpiRequest.id)).where(UpiRequest.status == "active")).scalar()

    return {
        "date": d.isoformat(),
        "sales": f(sales),
        "bill_count": count,
        "avg_bill_value": f(money(sales / count)) if count else 0.0,
        "sales_yesterday": f(y_sales),
        "sales_change_pct": round(float((sales - y_sales) / y_sales * 100), 1) if y_sales else None,
        "collected": f(money(upi_in + cash_in)),
        "collected_upi": f(money(upi_in)),
        "collected_cash": f(money(cash_in)),
        "refunds": f(money(refunds)),
        "returns": f(money(returns_today)),
        "credit_given_today": f(credit_today),
        "outstanding_due": f(outstanding),
        "customers_with_due": due_customers,
        "pending_upi": int(pending_upi or 0),
        "sales_by_mode": _mode_split(db, bills),
    }


def _bucket(d: date, granularity: str) -> date:
    if granularity == "week":
        return d - timedelta(days=d.weekday())
    if granularity == "month":
        return d.replace(day=1)
    return d


def _label(d: date, granularity: str) -> str:
    if granularity == "month":
        return d.strftime("%b %Y")
    if granularity == "week":
        return "Wk of " + d.strftime("%d %b")
    return d.strftime("%d %b")


def trend(db: Session, granularity: str = "day", periods: int | None = None) -> dict:
    granularity = granularity if granularity in ("day", "week", "month") else "day"
    periods = periods or {"day": 14, "week": 12, "month": 12}[granularity]
    periods = max(2, min(periods, 60))
    t = today()
    if granularity == "day":
        current = [t - timedelta(days=periods - 1 - i) for i in range(periods)]
        previous = [c - timedelta(days=periods) for c in current]
        end = t + timedelta(days=1)
    elif granularity == "week":
        wk = _bucket(t, "week")
        current = [wk - timedelta(weeks=periods - 1 - i) for i in range(periods)]
        previous = [c - timedelta(weeks=periods) for c in current]
        end = wk + timedelta(weeks=1)
    else:
        mo = t.replace(day=1)
        current = [add_months(mo, -(periods - 1 - i)) for i in range(periods)]
        previous = [add_months(c, -periods) for c in current]
        end = add_months(mo, 1)

    start = datetime.combine(previous[0], datetime.min.time())
    end_dt = datetime.combine(end, datetime.min.time())
    sales_by = defaultdict(lambda: ZERO)
    count_by = defaultdict(int)
    for b in _sale_bills_between(db, start, end_dt):
        key = _bucket(b.completed_at.date(), granularity)
        sales_by[key] += D(b.total)
        count_by[key] += 1
    coll_by = defaultdict(lambda: ZERO)
    for created_at, amount in db.execute(
        select(Payment.created_at, Payment.amount).where(
            Payment.gateway_status == "success", Payment.kind == "payment",
            Payment.created_at >= start, Payment.created_at < end_dt,
        )
    ).all():
        coll_by[_bucket(created_at.date(), granularity)] += D(amount)

    cur_total = sum((sales_by[c] for c in current), ZERO)
    prev_total = sum((sales_by[p] for p in previous), ZERO)
    return {
        "granularity": granularity,
        "labels": [_label(c, granularity) for c in current],
        "previous_labels": [_label(p, granularity) for p in previous],
        "current": [f(money(sales_by[c])) for c in current],
        "previous": [f(money(sales_by[p])) for p in previous],
        "collections": [f(money(coll_by[c])) for c in current],
        "bills": [count_by[c] for c in current],
        "totals": {
            "current": f(money(cur_total)),
            "previous": f(money(prev_total)),
            "change_pct": round(float((cur_total - prev_total) / prev_total * 100), 1) if prev_total else None,
        },
    }


def dues_ageing(db: Session) -> dict:
    buckets = {"0-30": ZERO, "31-60": ZERO, "60+": ZERO}
    counts = {"0-30": 0, "31-60": 0, "60+": 0}
    t = today()
    rows = db.execute(
        select(Bill.total, Bill.returned_amount, Bill.paid_amount, Bill.completed_at).where(
            Bill.customer_id.is_not(None),
            Bill.completed_at.is_not(None),
            Bill.status.in_(("credit", "part_paid")),
        )
    ).all()
    for total, returned, paid, completed_at in rows:
        due = D(total) - D(returned) - D(paid)
        if due <= 0:
            continue
        age = (t - completed_at.date()).days
        key = "0-30" if age <= 30 else ("31-60" if age <= 60 else "60+")
        buckets[key] += due
        counts[key] += 1
    return {
        "labels": list(buckets.keys()),
        "amounts": [f(money(v)) for v in buckets.values()],
        "counts": list(counts.values()),
    }


def _last_sale_dates(db: Session) -> dict[int, datetime]:
    rows = db.execute(
        select(BillItem.product_id, func.max(Bill.completed_at))
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(Bill.completed_at.is_not(None), Bill.bill_type == "sale")
        .group_by(BillItem.product_id)
    ).all()
    return {pid: dt for pid, dt in rows}


def _qty_sold_since(db: Session, since: datetime) -> dict[int, Decimal]:
    rows = db.execute(
        select(BillItem.product_id, func.sum(BillItem.qty - BillItem.returned_qty))
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(Bill.completed_at.is_not(None), Bill.completed_at >= since, Bill.bill_type == "sale")
        .group_by(BillItem.product_id)
    ).all()
    return {pid: D(q) for pid, q in rows}


def low_stock(db: Session, limit: int | None = None) -> list[dict]:
    q = (
        select(Product)
        .where(Product.is_active.is_(True), Product.stock_qty <= Product.reorder_level)
        .order_by(Product.stock_qty, Product.name)
    )
    if limit:
        q = q.limit(limit)
    return [
        {
            "id": p.id, "name": p.name, "unit": p.unit, "stock_qty": f(p.stock_qty),
            "reorder_level": f(p.reorder_level), "status": "out" if D(p.stock_qty) <= 0 else "low",
        }
        for p in db.execute(q).scalars()
    ]


def slow_moving(db: Session, days: int = 30, limit: int = 10) -> list[dict]:
    last = _last_sale_dates(db)
    cutoff = datetime.combine(today() - timedelta(days=days), datetime.min.time())
    result = []
    for p in db.execute(select(Product).where(Product.is_active.is_(True), Product.stock_qty > 0)).scalars():
        ls = last.get(p.id)
        if ls is None or ls < cutoff:
            result.append({
                "id": p.id, "name": p.name, "stock_qty": f(p.stock_qty),
                "last_sale": ls.date().isoformat() if ls else None,
                "days_since_sale": (today() - ls.date()).days if ls else None,
                "stock_value": f(money(D(p.stock_qty) * D(p.cost_price))),
            })
    result.sort(key=lambda r: (r["days_since_sale"] is not None, -(r["days_since_sale"] or 0)))
    return result[:limit]


def insights(db: Session, days: int = 30) -> dict:
    days = max(1, min(days, 365))
    start = datetime.combine(today() - timedelta(days=days - 1), datetime.min.time())
    end = datetime.combine(today() + timedelta(days=1), datetime.min.time())
    bills = _sale_bills_between(db, start, end)
    sales = sum((D(b.total) for b in bills), ZERO)

    top_products = db.execute(
        select(
            BillItem.product_id,
            BillItem.product_name,
            func.sum(BillItem.qty - BillItem.returned_qty).label("qty"),
            func.sum((BillItem.qty - BillItem.returned_qty) * BillItem.unit_price).label("revenue"),
        )
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(Bill.completed_at >= start, Bill.completed_at < end, Bill.bill_type == "sale")
        .group_by(BillItem.product_id, BillItem.product_name)
        .order_by(func.sum((BillItem.qty - BillItem.returned_qty) * BillItem.unit_price).desc())
        .limit(10)
    ).all()

    top_customers = db.execute(
        select(
            Customer.id, Customer.name, Customer.mobile,
            func.sum(Bill.total - Bill.returned_amount).label("spent"),
            func.count(Bill.id).label("bills"),
        )
        .join(Bill, Bill.customer_id == Customer.id)
        .where(Bill.completed_at >= start, Bill.completed_at < end, Bill.bill_type == "sale")
        .group_by(Customer.id, Customer.name, Customer.mobile)
        .order_by(func.sum(Bill.total - Bill.returned_amount).desc())
        .limit(10)
    ).all()

    hour_sales = [ZERO] * 24
    hour_bills = [0] * 24
    for b in bills:
        h = b.completed_at.hour
        hour_sales[h] += D(b.total)
        hour_bills[h] += 1

    return {
        "days": days,
        "sales": f(money(sales)),
        "bill_count": len(bills),
        "avg_bill_value": f(money(sales / len(bills))) if bills else 0.0,
        "sales_by_mode": _mode_split(db, bills),
        "top_products": [
            {"product_id": r.product_id, "name": r.product_name, "qty": f(r.qty), "revenue": f(money(r.revenue))}
            for r in top_products
        ],
        "top_customers": [
            {"customer_id": r.id, "name": r.name, "mobile": r.mobile, "spent": f(money(r.spent)), "bills": int(r.bills)}
            for r in top_customers
        ],
        "peak_hours": {
            "labels": [f"{h:02d}:00" for h in range(24)],
            "bills": hour_bills,
            "sales": [f(money(v)) for v in hour_sales],
        },
        "dues_ageing": dues_ageing(db),
        "low_stock": low_stock(db, limit=10),
        "slow_moving": slow_moving(db, days=30, limit=10),
    }


# ------------------------------------------------------------------ reports


def stock_report(db: Session) -> dict:
    rows = []
    cost_total = sell_total = ZERO
    for p, cat in db.execute(
        select(Product, Category.name).outerjoin(Category, Category.id == Product.category_id)
        .where(Product.is_active.is_(True)).order_by(Product.name)
    ).all():
        cost_value = money(D(p.stock_qty) * D(p.cost_price)) if D(p.stock_qty) > 0 else ZERO
        sell_value = money(D(p.stock_qty) * D(p.selling_price)) if D(p.stock_qty) > 0 else ZERO
        cost_total += cost_value
        sell_total += sell_value
        status = "out" if D(p.stock_qty) <= 0 else ("low" if D(p.stock_qty) <= D(p.reorder_level) else "ok")
        rows.append({
            "id": p.id, "name": p.name, "category": cat, "barcode": p.barcode, "unit": p.unit,
            "stock_qty": f(p.stock_qty), "reorder_level": f(p.reorder_level),
            "cost_price": f(p.cost_price), "selling_price": f(p.selling_price),
            "cost_value": f(cost_value), "selling_value": f(sell_value), "status": status,
        })
    return {
        "rows": rows,
        "totals": {
            "products": len(rows),
            "cost_value": f(money(cost_total)),
            "selling_value": f(money(sell_total)),
            "potential_margin": f(money(sell_total - cost_total)),
            "low": sum(1 for r in rows if r["status"] == "low"),
            "out": sum(1 for r in rows if r["status"] == "out"),
        },
    }


def sales_by_product(db: Session, date_from: date, date_to: date) -> dict:
    start = datetime.combine(date_from, datetime.min.time())
    end = datetime.combine(date_to + timedelta(days=1), datetime.min.time())
    rows = db.execute(
        select(
            BillItem.product_id, BillItem.product_name, BillItem.qty, BillItem.returned_qty,
            BillItem.line_total, BillItem.cost_price, Bill.subtotal, Bill.total,
        )
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(Bill.completed_at >= start, Bill.completed_at < end, Bill.bill_type == "sale")
    ).all()
    agg: dict[int, dict] = {}
    for r in rows:
        sold = D(r.qty) - D(r.returned_qty)
        if D(r.qty) <= 0:
            continue
        ratio = (D(r.total) / D(r.subtotal)) if D(r.subtotal) > 0 else Decimal("1")
        revenue = D(r.line_total) * ratio * sold / D(r.qty)
        cost = sold * D(r.cost_price)
        a = agg.setdefault(r.product_id, {"product_id": r.product_id, "name": r.product_name,
                                          "qty": ZERO, "revenue": ZERO, "cost": ZERO})
        a["qty"] += sold
        a["revenue"] += revenue
        a["cost"] += cost
    result = []
    for a in agg.values():
        margin = a["revenue"] - a["cost"]
        result.append({
            "product_id": a["product_id"], "name": a["name"], "qty": f(a["qty"]),
            "revenue": f(money(a["revenue"])), "cost": f(money(a["cost"])), "margin": f(money(margin)),
            "margin_pct": round(float(margin / a["revenue"] * 100), 1) if a["revenue"] > 0 else 0.0,
        })
    result.sort(key=lambda r: r["revenue"], reverse=True)
    tot_rev = sum((D(r["revenue"]) for r in result), ZERO)
    tot_cost = sum((D(r["cost"]) for r in result), ZERO)
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "rows": result,
        "totals": {
            "revenue": f(money(tot_rev)), "cost": f(money(tot_cost)), "margin": f(money(tot_rev - tot_cost)),
            "margin_pct": round(float((tot_rev - tot_cost) / tot_rev * 100), 1) if tot_rev > 0 else 0.0,
        },
    }


def movement_classes(db: Session) -> dict:
    """Fast / slow / dead stock. Dead = in stock but no sale in 60 days (FR-36)."""
    t = today()
    since30 = datetime.combine(t - timedelta(days=30), datetime.min.time())
    cutoff60 = datetime.combine(t - timedelta(days=60), datetime.min.time())
    sold30 = _qty_sold_since(db, since30)
    last = _last_sale_dates(db)
    ranked = sorted((q for q in sold30.values() if q > 0), reverse=True)
    fast_threshold = ranked[max(0, math.ceil(len(ranked) * 0.2) - 1)] if ranked else None
    rows = []
    for p in db.execute(select(Product).where(Product.is_active.is_(True)).order_by(Product.name)).scalars():
        q30 = sold30.get(p.id, ZERO)
        ls = last.get(p.id)
        if (ls is None or ls < cutoff60) and D(p.stock_qty) > 0:
            cls = "dead"
        elif fast_threshold is not None and q30 > 0 and q30 >= fast_threshold:
            cls = "fast"
        elif q30 > 0 or (ls is not None and ls >= cutoff60):
            cls = "slow"
        else:
            cls = "no_stock"
        rows.append({
            "id": p.id, "name": p.name, "stock_qty": f(p.stock_qty), "qty_30d": f(q30),
            "last_sale": ls.date().isoformat() if ls else None,
            "days_since_sale": (t - ls.date()).days if ls else None,
            "stock_value": f(money(max(D(p.stock_qty), ZERO) * D(p.cost_price))),
            "class": cls,
        })
    counts = defaultdict(int)
    for r in rows:
        counts[r["class"]] += 1
    return {"rows": rows, "counts": dict(counts)}


def reorder_suggestions(db: Session) -> list[dict]:
    """FR-38: suggested quantity from the last 30 days' average daily sales."""
    cover = app_settings.get_value(db, "reorder_cover_days")
    since30 = datetime.combine(today() - timedelta(days=30), datetime.min.time())
    sold30 = _qty_sold_since(db, since30)
    rows = []
    for p in db.execute(select(Product).where(Product.is_active.is_(True)).order_by(Product.name)).scalars():
        avg = sold30.get(p.id, ZERO) / Decimal("30")
        stock = D(p.stock_qty)
        days_left = float(stock / avg) if avg > 0 else None
        needs = stock <= D(p.reorder_level) or (days_left is not None and days_left < 7)
        if not needs:
            continue
        suggested = max(ZERO, avg * cover + D(p.reorder_level) - stock)
        rows.append({
            "id": p.id, "name": p.name, "unit": p.unit, "stock_qty": f(stock), "reorder_level": f(p.reorder_level),
            "avg_daily_sales": round(float(avg), 2), "days_left": round(days_left, 1) if days_left is not None else None,
            "suggested_qty": math.ceil(float(suggested)) if suggested > 0 else (
                math.ceil(float(D(p.reorder_level) * 2 - stock)) if stock <= D(p.reorder_level) else 0),
            "cost_price": f(p.cost_price),
        })
    rows.sort(key=lambda r: (r["days_left"] if r["days_left"] is not None else 9999, r["stock_qty"]))
    return rows


def expiry_report(db: Session, within_days: int | None = None) -> list[dict]:
    """FR-37: purchase batches that expire soon while the product is still in stock."""
    within = within_days if within_days is not None else app_settings.get_value(db, "near_expiry_days")
    limit_date = today() + timedelta(days=within)
    rows = db.execute(
        select(PurchaseItem, Product)
        .join(Product, Product.id == PurchaseItem.product_id)
        .where(PurchaseItem.expiry_date.is_not(None), PurchaseItem.expiry_date <= limit_date, Product.stock_qty > 0)
        .order_by(PurchaseItem.expiry_date)
    ).all()
    result = []
    seen = set()
    for item, product in rows:
        key = (product.id, item.batch_no, item.expiry_date)
        if key in seen:
            continue
        seen.add(key)
        days = (item.expiry_date - today()).days
        result.append({
            "product_id": product.id, "name": product.name, "batch_no": item.batch_no,
            "expiry_date": item.expiry_date.isoformat(), "days_to_expiry": days,
            "batch_qty": f(item.qty), "stock_qty": f(product.stock_qty),
            "status": "expired" if days < 0 else "near_expiry",
        })
    return result
