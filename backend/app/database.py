from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()
_sqlite = "sqlite" in settings.database_url
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _sqlite else {},
    echo=settings.debug,
    **({} if _sqlite else {
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        "pool_timeout": settings.db_pool_timeout_seconds,
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    }),
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """Create all tables — call once at startup or in tests."""
    Base.metadata.create_all(bind=engine)
