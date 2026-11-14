from datetime import datetime, timedelta, timezone

from conftest import auth, confirm, propose
from fastapi.testclient import TestClient

from app.main import create_app
from app.trends import SYNTHETIC_ORIGIN

NOW = datetime(2026, 11, 14, 15, 0, tzinfo=timezone.utc).timestamp()
VITALS = ["heart_rate", "blood_pressure", "oxygen_saturation", "temperature", "glucose"]


def make(tmp_path):
    return TestClient(create_app(tmp_path / "h.sqlite3", clock=lambda: NOW, enable_rate_limit=False))


def log(client, h, text, day_offset, context=""):
    pid = propose(client, h, text)
    when = (datetime.fromtimestamp(NOW, timezone.utc) - timedelta(days=day_offset)).isoformat()
    r = confirm(client, h, pid, measured_at=when, context=context)
    assert r.status_code == 201, r.text


def analysis(client, h, metric, **q):
    r = client.get(f"/api/v1/analysis/{metric}", headers=h, params=q)
    assert r.status_code == 200, r.text
    return r.json()


def test_heart_rate_rest_vs_exercise_never_mixed(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, v in enumerate([72, 74, 71, 75, 73, 78, 80]):
            log(c, h, f"Pulso {v} lpm", 6 - i, context="En reposo")
        log(c, h, "Pulso 140 lpm", 2, context="Después de ejercicio")
        log(c, h, "Pulso 90 lpm", 1)  # sin contexto
        a = analysis(c, h, "heart_rate")
        p = a["personal_calculation"]
        rest = next(s for s in p["series"] if s["context_group"] == "rest")
        exercise = next(s for s in p["series"] if s["context_group"] == "exercise")
        other = next(s for s in p["series"] if s["context_group"] == "other")
        assert rest["records"] == 7 and rest["stats"]["mean"] == [74.71]
        assert rest["stats"]["change_last_minus_first"] == [8.0]
        assert "8 lpm más" in rest["summary"]
        assert exercise["records"] == 1 and exercise["stats"]["change_last_minus_first"] is None
        assert "no describo un cambio" in exercise["summary"]
        assert other["records"] == 1
        assert "reposo" in p["message"] and "ejercicio" in p["message"]
        assert a["education"]["source_id"] == "nasa-cv-risk"
        assert "NASA" not in rest["summary"]
        assert a["clinical_assessment"] == "not_performed"


def test_blood_pressure_pairs_and_invalid_order(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, (s, d) in enumerate([(118, 76), (120, 78), (121, 79)]):
            log(c, h, f"Presión {s}/{d} mmHg", 4 - i * 2)
        log(c, h, "Presión 80/120 mmHg", 0)  # sistólica <= diastólica: captura incoherente
        a = analysis(c, h, "blood_pressure")
        p = a["personal_calculation"]
        s = p["series"][0]
        assert s["unit"] == "mmHg" and s["records"] == 3
        assert s["stats"]["mean"] == [119.67, 77.67]
        assert s["stats"]["change_last_minus_first"] == [3.0, 3.0]
        assert "121/79 mmHg" in s["summary"]
        assert len(p["invalid_excluded"]) == 1
        assert a["education"]["source_id"] == "nasa-orthostatic-intolerance"


def test_oxygen_saturation_bounds(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, v in enumerate([98, 97, 96]):
            log(c, h, f"Saturación {v} %", 4 - i * 2)
        log(c, h, "Saturación 105 %", 0)  # imposible como porcentaje
        p = analysis(c, h, "oxygen_saturation")["personal_calculation"]
        assert p["series"][0]["records"] == 3 and len(p["invalid_excluded"]) == 1
        assert analysis(c, h, "oxygen_saturation")["education"]["source_id"] == "nasa-hypoxia-risk"


def test_temperature_units_stay_separate(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, v in enumerate([36.6, 36.8, 37.0]):
            log(c, h, f"Temperatura {str(v).replace('.', ',')} °C", 4 - i * 2)
        log(c, h, "Temperatura 98.6 °F", 1)
        p = analysis(c, h, "temperature")["personal_calculation"]
        units = {s["unit"]: s for s in p["series"]}
        assert set(units) == {"°C", "°F"}
        assert units["°C"]["records"] == 3 and units["°C"]["stats"]["mean"] == [36.8]
        assert units["°F"]["records"] == 1
        assert units["°C"]["stats"]["change_last_minus_first"] == [0.4]


def test_glucose_units_and_meal_context(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, v in enumerate([90, 92, 95]):
            log(c, h, f"Glucosa {v} mg/dL", 4 - i * 2, context="En ayunas")
        log(c, h, "Glucosa 140 mg/dL", 1, context="Después de comer")
        log(c, h, "Glucosa 5.2 mmol/L", 1, context="En ayunas")
        p = analysis(c, h, "glucose")["personal_calculation"]
        fasting = next(
            s for s in p["series"] if s["context_group"] == "fasting" and s["unit"] == "mg/dL"
        )
        post = next(s for s in p["series"] if s["context_group"] == "post_meal")
        mmol = next(s for s in p["series"] if s["unit"] == "mmol/L")
        assert fasting["records"] == 3 and fasting["stats"]["change_last_minus_first"] == [5.0]
        assert post["records"] == 1 and mmol["records"] == 1
        assert analysis(c, h, "glucose")["education"]["source_id"] == "nasa-spaceflight-insulin-2002"


def test_duplicates_conflicts_and_other_metrics(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        log(c, h, "Pulso 72 lpm", 3, context="En reposo")
        log(c, h, "Pulso 72 lpm", 3, context="En reposo")  # duplicado
        log(c, h, "Pulso 75 lpm", 2, context="En reposo")
        log(c, h, "Pulso 78 lpm", 2, context="En reposo")  # conflicto
        log(c, h, "Pulso 400 lpm", 1, context="En reposo")  # imposible
        log(c, h, "Dormí 7 horas", 1)  # otro indicador
        p = analysis(c, h, "heart_rate")["personal_calculation"]
        rest = next(s for s in p["series"] if s["context_group"] == "rest")
        assert p["duplicates_collapsed"] == 1
        assert [x["date"] for x in p["conflicting_dates"]] == ["2026-11-12"]
        assert len(p["invalid_excluded"]) == 1
        assert rest["records"] == 1 and "no describo un cambio" in rest["summary"]


def test_empty_window_and_unknown_metric(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        a = analysis(c, h, "heart_rate")
        assert "No hay registros" in a["personal_calculation"]["message"]
        assert a["personal_calculation"]["series"] == []
        r = c.get("/api/v1/analysis/peso", headers=h)
        assert r.status_code == 422


def test_synthetic_each_metric_marked_and_scoped(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for metric in VITALS:
            r = c.post(f"/api/v1/synthetic/{metric}", headers=h)
            assert r.status_code == 201 and r.json()["entries"] == 7
        a = analysis(c, h, "heart_rate")
        assert a["synthetic"] is True
        assert a["personal_calculation"]["message"].startswith("Datos sintéticos")
        rest = next(
            s for s in a["personal_calculation"]["series"] if s["context_group"] == "rest"
        )
        assert rest["records"] == 7
        # Recargar sintéticos de un indicador no borra los de otro ni los confirmados.
        log(c, h, "Pulso 81 lpm", 8, context="En reposo")  # fuera de la ventana de 7 días
        assert c.post("/api/v1/synthetic/heart_rate", headers=h).status_code == 201
        a = analysis(c, h, "heart_rate")
        rest = next(
            s for s in a["personal_calculation"]["series"] if s["context_group"] == "rest"
        )
        assert rest["records"] == 7  # la serie sintética queda intacta
        glucose = analysis(c, h, "glucose")["personal_calculation"]
        assert sum(s["records"] for s in glucose["series"]) == 7
        entries = c.get("/api/v1/entries", headers=h, params={"limit": 500}).json()
        assert entries["count"] == 7 * len(VITALS) + 1  # el registro confirmado sigue
        synthetic = [e for e in entries["entries"] if e["origin"] == SYNTHETIC_ORIGIN]
        assert len(synthetic) == 7 * len(VITALS)


def test_vitals_require_session(tmp_path):
    with make(tmp_path) as c:
        for metric in VITALS:
            assert c.get(f"/api/v1/analysis/{metric}").status_code == 401
            assert c.post(f"/api/v1/synthetic/{metric}").status_code == 401
        assert c.post("/api/v1/synthetic/peso", headers=auth(c)).status_code == 422
