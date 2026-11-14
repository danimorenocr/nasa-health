"""Reglas de formato demostrativas, NO algoritmo clínico ni clasificador validado."""

import re
import unicodedata

URGENT_MESSAGE = (
    "Esto podría requerir ayuda urgente. No esperes a completar este registro: contacta al responsable "
    "médico o al servicio de emergencia disponible y sigue el protocolo aprobado para tu ubicación o misión. "
    "Este prototipo no tiene un protocolo de misión cargado y no ha avisado a nadie. No puedo diagnosticarte."
)


def normalize(text):
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))


def reply(status, message, candidate=None):
    return {
        "status": status,
        "message": message,
        "candidate": candidate,
        "source_ids": [],
        "content_origin": "prototype_template_not_clinical_protocol",
        "rule_set_version": "0.2.0",
        "clinical_assessment": "not_performed",
        "communication_sent": False,
    }


def interpret(text):
    text = text.strip()
    s = normalize(text)
    if re.search(
        r"pecho|respir|falta (?:el )?aire|desmay|inconscien|sangrado|hemorrag|suicid|matarme|no quiero vivir",
        s,
    ):
        return reply("safety_notice", URGENT_MESSAGE)
    if re.search(r"\b(co2|cabina|dioxido|radiacion)\b", s):
        return reply(
            "information",
            "Las condiciones de cabina se registran por separado. No las convierto "
            "en diagnóstico ni criterio de triage personal. Esta versión registra indicadores personales.",
        )
    if re.search(r"\b(mide|mideme|escan|camara|escuch|microfono)\b", s):
        return reply(
            "information",
            "No puedo medir por texto, voz o cámara. Escribe la lectura real de un "
            "instrumento y su unidad, y confirma después el origen.",
        )
    if re.search(r"dosis|medicamento|medicina|diagnost|receta|que (?:me )?tomo|tengo una enfermedad", s):
        return reply(
            "information",
            "No doy diagnósticos, dosis ni tratamientos. Se requiere contenido clínico "
            "revisado y el protocolo aprobado de la misión; no están cargados en esta versión.",
        )
    descriptors = [
        ("blood_pressure", r"presion|tension"),
        ("heart_rate", r"pulso|frecuencia cardiaca"),
        ("temperature", r"temperatura"),
        ("oxygen_saturation", r"saturacion|spo2"),
        ("glucose", r"glucosa|glicemia"),
        ("sleep", r"dormi|sueno|horas de dormir"),
    ]
    matches = [metric for metric, pattern in descriptors if re.search(pattern, s)]
    if len(matches) > 1:
        return reply(
            "needs_clarification", "Registra un indicador por mensaje para no mezclar valores y unidades."
        )
    if matches:
        metric = matches[0]
        numeric = re.sub(r"(\d),(\d)", r"\1.\2", s.replace("spo2", "saturacion"))
        values = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", numeric)]
        expected = 2 if metric == "blood_pressure" else 1
        if len(values) != expected or re.search(r"-\s*\d", s):
            return reply(
                "needs_clarification",
                "No pude separar una lectura inequívoca. Escribe indicador, "
                "valor y unidad (por ejemplo, presión 120/80 mmHg). No he guardado nada.",
            )
        celsius = bool(re.search(r"°\s*c\b|celsius|grados c\b", s))
        fahrenheit = bool(re.search(r"°\s*f\b|fahrenheit|grados f\b", s))
        mg = bool(re.search(r"mg\s*/\s*dl\b", s))
        mmol = bool(re.search(r"mmol\s*/\s*l\b", s))
        if (metric == "temperature" and celsius and fahrenheit) or (metric == "glucose" and mg and mmol):
            return reply(
                "needs_clarification", "Hay dos unidades. Envía una sola lectura con una única unidad."
            )
        unit = None
        if metric == "heart_rate" and re.search(r"\b(lpm|bpm)\b|latidos por minuto", s):
            unit = "lpm"
        elif metric == "temperature":
            unit = "°C" if celsius else "°F" if fahrenheit else None
        elif metric == "blood_pressure" and re.search(r"\bmmhg\b", s):
            unit = "mmHg"
        elif metric == "oxygen_saturation" and re.search(r"%|por ciento", s):
            unit = "%"
        elif metric == "glucose":
            unit = "mg/dL" if mg else "mmol/L" if mmol else None
        elif metric == "sleep" and re.search(r"\b(h|horas?)\b", s):
            unit = "h"
        if not unit:
            return reply(
                "needs_clarification",
                "Falta una unidad compatible o no es clara. Especifica lpm, "
                "°C/°F, mmHg, %, mg/dL, mmol/L o horas según el indicador. No asumo unidades.",
            )
        return reply(
            "needs_confirmation",
            "Revisa el texto, valor y unidad, e indica el instrumento u origen. "
            "Todavía no he registrado ni interpretado clínicamente la lectura.",
            {"kind": "measurement", "metric": metric, "values": values, "unit": unit, "original_text": text},
        )
    if re.search(r"\d", s):
        return reply(
            "needs_clarification",
            "Hay números pero no un indicador inequívoco. Escribe qué mediste "
            "y la unidad. No he guardado nada.",
        )
    if len(s) < 5:
        return reply(
            "needs_clarification",
            "Describe el síntoma o escribe una lectura con su unidad. "
            "No hay datos suficientes para evaluar tu salud.",
        )
    return reply(
        "needs_confirmation",
        "Puedo registrar esto como síntoma o contexto declarado, sin "
        "interpretarlo como diagnóstico. Revisa antes de confirmar. No descarto una urgencia por no "
        "reconocer una frase.",
        {"kind": "symptom", "original_text": text},
    )
