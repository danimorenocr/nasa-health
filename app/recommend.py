"""Recomendación guardada por registro y detección de valores fuera de parámetros.

Los rangos son referencias generales para adultos (no un diagnóstico). Se evalúan al
confirmar el registro y el resultado se guarda junto a la entrada, para que el panel
principal y los avisos inteligentes lo muestren sin recalcular.
"""

import re

_EXERCISE = re.compile(r"ejercicio|entren|correr|caminata|gym|gimnasio|actividad", re.I)

# metric -> texto cuando está dentro de parámetros
IN_RANGE = {
    "heart_rate": "Tu pulso está dentro del rango de referencia. Mantén tu rutina de entrenamiento y la hidratación; en microgravedad el ejercicio protege el sistema cardiovascular.",
    "blood_pressure": "Tu presión está dentro del rango de referencia. Mantén la hidratación y el aporte de sodio habitual, y cambia de postura con calma.",
    "temperature": "Tu temperatura está dentro del rango de referencia. Mantén la ventilación del módulo y bebe agua, sobre todo después de ejercitarte.",
    "oxygen_saturation": "Tu saturación está dentro del rango de referencia. Sigue vigilando la oxigenación si cambian las condiciones de cabina o traje.",
    "glucose": "Tu glucosa está dentro del rango de referencia. Conserva horarios regulares de comida y tu actividad física.",
    "muscle_mass": "Registro de músculos guardado. No hay un rango de referencia para este dato: compara tu tendencia semanal y combina ejercicio de resistencia con proteína suficiente.",
    "sleep": "Tu descanso está dentro del rango de referencia. Mantén una rutina de sueño constante y baja la luz azul antes de dormir.",
}

# (clave, texto) para fuera de rango
OUT = {
    ("heart_rate", "high"): "Tu pulso está por encima del rango de referencia. Descansa unos minutos, respira lento, hidrátate y vuelve a medir. Si sigue alto o sientes síntomas, avisa al equipo médico.",
    ("heart_rate", "low"): "Tu pulso está por debajo del rango de referencia. Si hay mareo, desmayo o falta de aire, avisa al equipo médico; si no, repite la medición en reposo.",
    ("blood_pressure", "high"): "Tu presión está por encima del rango de referencia. Reposa sentado, reduce el sodio y la cafeína, y repite la medición en unos minutos. Si persiste, consulta al equipo médico.",
    ("blood_pressure", "low"): "Tu presión está por debajo del rango de referencia. Hidrátate, cambia de postura despacio y vuelve a medir. Si hay mareo, avisa al equipo médico.",
    ("temperature", "high"): "Tu temperatura está por encima del rango de referencia. Mejora la ventilación, evita esfuerzo intenso, hidrátate y repite la medición en 30 minutos.",
    ("temperature", "low"): "Tu temperatura está por debajo del rango de referencia. Abrígate, revisa el climatizado y repite la medición; avisa si persiste.",
    ("oxygen_saturation", "low"): "Tu saturación está por debajo del rango de referencia. Respira con calma, verifica el sensor y el sello/analizador de oxígeno y repite la medición. Si sigue baja, avisa de inmediato.",
    ("glucose", "high"): "Tu glucosa está por encima del rango de referencia. Hidrátate, evita azúcares simples y repite la medición según tu contexto (ayunas o tras comer).",
    ("glucose", "low"): "Tu glucosa está por debajo del rango de referencia. Toma una fuente rápida de carbohidratos y repite la medición en 15 minutos; avisa si persiste.",
    ("sleep", "low"): "Dormiste menos de lo recomendado. Prioriza un descanso reparador hoy, reduce la luz azul antes de acostarte y mantén horarios fijos.",
    ("sleep", "high"): "Dormiste más de lo habitual. Mantén horarios regulares y revisa si hay cansancio persistente.",
}


def _classify(metric, values, unit, context):
    """Devuelve (None | 'high' | 'low', severidad, motivo)."""
    v = values[0]
    if metric == "heart_rate":
        if context and _EXERCISE.search(context):
            return None, None, None  # tras ejercicio no es comparable
        if v > 100:
            return "high", "critical" if v > 130 else "attention", f"{v:g} bpm (referencia 50–100)"
        if v < 50:
            return "low", "critical" if v < 40 else "attention", f"{v:g} bpm (referencia 50–100)"
    elif metric == "blood_pressure" and len(values) >= 2:
        s, d = values[0], values[1]
        if s >= 130 or d >= 85:
            return "high", "critical" if s >= 180 or d >= 120 else "attention", f"{s:g}/{d:g} mmHg (referencia <130/85)"
        if s < 90 or d < 60:
            return "low", "critical" if s < 80 or d < 50 else "attention", f"{s:g}/{d:g} mmHg (referencia ≥90/60)"
    elif metric == "temperature":
        c = (v - 32) * 5 / 9 if unit == "°F" else v
        shown = f"{v:g} {unit}"
        if c >= 37.6:
            return "high", "critical" if c >= 39.5 else "attention", f"{shown} (referencia 36,0–37,5 °C)"
        if c < 36.0:
            return "low", "critical" if c < 35.0 else "attention", f"{shown} (referencia 36,0–37,5 °C)"
    elif metric == "oxygen_saturation":
        if v < 95:
            return "low", "critical" if v < 90 else "attention", f"{v:g} % (referencia ≥95)"
    elif metric == "glucose":
        mg = v * 18.016 if unit == "mmol/L" else v
        shown = f"{v:g} {unit}"
        if mg > 140:
            return "high", "critical" if mg > 250 else "attention", f"{shown} (referencia 70–140 mg/dL)"
        if mg < 70:
            return "low", "critical" if mg < 54 else "attention", f"{shown} (referencia 70–140 mg/dL)"
    elif metric == "sleep":
        if v < 6:
            return "low", "critical" if v < 4 else "attention", f"{v:g} h (referencia 6–9)"
        if v > 10:
            return "high", "attention", f"{v:g} h (referencia 6–9)"
    return None, None, None


IN_RANGE_EN = {
    "heart_rate": "Your pulse is within the reference range. Keep your training routine and hydration; exercise protects the cardiovascular system in microgravity.",
    "blood_pressure": "Your blood pressure is within the reference range. Keep hydration and usual sodium intake, and change posture calmly.",
    "temperature": "Your temperature is within the reference range. Keep the module ventilated and drink water, especially after exercise.",
    "oxygen_saturation": "Your saturation is within the reference range. Keep watching oxygenation if cabin or suit conditions change.",
    "glucose": "Your glucose is within the reference range. Keep regular meal times and physical activity.",
    "muscle_mass": "Muscle record saved. There is no reference range for this value: compare your weekly trend and combine resistance exercise with enough protein.",
    "sleep": "Your rest is within the reference range. Keep a steady sleep routine and reduce blue light before bed.",
}

OUT_EN = {
    ("heart_rate", "high"): "Your pulse is above the reference range. Rest a few minutes, breathe slowly, hydrate and measure again. If it stays high or you feel symptoms, tell the medical team.",
    ("heart_rate", "low"): "Your pulse is below the reference range. If you feel dizzy, faint or short of breath, tell the medical team; otherwise repeat the measurement at rest.",
    ("blood_pressure", "high"): "Your blood pressure is above the reference range. Rest seated, cut sodium and caffeine, and measure again in a few minutes. If it persists, consult the medical team.",
    ("blood_pressure", "low"): "Your blood pressure is below the reference range. Hydrate, change posture slowly and measure again. If you feel dizzy, tell the medical team.",
    ("temperature", "high"): "Your temperature is above the reference range. Improve ventilation, avoid intense effort, hydrate and measure again in 30 minutes.",
    ("temperature", "low"): "Your temperature is below the reference range. Keep warm, check the climate control and measure again; tell the team if it persists.",
    ("oxygen_saturation", "low"): "Your saturation is below the reference range. Breathe calmly, check the sensor and the suit seal or oxygen analyzer, and measure again. If it stays low, report it immediately.",
    ("glucose", "high"): "Your glucose is above the reference range. Hydrate, avoid simple sugars and measure again according to your context (fasting or after eating).",
    ("glucose", "low"): "Your glucose is below the reference range. Take a quick source of carbohydrates and measure again in 15 minutes; tell the team if it persists.",
    ("sleep", "low"): "You slept less than recommended. Prioritize restful sleep today, reduce blue light before bed and keep fixed schedules.",
    ("sleep", "high"): "You slept more than usual. Keep regular schedules and check for persistent tiredness.",
}

DISCLAIMER_EN = "General reference, not a diagnosis."
DISCLAIMER_EN_OUT = "General reference, not a diagnosis. If you have symptoms, contact the medical team."


def assess(candidate, context=""):
    """Recomendación + estado para una medición. None si no es una medición."""
    if not isinstance(candidate, dict) or candidate.get("kind") != "measurement":
        return None
    metric = candidate.get("metric")
    values = candidate.get("values") or []
    if metric not in IN_RANGE or not values:
        return None
    direction, severity, reason = _classify(metric, values, candidate.get("unit", ""), context or "")
    if direction is None:
        return {
            "text": IN_RANGE[metric],
            "text_en": IN_RANGE_EN[metric],
            "disclaimer_en": DISCLAIMER_EN,
            "out_of_range": False,
            "severity": None,
            "reason": None,
            "disclaimer": "Referencia general, no es un diagnóstico.",
        }
    return {
        "text": OUT.get((metric, direction), IN_RANGE[metric]),
        "text_en": OUT_EN.get((metric, direction), IN_RANGE_EN[metric]),
        "disclaimer_en": DISCLAIMER_EN_OUT,
        "out_of_range": True,
        "severity": severity,
        "reason": reason,
        "reason_en": reason.replace("referencia", "reference").replace(",", "."),
        "disclaimer": "Referencia general, no es un diagnóstico. Ante síntomas, contacta al equipo médico.",
    }
