from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import create_app

NOW = datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc).timestamp()
TODAY = "2026-11-16"


def register(client, name, email):
    response = client.post(
        "/api/v1/auth/register",
        json={"name": name, "email": email, "password": "clave-segura-26"},
    )
    assert response.status_code == 201
    return {"Authorization": "Bearer " + response.json()["token"]}


def test_check_in_upsert_and_private_journal(tmp_path):
    app = create_app(tmp_path / "mind.sqlite3", clock=lambda: NOW, enable_rate_limit=False)
    with TestClient(app) as client:
        owner = register(client, "Sofía", "sofi@example.com")
        other = register(client, "Alex", "alex@example.com")
        created = client.put(
            f"/api/v1/mind/check-ins/{TODAY}",
            headers=owner,
            json={"mood_score": 2, "mood_word": "Cansado", "stress": 4},
        )
        assert created.status_code == 200
        check_in_id = created.json()["check_in"]["id"]
        updated = client.put(
            f"/api/v1/mind/check-ins/{TODAY}",
            headers=owner,
            json={"mood_score": 3, "mood_word": "Tranquilo", "energy": 2},
        )
        assert updated.json()["status"] == "updated"
        assert updated.json()["check_in"]["id"] == check_in_id
        history = client.get("/api/v1/mind/check-ins?days=7", headers=owner).json()["check_ins"]
        assert len(history) == 1 and history[0]["mood_word"] == "Tranquilo"
        assert "stress" not in history[0] and history[0]["energy"] == 2

        journal = client.post(
            "/api/v1/mind/journal",
            headers=owner,
            json={"entry_date": TODAY, "text": "Contenido ficticio para la demo."},
        )
        assert journal.status_code == 201
        journal_id = journal.json()["id"]
        assert client.get("/api/v1/mind/journal", headers=other).json()["entries"] == []
        assert client.put(
            f"/api/v1/mind/journal/{journal_id}",
            headers=other,
            json={"entry_date": TODAY, "text": "No autorizado"},
        ).status_code == 404
        assert client.delete(f"/api/v1/mind/journal/{journal_id}", headers=other).status_code == 404
        assert client.get("/api/v1/export", headers=owner).json()["entries"] == []
        assert client.delete(f"/api/v1/mind/journal/{journal_id}", headers=owner).status_code == 204


def test_rewards_and_weekly_mission_are_idempotent(tmp_path):
    app = create_app(tmp_path / "rewards.sqlite3", clock=lambda: NOW, enable_rate_limit=False)
    with TestClient(app) as client:
        headers = register(client, "Sofía", "rewards@example.com")
        action = {"kind": "onboarding_completed", "action_date": TODAY}
        first = client.post("/api/v1/mind/actions", headers=headers, json=action)
        repeated = client.post("/api/v1/mind/actions", headers=headers, json=action)
        assert first.json()["status"] == "created"
        assert repeated.json()["status"] == "already_recorded"
        assert repeated.json()["rewards"]["xp"] == 50

        client.put(
            f"/api/v1/mind/check-ins/{TODAY}",
            headers=headers,
            json={"mood_score": 4, "mood_word": "Con energía"},
        )
        pause = {"kind": "pause_completed", "action_date": TODAY}
        completed = client.post("/api/v1/mind/actions", headers=headers, json=pause).json()["rewards"]
        assert completed["weekly_mission"]["complete"] is True
        assert completed["weekly_mission"]["xp_awarded"] is True
        assert completed["xp"] == 400  # contacto + check-in + misión + Fuerza gravitacional
        repeated_pause = client.post("/api/v1/mind/actions", headers=headers, json=pause).json()["rewards"]
        assert repeated_pause["xp"] == 400

        reminder = client.post(
            "/api/v1/mind/reminders",
            headers=headers,
            json={"kind": "contact", "title": "Escribir a casa", "remind_at": "2026-11-17T18:30:00Z"},
        )
        assert reminder.status_code == 201
        rewards = client.get("/api/v1/rewards", headers=headers).json()
        shield = next(item for item in rewards["badges"] if item["code"] == "protective_shield")
        assert shield["unlocked"] is True
        xp_after_shield = rewards["xp"]
        assert client.get("/api/v1/rewards", headers=headers).json()["xp"] == xp_after_shield


def test_synthetic_check_ins_fill_7_days_and_never_overwrite_real_ones(tmp_path):
    app = create_app(tmp_path / "synthetic.sqlite3", clock=lambda: NOW, enable_rate_limit=False)
    with TestClient(app) as client:
        owner = register(client, "Sofía", "sofi@example.com")
        real = client.put(
            f"/api/v1/mind/check-ins/{TODAY}", headers=owner,
            json={"mood_score": 5, "mood_word": "Tranquilo", "energy": 5},
        )
        assert real.status_code == 200
        loaded = client.post("/api/v1/mind/synthetic", headers=owner)
        assert loaded.status_code == 201 and loaded.json()["check_ins"] == 6
        rows = client.get("/api/v1/mind/check-ins?days=7", headers=owner).json()["check_ins"]
        assert len(rows) == 7
        today = next(r for r in rows if r["date"] == TODAY)
        assert today["mood_score"] == 5 and not today.get("synthetic")
        fake = [r for r in rows if r.get("synthetic")]
        assert len(fake) == 6 and all(
            all(r.get(k) for k in ("stress", "isolation", "concentration", "energy", "sleep_difficulty")) for r in fake
        )
        again = client.post("/api/v1/mind/synthetic", headers=owner)
        assert again.status_code == 201
        assert len(client.get("/api/v1/mind/check-ins?days=7", headers=owner).json()["check_ins"]) == 7
