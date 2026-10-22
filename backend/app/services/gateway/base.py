"""Payment gateway adapter interface.

Every provider (mock, Razorpay, Cashfree, a bank API...) is wrapped behind this interface, so the
provider can be swapped without touching billing, ledger or reconciliation code.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Mapping
from urllib.parse import quote

from sqlalchemy.orm import Session


@dataclass
class GatewayQr:
    gateway_qr_id: str
    payload: str | None = None  # upi://pay?... string rendered as a QR by the app
    image_url: str | None = None  # some gateways return a hosted QR image instead


@dataclass
class NormalizedPayment:
    status: str  # success | failed
    gateway_payment_id: str
    amount: Decimal
    gateway_qr_id: str | None = None
    reference: str | None = None
    utr: str | None = None
    payer_vpa: str | None = None
    payer_name: str | None = None
    paid_at: datetime | None = None
    error_reason: str | None = None


@dataclass
class WebhookParse:
    event_id: str | None
    event_type: str | None
    payments: list[NormalizedPayment] = field(default_factory=list)


@dataclass
class GatewaySettlementItem:
    gateway_payment_id: str
    amount: Decimal
    fee: Decimal = Decimal("0")
    utr: str | None = None
    reference: str | None = None
    payer_vpa: str | None = None
    payer_name: str | None = None
    captured_at: datetime | None = None


@dataclass
class GatewaySettlement:
    gateway_settlement_id: str
    settlement_date: date
    gross: Decimal
    fees: Decimal
    tax: Decimal
    net: Decimal
    bank_utr: str | None
    items: list[GatewaySettlementItem] = field(default_factory=list)


def build_upi_uri(payee_vpa: str, payee_name: str, amount: Decimal, ref: str, note: str) -> str:
    """NPCI UPI deep-link. Any UPI app (GPay, PhonePe, Paytm, BHIM) can scan it."""
    parts = {
        "pa": payee_vpa,
        "pn": payee_name,
        "am": f"{amount:.2f}",
        "cu": "INR",
        "tr": ref,
        "tn": note[:50],
    }
    return "upi://pay?" + "&".join(f"{k}={quote(str(v), safe='@.-_')}" for k, v in parts.items())


class PaymentGateway(ABC):
    name: str = "base"

    @abstractmethod
    def create_qr(
        self,
        db: Session,
        *,
        ref: str,
        amount: Decimal,
        description: str,
        expires_at: datetime,
        payee_vpa: str,
        payee_name: str,
        notes: dict,
    ) -> GatewayQr: ...

    def close_qr(self, db: Session, gateway_qr_id: str) -> None:  # noqa: B027 - optional hook
        return None

    @abstractmethod
    def verify_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> bool: ...

    @abstractmethod
    def parse_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> WebhookParse: ...

    @abstractmethod
    def fetch_qr_payments(self, db: Session, gateway_qr_id: str) -> list[NormalizedPayment]: ...

    @abstractmethod
    def fetch_settlements(self, db: Session, payments_date: date) -> list[GatewaySettlement]: ...
