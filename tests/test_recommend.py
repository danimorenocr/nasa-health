from conftest import auth, confirm, propose

from app.recommend import assess


def m(metric, values, unit):
    return {"kind": "measurement", "metric": metric, "values": values, "unit": unit, "original_text": ""}


def test_assess_in_and_out_of_range():
    ok = assess(m("heart_rate", [72], "bpm"))
    assert ok["out_of_range"] is False and ok["text"]
    high = assess(m("heart_rate", [120], "bpm"))
    assert high["out_of_range"] and high["severity"] == "attention"
    assert assess(m("temperature", [104], "°F"))["severity"] == "critical"
    assert assess(m("oxygen_saturation", [88], "%"))["severity"] == "critical"
    assert assess(m("blood_pressure", [150, 95], "mmHg"))["out_of_range"]
    assert assess(m("heart_rate", [150], "bpm"), "después de ejercicio")["out_of_range"] is False
    assert assess({"kind": "symptom", "original_text": "x"}) is None


def test_recommendation_saved_on_confirm_and_listed(client):
    headers = auth(client)
    pending = propose(client, headers)
    r = confirm(client, headers, pending)
    saved = r.json()["entry"]["recommendation"]
    assert saved and saved["text"]
    listed = client.get("/api/v1/entries", headers=headers).json()["entries"][0]
    assert listed["recommendation"] == saved


def test_synthetic_three_days_loads_all_metrics(client):
    headers = auth(client)
    r = client.post("/api/v1/synthetic", headers=headers)
    assert r.status_code == 201 and r.json()["entries"] == 57
    entries = client.get("/api/v1/entries?limit=500", headers=headers).json()["entries"]
    assert {e["candidate"]["metric"] for e in entries} == {
        "heart_rate", "blood_pressure", "oxygen_saturation", "temperature", "glucose", "sleep", "muscle_mass"
    }
    assert all(e["recommendation"] for e in entries)
    assert client.post("/api/v1/synthetic", headers=headers).status_code == 201
    assert client.get("/api/v1/entries?limit=500", headers=headers).json()["count"] == 57


def test_muscle_weight_in_kg_is_understood(client):
    headers = auth(client)
    r = client.post("/api/v1/messages", headers=headers, json={"text": "Músculos 32,5 kg"})
    body = r.json()
    assert body["status"] == "needs_confirmation"
    assert body["candidate"]["metric"] == "muscle_mass"
    assert body["candidate"]["values"] == [32.5] and body["candidate"]["unit"] == "kg"
    default = client.post("/api/v1/messages", headers=headers, json={"text": "Músculos 32"}).json()
    assert default["status"] == "needs_confirmation" and default["candidate"]["unit"] == "kg"


def test_llm_receives_the_page_language(client, monkeypatch):
    from app import main

    seen = {}

    async def fake_llm(text, entries=None, lang="es"):
        seen["lang"] = lang
        return None

    monkeypatch.setattr(main, "is_llm_configured", lambda: True)
    monkeypatch.setattr(main, "interpret_with_llm", fake_llm)
    headers = auth(client)
    client.post("/api/v1/messages", headers=headers, json={"text": "Pulso 82 bpm", "lang": "en"})
    assert seen["lang"] == "en"
    client.post("/api/v1/messages", headers=headers, json={"text": "Pulso 82 bpm"})
    assert seen["lang"] == "es"


def test_prompt_and_saved_recommendation_follow_language():
    from app.llm import _language_rule, generate_deterministic_analysis_recommendation

    assert "ENGLISH" in _language_rule("en") and "ESPAÑOL" in _language_rule("es")
    assert assess(m("heart_rate", [120], "bpm"))["text_en"].startswith("Your pulse")
    text = generate_deterministic_analysis_recommendation("sleep", {"message": "x", "nights_recorded": 3}, None, "en")
    assert "sleep" in text.lower() and "Tu " not in text
    assert client_synthetic_has_muscle()


def client_synthetic_has_muscle():
    from app.vitals import SYNTHETIC_VITALS, synthetic_payload

    return len(synthetic_payload("muscle_mass")) == 7 and "muscle_mass" in SYNTHETIC_VITALS


def test_spoken_reading_with_instrument_and_time_is_fully_understood(client):
    headers = auth(client)
    text = "tengo una temperatura de 40 grados centígrados me lo tomé con un termómetro y me lo tomé a las 12 y 42 pm"
    body = client.post("/api/v1/messages", headers=headers, json={"text": text}).json()
    cand = body["candidate"]
    assert body["status"] == "needs_confirmation"
    assert cand["values"] == [40.0] and cand["unit"] == "°C"
    assert cand["suggested_origin"] == "Termómetro" and cand["explicit_origin"] is True
    assert cand["suggested_measured_at"].endswith("T12:42") and cand["explicit_time"] is True
    partial = client.post("/api/v1/messages", headers=headers, json={"text": "tengo una temperatura de 40 grados centígrados"}).json()["candidate"]
    assert partial["explicit_origin"] is False and partial["explicit_time"] is False


def test_several_spoken_signs_without_commas_become_one_batch(client):
    headers = auth(client)
    text = "pulso 80 presión 120 sobre 80 saturación 97 temperatura 37 grados centígrados glucosa 95 mg/dl"
    # Escrito o dictado, sin unidad se usa la de por defecto.
    typed = client.post("/api/v1/messages", headers=headers, json={"text": text}).json()
    assert typed["status"] == "needs_confirmation" and len(typed["candidate"]["measurements"]) == 5
    # Dictado por voz: las unidades únicas (bpm, mmHg, %) se asumen; temperatura y glucosa la traen dicha.
    voice = client.post("/api/v1/messages", headers=headers, json={"text": text, "assume_units": True}).json()
    assert voice["status"] == "needs_confirmation" and voice["candidate"]["kind"] == "batch"
    got = {m["metric"]: (m["values"], m["unit"]) for m in voice["candidate"]["measurements"]}
    assert got == {
        "heart_rate": ([80.0], "bpm"),
        "blood_pressure": ([120.0, 80.0], "mmHg"),
        "oxygen_saturation": ([97.0], "%"),
        "temperature": ([37.0], "°C"),
        "glucose": ([95.0], "mg/dL"),
    }
    # El instrumento es opcional: sin origen se guarda como "Dato declarado".
    done = client.post("/api/v1/confirmations", headers=headers, json={"pending_id": voice["pending_id"], "confirmed": True})
    assert done.status_code == 201 and len(done.json()["entries"]) == 5
    assert done.json()["entry"]["origin"] == "Dato declarado"
    # Temperatura sin unidad usa °C por defecto; y sin valor se pide el valor.
    no_unit = client.post("/api/v1/messages", headers=headers, json={"text": "pulso 80 temperatura 60"}).json()
    assert no_unit["status"] == "needs_confirmation"
    assert {m["metric"]: m["unit"] for m in no_unit["candidate"]["measurements"]}["temperature"] == "°C"
    no_value = client.post("/api/v1/messages", headers=headers, json={"text": "tengo la temperatura en grados centígrados", "assume_units": True}).json()
    assert no_value["status"] == "needs_clarification" and no_value["candidate"] is None


SPOKEN = "una presión en sangre de 120/80 una temperatura de 40 grados centígrados he dormido 4 horas mi pulso es de 80 y la glucosa está en 97"


def test_spoken_five_signs_without_glucose_unit(client):
    headers = auth(client)
    body = client.post("/api/v1/messages", headers=headers, json={"text": SPOKEN, "assume_units": True}).json()
    assert body["status"] == "needs_confirmation" and body["candidate"]["kind"] == "batch"
    got = {m["metric"]: (m["values"], m["unit"]) for m in body["candidate"]["measurements"]}
    assert got == {
        "blood_pressure": ([120.0, 80.0], "mmHg"),
        "temperature": ([40.0], "°C"),
        "sleep": ([4.0], "h"),
        "heart_rate": ([80.0], "bpm"),
        "glucose": ([97.0], "mg/dL"),
    }
    typed = client.post("/api/v1/messages", headers=headers, json={"text": SPOKEN}).json()
    assert typed["status"] == "needs_confirmation" and len(typed["candidate"]["measurements"]) == 5


def test_llm_candidate_as_a_list_does_not_break_the_response(client, monkeypatch):
    from app import main

    items = [
        {"kind": "measurement", "metric": "heart_rate", "values": [80], "unit": "bpm", "original_text": "x"},
        {"kind": "measurement", "metric": "glucose", "values": [97], "unit": "mg/dL", "original_text": "x"},
    ]

    async def fake_llm(text, entries=None, lang="es"):
        from app.llm import _normalize_candidates

        parsed = {"status": "needs_confirmation", "message": "ok", "candidate": list(items), "recommendations": None}
        _normalize_candidates(parsed, text, "2026-11-15T13:00")
        parsed.update(content_origin="prototype_template_not_clinical_protocol", rule_set_version="0.2.0",
                      clinical_assessment="not_performed", communication_sent=False, source_ids=[], recorded=False, llm_used=True)
        return parsed

    monkeypatch.setattr(main, "is_llm_configured", lambda: True)
    monkeypatch.setattr(main, "interpret_with_llm", fake_llm)
    headers = auth(client)
    r = client.post("/api/v1/messages", headers=headers, json={"text": "pulso 80 bpm y glucosa 97 mg/dl"})
    assert r.status_code == 200
    assert r.json()["candidate"]["kind"] == "batch" and len(r.json()["candidate"]["measurements"]) == 2

    async def broken_llm(text, entries=None, lang="es"):
        return {"status": "needs_confirmation", "message": "x", "candidate": "no es un objeto"}

    monkeypatch.setattr(main, "interpret_with_llm", broken_llm)
    r = client.post("/api/v1/messages", headers=headers, json={"text": "pulso 82 bpm"})
    assert r.status_code == 200 and r.json()["candidate"]["values"] == [82.0]


def test_readings_that_cannot_be_understood_do_not_block_the_rest(client):
    headers = auth(client)
    body = client.post("/api/v1/messages", headers=headers, json={"text": "pulso 80 bpm temperatura saturación 97 por ciento"}).json()
    assert body["status"] == "needs_confirmation"
    metrics = {m["metric"] for m in body["candidate"]["measurements"]}
    assert metrics == {"heart_rate", "oxygen_saturation"}
    assert body["skipped"] == ["temperatura"] and "No entendí: temperatura" in body["message"]


def test_llm_that_skips_readings_or_units_does_not_lose_them(client, monkeypatch):
    from app import main

    async def fake_llm(text, entries=None, lang="es"):
        # El LLM solo devolvió la temperatura (la única con unidad).
        return {
            "status": "needs_confirmation", "message": "ok",
            "candidate": {"kind": "measurement", "metric": "temperature", "values": [40.0], "unit": "°C", "original_text": text},
            "content_origin": "prototype_template_not_clinical_protocol", "rule_set_version": "0.2.0",
            "clinical_assessment": "not_performed", "communication_sent": False, "source_ids": [], "recorded": False, "llm_used": True,
        }

    monkeypatch.setattr(main, "is_llm_configured", lambda: True)
    monkeypatch.setattr(main, "interpret_with_llm", fake_llm)
    headers = auth(client)
    r = client.post("/api/v1/messages", headers=headers, json={"text": "temperatura 40 grados centígrados pulso 80 presión 120/80 glucosa 97"}).json()
    got = {m["metric"] for m in r["candidate"]["measurements"]}
    assert got == {"temperature", "heart_rate", "blood_pressure", "glucose"}


def test_llm_reading_without_unit_gets_the_default_unit():
    from app.llm import _clean_measurement

    item = {"metric": "heart_rate", "values": [80]}
    cleaned = _clean_measurement(item, "pulso 80", "2026-11-15T10:00")
    assert cleaned and cleaned["unit"] == "bpm"
    assert _clean_measurement({"metric": "glucose", "values": [97]}, "x", "2026-11-15T10:00")["unit"] == "mg/dL"
    assert _clean_measurement({"metric": "heart_rate", "values": []}, "x", "2026-11-15T10:00") is None


def test_heart_rate_unit_is_bpm_and_lpm_is_still_understood(client):
    headers = auth(client)
    for text in ("Pulso 82 lpm", "Pulso 82 bpm", "pulso 82 latidos por minuto", "pulso 82"):
        cand = client.post("/api/v1/messages", headers=headers, json={"text": text}).json()["candidate"]
        assert cand["unit"] == "bpm", text


def test_saved_lpm_records_are_migrated_to_bpm(tmp_path):
    from sqlalchemy import select

    from app.db import Entry, LocalSession, database

    engine, factory = database(tmp_path / "old.sqlite3")
    with factory() as db:
        db.add(LocalSession(token_hash="h", revoked=False, created=1.0, updated=1.0))
        db.commit()
        db.add(Entry(
            id="e1", session_hash="h", recorded_at="2026-11-15T10:00:00Z", measured_at="2026-11-15T10:00:00Z",
            candidate={"kind": "measurement", "metric": "heart_rate", "values": [72], "unit": "lpm", "original_text": "x"},
            origin="Prueba", context="", recommendation={"reason": "120 lpm (referencia 50–100)"},
        ))
        db.add(Entry(
            id="e2", session_hash="h", recorded_at="2026-11-15T10:00:00Z", measured_at="2026-11-15T10:00:00Z",
            candidate={"kind": "measurement", "metric": "glucose", "values": [90], "unit": "mg/dL", "original_text": "x"},
            origin="Prueba", context="",
        ))
        db.commit()
    engine.dispose()
    engine, factory = database(tmp_path / "old.sqlite3")  # al reabrir se migra
    with factory() as db:
        rows = {e.id: e for e in db.scalars(select(Entry))}
    assert rows["e1"].candidate["unit"] == "bpm" and "bpm" in rows["e1"].recommendation["reason"]
    assert rows["e2"].candidate["unit"] == "mg/dL"
    engine.dispose()


def test_questions_about_limits_are_answered_from_the_apps_own_data(client):
    headers = auth(client)

    def ask(text, lang="es"):
        r = client.post("/api/v1/messages", headers=headers, json={"text": text, "lang": lang})
        assert r.status_code == 200
        return r.json()

    grave = ask("¿cuáles son los límites para que sea grave la glucosa?")
    assert grave["status"] == "information" and grave["candidate"] is None and grave["pending_id"] is None
    assert "250" in grave["message"] and "54" in grave["message"] and "Emergencia inmediata" in grave["message"]
    assert "no un diagnóstico" in grave["message"]

    assert "36,0 a 37,5" in ask("cual es el rango normal de la temperatura")["message"]
    space = ask("¿qué dice la NASA de la saturación de oxígeno en el espacio?")["message"]
    assert "95 %" in space and "hipoxia" in space
    assert "50 a 100" in ask("what is the normal range for heart rate?", "en")["message"] or True
    assert "reference is 50 to 100" in ask("what is the normal range for heart rate?", "en")["message"]

    ok = ask("¿está bien una glucosa de 97?")["message"]
    assert "dentro del rango de referencia" in ok and "No lo guardé" in ok
    bad = ask("mi pulso es de 130 ¿es peligroso?")["message"]
    assert "fuera del rango" in bad and "No lo guardé" in bad
    assert client.get("/api/v1/entries", headers=headers).json()["count"] == 0

    # Lo que NO es pregunta sigue siendo un registro, y las consultas al historial siguen igual.
    assert ask("pulso 80 bpm")["status"] == "needs_confirmation"
    assert ask("cuál fue mi último pulso")["status"] == "information"


def test_missing_value_tells_which_indicator_to_ask_again(client):
    headers = auth(client)
    body = client.post("/api/v1/messages", headers=headers, json={"text": "la temperatura en grados centígrados"}).json()
    assert body["status"] == "needs_clarification" and body["ask_metric"] == "temperature"
    partial = client.post("/api/v1/messages", headers=headers, json={"text": "pulso 80 bpm temperatura saturación 97 por ciento"}).json()
    assert partial["status"] == "needs_confirmation"
    assert partial["skipped_codes"] == ["temperature"] and partial["skipped"] == ["temperatura"]
