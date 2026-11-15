import hashlib
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import column, delete, func, select
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .catalog import INDICATORS, LIMITATIONS, SOURCES
from .db import (
    Account,
    DailyCheckIn,
    Entry,
    JournalEntry,
    LocalSession,
    Reminder,
    ResearchCache,
    RewardGrant,
    WellnessAction,
    database,
    serialize_entry,
)
from .engine import URGENT_MESSAGE, interpret
from .guidance import build_guidance
from .llm import generate_analysis_recommendation, interpret_with_llm, is_llm_configured
from .recommend import assess
from .research import ResearchUnavailable, import_study
from .schemas import (
    AuthOut,
    CheckInInput,
    ConfirmInput,
    EntriesOut,
    HistoryOut,
    JournalInput,
    LoginInput,
    MessageInput,
    MessageOut,
    ProfileUpdateInput,
    RecordedOut,
    RegisterInput,
    ReminderInput,
    SessionOut,
    UserOut,
    WellnessActionInput,
)
from .trends import SYNTHETIC_ORIGIN, analyze_sleep
from .vitals import SYNTHETIC_VITALS, VITAL_SPECS, analyze_vital, synthetic_payload

ROOT = Path(__file__).resolve().parent.parent
_env_file = ROOT / ".env"
if _env_file.is_file():
    try:
        for _raw_line in _env_file.read_text(encoding="utf-8").splitlines():
            _line = _raw_line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                _k, _v = _k.strip(), _v.strip().strip("\"'")
                if _k and _k not in os.environ:
                    os.environ[_k] = _v
    except OSError:
        pass

# Front React compilado (npm run build en astra-health-front). Se sirve desde el mismo origen que la API.
FRONT_DIST = Path(os.environ.get("FRONT_DIST", ROOT.parent / "astra-health-front" / "dist"))
# Retencion: la sesion se conserva mientras haya acceso al menos una vez dentro de este plazo
# (SESSION_TTL_DAYS, 30 por defecto). Ya no depende de mantenerla activa cada 24 h.
TTL_DAYS = max(1, min(int(os.environ.get("SESSION_TTL_DAYS", "30")), 365))
TTL = TTL_DAYS * 24 * 60 * 60
PENDING_TTL = 120

BADGE_RULES = [
    ("first_contact", "Primer contacto", 50, 1),
    ("heart_in_orbit", "Corazón en órbita", 75, 1),
    ("rest_guardian", "Guardián del descanso", 75, 3),
    ("stellar_mind", "Mente estelar", 50, 1),
    ("gravity_strength", "Fuerza gravitacional", 125, 1),
    ("protective_shield", "Escudo protector", 150, 1),
    ("orbital_consistency", "Constancia orbital", 100, 5),
    ("integral_explorer", "Explorador integral", 100, 2),
]


def iso(timestamp):
    return (
        datetime.fromtimestamp(timestamp, timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


def password_digest(password, salt):
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024
    ).hex()


def new_password(password):
    salt = secrets.token_bytes(16)
    return salt.hex(), password_digest(password, salt)


def password_matches(password, salt_hex, expected):
    actual = password_digest(password, bytes.fromhex(salt_hex))
    return secrets.compare_digest(actual, expected)


def create_app(db_path=None, clock=time.time, enable_rate_limit=True):
    engine, factory = database(db_path or os.environ.get("DATABASE_PATH", ROOT / "data/health.sqlite3"))
    # Bundled public metadata snapshots support offline inspection with original retrieval dates.
    with factory() as db:
        for path in (ROOT / "research_snapshots").glob("OSD-*.json"):
            snapshot = json.loads(path.read_text(encoding="utf-8"))
            if db.get(ResearchCache, snapshot["accession"]) is None:
                db.add(
                    ResearchCache(
                        accession=snapshot["accession"],
                        retrieved_at=datetime.fromisoformat(snapshot["retrieved_at"]).timestamp(),
                        document=snapshot,
                    )
                )
        db.commit()
    lock = threading.Lock()
    rate_lock = threading.Lock()
    hits = defaultdict(deque)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        engine.dispose()

    app = FastAPI(
        title="Salud espacial - backend textual de prueba",
        version="0.3.0",
        lifespan=lifespan,
        description=(
            "Prototipo con datos ficticios; no es diagnóstico ni triage médico. "
            "Interpretación de lenguaje natural con LLM opcional (con heurística local de respaldo) "
            "y transcripción de notas de voz reenviada a un proveedor externo solo si el servidor tiene clave configurada. "
            "Persistencia SQLite local."
        ),
    )
    app.state.engine = engine
    app.state.factory = factory

    def error(code, text):
        return JSONResponse(status_code=code, content={"detail": text})

    @app.middleware("http")
    async def security(request: Request, call_next):
        now = clock()
        origin = request.headers.get("origin")
        host = request.headers.get("host", "")
        if origin and urlparse(origin).netloc != host:
            response = error(403, "Origen no permitido.")
        elif request.method in {"POST", "PUT", "PATCH"} and request.url.path.startswith("/api/"):
            # Las notas de voz son audio binario y necesitan un límite mayor; el resto sigue en 8 KiB.
            is_audio = request.url.path == "/api/v1/transcribe"
            max_body = 10 * 1024 * 1024 + 1024 if is_audio else 8192
            max_label = "10 MiB" if is_audio else "8 KiB"
            length = request.headers.get("content-length")
            if length and (not length.isdigit() or int(length) > max_body):
                response = error(413, f"Cuerpo demasiado grande o tamaño inválido (máximo {max_label}).")
            else:
                # Stream in bounded chunks, including requests without Content-Length.
                body = bytearray()
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > max_body:
                        break
                if len(body) > max_body:
                    response = error(413, f"Cuerpo demasiado grande (máximo {max_label}).")
                else:
                    request._body = bytes(body)
                    response = await limited_call(request, call_next, now)
        else:
            response = await limited_call(request, call_next, now)
        response.headers.update(
            {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Permissions-Policy": "microphone=(self), camera=()",
            }
        )
        if request.url.path not in {"/docs", "/redoc"}:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' blob: data:; "
                "img-src 'self' https: data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
            )
        return response

    async def limited_call(request, call_next, now):
        if enable_rate_limit:
            key = request.client.host if request.client else "local"
            with rate_lock:
                bucket = hits[key]
                while bucket and now - bucket[0] >= 60:
                    bucket.popleft()
                if len(bucket) >= 120:
                    return error(429, "Demasiadas solicitudes. Espera un minuto.")
                bucket.append(now)
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation(_request, _exc):
        return error(422, "Solicitud inválida. Revisa campos, valores, longitudes y zonas horarias en /docs.")

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request, exc):
        return error(exc.status_code, exc.detail if exc.status_code != 404 else "Ruta no encontrada.")

    def cleanup(db):
        cutoff = clock() - TTL
        expired_accounts = db.scalars(
            select(LocalSession).where(LocalSession.user_id.is_not(None), LocalSession.updated <= cutoff)
        )
        for expired in expired_accounts:
            expired.revoked = True
            expired.pending_id, expired.pending, expired.pending_expires = None, None, None
        db.execute(
            delete(LocalSession).where(LocalSession.user_id.is_(None), LocalSession.updated <= cutoff)
        )
        db.commit()

    def authenticated(authorization: Annotated[str | None, Header()] = None):
        if not authorization or not authorization.startswith("Bearer ") or len(authorization) != 71:
            raise HTTPException(401, "Sesión inválida o vencida.")
        digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
        # One local process/worker: serialize confirmation+consume to prevent duplicate writes.
        with lock, factory() as db:
            cleanup(db)
            session = db.get(LocalSession, digest)
            if session is None or session.revoked:
                raise HTTPException(401, "Sesión inválida o vencida.")
            session.updated = clock()
            db.commit()
            yield db, session

    Auth = Annotated[tuple, Depends(authenticated)]

    def entry_condition(session):
        if not session.user_id:
            return Entry.session_hash == session.token_hash
        account_sessions = select(LocalSession.token_hash).where(LocalSession.user_id == session.user_id)
        return Entry.session_hash.in_(account_sessions)

    def require_account(session):
        if not session.user_id:
            raise HTTPException(401, "Inicia sesión con una cuenta para usar esta función.")
        return session.user_id

    def serialize_check_in(row):
        return {
            "id": row.id,
            "date": row.entry_date,
            "mood_score": row.mood_score,
            "mood_word": row.mood_word,
            **row.scales,
            "created_at": iso(row.created),
            "updated_at": iso(row.updated),
        }

    def serialize_journal(row):
        return {
            "id": row.id,
            "date": row.entry_date,
            "text": row.text,
            "created_at": iso(row.created),
            "updated_at": iso(row.updated),
            "private": True,
        }

    def serialize_reminder(row):
        return {
            "id": row.id,
            "kind": row.kind,
            "title": row.title,
            "remind_at": row.remind_at,
            "created_at": iso(row.created),
            "updated_at": iso(row.updated),
        }

    def grant_once(db, owner_id, code, xp, period_key=""):
        existing = db.scalar(
            select(RewardGrant).where(
                RewardGrant.owner_id == owner_id,
                RewardGrant.code == code,
                RewardGrant.period_key == period_key,
            )
        )
        if existing:
            return existing
        grant = RewardGrant(
            id=str(uuid4()),
            owner_id=owner_id,
            code=code,
            period_key=period_key,
            xp=xp,
            granted_at=clock(),
        )
        db.add(grant)
        db.flush()
        return grant

    def reward_progress(db, session):
        owner_id = require_account(session)
        today = datetime.fromtimestamp(clock(), timezone.utc).date()
        week_start = today - timedelta(days=today.weekday())
        week_end = week_start + timedelta(days=6)
        week_key = f"{week_start.isocalendar().year}-W{week_start.isocalendar().week:02d}"

        check_ins = list(
            db.scalars(select(DailyCheckIn).where(DailyCheckIn.owner_id == owner_id))
        )
        reminders = list(db.scalars(select(Reminder).where(Reminder.owner_id == owner_id)))
        actions = list(db.scalars(select(WellnessAction).where(WellnessAction.owner_id == owner_id)))
        action_kinds = {action.kind for action in actions}
        weekly_actions = {
            action.kind
            for action in actions
            if week_start.isoformat() <= action.action_date <= week_end.isoformat()
        }
        weekly_check_in = any(
            week_start.isoformat() <= item.entry_date <= week_end.isoformat() for item in check_ins
        )
        weekly_pause = "pause_completed" in weekly_actions
        if weekly_check_in and weekly_pause:
            grant_once(db, owner_id, "operation_wellbeing", 150, week_key)

        sleep_dates = {
            row.measured_at[:10]
            for row in db.scalars(entry_query(session))
            if row.candidate.get("kind") == "measurement" and row.candidate.get("metric") == "sleep"
        }
        completed_missions = db.scalar(
            select(func.count()).select_from(RewardGrant).where(
                RewardGrant.owner_id == owner_id,
                RewardGrant.code == "operation_wellbeing",
            )
        ) or 0
        progress_by_code = {
            "first_contact": int("onboarding_completed" in action_kinds),
            "heart_in_orbit": len(check_ins),
            "rest_guardian": len(sleep_dates),
            "stellar_mind": int("breathing_completed" in action_kinds),
            "gravity_strength": completed_missions,
            "protective_shield": len(reminders),
            "orbital_consistency": len({item.entry_date for item in check_ins}),
            "integral_explorer": sum(
                action in action_kinds for action in ("explore_body", "explore_insights")
            ),
        }
        badge_rows = []
        for code, name, xp, target in BADGE_RULES:
            progress = min(progress_by_code[code], target)
            if progress >= target:
                grant_once(db, owner_id, code, xp)
            unlocked = db.scalar(
                select(RewardGrant.id).where(
                    RewardGrant.owner_id == owner_id,
                    RewardGrant.code == code,
                    RewardGrant.period_key == "",
                )
            ) is not None
            badge_rows.append(
                {
                    "code": code,
                    "name": name,
                    "xp": xp,
                    "progress": progress,
                    "target": target,
                    "unlocked": unlocked,
                }
            )
        db.commit()
        total_xp = db.scalar(
            select(func.coalesce(func.sum(RewardGrant.xp), 0)).where(RewardGrant.owner_id == owner_id)
        )
        mission_granted = db.scalar(
            select(RewardGrant.id).where(
                RewardGrant.owner_id == owner_id,
                RewardGrant.code == "operation_wellbeing",
                RewardGrant.period_key == week_key,
            )
        ) is not None
        return {
            "xp": total_xp,
            "badges": badge_rows,
            "weekly_mission": {
                "code": "operation_wellbeing",
                "name": "Operación Bienestar",
                "week": week_key,
                "xp": 150,
                "conditions": [
                    {"code": "check_in", "label": "Completar un check-in", "complete": weekly_check_in},
                    {"code": "pause", "label": "Completar una pausa voluntaria", "complete": weekly_pause},
                ],
                "complete": weekly_check_in and weekly_pause,
                "xp_awarded": mission_granted,
            },
        }

    def user_payload(account):
        return {
            "id": account.id,
            "name": account.name,
            "email": account.email,
            "profile_image_url": account.profile_image_url,
        }

    def create_user_session(db, account):
        token = secrets.token_hex(32)
        created = clock()
        db.add(
            LocalSession(
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                user_id=account.id,
                revoked=False,
                created=created,
                updated=created,
            )
        )
        return {
            "token": token,
            "created_at": iso(created),
            "user": user_payload(account),
            "expires_after_idle_hours": TTL_DAYS * 24,
            "expires_after_idle_days": TTL_DAYS,
            "storage": "sqlite",
        }

    @app.get("/health")
    def health():
        with factory() as db:
            db.execute(select(1)).scalar_one()
        return {"status": "ok", "version": "0.3.0", "storage": "sqlite", "mode": "prototype"}

    @app.get("/api/v1/capabilities")
    def capabilities():
        return {
            "input": "text",
            "storage": "sqlite",
            "session_idle_ttl_hours": TTL_DAYS * 24,
            "session_idle_ttl_days": TTL_DAYS,
            "pending_ttl_seconds": PENDING_TTL,
            "sources": SOURCES,
            "limitations": LIMITATIONS,
            "emergency_protocol": {"available": False, "communication_connected": False},
            "supported_metrics": INDICATORS,
        }

    @app.get("/api/v1/guidance")
    def guidance():
        return build_guidance(SOURCES)

    @app.get("/api/v1/indicators")
    def indicators():
        return {
            "indicators": INDICATORS,
            "clinical_assessment": "not_performed",
            "source_ids": ["space-apps-2026"],
        }

    @app.post("/api/v1/auth/register", status_code=201, response_model=AuthOut)
    def register(payload: RegisterInput, authorization: Annotated[str | None, Header()] = None):
        with lock, factory() as db:
            cleanup(db)
            if db.scalar(select(Account).where(Account.email == payload.email)):
                raise HTTPException(409, "Ya existe una cuenta con ese correo.")
            salt, digest = new_password(payload.password)
            account = Account(
                id=str(uuid4()),
                name=payload.name,
                email=payload.email,
                password_salt=salt,
                password_hash=digest,
                created=clock(),
            )
            db.add(account)
            # If this browser used the earlier anonymous prototype, preserve
            # those entries by attaching that session to the new account.
            if authorization and authorization.startswith("Bearer ") and len(authorization) == 71:
                previous_digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
                previous = db.get(LocalSession, previous_digest)
                if previous is not None and previous.user_id is None and not previous.revoked:
                    previous.user_id = account.id
                    previous.revoked = True
            response = create_user_session(db, account)
            try:
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(409, "Ya existe una cuenta con ese correo.") from exc
            return response

    @app.post("/api/v1/auth/login", response_model=AuthOut)
    def login(payload: LoginInput):
        with lock, factory() as db:
            cleanup(db)
            account = db.scalar(select(Account).where(Account.email == payload.email))
            if account is None or not password_matches(
                payload.password, account.password_salt, account.password_hash
            ):
                raise HTTPException(401, "Correo o contraseña incorrectos.")
            response = create_user_session(db, account)
            db.commit()
            return response

    @app.post("/api/v1/auth/logout", status_code=204)
    def logout(auth: Auth):
        db, session = auth
        session.revoked = True
        session.pending_id, session.pending, session.pending_expires = None, None, None
        db.commit()
        return Response(status_code=204)

    @app.patch("/api/v1/profile", response_model=UserOut)
    def update_profile(payload: ProfileUpdateInput, auth: Auth):
        db, session = auth
        account = db.get(Account, session.user_id) if session.user_id else None
        if account is None:
            raise HTTPException(401, "La sesión no está vinculada a una cuenta.")
        account.profile_image_url = payload.profile_image_url
        db.commit()
        return user_payload(account)

    @app.get("/api/v1/mind/check-ins")
    def list_check_ins(auth: Auth, days: int = Query(7, ge=1, le=3650)):
        db, session = auth
        owner_id = require_account(session)
        today = datetime.fromtimestamp(clock(), timezone.utc).date()
        start = today - timedelta(days=days - 1)
        rows = db.scalars(
            select(DailyCheckIn)
            .where(DailyCheckIn.owner_id == owner_id, DailyCheckIn.entry_date >= start.isoformat())
            .order_by(DailyCheckIn.entry_date)
        )
        return {"check_ins": [serialize_check_in(row) for row in rows], "days": days}

    @app.put("/api/v1/mind/check-ins/{entry_date}")
    def save_check_in(entry_date: date, payload: CheckInInput, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        today = datetime.fromtimestamp(clock(), timezone.utc).date()
        if entry_date > today:
            raise HTTPException(422, "El check-in no puede tener una fecha futura.")
        row = db.scalar(
            select(DailyCheckIn).where(
                DailyCheckIn.owner_id == owner_id,
                DailyCheckIn.entry_date == entry_date.isoformat(),
            )
        )
        now = clock()
        scales = {
            key: value
            for key, value in {
                "stress": payload.stress,
                "isolation": payload.isolation,
                "concentration": payload.concentration,
                "energy": payload.energy,
                "sleep_difficulty": payload.sleep_difficulty,
            }.items()
            if value is not None
        }
        created = row is None
        if row is None:
            row = DailyCheckIn(
                id=str(uuid4()),
                owner_id=owner_id,
                entry_date=entry_date.isoformat(),
                mood_score=payload.mood_score,
                mood_word=payload.mood_word,
                scales=scales,
                created=now,
                updated=now,
            )
            db.add(row)
        else:
            row.mood_score = payload.mood_score
            row.mood_word = payload.mood_word
            row.scales = scales
            row.updated = now
        db.commit()
        return {"status": "created" if created else "updated", "check_in": serialize_check_in(row)}

    @app.get("/api/v1/mind/journal")
    def list_journal(auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        rows = db.scalars(
            select(JournalEntry)
            .where(JournalEntry.owner_id == owner_id)
            .order_by(JournalEntry.entry_date.desc(), JournalEntry.created.desc())
        )
        return {"entries": [serialize_journal(row) for row in rows]}

    @app.post("/api/v1/mind/journal", status_code=201)
    def create_journal(payload: JournalInput, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        if payload.entry_date > datetime.fromtimestamp(clock(), timezone.utc).date():
            raise HTTPException(422, "La entrada no puede tener una fecha futura.")
        now = clock()
        row = JournalEntry(
            id=str(uuid4()),
            owner_id=owner_id,
            entry_date=payload.entry_date.isoformat(),
            text=payload.text,
            created=now,
            updated=now,
        )
        db.add(row)
        db.commit()
        return serialize_journal(row)

    @app.put("/api/v1/mind/journal/{entry_id}")
    def update_journal(entry_id: str, payload: JournalInput, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        row = db.scalar(
            select(JournalEntry).where(
                JournalEntry.id == entry_id,
                JournalEntry.owner_id == owner_id,
            )
        )
        if row is None:
            raise HTTPException(404, "Entrada de diario no encontrada.")
        if payload.entry_date > datetime.fromtimestamp(clock(), timezone.utc).date():
            raise HTTPException(422, "La entrada no puede tener una fecha futura.")
        row.entry_date = payload.entry_date.isoformat()
        row.text = payload.text
        row.updated = clock()
        db.commit()
        return serialize_journal(row)

    @app.delete("/api/v1/mind/journal/{entry_id}", status_code=204)
    def delete_journal(entry_id: str, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        row = db.scalar(
            select(JournalEntry).where(
                JournalEntry.id == entry_id,
                JournalEntry.owner_id == owner_id,
            )
        )
        if row is None:
            raise HTTPException(404, "Entrada de diario no encontrada.")
        db.delete(row)
        db.commit()
        return Response(status_code=204)

    @app.get("/api/v1/mind/reminders")
    def list_reminders(auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        rows = db.scalars(
            select(Reminder).where(Reminder.owner_id == owner_id).order_by(Reminder.remind_at)
        )
        return {"reminders": [serialize_reminder(row) for row in rows]}

    @app.post("/api/v1/mind/reminders", status_code=201)
    def create_reminder(payload: ReminderInput, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        now = clock()
        row = Reminder(
            id=str(uuid4()),
            owner_id=owner_id,
            kind=payload.kind,
            title=payload.title,
            remind_at=payload.remind_at.isoformat().replace("+00:00", "Z"),
            created=now,
            updated=now,
        )
        db.add(row)
        db.commit()
        return serialize_reminder(row)

    @app.put("/api/v1/mind/reminders/{reminder_id}")
    def update_reminder(reminder_id: str, payload: ReminderInput, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        row = db.scalar(
            select(Reminder).where(Reminder.id == reminder_id, Reminder.owner_id == owner_id)
        )
        if row is None:
            raise HTTPException(404, "Recordatorio no encontrado.")
        row.kind = payload.kind
        row.title = payload.title
        row.remind_at = payload.remind_at.isoformat().replace("+00:00", "Z")
        row.updated = clock()
        db.commit()
        return serialize_reminder(row)

    @app.delete("/api/v1/mind/reminders/{reminder_id}", status_code=204)
    def delete_reminder(reminder_id: str, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        row = db.scalar(
            select(Reminder).where(Reminder.id == reminder_id, Reminder.owner_id == owner_id)
        )
        if row is None:
            raise HTTPException(404, "Recordatorio no encontrado.")
        db.delete(row)
        db.commit()
        return Response(status_code=204)

    @app.post("/api/v1/mind/actions")
    def record_wellness_action(payload: WellnessActionInput, auth: Auth):
        db, session = auth
        owner_id = require_account(session)
        today = datetime.fromtimestamp(clock(), timezone.utc).date()
        if payload.action_date > today:
            raise HTTPException(422, "La acción no puede tener una fecha futura.")
        row = db.scalar(
            select(WellnessAction).where(
                WellnessAction.owner_id == owner_id,
                WellnessAction.kind == payload.kind,
                WellnessAction.action_date == payload.action_date.isoformat(),
            )
        )
        created = row is None
        if row is None:
            row = WellnessAction(
                id=str(uuid4()),
                owner_id=owner_id,
                kind=payload.kind,
                action_date=payload.action_date.isoformat(),
                created=clock(),
            )
            db.add(row)
            db.flush()
        rewards = reward_progress(db, session)
        return {"status": "created" if created else "already_recorded", "rewards": rewards}

    @app.get("/api/v1/rewards")
    def rewards(auth: Auth):
        db, session = auth
        return reward_progress(db, session)

    @app.post("/api/v1/sessions", status_code=201, response_model=SessionOut)
    def new_session():
        with lock, factory() as db:
            cleanup(db)
            if db.scalar(select(func.count()).select_from(LocalSession)) >= 1000:
                raise HTTPException(503, "Límite de sesiones alcanzado.")
            token = secrets.token_hex(32)
            created = clock()
            db.add(
                LocalSession(
                    token_hash=hashlib.sha256(token.encode()).hexdigest(),
                    revoked=False,
                    created=created,
                    updated=created,
                )
            )
            db.commit()
            return {
                "token": token,
                "created_at": iso(created),
                "expires_after_idle_hours": TTL_DAYS * 24,
                "expires_after_idle_days": TTL_DAYS,
                "storage": "sqlite",
            }

    @app.get("/api/v1/session")
    def current_session(auth: Auth):
        db, session = auth
        account = db.get(Account, session.user_id) if session.user_id else None
        return {
            "valid": True,
            "created_at": iso(session.created or session.updated),
            "user": user_payload(account) if account else None,
            "storage": "sqlite",
            "expires_after_idle_hours": TTL_DAYS * 24,
            "expires_after_idle_days": TTL_DAYS,
            "entry_count": db.scalar(
                select(func.count()).select_from(Entry).where(entry_condition(session))
            ),
        }

    def entry_query(session):
        return select(Entry).where(entry_condition(session))

    @app.post("/api/v1/messages", response_model=MessageOut)
    async def message(payload: MessageInput, auth: Auth):
        db, session = auth
        entries = list(
            db.scalars(
                entry_query(session).order_by(Entry.measured_at.desc(), column("rowid").desc())
            )
        )
        result = None
        if is_llm_configured():
            result = await interpret_with_llm(payload.text, entries=entries)

        if not result:
            result = interpret(payload.text, entries=entries)

        session.pending = result.get("candidate")
        session.pending_id = str(uuid4()) if session.pending else None
        session.pending_expires = clock() + PENDING_TTL if session.pending else None
        db.commit()
        return {
            **result,
            "pending_id": session.pending_id,
            "pending_expires_at": iso(session.pending_expires) if session.pending_expires else None,
            "recorded": False,
        }

    @app.post("/api/v1/confirmations", status_code=201, response_model=RecordedOut)
    def confirm(payload: ConfirmInput, auth: Auth):
        db, session = auth
        if not session.pending or session.pending_id != str(payload.pending_id):
            raise HTTPException(409, "La propuesta ya no está pendiente. Envía de nuevo el texto.")
        if session.pending_expires is None or clock() >= session.pending_expires:
            session.pending_id, session.pending, session.pending_expires = None, None, None
            db.commit()
            raise HTTPException(409, "La propuesta venció. Envía de nuevo el texto y revísalo.")
        measured = payload.measured_at.timestamp() if payload.measured_at else clock()
        if measured > clock():
            raise HTTPException(422, "La fecha de medición no puede estar en el futuro.")
        count = db.scalar(
            select(func.count()).select_from(Entry).where(entry_condition(session))
        )
        if count >= 2000:
            raise HTTPException(409, "Sesión llena (2000 registros). Exporta y borra la sesión.")
        if session.pending.get("kind") == "batch":
            measurements = session.pending.get("measurements", [])
            entries_added = []
            for m in measurements:
                e = Entry(
                    id=str(uuid4()),
                    session_hash=session.token_hash,
                    recorded_at=iso(clock()),
                    measured_at=iso(measured),
                    candidate=m,
                    origin=payload.origin,
                    context=payload.context,
                    recommendation=assess(m, payload.context),
                )
                db.add(e)
                entries_added.append(e)
            session.pending_id, session.pending, session.pending_expires = None, None, None
            db.commit()
            serialized = [serialize_entry(e) for e in entries_added]
            return {
                "status": "recorded",
                "entry": serialized[0],
                "entries": serialized,
                "clinical_assessment": "not_performed",
                "message": f"{len(serialized)} registros confirmados en SQLite local. No determina normalidad ni descarta una urgencia.",
            }

        entry = Entry(
            id=str(uuid4()),
            session_hash=session.token_hash,
            recorded_at=iso(clock()),
            measured_at=iso(measured),
            candidate=session.pending,
            origin=payload.origin,
            context=payload.context,
            recommendation=assess(session.pending, payload.context),
        )
        db.add(entry)
        session.pending_id, session.pending, session.pending_expires = None, None, None
        db.commit()
        serialized = serialize_entry(entry)
        return {
            "status": "recorded",
            "entry": serialized,
            "entries": [serialized],
            "clinical_assessment": "not_performed",
            "message": "Registro confirmado en SQLite local. No determina normalidad ni descarta una urgencia.",
        }

    @app.delete("/api/v1/pending", status_code=204)
    def discard(auth: Auth):
        db, session = auth
        session.pending_id, session.pending, session.pending_expires = None, None, None
        db.commit()
        return Response(status_code=204)

    @app.post("/api/v1/transcribe")
    async def transcribe(request: Request, auth: Auth):
        audio_bytes = await request.body()
        if not audio_bytes or len(audio_bytes) < 100:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "El archivo de audio está vacío o es demasiado corto.",
                    "text": "",
                    "configured": False,
                },
            )
        if len(audio_bytes) > 10 * 1024 * 1024:
            raise HTTPException(413, "El archivo de audio supera el límite permitido de 10 MB.")

        openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
        groq_key = os.environ.get("GROQ_API_KEY", "").strip()

        if not openai_key and not groq_key:
            return {
                "status": "no_credentials",
                "message": (
                    "El servidor no tiene configuradas credenciales para la transcripción de notas de voz "
                    "(OPENAI_API_KEY o GROQ_API_KEY). Puedes usar el dictado en vivo del navegador "
                    "o escribir directamente con el teclado mientras tanto."
                ),
                "text": "",
                "configured": False,
            }

        content_type = request.headers.get("content-type", "audio/webm").split(";")[0].strip()
        ext = "webm"
        if "ogg" in content_type:
            ext = "ogg"
        elif "wav" in content_type:
            ext = "wav"
        elif "mp4" in content_type:
            ext = "mp4"
        elif "mp3" in content_type or "mpeg" in content_type:
            ext = "mp3"

        api_url = (
            "https://api.openai.com/v1/audio/transcriptions"
            if openai_key
            else "https://api.groq.com/openai/v1/audio/transcriptions"
        )
        api_token = openai_key or groq_key
        model_name = "whisper-1" if openai_key else "whisper-large-v3-turbo"

        files = {"file": (f"audio.{ext}", audio_bytes, content_type)}
        data = {"model": model_name, "language": "es"}
        headers = {"Authorization": f"Bearer {api_token}"}

        try:
            async with httpx.AsyncClient(timeout=35.0) as client:
                res = await client.post(api_url, headers=headers, data=data, files=files)
                if res.status_code == 200:
                    payload = res.json()
                    transcribed_text = payload.get("text", "").strip()
                    return {
                        "status": "success",
                        "text": transcribed_text,
                        "message": "Nota de voz transcrita exitosamente.",
                        "configured": True,
                    }
                return JSONResponse(
                    status_code=502,
                    content={
                        "status": "error",
                        "message": f"El servicio externo de transcripción devolvió código {res.status_code}.",
                        "text": "",
                        "configured": True,
                    },
                )
        except (httpx.HTTPError, ValueError, OSError) as ex:
            return JSONResponse(
                status_code=502,
                content={
                    "status": "error",
                    "message": f"No se pudo contactar el servicio de transcripción: {ex!s}",
                    "text": "",
                    "configured": True,
                },
            )

    @app.get("/api/v1/entries", response_model=EntriesOut)
    def entries(auth: Auth, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
        db, session = auth
        count = db.scalar(
            select(func.count()).select_from(Entry).where(entry_condition(session))
        )
        rows = db.scalars(
            entry_query(session).order_by(Entry.recorded_at.desc(), Entry.id).limit(limit).offset(offset)
        )
        return {
            "entries": [serialize_entry(e) for e in rows],
            "count": count,
            "limit": limit,
            "offset": offset,
        }

    @app.get("/api/v1/history", response_model=HistoryOut)
    def history(auth: Auth, metric: str = Query(...), days: int = Query(30, ge=1, le=3650)):
        if metric not in {i["code"] for i in INDICATORS}:
            raise HTTPException(422, "Indicador desconocido.")
        db, session = auth
        rows = db.scalars(
            entry_query(session)
            .where(Entry.measured_at >= iso(clock() - days * 86400))
            .order_by(Entry.measured_at, column("rowid"))  # rowid: desempata mismo instante por orden de captura
        )
        points = [
            {
                "t": e.measured_at,
                "values": e.candidate["values"],
                "unit": e.candidate["unit"],
                "origin": e.origin,
                "context": e.context,
                "entry_id": e.id,
            }
            for e in rows
            if e.candidate.get("metric") == metric
        ]
        # Keep units separate, never average mg/dL with mmol/L or Celsius with Fahrenheit.
        series = [
            {"unit": unit, "points": [p for p in points if p["unit"] == unit]}
            for unit in dict.fromkeys(p["unit"] for p in points)
        ]
        return {
            "metric": metric,
            "days": days,
            "as_of": iso(clock()),
            "series": series,
            "count": len(points),
            "clinical_assessment": "not_performed",
        }

    @app.get("/api/v1/analysis/{metric}")
    async def metric_analysis(
        auth: Auth,
        metric: str,
        days: int = Query(7, ge=1, le=90),
        tz_offset_minutes: int = Query(0, ge=-840, le=840),
    ):
        db, session = auth
        # rowid desempata registros con el mismo instante por orden de captura
        rows = list(db.scalars(entry_query(session).order_by(Entry.measured_at, column("rowid"))))
        now = datetime.fromtimestamp(clock(), timezone.utc)
        if metric == "sleep":
            res = analyze_sleep(rows, now, days, tz_offset_minutes)
        elif metric in VITAL_SPECS:
            res = analyze_vital(rows, now, days, tz_offset_minutes, VITAL_SPECS[metric])
        else:
            raise HTTPException(422, "Indicador de análisis desconocido.")

        res["ai_recommendation"] = await generate_analysis_recommendation(
            metric=metric,
            personal=res.get("personal_calculation"),
            education=res.get("education"),
            recent_entries=rows,
            now=now,
        )
        return res

    # Serie ficticia de 3 días para todos los indicadores: una lectura cada 8 h
    # (9 por indicador, de la más antigua a la más reciente) y el sueño de 3 noches.
    SYNTHETIC_3_DAYS = {
        "heart_rate": ("lpm", [[74], [88], [70], [76], [92], [68], [72], [84], [71]], "En reposo"),
        "blood_pressure": ("mmHg", [[118, 76], [124, 80], [116, 74], [120, 78], [128, 84], [117, 75], [121, 79], [126, 82], [119, 77]], "Sentado, en reposo"),
        "oxygen_saturation": ("%", [[97], [98], [97], [96], [98], [97], [98], [97], [98]], "En reposo"),
        "temperature": ("°C", [[36.6], [36.9], [36.5], [36.8], [37.2], [36.6], [36.7], [37.0], [36.6]], "Medición oral"),
        "glucose": ("mg/dL", [[92], [128], [88], [96], [135], [90], [94], [148], [91]], "Historial de prueba"),
        "muscle_mass": ("kg", [[32.1], [32.2], [32.1], [32.3], [32.2], [32.4], [32.3], [32.4], [32.5]], "Báscula de composición corporal"),
    }

    @app.post("/api/v1/synthetic", status_code=201)
    def synthetic_all(auth: Auth):
        """Carga datos ficticios de 3 días de todos los indicadores, claramente marcados.

        Reemplaza solo los sintéticos anteriores de esta sesión; nunca toca registros
        confirmados por la persona.
        """
        db, session = auth
        db.execute(
            delete(Entry).where(entry_condition(session), Entry.origin == SYNTHETIC_ORIGIN)
        )
        now_ts = clock()
        note = "Historial de prueba, no es de una persona real"
        rows = []
        for metric, (unit, series, context) in SYNTHETIC_3_DAYS.items():
            for i, values in enumerate(series):
                rows.append((metric, unit, values, now_ts - (len(series) - 1 - i) * 8 * 3600, context))
        for i, hours in enumerate([7.5, 6.5, 6.0]):  # de hace 3 noches a la última
            rows.append(("sleep", "h", [hours], now_ts - (2 - i) * 24 * 3600 - 2 * 3600, "Sueño declarado"))
        for metric, unit, values, ts, context in rows:
            candidate = {
                "kind": "measurement",
                "metric": metric,
                "values": values,
                "unit": unit,
                "original_text": f"{metric} {'/'.join(f'{v:g}' for v in values)} {unit} (sintético)",
            }
            full_context = f"{context}. {note}"
            db.add(
                Entry(
                    id=str(uuid4()),
                    session_hash=session.token_hash,
                    recorded_at=iso(now_ts),
                    measured_at=iso(ts),
                    candidate=candidate,
                    origin=SYNTHETIC_ORIGIN,
                    context=full_context,
                    recommendation=assess(candidate, full_context),
                )
            )
        db.commit()
        return {"status": "created", "days": 3, "entries": len(rows), "origin": SYNTHETIC_ORIGIN, "synthetic": True}

    @app.post("/api/v1/synthetic/{metric}", status_code=201)
    def synthetic_metric(auth: Auth, metric: str):
        """Carga una serie ficticia de 7 días, claramente marcada, para probar el análisis.

        Reemplaza solo las sintéticas anteriores de esa sesión e indicador; nunca toca
        registros confirmados por la persona ni los sintéticos de otros indicadores.
        """
        db, session = auth
        if metric == "sleep":
            payloads = [
                {
                    "candidate": {
                        "kind": "measurement",
                        "metric": "sleep",
                        "values": [hours],
                        "unit": "h",
                        "original_text": f"Dormí {hours} horas (sintético)",
                    },
                    "context": "Historial de prueba, no es de una persona real",
                }
                for hours in [7.5, 7.0, 6.5, 6.0, 5.5, 5.0, 4.5]
            ]
        elif metric in SYNTHETIC_VITALS:
            payloads = synthetic_payload(metric)
        else:
            raise HTTPException(422, "Indicador sintético desconocido.")
        db.execute(
            delete(Entry).where(
                entry_condition(session),
                Entry.origin == SYNTHETIC_ORIGIN,
                Entry.candidate["metric"].as_string() == metric,
            )
        )
        now = datetime.fromtimestamp(clock(), timezone.utc)
        for i, item in enumerate(payloads):
            when = (now - timedelta(days=6 - i)).replace(hour=12, minute=0, second=0, microsecond=0)
            if when.timestamp() > clock():
                when = now
            db.add(
                Entry(
                    id=str(uuid4()),
                    session_hash=session.token_hash,
                    recorded_at=iso(clock()),
                    measured_at=iso(when.timestamp()),
                    candidate=item["candidate"],
                    origin=SYNTHETIC_ORIGIN,
                    context=item["context"],
                )
            )
        db.commit()
        return {
            "status": "created",
            "metric": metric,
            "entries": len(payloads),
            "origin": SYNTHETIC_ORIGIN,
            "synthetic": True,
        }

    @app.get("/api/v1/export")
    def export(auth: Auth):
        db, session = auth
        return {
            "schema_version": "2.0",
            "exported_at": iso(clock()),
            "mode": "prototype",
            "entries": [
                serialize_entry(e) for e in db.scalars(entry_query(session).order_by(Entry.measured_at))
            ],
            "sources": SOURCES,
            "limitations": LIMITATIONS,
        }

    @app.delete("/api/v1/session", status_code=204)
    def erase(auth: Auth):
        db, session = auth
        db.delete(session)
        db.commit()
        return Response(status_code=204)

    @app.get("/api/v1/research/studies")
    def research_list():
        with factory() as db:
            rows = db.scalars(select(ResearchCache).order_by(ResearchCache.accession))
            return {
                "studies": [
                    dict(r.document, cached=True, stale=clock() - r.retrieved_at >= 86400) for r in rows
                ],
                "scope": "Investigación pública separada de los registros de la sesión.",
                "suggested_accessions": ["OSD-656", "OSD-48"],
            }

    @app.get("/api/v1/research/studies/{accession}")
    def research_study(accession: str, refresh: bool = False):
        import re

        if not re.fullmatch(r"OSD-[1-9]\d{0,5}", accession):
            raise HTTPException(422, "Usa un identificador como OSD-656.")
        with factory() as db:
            cached = db.get(ResearchCache, accession)
            # Daily cache; explicit refresh is still bounded to one per five minutes per study.
            if cached and (
                not refresh
                and clock() - cached.retrieved_at < 86400
                or refresh
                and clock() - cached.retrieved_at < 300
            ):
                return dict(cached.document, cached=True, stale=False)
            try:
                document = import_study(accession, clock())
            except ResearchUnavailable as exc:
                if cached:
                    return dict(
                        cached.document,
                        cached=True,
                        stale=True,
                        upstream_error="OSDR no disponible; se muestra la copia local con su fecha.",
                    )
                raise HTTPException(502, str(exc)) from exc
            if cached:
                cached.document, cached.retrieved_at = document, clock()
            else:
                db.add(ResearchCache(accession=accession, retrieved_at=clock(), document=document))
            db.commit()
            return dict(document, cached=False, stale=False)

    @app.get("/api/v1/safety")
    def safety():
        return {
            "message": URGENT_MESSAGE,
            "protocol_available": False,
            "communication_sent": False,
            "validated": False,
        }

    @app.get("/demo", include_in_schema=False)
    def demo():
        return FileResponse(ROOT / "demo/index.html")

    @app.get("/", include_in_schema=False)
    def front():
        index = FRONT_DIST / "index.html"
        return FileResponse(index if index.is_file() else ROOT / "demo/index.html")

    @app.get("/app.js", include_in_schema=False)
    def demo_js():
        return FileResponse(ROOT / "demo/app.js", media_type="application/javascript")

    @app.get("/style.css", include_in_schema=False)
    def demo_css():
        return FileResponse(ROOT / "demo/style.css", media_type="text/css")

    if (FRONT_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=FRONT_DIST / "assets"), name="front-assets")

    return app


app = create_app()
