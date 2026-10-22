from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from ..config import settings as env
from ..database import get_db
from ..models import User
from ..security import get_current_user, require_owner
from ..services import app_settings
from ..services.audit import log_audit

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _with_gateway(data: dict) -> dict:
    # Gateway keys never leave the server; the app only learns which adapter is active.
    data["gateway"] = env.PAYMENT_GATEWAY.lower()
    data["gateway_is_mock"] = env.is_mock_gateway
    data["public_app_url"] = env.PUBLIC_APP_URL
    return data


@router.get("")
def get_settings(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _with_gateway(app_settings.get_all(db))


@router.put("")
def update_settings(data: dict = Body(...), owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    changes = app_settings.update(db, data)
    if changes:
        log_audit(db, owner, "update", "settings", None, "Changed settings: " + ", ".join(changes.keys()),
                  old={k: v[0] for k, v in changes.items()}, new={k: v[1] for k, v in changes.items()})
    db.commit()
    return _with_gateway(app_settings.get_all(db))
