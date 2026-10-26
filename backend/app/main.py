import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Allow running directly from within the `app` directory (e.g. `uvicorn main:app`)
if not __package__:
    parent_dir = str(Path(__file__).resolve().parent.parent)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)
    __package__ = "app"

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError

from . import models  # noqa: F401 - registers tables on Base.metadata
from .config import settings
from .database import Base, SessionLocal, engine, ensure_database, safe_db_url
from .models import User
from .routers import (
    admin,
    auth,
    bills,
    customers,
    dashboard,
    exports,
    inventory,
    payments,
    products,
    recon,
    upi,
)
from .routers import settings as settings_router
from .security import hash_password
from .services import app_settings

logger = logging.getLogger("upi_tracker")
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


def init_db() -> None:
    ensure_database()
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        app_settings.ensure_defaults(db)
        if not db.execute(select(func.count(User.id))).scalar():
            db.add(User(
                name=settings.DEFAULT_OWNER_NAME,
                username=settings.DEFAULT_OWNER_USERNAME.lower(),
                password_hash=hash_password(settings.DEFAULT_OWNER_PASSWORD),
                role="owner",
            ))
            logger.warning("Created default owner account '%s'. Change the password after first login.",
                           settings.DEFAULT_OWNER_USERNAME)
        db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
    except OperationalError as exc:
        logger.error(
            "Cannot connect to MySQL at %s: %s\n"
            "Start MySQL and check DATABASE_URL (user, password, host, port) in backend/.env.",
            safe_db_url(), exc.orig,
        )
        raise SystemExit(1) from None
    yield


app = FastAPI(title=settings.APP_NAME, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    logger.warning("Integrity error on %s: %s", request.url.path, exc.orig)
    return JSONResponse(status_code=400, content={"detail": "This record conflicts with an existing one (duplicate value)."})


@app.exception_handler(OperationalError)
async def db_error_handler(request: Request, exc: OperationalError):
    logger.error("Database error on %s: %s", request.url.path, exc.orig)
    return JSONResponse(status_code=503, content={"detail": "Database is not reachable. Check that MySQL is running."})


for r in (auth, settings_router, products, customers, bills, upi, payments, inventory, dashboard, recon, exports, admin):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "gateway": settings.PAYMENT_GATEWAY}


# Serve the built React app (frontend/dist) when it exists, so one process can run everything.
if FRONTEND_DIST.is_dir():
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
