from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Setting

DEFAULTS: dict[str, str] = {
    "shop_name": "Plant Technocrat",
    "shop_tagline": "Growing Green Futures",
    "shop_address": "",
    "shop_phone": "",
    "shop_gstin": "",
    "upi_vpa": "planttechnocrat@demo",  # placeholder: set the real UPI ID in Settings
    "upi_payee_name": "Plant Technocrat",
    "allow_zero_stock_sale": "true",
    "cashier_max_discount_pct": "10",
    "qr_expiry_minutes": "15",
    "payment_link_expiry_days": "7",
    "receipt_paper": "80mm",
    "receipt_footer": "Thank you for growing green with us!",
    "reorder_cover_days": "14",
    "near_expiry_days": "30",
    "reminder_template": (
        "Hello {name}, your pending amount at {shop} is Rs. {amount} "
        "(oldest due since {since}). Pay securely by UPI: {link}"
    ),
}

BOOL_KEYS = {"allow_zero_stock_sale"}
INT_KEYS = {
    "qr_expiry_minutes",
    "payment_link_expiry_days",
    "reorder_cover_days",
    "near_expiry_days",
}
FLOAT_KEYS = {"cashier_max_discount_pct"}
# Thermal rolls (58 / 80 mm) or sheets for a regular printer
CHOICE_KEYS = {"receipt_paper": {"58mm", "80mm", "a5", "a4", "a3"}}


def _coerce(key: str, raw: str):
    if key in CHOICE_KEYS:
        return raw if raw in CHOICE_KEYS[key] else DEFAULTS[key]
    if key in BOOL_KEYS:
        return str(raw).lower() in ("1", "true", "yes", "on")
    if key in INT_KEYS:
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            return int(DEFAULTS[key])
    if key in FLOAT_KEYS:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return float(DEFAULTS[key])
    return raw


def get_all(db: Session) -> dict:
    stored = {s.key: s.value for s in db.execute(select(Setting)).scalars()}
    return {k: _coerce(k, stored.get(k, v)) for k, v in DEFAULTS.items()}


def get_value(db: Session, key: str):
    row = db.get(Setting, key)
    return _coerce(key, row.value if row else DEFAULTS[key])


def update(db: Session, data: dict) -> dict:
    """Store known keys only. Returns {key: (old, new)} for changed values."""
    current = get_all(db)
    changes = {}
    for key, value in data.items():
        if key not in DEFAULTS or value is None:
            continue
        if key in BOOL_KEYS:
            raw = "true" if value in (True, "true", "1", 1) else "false"
        else:
            raw = str(value).strip()
        if _coerce(key, raw) == current.get(key):
            continue
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=raw))
        else:
            row.value = raw
        changes[key] = (current.get(key), _coerce(key, raw))
    return changes


def ensure_defaults(db: Session) -> None:
    existing = {s.key for s in db.execute(select(Setting)).scalars()}
    for key, value in DEFAULTS.items():
        if key not in existing:
            db.add(Setting(key=key, value=value))
