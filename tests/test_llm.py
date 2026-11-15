import pytest

from app.llm import interpret_with_llm
from app.schemas import MessageOut


@pytest.mark.anyio
async def test_interpret_with_llm_mock(monkeypatch):
    monkeypatch.setenv("TEST_WITH_LIVE_LLM", "1")
    monkeypatch.setenv("GROQ_API_KEY", "dummy-groq-key")

    fake_response_content = (
        '{"status": "needs_confirmation", '
        '"message": "🛰️ ¡Telemetría recibida!", '
        '"candidate": {'
        '  "kind": "measurement", '
        '  "metric": "heart_rate", '
        '  "values": [115], '
        '  "unit": "bpm", '
        '  "suggested_origin": "Oxímetro", '
        '  "suggested_measured_at": "2026-11-13T11:00"'
        '}, '
        '"recommendations": ["Hidratarse adecuadamente", "Reposo relativo"]}'
    )

    class DummyResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": fake_response_content
                        }
                    }
                ]
            }

    class DummyAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        async def post(self, url, headers=None, json=None):
            return DummyResponse()

    monkeypatch.setattr("httpx.AsyncClient", lambda **kwargs: DummyAsyncClient())

    result = await interpret_with_llm("Me medí el pulso y tengo 115 latidos por minuto con oximetro")
    assert result is not None
    assert result["status"] == "needs_confirmation"
    assert result["candidate"]["metric"] == "heart_rate"
    assert result["candidate"]["values"] == [115.0]
    assert result["candidate"]["suggested_origin"] == "Oxímetro"
    assert result["candidate"]["suggested_measured_at"] == "2026-11-13T11:00"
    assert isinstance(result["recommendations"], list)
    assert len(result["recommendations"]) == 2
    assert result["llm_used"] is True

    # Validate against MessageOut schema
    validated = MessageOut(**result, pending_id="test-id", pending_expires_at="2026-11-14T20:00:00Z")
    assert validated.recommendations == ["Hidratarse adecuadamente", "Reposo relativo"]


def test_deterministic_analysis_recommendations():
    from app.llm import generate_deterministic_analysis_recommendation

    # 1. Temperatura con pico febril
    personal_fever = {"message": "Promedio 37.9 °C (mínimo 37.0 °C, máximo 38.7 °C)."}
    edu = {"text": "NASA investiga temperatura en microgravedad."}
    rec_fever = generate_deterministic_analysis_recommendation("temperature", personal_fever, edu)
    assert "febril" in rec_fever.lower() or "38.7" in rec_fever
    assert "microgravedad" in rec_fever
    assert "convección" in rec_fever or "ventilación" in rec_fever

    # 2. Pulso elevado
    personal_hr = {"message": "Promedio 98 bpm (máximo 115 bpm)."}
    rec_hr = generate_deterministic_analysis_recommendation("heart_rate", personal_hr, edu)
    assert "pulsaciones elevadas" in rec_hr or "taquicardia" in rec_hr
    assert "volemia" in rec_hr or "líquidos" in rec_hr


    # 3. Sin registros
    rec_empty = generate_deterministic_analysis_recommendation("temperature", {"message": "No hay registros de temperatura procesables en los últimos 7 días."}, edu)
    assert "Todavía no se puede analizar" in rec_empty
    assert "temperatura corporal" in rec_empty


@pytest.mark.anyio
async def test_generate_analysis_recommendation_mock(monkeypatch):
    monkeypatch.setenv("TEST_WITH_LIVE_LLM", "1")
    monkeypatch.setenv("GROQ_API_KEY", "dummy-groq-key")

    from app.llm import generate_analysis_recommendation

    class DummyResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Astronauta, debido al riesgo de sobrecalentamiento en microgravedad con 38.7 °C, aumenta la ventilación de tu módulo y descansa."
                        }
                    }
                ]
            }

    class DummyAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        async def post(self, url, headers=None, json=None):
            return DummyResponse()

    monkeypatch.setattr("httpx.AsyncClient", lambda **kwargs: DummyAsyncClient())

    # Con registros
    rec = await generate_analysis_recommendation(
        "temperature",
        {"message": "Promedio 37.9 °C, máximo 38.7 °C."},
        {"text": "Investigación NASA sobre temperatura corporal."},
    )
    assert "sobrecalentamiento" in rec
    assert "ventilación" in rec

    # Sin registros
    rec_empty = await generate_analysis_recommendation(
        "glucose",
        {"message": "No hay registros de glucosa procesables en los últimos 7 días."},
        {"text": "Investigación NASA sobre metabolismo."},
    )
    assert "Todavía no se puede analizar" in rec_empty
    assert "glucosa" in rec_empty



MULTI_LLM_RESULT = {
    "status": "needs_confirmation",
    "message": "Lecturas identificadas.",
    "candidates": [
        {"kind": "measurement", "metric": "heart_rate", "values": [32.0], "unit": "bpm",
         "original_text": "32 BPM", "suggested_origin": "Monitor", "suggested_measured_at": "2026-11-14T21:36"},
        {"kind": "measurement", "metric": "temperature", "values": [37.2], "unit": "°C",
         "original_text": "37.2 grados", "suggested_origin": "Termómetro", "suggested_measured_at": "2026-11-14T21:36"},
    ],
    "recommendations": "texto",
    "content_origin": "prototype_template_not_clinical_protocol",
    "rule_set_version": "0.2.0",
    "clinical_assessment": "not_performed",
    "communication_sent": False,
    "source_ids": [],
    "recorded": False,
    "llm_used": True,
}


def test_multi_candidates_become_batch_and_validate():
    from copy import deepcopy

    from app.llm import _normalize_candidates

    parsed = deepcopy(MULTI_LLM_RESULT)
    _normalize_candidates(parsed, "pulso 32 y temperatura 37.2", "2026-11-14T21:36")
    assert "candidates" not in parsed
    assert parsed["candidate"]["kind"] == "batch"
    assert [m["metric"] for m in parsed["candidate"]["measurements"]] == ["heart_rate", "temperature"]
    MessageOut(**parsed, pending_id="x", pending_expires_at="2026-11-14T22:00:00Z")


def test_messages_endpoint_accepts_llm_multi_candidates(client, monkeypatch):
    from copy import deepcopy

    from app import main
    from tests.conftest import auth

    async def fake_llm(text, entries=None, lang="es"):
        from app.llm import _normalize_candidates

        parsed = deepcopy(MULTI_LLM_RESULT)
        _normalize_candidates(parsed, text, "2026-11-14T21:36")
        return parsed

    monkeypatch.setattr(main, "is_llm_configured", lambda: True)
    monkeypatch.setattr(main, "interpret_with_llm", fake_llm)
    headers = auth(client)
    r = client.post("/api/v1/messages", headers=headers, json={"text": "pulso 32 y temperatura 37.2"})
    assert r.status_code == 200
    body = r.json()
    assert body["candidate"]["kind"] == "batch" and body["pending_id"]
    done = client.post(
        "/api/v1/confirmations", headers=headers,
        json={"pending_id": body["pending_id"], "confirmed": True, "origin": "Prueba"},
    )
    assert done.status_code == 201 and len(done.json()["entries"]) == 2
