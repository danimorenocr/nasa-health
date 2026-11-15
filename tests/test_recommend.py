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
