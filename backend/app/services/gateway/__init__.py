from functools import lru_cache

from ...config import settings
from .base import PaymentGateway


@lru_cache
def _build(name: str) -> PaymentGateway:
    if name == "mock":
        from .mock import MockGateway

        return MockGateway()
    if name == "razorpay":
        from .razorpay import RazorpayGateway

        return RazorpayGateway()
    raise RuntimeError(f"Unknown PAYMENT_GATEWAY '{name}'. Use 'mock' or 'razorpay'.")


def get_gateway(name: str | None = None) -> PaymentGateway:
    return _build((name or settings.PAYMENT_GATEWAY).lower())
