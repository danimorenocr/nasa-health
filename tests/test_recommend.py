from conftest import auth, confirm, propose

from app.recommend import assess


def m(metric, values, unit):
    return {"kind": "measurement", "metric": metric, "values": values, "unit": unit, "original_text": ""}


def test_assess_in_and_out_of_range():
    ok = assess(m("heart_rate", [72], "lpm"))
    assert ok["out_of_range"] is False and ok["text"]
    high = assess(m("heart_rate", [120], "lpm"))
    assert high["out_of_range"] and high["severity"] == "attention"
    assert assess(m("temperature", [104], "°F"))["severity"] == "critical"
    assert assess(m("oxygen_saturation", [88], "%"))["severity"] == "critical"
    assert assess(m("blood_pressure", [150, 95], "mmHg"))["out_of_range"]
    assert assess(m("heart_rate", [150], "lpm"), "después de ejercicio")["out_of_range"] is False
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
    assert client.post("/api/v1/messages", headers=headers, json={"text": "Músculos 32"}).json()["status"] == "needs_clarification"


def test_llm_receives_the_page_language(client, monkeypatch):
    from app import main

    seen = {}

    async def fake_llm(text, entries=None, lang="es"):
        seen["lang"] = lang
        return None

    monkeypatch.setattr(main, "is_llm_configured", lambda: True)
    monkeypatch.setattr(main, "interpret_with_llm", fake_llm)
    headers = auth(client)
    client.post("/api/v1/messages", headers=headers, json={"text": "Pulso 82 lpm", "lang": "en"})
    assert seen["lang"] == "en"
    client.post("/api/v1/messages", headers=headers, json={"text": "Pulso 82 lpm"})
    assert seen["lang"] == "es"


def test_prompt_and_saved_recommendation_follow_language():
    from app.llm import _language_rule, generate_deterministic_analysis_recommendation

    assert "ENGLISH" in _language_rule("en") and "ESPAÑOL" in _language_rule("es")
    assert assess(m("heart_rate", [120], "lpm"))["text_en"].startswith("Your pulse")
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
    # Escrito a mano: sin unidad no se asume ninguna.
    typed = client.post("/api/v1/messages", headers=headers, json={"text": text}).json()
    assert typed["status"] == "needs_clarification"
    # Dictado por voz: las unidades únicas (lpm, mmHg, %) se asumen; temperatura y glucosa la traen dicha.
    voice = client.post("/api/v1/messages", headers=headers, json={"text": text, "assume_units": True}).json()
    assert voice["status"] == "needs_confirmation" and voice["candidate"]["kind"] == "batch"
    got = {m["metric"]: (m["values"], m["unit"]) for m in voice["candidate"]["measurements"]}
    assert got == {
        "heart_rate": ([80.0], "lpm"),
        "blood_pressure": ([120.0, 80.0], "mmHg"),
        "oxygen_saturation": ([97.0], "%"),
        "temperature": ([37.0], "°C"),
        "glucose": ([95.0], "mg/dL"),
    }
    # El instrumento es opcional: sin origen se guarda como "Dato declarado".
    done = client.post("/api/v1/confirmations", headers=headers, json={"pending_id": voice["pending_id"], "confirmed": True})
    assert done.status_code == 201 and len(done.json()["entries"]) == 5
    assert done.json()["entry"]["origin"] == "Dato declarado"
    # Temperatura sin unidad sigue pidiéndose aun por voz; y sin valor se pide el valor.
    no_unit = client.post("/api/v1/messages", headers=headers, json={"text": "pulso 80 temperatura 37", "assume_units": True}).json()
    assert no_unit["status"] == "needs_clarification"
    no_value = client.post("/api/v1/messages", headers=headers, json={"text": "tengo la temperatura en grados centígrados", "assume_units": True}).json()
    assert no_value["status"] == "needs_clarification" and no_value["candidate"] is None
