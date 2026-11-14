import hashlib
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import column, delete, func, select
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .catalog import INDICATORS, LIMITATIONS, SOURCES
from .db import Account, Entry, LocalSession, ResearchCache, database, serialize_entry
from .engine import URGENT_MESSAGE, interpret
from .research import ResearchUnavailable, import_study
from .schemas import (
    AuthOut,
    ConfirmInput,
    EntriesOut,
    HistoryOut,
    LoginInput,
    MessageInput,
    MessageOut,
    RecordedOut,
    RegisterInput,
    SessionOut,
)
from .trends import SYNTHETIC_ORIGIN, analyze_sleep
from .vitals import SYNTHETIC_VITALS, VITAL_SPECS, analyze_vital, synthetic_payload

ROOT = Path(__file__).resolve().parent.parent
# Front React compilado (npm run build en astra-health-front). Se sirve desde el mismo origen que la API.
FRONT_DIST = Path(os.environ.get("FRONT_DIST", ROOT.parent / "astra-health-front" / "dist"))
# Retencion: la sesion se conserva mientras haya acceso al menos una vez dentro de este plazo
# (SESSION_TTL_DAYS, 30 por defecto). Ya no depende de mantenerla activa cada 24 h.
TTL_DAYS = max(1, min(int(os.environ.get("SESSION_TTL_DAYS", "30")), 365))
TTL = TTL_DAYS * 24 * 60 * 60
PENDING_TTL = 120


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
        description="Solo datos ficticios. No diagnóstico, triage, ML, LLM ni voz. Persistencia SQLite local.",
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
            length = request.headers.get("content-length")
            if length and (not length.isdigit() or int(length) > 8192):
                response = error(413, "Cuerpo demasiado grande o tamaño inválido (máximo 8 KiB).")
            else:
                # Stream in bounded chunks, including requests without Content-Length.
                body = bytearray()
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > 8192:
                        break
                if len(body) > 8192:
                    response = error(413, "Cuerpo demasiado grande (máximo 8 KiB).")
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
                "Permissions-Policy": "microphone=(), camera=()",
            }
        )
        if request.url.path not in {"/docs", "/redoc"}:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' blob: data:; "
                "img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
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

    def user_payload(account):
        return {"id": account.id, "name": account.name, "email": account.email}

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

    @app.post("/api/v1/messages", response_model=MessageOut)
    def message(payload: MessageInput, auth: Auth):
        db, session = auth
        result = interpret(payload.text)
        session.pending = result["candidate"]
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
        entry = Entry(
            id=str(uuid4()),
            session_hash=session.token_hash,
            recorded_at=iso(clock()),
            measured_at=iso(measured),
            candidate=session.pending,
            origin=payload.origin,
            context=payload.context,
        )
        db.add(entry)
        session.pending_id, session.pending, session.pending_expires = None, None, None
        db.commit()
        return {
            "status": "recorded",
            "entry": serialize_entry(entry),
            "clinical_assessment": "not_performed",
            "message": "Registro confirmado en SQLite local. No determina normalidad ni descarta una urgencia.",
        }

    @app.delete("/api/v1/pending", status_code=204)
    def discard(auth: Auth):
        db, session = auth
        session.pending_id, session.pending, session.pending_expires = None, None, None
        db.commit()
        return Response(status_code=204)

    def entry_query(session):
        return select(Entry).where(entry_condition(session))

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
    def metric_analysis(
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
            return analyze_sleep(rows, now, days, tz_offset_minutes)
        if metric not in VITAL_SPECS:
            raise HTTPException(422, "Indicador de análisis desconocido.")
        return analyze_vital(rows, now, days, tz_offset_minutes, VITAL_SPECS[metric])

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
