import os

import pytest

# Point the app at a throw-away test database BEFORE app modules are imported.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "mysql+pymysql://upi:upi_pass123@localhost:3306/upi_tracker_test?charset=utf8mb4"
)
os.environ["PAYMENT_GATEWAY"] = "mock"
os.environ["DEFAULT_OWNER_USERNAME"] = "owner"
os.environ["DEFAULT_OWNER_PASSWORD"] = "owner123"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine, ensure_database  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    ensure_database()
    Base.metadata.drop_all(bind=engine)
    with TestClient(app) as c:  # runs the lifespan -> creates tables + default owner
        yield c
    engine.dispose()


def _token(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def owner(client):
    return _token(client, "owner", "owner123")


@pytest.fixture(scope="session")
def cashier(client, owner):
    r = client.post("/api/users", headers=owner,
                    json={"name": "Counter Staff", "username": "cashier1", "password": "cashier123", "role": "cashier"})
    assert r.status_code == 200, r.text
    return _token(client, "cashier1", "cashier123")
