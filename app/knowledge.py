"""Respuestas a preguntas sobre rangos y límites, con la información que ya tiene la app.

Todo sale de tablas fijas (los mismos rangos de referencia con los que se marca "fuera de
rango", la orientación de señales de alerta y el texto educativo de NASA), sin inventar
cifras. Son referencias generales, no un diagnóstico.
"""

import re

from .engine import DESCRIPTORS, METRIC_LABELS, interpret, normalize
from .guidance import INDICATOR_GUIDANCE
from .recommend import OUT, OUT_EN, assess
from .vitals import VITAL_SPECS

NAMES_EN = {
    "heart_rate": "Heart rate", "blood_pressure": "Blood pressure", "temperature": "Temperature",
    "oxygen_saturation": "Oxygen saturation", "glucose": "Glucose", "sleep": "Sleep", "muscle_mass": "Muscles",
}

# Los mismos cortes que usa recommend.py para marcar atención / crítico.
LIMITS_ES = {
    "heart_rate": "En reposo la referencia es de 50 a 100 bpm. Se marca atención por encima de 100 o por debajo de 50 bpm, y nivel crítico por encima de 130 o por debajo de 40 bpm. Después de ejercicio no es comparable.",
    "blood_pressure": "La referencia es menor de 130/85 y mayor o igual a 90/60 mmHg. Se marca atención si la sistólica es de 130 o más, la diastólica de 85 o más, o si baja de 90/60. Nivel crítico: 180/120 o más, o menos de 80/50.",
    "temperature": "La referencia es de 36,0 a 37,5 °C. Se marca atención desde 37,6 °C o por debajo de 36,0 °C, y nivel crítico desde 39,5 °C o por debajo de 35,0 °C.",
    "oxygen_saturation": "La referencia es de 95 % o más. Se marca atención entre 90 y 94 %, y nivel crítico por debajo de 90 %.",
    "glucose": "La referencia es de 70 a 140 mg/dL (unos 3,9 a 7,8 mmol/L). Se marca atención por encima de 140 o por debajo de 70 mg/dL, y nivel crítico por encima de 250 o por debajo de 54 mg/dL.",
    "sleep": "La referencia es de 6 a 9 horas. Se marca atención con menos de 6 o más de 10 horas, y nivel crítico con menos de 4 horas.",
    "muscle_mass": "Para el peso de músculos no hay un rango de referencia: lo útil es seguir tu tendencia semanal y combinar ejercicio de resistencia con proteína suficiente.",
}
LIMITS_EN = {
    "heart_rate": "At rest the reference is 50 to 100 bpm. Attention is flagged above 100 or below 50 bpm, and critical above 130 or below 40 bpm. After exercise it is not comparable.",
    "blood_pressure": "The reference is below 130/85 and at least 90/60 mmHg. Attention is flagged if systolic is 130 or more, diastolic 85 or more, or if it drops below 90/60. Critical: 180/120 or more, or below 80/50.",
    "temperature": "The reference is 36.0 to 37.5 °C. Attention is flagged from 37.6 °C or below 36.0 °C, and critical from 39.5 °C or below 35.0 °C.",
    "oxygen_saturation": "The reference is 95% or more. Attention is flagged between 90 and 94%, and critical below 90%.",
    "glucose": "The reference is 70 to 140 mg/dL (about 3.9 to 7.8 mmol/L). Attention is flagged above 140 or below 70 mg/dL, and critical above 250 or below 54 mg/dL.",
    "sleep": "The reference is 6 to 9 hours. Attention is flagged with under 6 or over 10 hours, and critical under 4 hours.",
    "muscle_mass": "There is no reference range for muscle weight: what helps is following your weekly trend and combining resistance exercise with enough protein.",
}
DISCLAIMER_ES = "Son referencias generales de esta app, no un diagnóstico: ante síntomas o dudas, consulta al equipo médico."
DISCLAIMER_EN = "These are general reference values in this app, not a diagnosis: with symptoms or doubts, contact the medical team."

QUESTION = re.compile(
    r"\?|^(cual|cuales|que|como|cuando|cuanto|cuanta|hasta|desde|por que|debo|puedo|sera|es|esta|estan|son)\b"
)
TOPIC = re.compile(
    r"limite|rango|normal|grave|critic|peligros|preocup|riesgo|referencia|maximo|minimo|umbral|urgente|emergencia|"
    r"alto|alta|baja|bajo|significa|para que sirve|que es|que hago|que debo|que puedo|recomend|espacio|nasa|microgravedad|astronaut|"
    r"esta bien|es bien|estoy bien|mal|sano|saludable"
)
EN_METRICS = {
    "heart_rate": r"heart rate|pulse|heartbeat",
    "blood_pressure": r"blood pressure",
    "temperature": r"temperature|fever",
    "oxygen_saturation": r"oxygen|saturation|spo2",
    "glucose": r"glucose|blood sugar",
    "sleep": r"\bsleep",
    "muscle_mass": r"muscle",
}
EN_QUESTION = re.compile(r"\?|^(what|which|how|when|is|are|should|can|do|does)\b")
EN_TOPIC = re.compile(
    r"limit|range|normal|serious|dangerous|critical|worry|threshold|safe|high|low|risk|what should|what do i|nasa|space|microgravity|ok\b|fine"
)
ASKS_RECORDS = re.compile(r"ultim|registr|historial|guardad|resumen|cuantos|cuantas veces|mis datos|recuerdas|memoria|last record|my records|history|my data")
EVALUATION = re.compile(r"normal|bien|alto|alta|bajo|baja|grave|preocup|peligros|mal|sano|saludable|critic|serious|dangerous|worry|fine|ok\b|high|low")
WANTS_WARNING_SIGNS = re.compile(r"grave|critic|urgente|emergencia|peligros|alarma|preocup")
WANTS_SPACE = re.compile(r"espacio|nasa|microgravedad|astronaut|vuelo|mision")
WANTS_ACTIONS = re.compile(r"que hago|que debo|que puedo|que hacer|recomend|como (lo )?(bajo|subo|mejoro|controlo|trato)")


def _reply(message):
    return {
        "status": "information",
        "message": message,
        "candidate": None,
        "source_ids": [],
        "content_origin": "prototype_template_not_clinical_protocol",
        "rule_set_version": "0.2.0",
        "clinical_assessment": "not_performed",
        "communication_sent": False,
    }


def _metrics_in(norm):
    found = []
    for metric, pattern in DESCRIPTORS:
        if re.search(pattern, norm) and metric not in found:
            found.append(metric)
    for metric, pattern in EN_METRICS.items():
        if re.search(pattern, norm) and metric not in found:
            found.append(metric)
    return found


def _warning_signs(metric):
    for item in INDICATOR_GUIDANCE:
        if item["code"] == metric:
            return item["attention"].split("Consulta no urgente")[0].strip()
    return ""


def _space_text(metric):
    spec = VITAL_SPECS.get(metric)
    return spec["education"]["text"] if spec else ""


def _evaluate(text, lang):
    """"¿Está bien una glucosa de 97?": se evalúa con los mismos rangos y NO se guarda."""
    plain = re.sub(r"[¿?¡!]", " ", text)
    result = interpret(plain, entries=[], assume_units=True)
    cand = result.get("candidate")
    if not isinstance(cand, dict):
        # La frase es una pregunta: se arma una lectura simple con el indicador y el número que mencionó.
        metrics = _metrics_in(normalize(plain))
        numbers = re.findall(r"\d+(?:[.,]\d+)?", plain)
        if not metrics or not numbers:
            return None
        metric = metrics[0]
        need = 2 if metric == "blood_pressure" else 1
        if len(numbers) < need:
            return None
        units = " ".join(re.findall(r"mg\s*/\s*dl|mmol\s*/\s*l|°\s*[cf]|fahrenheit|celsius|kg|mmhg|%", plain, flags=re.IGNORECASE)[:1])
        reading = f"{METRIC_LABELS.get(metric, metric)} " + ("/".join(numbers[:2]) if need == 2 else numbers[0]) + f" {units}"
        cand = interpret(reading, entries=[], assume_units=True).get("candidate")
        if not isinstance(cand, dict):
            return None
    items = cand.get("measurements") if cand.get("kind") == "batch" else [cand]
    lines = []
    for item in items[:4]:
        verdict = assess(item)
        if not verdict:
            continue
        en = lang == "en"
        label = NAMES_EN[item["metric"]] if en else METRIC_LABELS.get(item["metric"], item["metric"]).capitalize()
        values = "/".join(f"{v:g}" for v in item["values"])
        head = f"{label} {values} {item['unit']}"
        if verdict["out_of_range"]:
            reason = verdict.get("reason_en") if en else verdict.get("reason")
            reason = reason[reason.find("(") + 1 : reason.rfind(")")] if "(" in (reason or "") else reason
            where = "is outside the reference range" if en else "está fuera del rango de referencia"
            lines.append(f"{head} {where} ({reason}). {verdict['text_en'] if en else verdict['text']}")
        elif item["metric"] == "muscle_mass":
            lines.append(f"{head}. {verdict['text_en'] if en else verdict['text']}")
        else:
            where = "is within the reference range" if en else "está dentro del rango de referencia"
            lines.append(f"{head} {where}.")
    if not lines:
        return None
    tail = (
        " I did not save it: tell me the reading without the question if you want to record it. " + DISCLAIMER_EN
        if lang == "en"
        else " No lo guardé: dímelo sin la pregunta si quieres registrarlo. " + DISCLAIMER_ES
    )
    return _reply(" ".join(lines) + tail)


def answer_question(text, lang="es"):
    """Responde preguntas sobre límites, rangos y qué hacer; None si no es una pregunta de ese tipo."""
    norm = normalize(text)
    if not norm or ASKS_RECORDS.search(norm):
        return None
    metrics = _metrics_in(norm)
    if not metrics:
        return None
    has_digits = bool(re.search(r"\d", norm))
    asked = (bool(QUESTION.search(text.lower()) or QUESTION.search(norm)) and bool(TOPIC.search(norm))) or (
        bool(EN_QUESTION.search(norm) or EN_QUESTION.search(text.lower())) and bool(EN_TOPIC.search(norm))
        and lang == "en"
    )
    if not asked:
        return None
    if has_digits:
        return _evaluate(text, lang) if EVALUATION.search(norm) else None

    en = lang == "en"
    parts = []
    for metric in metrics[:3]:
        name = NAMES_EN[metric] if en else METRIC_LABELS.get(metric, metric).capitalize()
        block = [f"{name}: {(LIMITS_EN if en else LIMITS_ES)[metric]}"]
        if WANTS_ACTIONS.search(norm):
            high = bool(re.search(r"alt[oa]|sub[ei]|elevad|sobre", norm))
            low = bool(re.search(r"baj[oa]|descend|poco", norm))
            table = OUT_EN if en else OUT
            keys = [d for d, wanted in (("high", high or not low), ("low", low or not high)) if wanted]
            block.extend(table[(metric, d)] for d in keys if (metric, d) in table)
        if WANTS_WARNING_SIGNS.search(norm) and not en:
            signs = _warning_signs(metric)
            if signs:
                block.append(signs)
        if WANTS_SPACE.search(norm) and not en:
            education = _space_text(metric)
            if education:
                block.append(f"En el espacio: {education}")
        parts.append(" ".join(block))
    parts.append(DISCLAIMER_EN if en else DISCLAIMER_ES)
    return _reply(" ".join(parts))
