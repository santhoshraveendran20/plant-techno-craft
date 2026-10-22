from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .utils import now

Money = Numeric(12, 2)
Qty = Numeric(12, 3)


def _zero():
    return Decimal("0")


# ---------------------------------------------------------------- users & admin


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="cashier")  # owner | cashier
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    username: Mapped[str] = mapped_column(String(50), default="system")
    role: Mapped[str] = mapped_column(String(20), default="system")
    action: Mapped[str] = mapped_column(String(50), index=True)
    entity: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    summary: Mapped[str] = mapped_column(String(255), default="")
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


# ---------------------------------------------------------------- catalogue


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    unit: Mapped[str] = mapped_column(String(20), default="pcs")
    cost_price: Mapped[Decimal] = mapped_column(Money, default=_zero)
    selling_price: Mapped[Decimal] = mapped_column(Money, default=_zero)
    stock_qty: Mapped[Decimal] = mapped_column(Qty, default=_zero)
    reorder_level: Mapped[Decimal] = mapped_column(Qty, default=_zero)
    track_expiry: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    category: Mapped[Category | None] = relationship()


# ---------------------------------------------------------------- customers


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    mobile: Mapped[str] = mapped_column(String(15), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    opening_balance: Mapped[Decimal] = mapped_column(Money, default=_zero)
    # Cached running ledger balance: positive = customer owes the shop, negative = advance
    balance: Mapped[Decimal] = mapped_column(Money, default=_zero, index=True)
    whatsapp_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_reminder_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    vpas: Mapped[list["CustomerVPA"]] = relationship(
        back_populates="customer", cascade="all, delete-orphan", order_by="CustomerVPA.id"
    )


class CustomerVPA(Base):
    __tablename__ = "customer_vpas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    vpa: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    customer: Mapped[Customer] = relationship(back_populates="vpas")


# ---------------------------------------------------------------- billing


class Bill(Base):
    __tablename__ = "bills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_no: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    bill_type: Mapped[str] = mapped_column(String(10), default="sale")  # sale | opening
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    # draft | pending | paid | part_paid | credit | returned | cancelled
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    subtotal: Mapped[Decimal] = mapped_column(Money, default=_zero)
    discount: Mapped[Decimal] = mapped_column(Money, default=_zero)
    total: Mapped[Decimal] = mapped_column(Money, default=_zero)
    paid_amount: Mapped[Decimal] = mapped_column(Money, default=_zero)
    returned_amount: Mapped[Decimal] = mapped_column(Money, default=_zero)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_ref: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    items: Mapped[list["BillItem"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", order_by="BillItem.id"
    )
    customer: Mapped[Customer | None] = relationship()
    creator: Mapped[User | None] = relationship()

    @property
    def net_total(self) -> Decimal:
        return (self.total or Decimal("0")) - (self.returned_amount or Decimal("0"))

    @property
    def due_amount(self) -> Decimal:
        due = self.net_total - (self.paid_amount or Decimal("0"))
        return due if due > 0 else Decimal("0")


class BillItem(Base):
    __tablename__ = "bill_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    product_name: Mapped[str] = mapped_column(String(200))
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    unit: Mapped[str] = mapped_column(String(20), default="pcs")
    qty: Mapped[Decimal] = mapped_column(Qty)
    unit_price: Mapped[Decimal] = mapped_column(Money)
    cost_price: Mapped[Decimal] = mapped_column(Money, default=_zero)
    line_total: Mapped[Decimal] = mapped_column(Money)
    returned_qty: Mapped[Decimal] = mapped_column(Qty, default=_zero)

    bill: Mapped[Bill] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()


class UpiRequest(Base):
    """A dynamic UPI QR / payment link generated through the gateway."""

    __tablename__ = "upi_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ref: Mapped[str] = mapped_column(String(40), unique=True)
    purpose: Mapped[str] = mapped_column(String(10), default="bill")  # bill | due
    bill_id: Mapped[int | None] = mapped_column(ForeignKey("bills.id"), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    received_amount: Mapped[Decimal] = mapped_column(Money, default=_zero)
    # active | paid | partially_paid | failed | expired | cancelled
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    gateway: Mapped[str] = mapped_column(String(20))
    gateway_qr_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    public_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    is_link: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    bill: Mapped[Bill | None] = relationship()
    customer: Mapped[Customer | None] = relationship()


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int | None] = mapped_column(ForeignKey("bills.id"), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    upi_request_id: Mapped[int | None] = mapped_column(ForeignKey("upi_requests.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(10), default="payment")  # payment | refund | writeoff
    mode: Mapped[str] = mapped_column(String(10))  # upi | cash | writeoff
    amount: Mapped[Decimal] = mapped_column(Money)  # negative for refunds
    utr: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    payer_vpa: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    payer_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    gateway_status: Mapped[str] = mapped_column(String(20), default="success")  # success | failed | pending
    # matched | mismatch | overpaid | manual | unlinked | failed
    match_status: Mapped[str] = mapped_column(String(20), default="matched")
    source: Mapped[str] = mapped_column(String(20), default="counter")  # counter | webhook | poll | manual | recon
    ledger_posted: Mapped[bool] = mapped_column(Boolean, default=False)
    settlement_id: Mapped[int | None] = mapped_column(ForeignKey("settlements.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

    bill: Mapped[Bill | None] = relationship()
    customer: Mapped[Customer | None] = relationship()


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    # opening | bill | payment | refund | return | writeoff
    entry_type: Mapped[str] = mapped_column(String(20))
    bill_id: Mapped[int | None] = mapped_column(ForeignKey("bills.id"), nullable=True)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id"), nullable=True)
    return_id: Mapped[int | None] = mapped_column(ForeignKey("sales_returns.id"), nullable=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    debit: Mapped[Decimal] = mapped_column(Money, default=_zero)
    credit: Mapped[Decimal] = mapped_column(Money, default=_zero)
    balance_after: Mapped[Decimal] = mapped_column(Money, default=_zero)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class SalesReturn(Base):
    __tablename__ = "sales_returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    return_no: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id"), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    refund_amount: Mapped[Decimal] = mapped_column(Money, default=_zero)
    refund_mode: Mapped[str] = mapped_column(String(20))  # cash | ledger
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

    items: Mapped[list["SalesReturnItem"]] = relationship(cascade="all, delete-orphan")


class SalesReturnItem(Base):
    __tablename__ = "sales_return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("sales_returns.id", ondelete="CASCADE"), index=True)
    bill_item_id: Mapped[int] = mapped_column(ForeignKey("bill_items.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(200))
    qty: Mapped[Decimal] = mapped_column(Qty)
    amount: Mapped[Decimal] = mapped_column(Money)


class Reminder(Base):
    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    channel: Mapped[str] = mapped_column(String(10))  # whatsapp | sms
    amount_due: Mapped[Decimal] = mapped_column(Money)
    message: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------------------------------------------------------------- inventory


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    mobile: Mapped[str | None] = mapped_column(String(15), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SupplierPayment(Base):
    __tablename__ = "supplier_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    mode: Mapped[str] = mapped_column(String(20), default="cash")
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paid_on: Mapped[date] = mapped_column(Date)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = (UniqueConstraint("supplier_id", "invoice_no", name="uq_supplier_invoice"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    invoice_no: Mapped[str] = mapped_column(String(50))
    invoice_date: Mapped[date] = mapped_column(Date)
    total: Mapped[Decimal] = mapped_column(Money, default=_zero)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

    supplier: Mapped[Supplier] = relationship()
    items: Mapped[list["PurchaseItem"]] = relationship(
        back_populates="purchase", cascade="all, delete-orphan", order_by="PurchaseItem.id"
    )


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    purchase_id: Mapped[int] = mapped_column(ForeignKey("purchases.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    qty: Mapped[Decimal] = mapped_column(Qty)
    cost_price: Mapped[Decimal] = mapped_column(Money)
    line_total: Mapped[Decimal] = mapped_column(Money)
    batch_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    purchase: Mapped[Purchase] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    # opening | purchase | sale | return | adjustment | count
    movement_type: Mapped[str] = mapped_column(String(20), index=True)
    qty_in: Mapped[Decimal] = mapped_column(Qty, default=_zero)
    qty_out: Mapped[Decimal] = mapped_column(Qty, default=_zero)
    balance_after: Mapped[Decimal] = mapped_column(Qty, default=_zero)
    ref_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ref_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

    product: Mapped[Product] = relationship()
    user: Mapped[User | None] = relationship()


class StockAdjustment(Base):
    __tablename__ = "stock_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    qty_change: Mapped[Decimal] = mapped_column(Qty)  # signed
    reason: Mapped[str] = mapped_column(String(30))  # damage | loss | wastage | correction | other
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    product: Mapped[Product] = relationship()
    requester: Mapped[User | None] = relationship(foreign_keys=[requested_by])
    approver: Mapped[User | None] = relationship(foreign_keys=[approved_by])


class StockCount(Base):
    __tablename__ = "stock_counts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | posted | cancelled
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    posted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    items: Mapped[list["StockCountItem"]] = relationship(
        back_populates="count", cascade="all, delete-orphan", order_by="StockCountItem.id"
    )


class StockCountItem(Base):
    __tablename__ = "stock_count_items"
    __table_args__ = (UniqueConstraint("count_id", "product_id", name="uq_count_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    count_id: Mapped[int] = mapped_column(ForeignKey("stock_counts.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    counted_qty: Mapped[Decimal] = mapped_column(Qty, default=_zero)
    system_qty: Mapped[Decimal | None] = mapped_column(Qty, nullable=True)  # snapshot when posted
    difference: Mapped[Decimal | None] = mapped_column(Qty, nullable=True)

    count: Mapped[StockCount] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()


# ---------------------------------------------------------------- reconciliation


class Settlement(Base):
    __tablename__ = "settlements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gateway: Mapped[str] = mapped_column(String(20))
    gateway_settlement_id: Mapped[str] = mapped_column(String(100), unique=True)
    settlement_date: Mapped[date] = mapped_column(Date)
    payments_date: Mapped[date] = mapped_column(Date, index=True)
    gross: Mapped[Decimal] = mapped_column(Money, default=_zero)
    fees: Mapped[Decimal] = mapped_column(Money, default=_zero)
    tax: Mapped[Decimal] = mapped_column(Money, default=_zero)
    net: Mapped[Decimal] = mapped_column(Money, default=_zero)
    bank_utr: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bank_credit_amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    bank_credit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    bank_credit_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    items: Mapped[list["SettlementItem"]] = relationship(
        back_populates="settlement", cascade="all, delete-orphan", order_by="SettlementItem.id"
    )


class SettlementItem(Base):
    __tablename__ = "settlement_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    settlement_id: Mapped[int] = mapped_column(ForeignKey("settlements.id", ondelete="CASCADE"), index=True)
    gateway_payment_id: Mapped[str] = mapped_column(String(100), index=True)
    utr: Mapped[str | None] = mapped_column(String(64), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    fee: Mapped[Decimal] = mapped_column(Money, default=_zero)
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    payer_vpa: Mapped[str | None] = mapped_column(String(100), nullable=True)
    payer_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id"), nullable=True)
    match_status: Mapped[str] = mapped_column(String(20), default="missing_in_app")

    settlement: Mapped[Settlement] = relationship(back_populates="items")


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gateway: Mapped[str] = mapped_column(String(20))
    event_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    signature_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    payload: Mapped[str] = mapped_column(Text)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MockGatewayTxn(Base):
    """What the built-in mock gateway 'saw'. Used for polling, settlements and reconciliation demos."""

    __tablename__ = "mock_gateway_txns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gateway_payment_id: Mapped[str] = mapped_column(String(100), unique=True)
    gateway_qr_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    utr: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payer_vpa: Mapped[str | None] = mapped_column(String(100), nullable=True)
    payer_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(20))  # success | failed
    error_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
