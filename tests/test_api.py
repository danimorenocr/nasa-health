import hashlib
from concurrent.futures import ThreadPoolExecutor

from conftest import auth, confirm, propose
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Account, Entry, LocalSession
from app.main import create_app


def test_flow_and_isolation(client):
    a, b = auth(client), auth(client)
    pending = propose(client, a)
    assert client.get("/api/v1/entries", headers=a).json()["count"] == 0
    assert confirm(client, b, pending).status_code == 409
    assert confirm(client, a, pending, origin="").status_code == 422
    r = confirm(client, a, pending)
    assert r.status_code == 201
    assert r.json()["entry"]["candidate"]["values"] == [82]
    assert confirm(client, a, pending).status_code == 409
    assert client.get("/api/v1/entries", headers=b).json()["count"] == 0
    assert len(client.get("/api/v1/export", headers=a).json()["entries"]) == 1
    assert client.delete("/api/v1/session", headers=a).status_code == 204
    assert client.get("/api/v1/entries", headers=a).status_code == 401
    with client.app.state.factory() as db:
        assert db.scalar(select(func.count()).select_from(Entry)) == 0


def test_session_exposes_stable_creation_time(client):
    created = client.post("/api/v1/sessions").json()
    headers = {"Authorization": "Bearer " + created["token"]}
    resumed = client.get("/api/v1/session", headers=headers).json()
    assert created["created_at"] == resumed["created_at"]


def test_account_register_login_logout_and_persistent_entries(client):
    payload = {"name": "Sofía Rivera", "email": "SOFI@example.com", "password": "orbita-segura-26"}
    registered = client.post("/api/v1/auth/register", json=payload)
    assert registered.status_code == 201
    assert registered.json()["user"]["email"] == "sofi@example.com"
    assert registered.json()["user"]["profile_image_url"] is None
    first_headers = {"Authorization": "Bearer " + registered.json()["token"]}
    assert client.get("/api/v1/session", headers=first_headers).json()["user"]["name"] == "Sofía Rivera"

    image_url = "https://images.example.com/perfiles/sofi.jpg"
    assert client.patch(
        "/api/v1/profile", headers=first_headers, json={"profile_image_url": "http://insegura.example/foto.jpg"}
    ).status_code == 422
    updated = client.patch(
        "/api/v1/profile", headers=first_headers, json={"profile_image_url": image_url}
    )
    assert updated.status_code == 200
    assert updated.json()["profile_image_url"] == image_url

    pending = propose(client, first_headers)
    assert confirm(client, first_headers, pending).status_code == 201
    assert client.post("/api/v1/auth/logout", headers=first_headers).status_code == 204
    assert client.get("/api/v1/session", headers=first_headers).status_code == 401

    assert client.post(
        "/api/v1/auth/login", json={"email": payload["email"], "password": "incorrecta"}
    ).status_code == 401
    logged_in = client.post(
        "/api/v1/auth/login", json={"email": payload["email"], "password": payload["password"]}
    )
    assert logged_in.status_code == 200
    second_headers = {"Authorization": "Bearer " + logged_in.json()["token"]}
    assert client.get("/api/v1/session", headers=second_headers).json()["user"]["profile_image_url"] == image_url
    assert client.get("/api/v1/entries", headers=second_headers).json()["count"] == 1
    assert client.post("/api/v1/auth/register", json=payload).status_code == 409

    with client.app.state.factory() as db:
        account = db.scalars(select(Account)).one()
        assert account.password_hash != payload["password"]


def test_register_adopts_entries_from_anonymous_prototype_session(client):
    anonymous = auth(client)
    assert confirm(client, anonymous, propose(client, anonymous)).status_code == 201
    registered = client.post(
        "/api/v1/auth/register",
        headers=anonymous,
        json={"name": "Nueva tripulante", "email": "nueva@example.com", "password": "clave-segura-88"},
    )
    assert registered.status_code == 201
    account_headers = {"Authorization": "Bearer " + registered.json()["token"]}
    assert client.get("/api/v1/entries", headers=account_headers).json()["count"] == 1


def test_pending_invalidated_and_discarded(client):
    h = auth(client)
    p = propose(client, h)
    r = client.post("/api/v1/messages", headers=h, json={"text": "Me duele el pecho y me falta el aire"})
    assert r.json()["status"] == "safety_notice"
    assert r.json()["pending_id"] is None
    assert confirm(client, h, p).status_code == 409
    p = propose(client, h)
    assert client.delete("/api/v1/pending", headers=h).status_code == 204
    assert confirm(client, h, p).status_code == 409
    assert client.get("/api/v1/entries", headers=h).json()["count"] == 0


def test_validation(client):
    assert client.get("/api/v1/entries").status_code == 401
    h = auth(client)
    for data in [{"text": ""}, {"text": "x" * 2001}, {"text": "Pulso 82 lpm", "extra": True}]:
        assert client.post("/api/v1/messages", headers=h, json=data).status_code == 422


def test_bad_json_size_origin_and_headers(client):
    h = auth(client)
    assert (
        client.post(
            "/api/v1/messages", headers={**h, "content-type": "application/json"}, content="{"
        ).status_code
        == 422
    )
    assert client.post("/api/v1/messages", headers=h, content="x" * 9000).status_code == 413
    assert client.post("/api/v1/sessions", headers={"Origin": "https://other.example"}).status_code == 403
    r = client.get("/")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/api/v1/capabilities").json()["storage"] == "sqlite"


def test_dates_history_and_separate_units(client):
    h, other = auth(client), auth(client)
    p = propose(client, h, "Temperatura 37 °C")
    assert confirm(client, h, p, measured_at="2999-01-01T00:00:00Z").status_code == 422
    assert confirm(client, h, p, measured_at="2026-11-14T09:00:00").status_code == 422
    assert confirm(client, h, p, measured_at="2026-11-14T09:00:00-05:00").status_code == 201
    assert confirm(client, h, propose(client, h, "Temperatura 98 °F")).status_code == 201
    r = client.get("/api/v1/history?metric=temperature&days=3650", headers=h)
    assert r.status_code == 200
    assert r.json()["count"] == 2
    assert {x["unit"] for x in r.json()["series"]} == {"°C", "°F"}
    assert client.get("/api/v1/history?metric=temperature", headers=other).json()["count"] == 0
    assert client.get("/api/v1/history?metric=unknown", headers=h).status_code == 422
    assert client.get("/api/v1/entries?limit=501", headers=h).status_code == 422


def test_persistence_restart_and_no_raw_token(tmp_path):
    path = tmp_path / "persistent.db"
    first = create_app(path, enable_rate_limit=False)
    with TestClient(first) as c:
        h = auth(c)
        assert confirm(c, h, propose(c, h)).status_code == 201
        with first.state.factory() as db:
            row = db.scalars(select(LocalSession)).one()
            assert row.token_hash == hashlib.sha256(h["Authorization"][7:].encode()).hexdigest()
    with TestClient(create_app(path, enable_rate_limit=False)) as c:
        assert c.get("/api/v1/session", headers=h).status_code == 200
        assert c.get("/api/v1/entries", headers=h).json()["count"] == 1


def test_pending_and_session_expiry(tmp_path):
    now = [1_800_000_000.0]
    with TestClient(create_app(tmp_path / "expiry.db", clock=lambda: now[0], enable_rate_limit=False)) as c:
        h = auth(c)
        p = propose(c, h)
        now[0] += 120
        assert confirm(c, h, p).status_code == 409
        p = propose(c, h)
        assert confirm(c, h, p).status_code == 201
        now[0] += 86400
        assert c.get("/api/v1/entries", headers=h).status_code == 200  # ya no caduca a las 24 h
        now[0] += 31 * 86400
        assert c.get("/api/v1/entries", headers=h).status_code == 401
        with c.app.state.factory() as db:
            assert db.scalar(select(func.count()).select_from(Entry)) == 0


def test_concurrent_confirmation_consumed_once(client):
    h = auth(client)
    p = propose(client, h)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: confirm(client, h, p), range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert client.get("/api/v1/entries", headers=h).json()["count"] == 1


def test_rate_limit(tmp_path):
    with TestClient(create_app(tmp_path / "rate.db")) as c:
        codes = [c.get("/health").status_code for _ in range(121)]
        assert codes[-1] == 429


def test_api_memory_flow(client):
    h = auth(client)
    # 1. Antes de registrar, consultar memoria
    r_empty = client.post("/api/v1/messages", headers=h, json={"text": "¿Cuál fue mi último pulso?"})
    assert r_empty.status_code == 200
    assert r_empty.json()["status"] == "information"
    assert r_empty.json()["pending_id"] is None
    assert "No tienes registros de pulso" in r_empty.json()["message"]

    # 2. Registrar un pulso
    p = propose(client, h, "Pulso 82 lpm")
    r_conf = confirm(client, h, p, origin="Pulsómetro de prueba", context="en reposo")
    assert r_conf.status_code == 201

    # 3. Consultar pulso en memoria
    r_pulse = client.post("/api/v1/messages", headers=h, json={"text": "¿Cuál fue mi último pulso?"})
    assert r_pulse.status_code == 200
    assert r_pulse.json()["status"] == "information"
    assert r_pulse.json()["pending_id"] is None
    assert "82 lpm" in r_pulse.json()["message"]
    assert "Pulsómetro de prueba" in r_pulse.json()["message"]

    # 4. Consultar resumen de registros en memoria
    r_sum = client.post("/api/v1/messages", headers=h, json={"text": "¿Qué registros tengo?"})
    assert r_sum.status_code == 200
    assert "1 registro(s) confirmado(s)" in r_sum.json()["message"]
    assert "pulso" in r_sum.json()["message"]


def test_api_batch_confirmation_flow(client):
    h = auth(client)
    # Proponer múltiples mediciones
    r_msg = client.post(
        "/api/v1/messages",
        headers=h,
        json={"text": "Pulso 80 pulsaiones por minuto y temperatura 36.6 °C"},
    )
    assert r_msg.status_code == 200
    data = r_msg.json()
    assert data["status"] == "needs_confirmation"
    assert data["candidate"]["kind"] == "batch"
    assert len(data["candidate"]["measurements"]) == 2
    pending_id = data["pending_id"]

    # Confirmar el lote
    r_conf = client.post(
        "/api/v1/confirmations",
        headers=h,
        json={"pending_id": pending_id, "confirmed": True, "origin": "Pulsómetro y termómetro", "context": "reposo"},
    )
    assert r_conf.status_code == 201
    conf_data = r_conf.json()
    assert conf_data["status"] == "recorded"
    assert "2 registros confirmados" in conf_data["message"]
    assert len(conf_data["entries"]) == 2

    # Verificar que ambas quedaron en SQLite
    r_entries = client.get("/api/v1/entries", headers=h)
    assert r_entries.status_code == 200
    assert r_entries.json()["count"] == 2


def test_transcribe_endpoint(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    h = auth(client)
    # Audio vacío
    r_empty = client.post("/api/v1/transcribe", headers=h, content=b"")
    assert r_empty.status_code == 400
    assert "vacío" in r_empty.json()["message"]

    # Audio real sin credenciales configuradas en el entorno
    fake_audio = b"RIFF" + b"\x00" * 200
    r_no_cred = client.post(
        "/api/v1/transcribe",
        headers={**h, "Content-Type": "audio/wav"},
        content=fake_audio,
    )
    assert r_no_cred.status_code == 200
    res_json = r_no_cred.json()
    assert res_json["status"] == "no_credentials"
    assert res_json["configured"] is False
    assert "OPENAI_API_KEY o GROQ_API_KEY" in res_json["message"]


