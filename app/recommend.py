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
            return "high", "critical" if v > 130 else "attention", f"{v:g} lpm (referencia 50–100)"
        if v < 50:
            return "low", "critical" if v < 40 else "attention", f"{v:g} lpm (referencia 50–100)"
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
            "out_of_range": False,
            "severity": None,
            "reason": None,
            "disclaimer": "Referencia general, no es un diagnóstico.",
        }
    return {
        "text": OUT.get((metric, direction), IN_RANGE[metric]),
        "out_of_range": True,
        "severity": severity,
        "reason": reason,
        "disclaimer": "Referencia general, no es un diagnóstico. Ante síntomas, contacta al equipo médico.",
    }
