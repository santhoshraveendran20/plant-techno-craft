import json

from sqlalchemy.orm import Session

from ..models import AuditLog, User


def _dump(value):
    if value is None:
        return None
    return json.dumps(value, default=str, ensure_ascii=False)


def log_audit(
    db: Session,
    user: User | None,
    action: str,
    entity: str,
    entity_id=None,
    summary: str = "",
    old=None,
    new=None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else "system",
            role=user.role if user else "system",
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            summary=(summary or "")[:255],
            old_value=_dump(old),
            new_value=_dump(new),
        )
    )
