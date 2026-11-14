from pathlib import Path

from sqlalchemy import JSON, Float, ForeignKey, Index, String, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class LocalSession(Base):
    __tablename__ = "local_session"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
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
