from datetime import datetime, timedelta, timezone

from conftest import auth, confirm, propose
from fastapi.testclient import TestClient

from app.main import create_app
from app.trends import SYNTHETIC_ORIGIN

NOW = datetime(2026, 11, 14, 15, 0, tzinfo=timezone.utc).timestamp()


def make(tmp_path, clock=lambda: NOW):
    return TestClient(create_app(tmp_path / "h.sqlite3", clock=lambda: clock(), enable_rate_limit=False))


def log(client, h, hours, day_offset, context="", text=None):
    pid = propose(client, h, text or f"Dormí {hours} horas")
    when = (datetime.fromtimestamp(NOW, timezone.utc) - timedelta(days=day_offset)).isoformat()
    r = confirm(client, h, pid, measured_at=when, context=context)
    assert r.status_code == 201, r.text


def analysis(client, h, **q):
    r = client.get("/api/v1/analysis/sleep", headers=h, params=q)
    assert r.status_code == 200
    return r.json()


def test_calculations_and_source_separation(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, v in enumerate([7.5, 7, 6.5, 6, 5.5, 5, 4.5]):
            log(c, h, v, 6 - i)
        a = analysis(c, h)
        p = a["personal_calculation"]
        assert p["nights_recorded"] == 7 and p["stats"]["mean_hours"] == 6.0
        assert p["stats"]["change_last_minus_first_hours"] == -3.0
        assert "3 h menos" in p["message"]
        assert "causa" not in p["message"] and "NASA" not in p["message"]
        assert a["education"]["source_id"] == "nasa-sleep-risk"
        assert a["clinical_assessment"] == "not_performed" and a["synthetic"] is False
        assert p["missing_dates"] == []


def test_missing_nights_not_invented(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        log(c, h, 7, 6)
        log(c, h, 6, 0)
        a = analysis(c, h)
        p = a["personal_calculation"]
        assert p["nights_recorded"] == 2 and len(p["missing_dates"]) == 5
        assert p["stats"]["change_last_minus_first_hours"] is None
        assert "no describo un cambio" in p["message"]


def test_duplicates_conflicts_naps_invalid(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        log(c, h, 7, 3)
        log(c, h, 7, 3)  # duplicado
        log(c, h, 6, 2)
        log(c, h, 8, 2)  # conflicto
        log(c, h, 1, 1, context="Siesta corta")
        log(c, h, 5, 1)
        log(c, h, 30, 0)  # imposible
        p = analysis(c, h)["personal_calculation"]
        assert p["duplicates_collapsed"] == 1
        assert [x["date"] for x in p["conflicting_dates"]] == ["2026-11-12"]
        assert len(p["naps_excluded"]) == 1 and len(p["invalid_excluded"]) == 1
        assert [n["hours"] for n in p["nights"]] == [7, 5]


def test_units_and_other_metrics_ignored(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        pid = propose(c, h, "Pulso 82 lpm")
        assert confirm(c, h, pid).status_code == 201
        assert analysis(c, h)["personal_calculation"]["nights_recorded"] == 0


def test_timezone_changes_assignment(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        pid = propose(c, h, "Dormí 6 horas")
        assert confirm(c, h, pid, measured_at="2026-11-14T02:00:00+00:00").status_code == 201
        utc = analysis(c, h)["personal_calculation"]["nights"]
        bog = analysis(c, h, tz_offset_minutes=-300)["personal_calculation"]["nights"]
        assert utc[0]["date"] == "2026-11-14" and bog[0]["date"] == "2026-11-13"


def test_synthetic_marked_and_idempotent(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        assert c.post("/api/v1/synthetic/sleep", headers=h).status_code == 201
        assert c.post("/api/v1/synthetic/sleep", headers=h).status_code == 201
        a = analysis(c, h)
        assert a["synthetic"] is True and a["personal_calculation"]["nights_recorded"] == 7
        assert a["personal_calculation"]["message"].startswith("Datos sintéticos")
        entries = c.get("/api/v1/entries", headers=h).json()
        assert entries["count"] == 7 and all(e["origin"] == SYNTHETIC_ORIGIN for e in entries["entries"])


def test_retention_survives_idle_beyond_24h_but_not_ttl(tmp_path):
    t = {"now": NOW}
    with make(tmp_path, clock=lambda: t["now"]) as c:
        h = auth(c)
        assert c.get("/api/v1/session", headers=h).status_code == 200
        t["now"] += 3 * 86400
        assert c.get("/api/v1/session", headers=h).status_code == 200
        t["now"] += 31 * 86400
        assert c.get("/api/v1/session", headers=h).status_code == 401


def test_requires_session(tmp_path):
    with make(tmp_path) as c:
        assert c.get("/api/v1/analysis/sleep").status_code == 401
        assert c.post("/api/v1/synthetic/sleep").status_code == 401
