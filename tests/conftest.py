import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "health.sqlite3", enable_rate_limit=False)
    with TestClient(app) as c:
        yield c


def auth(client):
    return {"Authorization": "Bearer " + client.post("/api/v1/sessions").json()["token"]}


def propose(client, headers, text="Pulso 82 lpm"):
    r = client.post("/api/v1/messages", headers=headers, json={"text": text})
    assert r.status_code == 200
    return r.json()["pending_id"]


def confirm(client, headers, pending_id, **extra):
    return client.post(
        "/api/v1/confirmations",
        headers=headers,
        json={"pending_id": pending_id, "confirmed": True, "origin": "Instrumento ficticio", **extra},
    )
