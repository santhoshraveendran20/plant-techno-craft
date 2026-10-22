import logging

from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

logger = logging.getLogger("upi_tracker")

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def safe_db_url() -> str:
    return make_url(settings.DATABASE_URL).render_as_string(hide_password=True)


def ensure_database() -> None:
    """Create the MySQL database named in DATABASE_URL if it does not exist yet."""
    url = make_url(settings.DATABASE_URL)
    if url.get_backend_name() != "mysql" or not url.database:
        return
    server_engine = create_engine(url.set(database=""), isolation_level="AUTOCOMMIT")
    try:
        with server_engine.connect() as conn:
            conn.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS `{url.database}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
    except ProgrammingError as exc:
        # The user may not be allowed to create databases; fine if it already exists.
        logger.warning("Could not create database %s (%s). Assuming it already exists.", url.database, exc.orig)
    finally:
        server_engine.dispose()


def lock(db: Session, model, obj_id):
    """SELECT ... FOR UPDATE a row and refresh the instance in the session."""
    db.flush()  # never let populate_existing overwrite pending in-memory changes
    return db.execute(
        select(model).where(model.id == obj_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()
