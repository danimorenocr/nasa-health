from pathlib import Path

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, String, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "account"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_salt: Mapped[str] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(String(64))
    profile_image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created: Mapped[float] = mapped_column(Float)


class LocalSession(Base):
    __tablename__ = "local_session"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated: Mapped[float] = mapped_column(Float)
    pending_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    pending: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pending_expires: Mapped[float | None] = mapped_column(Float, nullable=True)


class Entry(Base):
    __tablename__ = "entry"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_hash: Mapped[str] = mapped_column(ForeignKey("local_session.token_hash", ondelete="CASCADE"))
    recorded_at: Mapped[str] = mapped_column(String)
    measured_at: Mapped[str] = mapped_column(String)
    candidate: Mapped[dict] = mapped_column(JSON)
    origin: Mapped[str] = mapped_column(String(120))
    context: Mapped[str] = mapped_column(String(500))
    __table_args__ = (Index("ix_entry_session_measured", "session_hash", "measured_at"),)


def database(db_path):
    path = Path(db_path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 10})

    @event.listens_for(engine, "connect")
    def configure(conn, _record):
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA secure_delete=ON")

    Base.metadata.create_all(engine)
    # create_all does not alter existing tables. Preserve older local sessions
    # and use their last activity as the best available creation timestamp.
    with engine.begin() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(local_session)")}
        if "created" not in columns:
            conn.exec_driver_sql("ALTER TABLE local_session ADD COLUMN created FLOAT")
        if "user_id" not in columns:
            conn.exec_driver_sql("ALTER TABLE local_session ADD COLUMN user_id VARCHAR(36)")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_local_session_user_id ON local_session (user_id)")
        if "revoked" not in columns:
            conn.exec_driver_sql("ALTER TABLE local_session ADD COLUMN revoked BOOLEAN NOT NULL DEFAULT 0")
        conn.exec_driver_sql("UPDATE local_session SET created = updated WHERE created IS NULL")
        account_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(account)")}
        if "profile_image_url" not in account_columns:
            conn.exec_driver_sql("ALTER TABLE account ADD COLUMN profile_image_url VARCHAR(2048)")
    # Best effort on platforms with POSIX permissions. Still not encryption.
    path.chmod(0o600)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def serialize_entry(entry):
    return {
        "id": entry.id,
        "recorded_at": entry.recorded_at,
        "measured_at": entry.measured_at,
        "candidate": entry.candidate,
        "origin": entry.origin,
        "context": entry.context,
        "confirmed_by_user": True,
        "clinical_assessment": "not_performed",
    }


class ResearchCache(Base):
    __tablename__ = "research_cache"
    accession: Mapped[str] = mapped_column(String(20), primary_key=True)
    retrieved_at: Mapped[float] = mapped_column(Float)
    document: Mapped[dict] = mapped_column(JSON)
