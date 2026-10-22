from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from .config import settings

TWO_PLACES = Decimal("0.01")
THREE_PLACES = Decimal("0.001")
ZERO = Decimal("0")

# Lets the seed script generate historical data with consistent timestamps.
_frozen_now: datetime | None = None


def set_frozen_now(value: datetime | None) -> None:
    global _frozen_now
    _frozen_now = value


def now() -> datetime:
    """Current shop-local time as a naive datetime (stored as-is in MySQL DATETIME)."""
    if _frozen_now is not None:
        return _frozen_now
    return datetime.now(ZoneInfo(settings.TIMEZONE)).replace(tzinfo=None, microsecond=0)


def today() -> date:
    return now().date()


def day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, time.min)
    return start, start + timedelta(days=1)


def D(value) -> Decimal:
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def money(value) -> Decimal:
    return D(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def qty(value) -> Decimal:
    return D(value).quantize(THREE_PLACES, rounding=ROUND_HALF_UP)


def f(value) -> float:
    """Decimal -> float for JSON responses."""
    return float(D(value))


def fmt_inr(value) -> str:
    return f"Rs. {money(value):,.2f}"


def ean13_check_digit(first12: str) -> str:
    total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(first12))
    return str((10 - total % 10) % 10)


def is_valid_ean13(code: str) -> bool:
    return len(code) == 13 and code.isdigit() and ean13_check_digit(code[:12]) == code[12]


def add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)
