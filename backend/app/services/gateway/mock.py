"""Built-in mock gateway.

Behaves like a real aggregator: issues dynamic QR codes, signs webhooks with a shared secret,
answers status polls and produces T+1 settlement reports. Use it for demos and testing until the
shop's merchant account (Razorpay, Cashfree, PhonePe Business...) is ready.
"""

import hashlib
import hmac
import json
import random
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...config import settings
from ...models import MockGatewayTxn
from ...utils import D, day_bounds, money, now
from .base import (
    GatewayQr,
    GatewaySettlement,
    GatewaySettlementItem,
    NormalizedPayment,
    PaymentGateway,
    WebhookParse,
    build_upi_uri,
)

SIGNATURE_HEADER = "x-mock-signature"


class MockGateway(PaymentGateway):
    name = "mock"

    def create_qr(self, db, *, ref, amount, description, expires_at, payee_vpa, payee_name, notes) -> GatewayQr:
        return GatewayQr(
            gateway_qr_id=f"mqr_{secrets.token_hex(8)}",
            payload=build_upi_uri(payee_vpa, payee_name, amount, ref, description),
        )

    # ------------------------------------------------------------ webhooks
    def sign(self, raw_body: bytes) -> str:
        return hmac.new(settings.MOCK_WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()

    def verify_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> bool:
        received = headers.get(SIGNATURE_HEADER) or ""
        return bool(received) and hmac.compare_digest(self.sign(raw_body), received)

    def webhook_body(self, txn: MockGatewayTxn) -> bytes:
        body = {
            "event_id": f"evt_{secrets.token_hex(8)}",
            "event": "payment.success" if txn.status == "success" else "payment.failed",
            "payment": self._txn_dict(txn),
        }
        return json.dumps(body, separators=(",", ":")).encode()

    def parse_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> WebhookParse:
        data = json.loads(raw_body)
        payment = data.get("payment") or {}
        items = []
        if payment:
            items.append(self._normalize(payment))
        return WebhookParse(event_id=data.get("event_id"), event_type=data.get("event"), payments=items)

    # ------------------------------------------------------------ polling
    def fetch_qr_payments(self, db: Session, gateway_qr_id: str) -> list[NormalizedPayment]:
        txns = db.execute(
            select(MockGatewayTxn).where(MockGatewayTxn.gateway_qr_id == gateway_qr_id).order_by(MockGatewayTxn.id)
        ).scalars()
        return [self._normalize(self._txn_dict(t)) for t in txns]

    # ------------------------------------------------------------ settlements
    def fetch_settlements(self, db: Session, payments_date: date) -> list[GatewaySettlement]:
        start, end = day_bounds(payments_date)
        txns = list(
            db.execute(
                select(MockGatewayTxn)
                .where(
                    MockGatewayTxn.status == "success",
                    MockGatewayTxn.created_at >= start,
                    MockGatewayTxn.created_at < end,
                )
                .order_by(MockGatewayTxn.id)
            ).scalars()
        )
        if not txns:
            return []
        fee_pct = D(settings.MOCK_GATEWAY_FEE_PERCENT) / Decimal("100")
        items = []
        for t in txns:
            items.append(
                GatewaySettlementItem(
                    gateway_payment_id=t.gateway_payment_id,
                    amount=money(t.amount),
                    fee=money(D(t.amount) * fee_pct),
                    utr=t.utr,
                    reference=t.reference,
                    payer_vpa=t.payer_vpa,
                    payer_name=t.payer_name,
                    captured_at=t.created_at,
                )
            )
        gross = money(sum((i.amount for i in items), Decimal("0")))
        fees = money(sum((i.fee for i in items), Decimal("0")))
        tax = money(fees * Decimal("0.18"))
        rnd = random.Random(payments_date.toordinal())
        return [
            GatewaySettlement(
                gateway_settlement_id=f"setl_mock_{payments_date:%Y%m%d}",
                settlement_date=payments_date + timedelta(days=1),
                gross=gross,
                fees=fees,
                tax=tax,
                net=money(gross - fees - tax),
                bank_utr=f"MOCKN{payments_date:%y%m%d}{rnd.randint(100000, 999999)}",
                items=items,
            )
        ]

    # ------------------------------------------------------------ simulator
    def record_txn(
        self,
        db: Session,
        *,
        gateway_qr_id: str | None,
        reference: str | None,
        amount: Decimal,
        status: str,
        payer_vpa: str | None,
        payer_name: str | None,
        error_reason: str | None = None,
    ) -> MockGatewayTxn:
        txn = MockGatewayTxn(
            gateway_payment_id=f"pay_mock_{secrets.token_hex(8)}",
            gateway_qr_id=gateway_qr_id,
            reference=reference,
            amount=money(amount),
            utr="".join(random.choices("0123456789", k=12)) if status == "success" else None,
            payer_vpa=payer_vpa,
            payer_name=payer_name,
            status=status,
            error_reason=error_reason,
            created_at=now(),
        )
        db.add(txn)
        db.flush()
        return txn

    @staticmethod
    def _txn_dict(t: MockGatewayTxn) -> dict:
        return {
            "id": t.gateway_payment_id,
            "qr_id": t.gateway_qr_id,
            "reference": t.reference,
            "amount": str(money(t.amount)),
            "utr": t.utr,
            "payer_vpa": t.payer_vpa,
            "payer_name": t.payer_name,
            "status": t.status,
            "error_reason": t.error_reason,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }

    @staticmethod
    def _normalize(p: dict) -> NormalizedPayment:
        created = p.get("created_at")
        return NormalizedPayment(
            status="success" if p.get("status") == "success" else "failed",
            gateway_payment_id=p["id"],
            amount=money(p.get("amount") or 0),
            gateway_qr_id=p.get("qr_id"),
            reference=p.get("reference"),
            utr=p.get("utr"),
            payer_vpa=p.get("payer_vpa"),
            payer_name=p.get("payer_name"),
            paid_at=datetime.fromisoformat(created) if created else None,
            error_reason=p.get("error_reason"),
        )
