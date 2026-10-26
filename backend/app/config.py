from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    APP_NAME: str = "Plant Technocrat"
    DATABASE_URL: str = "mysql+pymysql://root:password@localhost:3306/upi_tracker?charset=utf8mb4"

    JWT_SECRET: str = "change-this-secret-in-production"
    JWT_EXPIRE_MINUTES: int = 720
    TIMEZONE: str = "Asia/Kolkata"

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Base URL of the web app, used to build customer payment links (/pay/<token>)
    PUBLIC_APP_URL: str = "http://localhost:5173"

    # Payment gateway adapter: "mock" (built-in simulator) or "razorpay"
    PAYMENT_GATEWAY: str = "mock"
    MOCK_WEBHOOK_SECRET: str = "mock-webhook-secret"
    MOCK_GATEWAY_FEE_PERCENT: float = 0.0
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""

    # First-run owner account (created only when the users table is empty)
    DEFAULT_OWNER_USERNAME: str = "owner"
    DEFAULT_OWNER_PASSWORD: str = "owner123"
    DEFAULT_OWNER_NAME: str = "Shop Owner"

    @field_validator("DATABASE_URL")
    @classmethod
    def _use_pymysql(cls, v: str) -> str:
        # TiDB Cloud shows plain "mysql://..."; SQLAlchemy would then look for the
        # missing MySQLdb driver, so force the installed PyMySQL driver.
        if v.startswith("mysql://"):
            return "mysql+pymysql://" + v[len("mysql://"):]
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_mock_gateway(self) -> bool:
        return self.PAYMENT_GATEWAY.lower() == "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
