"""Razorpay adapter (UPI QR Codes API + webhooks + settlement recon API).

Set PAYMENT_GATEWAY=razorpay and the RAZORPAY_* keys in backend/.env. Keys stay on the server and
are never sent to the browser. Configure the webhook in the Razorpay dashboard to POST
`qr_code.credited` and `payment.failed` events to  https://<your-domain>/api/upi/webhook/razorpay
"""

import hashlib
import hmac
import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Mapping
from zoneinfo import ZoneInfo

import httpx

from ...config import settings
from ...utils import D, money
from .base import (
    GatewayQr,
    GatewaySettlement,
    GatewaySettlementItem,
    NormalizedPayment,
    PaymentGateway,
    WebhookParse,
)

API_BASE = "https://api.razorpay.com/v1"


def _paise_to_rupees(value) -> Decimal:
    return money(D(value or 0) / Decimal("100"))


def _from_unix(ts) -> datetime | None:
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), ZoneInfo(settings.TIMEZONE)).replace(tzinfo=None)


class RazorpayGateway(PaymentGateway):
    name = "razorpay"

    def __init__(self) -> None:
        if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET:
            raise RuntimeError("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in backend/.env")

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=API_BASE,
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
            timeout=15,
        )

    def create_qr(self, db, *, ref, amount, description, expires_at, payee_vpa, payee_name, notes) -> GatewayQr:
        close_by = int(expires_at.replace(tzinfo=ZoneInfo(settings.TIMEZONE)).timestamp())
        body = {
            "type": "upi_qr",
            "name": payee_name[:40] or "Shop",
            "usage": "single_use",
            "fixed_amount": True,
            "payment_amount": int((D(amount) * 100).to_integral_value()),
            "description": description[:200],
            "close_by": close_by,
            "notes": {"ref": ref, **{k: str(v) for k, v in notes.items() if v not in ("", None)}},
        }
        with self._client() as client:
            r = client.post("/payments/qr_codes", json=body)
            if r.is_error:
                try:
                    reason = r.json()["error"]["description"]
                except (ValueError, KeyError, TypeError):
                    reason = r.text
                raise RuntimeError(f"Razorpay rejected the QR request ({r.status_code}): {reason}")
            data = r.json()
        return GatewayQr(gateway_qr_id=data["id"], payload=None, image_url=data.get("image_url"))

    def close_qr(self, db, gateway_qr_id: str) -> None:
        try:
            with self._client() as client:
                client.post(f"/payments/qr_codes/{gateway_qr_id}/close")
        except httpx.HTTPError:
            pass

    def verify_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> bool:
        secret = settings.RAZORPAY_WEBHOOK_SECRET
        received = headers.get("x-razorpay-signature") or ""
        if not secret or not received:
            return False
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, received)

    def parse_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> WebhookParse:
        data = json.loads(raw_body)
        event = data.get("event")
        payload = data.get("payload") or {}
        pay = (payload.get("payment") or {}).get("entity")
        qr = (payload.get("qr_code") or {}).get("entity")
        payments = []
        if pay and event == "qr_code.credited":
            payments.append(self._normalize(pay, qr, "success"))
        elif pay and event == "payment.failed":
            payments.append(self._normalize(pay, qr, "failed"))
        event_id = headers.get("x-razorpay-event-id") or (pay or {}).get("id")
        return WebhookParse(event_id=event_id, event_type=event, payments=payments)

    def fetch_qr_payments(self, db, gateway_qr_id: str) -> list[NormalizedPayment]:
        with self._client() as client:
            r = client.get(f"/payments/qr_codes/{gateway_qr_id}/payments")
            r.raise_for_status()
            items = r.json().get("items", [])
        result = []
        for pay in items:
            status = pay.get("status")
            if status in ("captured", "authorized"):
                result.append(self._normalize(pay, {"id": gateway_qr_id}, "success"))
            elif status == "failed":
                result.append(self._normalize(pay, {"id": gateway_qr_id}, "failed"))
        return result

    def fetch_settlements(self, db, payments_date: date) -> list[GatewaySettlement]:
        # Razorpay settles T+1; the recon API is queried by settlement day.
        day = payments_date + timedelta(days=1)
        with self._client() as client:
            r = client.get(
                "/settlements/recon/combined",
                params={"year": day.year, "month": day.month, "day": day.day, "count": 1000},
            )
            r.raise_for_status()
            rows = r.json().get("items", [])
        grouped: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            if row.get("type") == "payment" and row.get("settlement_id"):
                grouped[row["settlement_id"]].append(row)
        settlements = []
        for sid, rows_ in grouped.items():
            items = [
                GatewaySettlementItem(
                    gateway_payment_id=row.get("entity_id"),
                    amount=_paise_to_rupees(row.get("amount")),
                    fee=_paise_to_rupees(row.get("fee")),
                    utr=None,
                    reference=(row.get("notes") or {}).get("ref") if isinstance(row.get("notes"), dict) else None,
                    captured_at=_from_unix(row.get("created_at")),
                )
                for row in rows_
            ]
            gross = money(sum((i.amount for i in items), Decimal("0")))
            fees = money(sum((i.fee for i in items), Decimal("0")))
            tax = money(sum((_paise_to_rupees(row.get("tax")) for row in rows_), Decimal("0")))
            settlements.append(
                GatewaySettlement(
                    gateway_settlement_id=sid,
                    settlement_date=day,
                    gross=gross,
                    fees=fees,
                    tax=tax,
                    net=money(gross - fees - tax),
                    bank_utr=rows_[0].get("settlement_utr"),
                    items=items,
                )
            )
        return settlements

    @staticmethod
    def _normalize(pay: dict, qr: dict | None, status: str) -> NormalizedPayment:
        notes = pay.get("notes") if isinstance(pay.get("notes"), dict) else {}
        qr_notes = (qr or {}).get("notes") if isinstance((qr or {}).get("notes"), dict) else {}
        return NormalizedPayment(
            status=status,
            gateway_payment_id=pay["id"],
            amount=_paise_to_rupees(pay.get("amount")),
            gateway_qr_id=(qr or {}).get("id"),
            reference=notes.get("ref") or qr_notes.get("ref"),
            utr=(pay.get("acquirer_data") or {}).get("rrn"),
            payer_vpa=pay.get("vpa"),
            payer_name=None,
            paid_at=_from_unix(pay.get("created_at")),
            error_reason=pay.get("error_description"),
        )
