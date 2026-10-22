"""Request bodies. Responses are plain dicts built by serializers in app/serializers.py."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6)
    role: Literal["owner", "cashier"] = "cashier"


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    role: Literal["owner", "cashier"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=6)


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: int | None = None
    barcode: str | None = Field(default=None, max_length=64)
    unit: str = Field(default="pcs", max_length=20)
    cost_price: float = Field(default=0, ge=0)
    selling_price: float = Field(ge=0)
    stock_qty: float = Field(default=0, ge=0, description="Opening stock, only used when creating")
    reorder_level: float = Field(default=0, ge=0)
    track_expiry: bool = False
    is_active: bool = True

    @field_validator("barcode")
    @classmethod
    def clean_barcode(cls, v):
        v = (v or "").strip()
        return v or None


def normalize_mobile(v: str) -> str:
    digits = "".join(ch for ch in v if ch.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) != 10:
        raise ValueError("Mobile number must have 10 digits")
    return digits


class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    mobile: str = Field(min_length=10, max_length=15)
    email: str | None = None
    address: str | None = None
    opening_balance: float = Field(default=0, ge=0)
    whatsapp_consent: bool = False
    notes: str | None = None
    vpas: list[str] = []

    @field_validator("mobile")
    @classmethod
    def clean_mobile(cls, v: str):
        return normalize_mobile(v)


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=150)
    mobile: str | None = None
    email: str | None = None
    address: str | None = None
    whatsapp_consent: bool | None = None
    notes: str | None = None

    @field_validator("mobile")
    @classmethod
    def clean_mobile(cls, v):
        if v is None:
            return v
        return normalize_mobile(v)


class VpaIn(BaseModel):
    vpa: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9.\-_]+@[A-Za-z0-9.\-_]+$")


class DuePaymentIn(BaseModel):
    amount: float = Field(gt=0)
    mode: Literal["cash", "upi"] = "cash"
    utr: str | None = None
    payer_vpa: str | None = None
    note: str | None = None


class AmountIn(BaseModel):
    amount: float = Field(gt=0)


class WriteOffIn(BaseModel):
    amount: float = Field(gt=0)
    reason: str = Field(min_length=3, max_length=200)


class ReminderIn(BaseModel):
    channel: Literal["whatsapp", "sms"] = "whatsapp"
    include_link: bool = True


class BillItemIn(BaseModel):
    product_id: int
    qty: float = Field(gt=0)
    unit_price: float | None = Field(default=None, ge=0)


class BillIn(BaseModel):
    customer_id: int | None = None
    items: list[BillItemIn] = []
    discount: float = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=255)
    client_ref: str | None = Field(default=None, max_length=64)


class CheckoutIn(BaseModel):
    cash_amount: float = Field(default=0, ge=0)
    upi_amount: float = Field(default=0, ge=0)


class ManualUpiIn(BaseModel):
    amount: float = Field(gt=0)
    utr: str = Field(min_length=6, max_length=64)
    payer_vpa: str | None = None
    payer_name: str | None = None


class CancelIn(BaseModel):
    reason: str | None = None


class ReturnItemIn(BaseModel):
    bill_item_id: int
    qty: float = Field(gt=0)


class ReturnIn(BaseModel):
    items: list[ReturnItemIn]
    refund_mode: Literal["cash", "upi", "ledger"] = "cash"
    reason: str | None = Field(default=None, max_length=255)


class SimulateIn(BaseModel):
    outcome: Literal["success", "failed"] = "success"
    amount: float | None = Field(default=None, gt=0)
    payer_vpa: str | None = "customer@okaxis"
    payer_name: str | None = "UPI Customer"
    deliver_webhook: bool = True


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    mobile: str | None = Field(default=None, max_length=15)
    gstin: str | None = Field(default=None, max_length=20)
    email: str | None = None
    address: str | None = None
    is_active: bool = True


class SupplierPaymentIn(BaseModel):
    amount: float = Field(gt=0)
    mode: Literal["cash", "upi", "bank", "cheque"] = "cash"
    reference: str | None = None
    note: str | None = None
    paid_on: date | None = None


class PurchaseItemIn(BaseModel):
    product_id: int
    qty: float = Field(gt=0)
    cost_price: float = Field(ge=0)
    batch_no: str | None = None
    expiry_date: date | None = None


class PurchaseIn(BaseModel):
    supplier_id: int
    invoice_no: str = Field(min_length=1, max_length=50)
    invoice_date: date
    items: list[PurchaseItemIn] = Field(min_length=1)
    notes: str | None = None
    update_cost_price: bool = True


class AdjustmentIn(BaseModel):
    product_id: int
    qty_change: float
    reason: Literal["damage", "loss", "wastage", "correction", "other"]
    note: str | None = Field(default=None, max_length=255)

    @field_validator("qty_change")
    @classmethod
    def non_zero(cls, v):
        if v == 0:
            raise ValueError("Quantity change cannot be zero")
        return v


class StockCountCreate(BaseModel):
    note: str | None = None


class StockCountItemIn(BaseModel):
    product_id: int | None = None
    barcode: str | None = None
    counted_qty: float | None = Field(default=None, ge=0)
    increment: float | None = None


class BankCreditIn(BaseModel):
    amount: float = Field(ge=0)
    credit_date: date | None = None
    reference: str | None = None


class SettingsIn(BaseModel):
    model_config = {"extra": "allow"}


class DraftSyncIn(BaseModel):
    drafts: list[BillIn]
