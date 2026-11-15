import pytest

from app.engine import interpret


@pytest.mark.parametrize(
    "text,metric,values,unit",
    [
        ("Pulso 82 bpm", "heart_rate", [82], "bpm"),
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
        "82 bpm",
        "Presión 120 mmHg",
        "Pulso 82 y 95 bpm",
        "Temperatura 37 °C o °F",
        "Glucosa 5 mg/dL o mmol/L",
        "Pulso -5 bpm",
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


def test_memory_queries_empty():
    assert "memoria local en SQLite" in interpret("¿Tienes memoria?")["message"]
    assert "memoria local en SQLite" in interpret("memoria")["message"]

    r_pulse = interpret("¿Cuál fue mi último pulso?")
    assert r_pulse["status"] == "information"
    assert r_pulse["candidate"] is None
    assert "No tienes registros de pulso" in r_pulse["message"]

    r_latest = interpret("¿Cuál fue mi último registro?")
    assert r_latest["status"] == "information"
    assert "Aún no tienes registros confirmados" in r_latest["message"]

    r_summary = interpret("¿Qué registros tengo?")
    assert r_summary["status"] == "information"
    assert "Aún no tienes registros confirmados" in r_summary["message"]

    r_symptom = interpret("¿Qué síntomas he registrado?")
    assert r_symptom["status"] == "information"
    assert "No tienes síntomas registrados" in r_symptom["message"]


def test_memory_queries_with_entries():
    sample_entries = [
        {
            "id": "entry-1",
            "measured_at": "2026-11-14T14:20:00Z",
            "recorded_at": "2026-11-14T14:20:05Z",
            "candidate": {
                "kind": "measurement",
                "metric": "heart_rate",
                "values": [82.0],
                "unit": "bpm",
                "original_text": "Pulso 82 bpm",
            },
            "origin": "Pulsómetro de prueba",
            "context": "en reposo",
        },
        {
            "id": "entry-2",
            "measured_at": "2026-11-14T10:15:00Z",
            "recorded_at": "2026-11-14T10:15:02Z",
            "candidate": {
                "kind": "measurement",
                "metric": "temperature",
                "values": [37.2],
                "unit": "°C",
                "original_text": "Temperatura 37,2 °C",
            },
            "origin": "Termómetro digital",
            "context": "",
        },
        {
            "id": "entry-3",
            "measured_at": "2026-11-13T22:00:00Z",
            "recorded_at": "2026-11-13T22:00:01Z",
            "candidate": {
                "kind": "symptom",
                "original_text": "Me siento cansado después del turno",
            },
            "origin": "Reporte voluntario",
            "context": "",
        },
    ]

    # Consulta de pulso
    r_pulse = interpret("¿Cuál fue mi último pulso?", entries=sample_entries)
    assert r_pulse["status"] == "information"
    assert "82 bpm" in r_pulse["message"]
    assert "Pulsómetro de prueba" in r_pulse["message"]
    assert "en reposo" in r_pulse["message"]

    # Consulta de temperatura
    r_temp = interpret("¿Cómo estuvo mi temperatura?", entries=sample_entries)
    assert r_temp["status"] == "information"
    assert "37,2 °C" in r_temp["message"]

    # Consulta del registro más reciente
    r_latest = interpret("¿Qué fue lo último que registré?", entries=sample_entries)
    assert r_latest["status"] == "information"
    assert "pulso: 82 bpm" in r_latest["message"]

    # Resumen de registros
    r_summary = interpret("¿Qué registros tengo?", entries=sample_entries)
    assert r_summary["status"] == "information"
    assert "3 registro(s) confirmado(s)" in r_summary["message"]
    assert "pulso" in r_summary["message"]
    assert "temperatura" in r_summary["message"]

    # Síntomas
    r_symptom = interpret("Último síntoma registrado", entries=sample_entries)
    assert r_symptom["status"] == "information"
    assert "Me siento cansado" in r_symptom["message"]

    # Multi-indicador
    r_multi = interpret("¿Cuál fue mi último pulso y temperatura?", entries=sample_entries)
    assert r_multi["status"] == "information"
    assert "pulso: 82 bpm" in r_multi["message"]
    assert "temperatura: 37,2 °C" in r_multi["message"]

    # Si hay urgencia, la seguridad prima sobre la consulta
    r_urgent = interpret("Me duele el pecho, ¿cuál fue mi último pulso?", entries=sample_entries)
    assert r_urgent["status"] == "safety_notice"


def test_spoken_numbers_and_units():
    # Spoken numbers in Spanish
    r_pulse = interpret("Pulso ochenta y dos bpm")
    assert r_pulse["status"] == "needs_confirmation"
    assert r_pulse["candidate"]["metric"] == "heart_rate"
    assert r_pulse["candidate"]["values"] == [82]
    assert r_pulse["candidate"]["unit"] == "bpm"

    # Spoken units: pulsaiones por minuto, pulsaciones por minuto, latidos por minuto
    r_pulsaiones = interpret("Pulso ochenta y dos pulsaiones por minuto")
    assert r_pulsaiones["status"] == "needs_confirmation"
    assert r_pulsaiones["candidate"]["metric"] == "heart_rate"
    assert r_pulsaiones["candidate"]["values"] == [82]
    assert r_pulsaiones["candidate"]["unit"] == "bpm"

    r_pulsaciones = interpret("Pulso 75 pulsaciones por minuto")
    assert r_pulsaciones["status"] == "needs_confirmation"
    assert r_pulsaciones["candidate"]["values"] == [75]
    assert r_pulsaciones["candidate"]["unit"] == "bpm"

    # Spoken decimals
    r_temp = interpret("Temperatura treinta y siete coma dos grados centígrados")
    assert r_temp["status"] == "needs_confirmation"
    assert r_temp["candidate"]["metric"] == "temperature"
    assert r_temp["candidate"]["values"] == [37.2]
    assert r_temp["candidate"]["unit"] == "°C"

    # Spoken blood pressure with sobre and milímetros de mercurio
    r_bp = interpret("Presión ciento veinte sobre ochenta milímetros de mercurio")
    assert r_bp["status"] == "needs_confirmation"
    assert r_bp["candidate"]["metric"] == "blood_pressure"
    assert r_bp["candidate"]["values"] == [120, 80]
    assert r_bp["candidate"]["unit"] == "mmHg"

    # Spoken saturation
    r_sat = interpret("Saturación noventa y siete por ciento")
    assert r_sat["status"] == "needs_confirmation"
    assert r_sat["candidate"]["metric"] == "oxygen_saturation"
    assert r_sat["candidate"]["values"] == [97]
    assert r_sat["candidate"]["unit"] == "%"

    # Spoken sleep
    r_sleep = interpret("Dormí ocho horas")
    assert r_sleep["status"] == "needs_confirmation"
    assert r_sleep["candidate"]["metric"] == "sleep"
    assert r_sleep["candidate"]["values"] == [8]
    assert r_sleep["candidate"]["unit"] == "h"


def test_batch_voice_measurements():
    # Multi-measurement batch in a single voice note
    text = "Pulso 80 pulsaiones por minuto y temperatura 36.6 °C"
    r = interpret(text)
    assert r["status"] == "needs_confirmation"
    assert r["candidate"]["kind"] == "batch"
    measurements = r["candidate"]["measurements"]
    assert len(measurements) == 2
    assert measurements[0]["metric"] == "heart_rate"
    assert measurements[0]["values"] == [80]
    assert measurements[0]["unit"] == "bpm"
    assert measurements[1]["metric"] == "temperature"
    assert measurements[1]["values"] == [36.6]
    assert measurements[1]["unit"] == "°C"


def test_temperature_spoken_units():
    # "grados" maps to Celsius by default unless fahrenheit is specified
    r_celsius = interpret("temperatura 37 grados")
    assert r_celsius["status"] == "needs_confirmation"
    assert r_celsius["candidate"]["metric"] == "temperature"
    assert r_celsius["candidate"]["values"] == [37.0]
    assert r_celsius["candidate"]["unit"] == "°C"

    r_centigrados = interpret("temperatura 37 centígrados")
    assert r_centigrados["status"] == "needs_confirmation"
    assert r_centigrados["candidate"]["metric"] == "temperature"
    assert r_centigrados["candidate"]["values"] == [37.0]
    assert r_centigrados["candidate"]["unit"] == "°C"

    r_fahr = interpret("temperatura 98.6 grados fahrenheit")
    assert r_fahr["status"] == "needs_confirmation"
    assert r_fahr["candidate"]["metric"] == "temperature"
    assert r_fahr["candidate"]["values"] == [98.6]
    assert r_fahr["candidate"]["unit"] == "°F"

    # Multi-measurement batch with spoken units
    r_batch = interpret("Pulso 80 pulsaiones por minuto y temperatura 37 grados")
    assert r_batch["status"] == "needs_confirmation"
    assert r_batch["candidate"]["kind"] == "batch"
    assert len(r_batch["candidate"]["measurements"]) == 2
    assert r_batch["candidate"]["measurements"][0]["metric"] == "heart_rate"
    assert r_batch["candidate"]["measurements"][0]["values"] == [80]
    assert r_batch["candidate"]["measurements"][0]["unit"] == "bpm"
    assert r_batch["candidate"]["measurements"][1]["metric"] == "temperature"
    assert r_batch["candidate"]["measurements"][1]["values"] == [37.0]
    assert r_batch["candidate"]["measurements"][1]["unit"] == "°C"

    # Conflicting units still clarify
    r_conflict = interpret("temperatura 37 °C o °F")
    assert r_conflict["status"] == "needs_clarification"

    # Sin unidad se usa la de por defecto (°C), pero el valor sigue siendo obligatorio.
    r_nounit = interpret("temperatura 37")
    assert r_nounit["status"] == "needs_confirmation"
    assert r_nounit["candidate"]["unit"] == "°C"
    assert interpret("temperatura")["status"] == "needs_clarification"


def test_natural_phrasing_latidos():
    r = interpret("tengo 100 latidos por minuto")
    assert r["status"] == "needs_confirmation"
    assert r["candidate"]["metric"] == "heart_rate"
    assert r["candidate"]["values"] == [100.0]
    assert r["candidate"]["unit"] == "bpm"

    r2 = interpret("mi ritmo cardiaco es de 75 latidos por minuto")
    assert r2["status"] == "needs_confirmation"
    assert r2["candidate"]["metric"] == "heart_rate"
    assert r2["candidate"]["values"] == [75.0]
    assert r2["candidate"]["unit"] == "bpm"


def test_contextual_origin_and_date():
    text = "Me medí la frecuencia cardiaca y tengo 115 latidos por minuto lo hice con 1 oximetro Y eso fue el 13 de noviembre de 2026 a las 11 A.M."
    r = interpret(text)
    assert r["status"] == "needs_confirmation"
    assert r["candidate"]["metric"] == "heart_rate"
    assert r["candidate"]["values"] == [115.0]
    assert r["candidate"]["unit"] == "bpm"
    assert r["candidate"]["suggested_origin"] == "Oxímetro"
    assert r["candidate"]["suggested_measured_at"] == "2026-11-13T11:00"
    assert "Datos recibidos y verificados" in r["message"]
    assert "protocolo de seguridad" in r["message"]


def test_relative_dates_and_default_instruments():
    from datetime import datetime, timedelta

    # 1. Sin instrumento explícito: asume instrumento correcto para temperatura
    r_temp = interpret("tengo 38.5 grados")
    assert r_temp["status"] == "needs_confirmation"
    assert r_temp["candidate"]["metric"] == "temperature"
    assert r_temp["candidate"]["values"] == [38.5]
    assert r_temp["candidate"]["unit"] == "°C"
    assert r_temp["candidate"]["suggested_origin"] == "Termómetro clínico infrarrojo de cabina"
    assert r_temp["candidate"]["suggested_measured_at"] is not None

    # 2. Sin instrumento explícito: asume instrumento correcto para pulso
    r_pulso = interpret("tengo 100 latidos por minuto")
    assert r_pulso["status"] == "needs_confirmation"
    assert r_pulso["candidate"]["metric"] == "heart_rate"
    assert r_pulso["candidate"]["values"] == [100.0]
    assert r_pulso["candidate"]["suggested_origin"] == "Pulsioxímetro / Monitor cardíaco de cabina"

    # 3. Fecha relativa: "hoy a las 8 am"
    now = datetime.now()
    r_hoy = interpret("Me medí la temperatura hoy a las 8 am y tengo 37.5 grados")
    assert r_hoy["status"] == "needs_confirmation"
    assert r_hoy["candidate"]["values"] == [37.5]
    assert r_hoy["candidate"]["suggested_origin"] == "Termómetro clínico infrarrojo de cabina"
    expected_hoy = f"{now.strftime('%Y-%m-%d')}T08:00"
    assert r_hoy["candidate"]["suggested_measured_at"] == expected_hoy

    # 4. Fecha relativa: "ayer a las 3 pm"
    yesterday = now - timedelta(days=1)
    r_ayer = interpret("Ayer me medí el pulso a las 3 pm y tenía 85 bpm")
    assert r_ayer["status"] == "needs_confirmation"
    assert r_ayer["candidate"]["values"] == [85.0]
    assert r_ayer["candidate"]["suggested_origin"] == "Pulsioxímetro / Monitor cardíaco de cabina"
    expected_ayer = f"{yesterday.strftime('%Y-%m-%d')}T15:00"
    assert r_ayer["candidate"]["suggested_measured_at"] == expected_ayer





