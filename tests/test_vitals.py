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


def test_context_negation_or_ambiguity_never_lands_in_a_named_group(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        log(c, h, "Pulso 95 lpm", 3, context="No estaba en reposo")
        log(c, h, "Pulso 96 lpm", 2, context="En reposo después de ejercicio")
        log(c, h, "Pulso 70 lpm", 1, context="No hice ejercicio, en reposo")
        log(c, h, "Pulso 71 lpm", 0, context="En reposo")
        p = analysis(c, h, "heart_rate")["personal_calculation"]
        rest = next(s for s in p["series"] if s["context_group"] == "rest")
        other = next(s for s in p["series"] if s["context_group"] == "other")
        # Solo las dos lecturas claramente en reposo; la negada y la ambigua van aparte.
        assert rest["records"] == 2 and [pt["values"] for pt in rest["points"]] == [[70], [71]]
        assert other["records"] == 2
        assert "no describo un cambio" in rest["summary"]


def test_same_day_readings_are_normal_and_kept(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        log(c, h, "Pulso 72 lpm", 2, context="En reposo")
        log(c, h, "Pulso 75 lpm", 2, context="En reposo")  # mismo día, valor distinto: normal
        log(c, h, "Pulso 75 lpm", 2, context="En reposo")  # repetición idéntica: también se conserva
        log(c, h, "Pulso 78 lpm", 1, context="En reposo")
        p = analysis(c, h, "heart_rate")["personal_calculation"]
        rest = next(s for s in p["series"] if s["context_group"] == "rest")
        assert rest["records"] == 4 and rest["dates"] == 2
        assert "conflict" not in p and "duplicates_collapsed" not in p
        assert rest["stats"]["change_last_minus_first"] == [6.0]
        assert "4 registro(s) en 2 fecha(s)" in rest["summary"]


def test_blood_pressure_pairs_and_pair_kept_for_review(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, (s, d) in enumerate([(118, 76), (120, 78), (121, 79)]):
            log(c, h, f"Presión {s}/{d} mmHg", 4 - i * 2)
        log(c, h, "Presión 80/120 mmHg", 0)  # pareja no procesable: se conserva, requiere revisión
        a = analysis(c, h, "blood_pressure")
        p = a["personal_calculation"]
        s = p["series"][0]
        assert s["unit"] == "mmHg" and s["records"] == 3
        assert s["stats"]["mean"] == [119.67, 77.67]
        assert s["stats"]["change_last_minus_first"] == [3.0, 3.0]
        assert "121/79 mmHg" in s["summary"]
        assert len(p["not_processed"]) == 1
        kept = p["not_processed"][0]
        assert kept["values"] == [80.0, 120.0] and kept["reason"] == "pair_not_processed"
        assert "no un juicio médico" in p["message"] or "no un criterio médico" in kept["detail"]
        assert "requiere revisión" in kept["detail"]
        assert a["education"]["source_id"] == "nasa-orthostatic-intolerance"


def test_saturation_over_100_is_a_scale_limit_and_kept(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        for i, v in enumerate([98, 97, 96]):
            log(c, h, f"Saturación {v} %", 4 - i * 2)
        log(c, h, "Saturación 105 %", 0)  # supera la escala del porcentaje
        a = analysis(c, h, "oxygen_saturation")
        p = a["personal_calculation"]
        assert p["series"][0]["records"] == 3
        assert len(p["not_processed"]) == 1
        kept = p["not_processed"][0]
        assert kept["values"] == [105.0] and kept["reason"] == "scale"
        assert "escala del porcentaje" in kept["detail"]
        assert "se conservan" in p["message"] and "no un juicio médico" in p["message"]
        assert a["education"]["source_id"] == "nasa-hypoxia-risk"


def test_prototype_limits_are_not_called_impossible(tmp_path):
    with make(tmp_path) as c:
        h = auth(c)
        log(c, h, "Pulso 72 lpm", 2, context="En reposo")
        log(c, h, "Pulso 350 lpm", 1, context="En reposo")  # fuera del límite del prototipo
        log(c, h, "Temperatura 50 °C", 1)
        a = analysis(c, h, "heart_rate")
        kept = a["personal_calculation"]["not_processed"][0]
        assert kept["reason"] == "prototype_limit"
        assert "límite del prototipo" in kept["detail"] and "no un criterio médico" in kept["detail"]
        for forbidden in ("imposible", "inválida", "invalid"):
            assert forbidden not in kept["detail"].lower()
            assert forbidden not in a["personal_calculation"]["message"].lower()
        t = analysis(c, h, "temperature")["personal_calculation"]
        assert t["series"] == [] and len(t["not_processed"]) == 1


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
        log(c, h, "Glucosa 100 mg/dL", 1, context="No estaba en ayunas")  # negada: no es ayunas
        p = analysis(c, h, "glucose")["personal_calculation"]
        fasting = next(
            s for s in p["series"] if s["context_group"] == "fasting" and s["unit"] == "mg/dL"
        )
        post = next(s for s in p["series"] if s["context_group"] == "post_meal")
        mmol = next(s for s in p["series"] if s["unit"] == "mmol/L")
        other = next(s for s in p["series"] if s["context_group"] == "other")
        assert fasting["records"] == 3 and fasting["stats"]["change_last_minus_first"] == [5.0]
        assert post["records"] == 1 and mmol["records"] == 1 and other["records"] == 1
        assert analysis(c, h, "glucose")["education"]["source_id"] == "nasa-spaceflight-insulin-2002"


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
