import pytest

from app.engine import interpret


@pytest.mark.parametrize(
    "text,metric,values,unit",
    [
        ("Pulso 82 lpm", "heart_rate", [82], "lpm"),
        ("Temperatura 37,2 °C", "temperature", [37.2], "°C"),
        ("Temperatura 98.6 °F", "temperature", [98.6], "°F"),
        ("Presión 120/80 mmHg", "blood_pressure", [120, 80], "mmHg"),
        ("Saturación 97 %", "oxygen_saturation", [97], "%"),
        ("SpO2 98 %", "oxygen_saturation", [98], "%"),
        ("Glucosa 90 mg/dL", "glucose", [90], "mg/dL"),
        ("Glucosa 5.2 mmol/L", "glucose", [5.2], "mmol/L"),
        ("Dormí 6 horas", "sleep", [6], "h"),
        ("Dormí 0 horas", "sleep", [0], "h"),
    ],
)
def test_parse(text, metric, values, unit):
    r = interpret(text)
    assert r["status"] == "needs_confirmation"
    assert r["candidate"]["metric"] == metric
    assert r["candidate"]["values"] == values
    assert r["candidate"]["unit"] == unit
    assert r["communication_sent"] is False
    assert r["clinical_assessment"] == "not_performed"


@pytest.mark.parametrize(
    "text",
    [
        "Pulso 82",
        "82 lpm",
        "Pulso 82 y temperatura 37 °C",
        "Presión 120 mmHg",
        "Pulso 82 y 95 lpm",
        "Temperatura 37 °C o °F",
        "Glucosa 5 mg/dL o mmol/L",
        "Pulso -5 lpm",
    ],
)
def test_clarify(text):
    r = interpret(text)
    assert r["status"] == "needs_clarification"
    assert r["candidate"] is None


@pytest.mark.parametrize(
    "text",
    [
        "Me duele el pecho y me falta el aire",
        "No puedo respirar",
        "Estoy pensando en suicidarme",
        "Tengo sangrado",
        "No tengo dolor de pecho",
    ],
)
def test_safety_not_validated(text):
    r = interpret(text)
    assert r["status"] == "safety_notice"
    assert r["candidate"] is None
    assert "no ha avisado a nadie" in r["message"]


def test_symptom_and_information():
    r = interpret("Me siento mareado")
    assert r["candidate"]["kind"] == "symptom"
    assert "No descarto una urgencia" in r["message"]
    for text in ["CO2 de cabina 4 mmHg", "Mídeme con cámara", "Dame una dosis de medicamento"]:
        assert interpret(text)["status"] == "information"
