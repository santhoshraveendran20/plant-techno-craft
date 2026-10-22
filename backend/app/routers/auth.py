from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import ChangePasswordIn, LoginIn, UserCreate, UserUpdate
from ..security import create_access_token, get_current_user, hash_password, require_owner, verify_password
from ..serializers import user_dict
from ..services.audit import log_audit
from ..utils import now

router = APIRouter(prefix="/api", tags=["auth & staff"])


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.username == body.username.strip().lower())).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong username or password")
    if not user.is_active:
        raise HTTPException(403, "This account is disabled. Ask the owner.")
    user.last_login_at = now()
    log_audit(db, user, "login", "user", user.id, f"{user.username} signed in")
    db.commit()
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": user_dict(user)}


@router.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return user_dict(user)


@router.post("/auth/change-password")
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    log_audit(db, user, "update", "user", user.id, "Changed own password")
    db.commit()
    return {"ok": True}


@router.get("/users")
def list_users(_: User = Depends(require_owner), db: Session = Depends(get_db)):
    return [user_dict(u) for u in db.execute(select(User).order_by(User.id)).scalars()]


@router.post("/users")
def create_user(body: UserCreate, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    username = body.username.strip().lower()
    if db.execute(select(User).where(User.username == username)).scalar_one_or_none():
        raise HTTPException(400, "Username already exists")
    user = User(name=body.name.strip(), username=username, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    db.flush()
    log_audit(db, owner, "create", "user", user.id, f"Added {body.role} {username}", new={"role": body.role})
    db.commit()
    return user_dict(user)


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    old = user_dict(user)
    if body.role is not None or body.is_active is False:
        demoting = (body.role is not None and body.role != "owner") or body.is_active is False
        if demoting and user.role == "owner":
            owners = db.execute(
                select(func.count(User.id)).where(User.role == "owner", User.is_active.is_(True))
            ).scalar()
            if owners <= 1:
                raise HTTPException(400, "At least one active owner is required")
    if body.name is not None:
        user.name = body.name.strip()
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.password_hash = hash_password(body.password)
    log_audit(db, owner, "update", "user", user.id, f"Updated user {user.username}" + (" (password reset)" if body.password else ""),
              old={k: old[k] for k in ("name", "role", "is_active")},
              new={"name": user.name, "role": user.role, "is_active": user.is_active})
    db.commit()
    return user_dict(user)
