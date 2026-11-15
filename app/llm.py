import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SPANISH_MONTHS_NAMES = {
    1: "enero",
    2: "febrero",
    3: "marzo",
    4: "abril",
    5: "mayo",
    6: "junio",
    7: "julio",
    8: "agosto",
    9: "septiembre",
    10: "octubre",
    11: "noviembre",
    12: "diciembre",
}

DEFAULT_MISSION_INSTRUMENTS = {
    "temperature": "Termómetro clínico infrarrojo de cabina",
    "heart_rate": "Pulsioxímetro / Monitor cardíaco de cabina",
    "blood_pressure": "Tensiómetro digital de brazo",
    "oxygen_saturation": "Pulsioxímetro de cabina",
    "glucose": "Glucómetro capilar telemétrico",
    "sleep": "Sensor de biotelemetría de sueño",
}

NASA_EVIDENCE_CONTEXT = {
    "temperature": (
        "EVIDENCIA NASA (Human Research Program / ISS): En microgravedad, la temperatura corporal central "
        "de los astronautas suele aumentar aproximadamente 1 °C debido a la alteración de la termorregulación "
        "y a la falta de convección y evaporación del sudor en ingravidez ('fiebre espacial' o space fever). "
        "Durante el ejercicio o caminatas espaciales (EVA), la temperatura se eleva mucho más rápido, "
        "aumentando el riesgo de sobrecalentamiento. "
        "CONDUCTA OPERACIONAL: En valores elevados (>37.5 °C o >38.0 °C), regular flujo de ventilación en módulo o traje, "
        "mantener hidratación activa con electrolitos, pausar ejercicio vigoroso, retirar capas térmicas y "
        "repetir medición en 30 minutos avisando al oficial de misión si supera 38.3 °C."
    ),
    "heart_rate": (
        "EVIDENCIA NASA (Cardiovascular Risk): En ingravidez se produce desacondicionamiento cardiovascular "
        "y redistribución cefálica de fluidos corporales con menor volumen plasmático. La frecuencia cardíaca basal "
        "y la respuesta taquicárdica al esfuerzo pueden incrementarse para mantener el gasto cardíaco. "
        "CONDUCTA OPERACIONAL: Hidratación con sales para preservar volumen intravascular, descansos programados, "
        "control de respiración diafragmática y monitorización periódica."
    ),
    "blood_pressure": (
        "EVIDENCIA NASA (Intolerancia Ortostática): Cambios en el tono vascular y volumen de líquidos inducen "
        "hipotensión ortostática y labilidad arterial, especialmente críticas al regreso o cambios de aceleración. "
        "CONDUCTA OPERACIONAL: Uso de prendas de compresión y rehidratación previa a esfuerzos."
    ),
    "oxygen_saturation": (
        "EVIDENCIA NASA (Riesgo de Hipoxia): En atmósferas de cabina de naves espaciales o trajes EVA a presión reducida, "
        "debe vigilarse estrechamente la saturación para evitar hipoxia hipobárica leve y letargo cognitivo. "
        "CONDUCTA OPERACIONAL: Chequear sellos de traje o módulo, analizadores de gas y flujo de O2."
    ),
    "glucose": (
        "EVIDENCIA NASA (Metabolismo e Insulina): Durante estancias prolongadas en microgravedad se observan cambios "
        "subclínicos en sensibilidad a la insulina y tolerancia a la glucosa. "
        "CONDUCTA OPERACIONAL: Crononutrición balanceada de raciones y ejercicio resistivo continuo."
    ),
    "sleep": (
        "EVIDENCIA NASA (Fatiga y Ritmo Circadiano): Las tripulaciones sufren disrupción circadiana por 16 amaneceres al día "
        "y ruido continuo de ventiladores de la estación espacial. "
        "CONDUCTA OPERACIONAL: Iluminación espectral azul regulada, antifaz, tapones y horarios estrictos de reposo."
    ),
}


def get_llm_config() -> dict[str, str] | None:
    if os.environ.get("PYTEST_CURRENT_TEST") and not os.environ.get("TEST_WITH_LIVE_LLM"):
        return None

    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    gemini_key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()

    if groq_key:
        return {
            "provider": "Groq",
            "url": "https://api.groq.com/openai/v1/chat/completions",
            "api_key": groq_key,
            "model": os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b"),
        }
    if openai_key:
        return {
            "provider": "OpenAI",
            "url": "https://api.openai.com/v1/chat/completions",
            "api_key": openai_key,
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        }
    if gemini_key:
        return {
            "provider": "Gemini",
            "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            "api_key": gemini_key,
            "model": os.environ.get("GEMINI_MODEL", "gemini-1.5-flash"),
        }
    return None


def is_llm_configured() -> bool:
    return get_llm_config() is not None


_VALID_METRICS = {"heart_rate", "temperature", "blood_pressure", "oxygen_saturation", "glucose", "sleep"}


def _clean_measurement(item: Any, text: str, now_iso: str) -> dict[str, Any] | None:
    """Devuelve una medición con la forma del esquema, o None si no es válida."""
    if not isinstance(item, dict) or item.get("metric") not in _VALID_METRICS:
        return None
    try:
        values = [float(v) for v in item.get("values", [])]
    except (TypeError, ValueError):
        return None
    unit = item.get("unit")
    if not values or not isinstance(unit, str) or not unit.strip():
        return None
    return {
        "kind": "measurement",
        "metric": item["metric"],
        "values": values,
        "unit": unit.strip(),
        "original_text": item.get("original_text") or text,
        "suggested_origin": item.get("suggested_origin") or DEFAULT_MISSION_INSTRUMENTS.get(item["metric"]),
        "suggested_measured_at": item.get("suggested_measured_at") or now_iso,
    }


def _normalize_candidates(parsed: dict[str, Any], text: str, now_iso: str) -> None:
    """Unifica la salida del LLM: `candidates` (lista) pasa a un `candidate` único o de tipo batch."""
    many = parsed.pop("candidates", None)
    if parsed.get("candidate") is None and isinstance(many, list):
        valid = [m for m in (_clean_measurement(i, text, now_iso) for i in many) if m]
        if len(valid) == 1:
            parsed["candidate"] = valid[0]
        elif len(valid) > 1:
            parsed["candidate"] = {
                "kind": "batch",
                "measurements": valid,
                "original_text": text,
                "suggested_origin": parsed.get("suggested_origin") or "Instrumentos de cabina",
                "suggested_measured_at": valid[0]["suggested_measured_at"],
            }
    parsed.setdefault("candidate", None)


async def interpret_with_llm(
    text: str,
    entries: list[Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    config = get_llm_config()
    if not config:
        return None

    if now is None:
        now = datetime.now()

    today_str = now.strftime("%Y-%m-%d")
    now_iso = now.strftime("%Y-%m-%dT%H:%M")
    now_human = f"{now.day} de {SPANISH_MONTHS_NAMES.get(now.month, '')} de {now.year}, hora {now.strftime('%I:%M %p')}"
    yesterday_str = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    two_days_ago_str = (now - timedelta(days=2)).strftime("%Y-%m-%d")

    system_prompt = (
        "Eres ASTRA (Autonomous Space Telemetry & Record Assistant), el sistema médico inteligente de telemetría a bordo de una misión espacial.\n"
        "Tu misión es interpretar la transcripción o mensaje del astronauta y estructurar con precisión las mediciones de salud.\n\n"
        "MÉTRICAS ADMITIDAS (debes usar exactamente uno de estos identificadores):\n"
        "- heart_rate: valores numéricos en lpm (latidos por minuto, pulso, pulsaciones).\n"
        "- temperature: valores en °C o °F (si dice grados o centígrados, normaliza a °C).\n"
        "- blood_pressure: dos valores [sistólica, diastólica] en mmHg.\n"
        "- oxygen_saturation: porcentaje de 0 a 100 en % (SpO2, saturación).\n"
        "- glucose: en mg/dL o mmol/L.\n"
        "- sleep: horas dormidas en h.\n\n"
        f"BASE TEMPORAL EXACTA DEL SISTEMA:\n"
        f"- Fecha y hora actual del sistema (HOY): {today_str} ({now_human}).\n"
        f"- AYER corresponde exactamente a: {yesterday_str}.\n"
        f"- ANTIER / ANTEAYER corresponde a: {two_days_ago_str}.\n\n"
        "REGLAS CRÍTICAS DE FECHA Y HORA ('suggested_measured_at'):\n"
        f"1. Si el astronauta dice 'hoy', 'esta mañana', 'ahorita', o similar, usa la fecha de hoy ({today_str}).\n"
        f"2. Si dice 'ayer' o 'el día de ayer', usa la fecha de ayer ({yesterday_str}).\n"
        f"3. Si dice 'antier' o 'anteayer', usa la fecha de {two_days_ago_str}.\n"
        "4. Si menciona una hora (ej. 'a las 11 AM', 'a las 8', 'a las 9 de la noche'), conviértela a formato 24h y úsala en el ISO (YYYY-MM-DDTHH:MM).\n"
        f"5. Si NO menciona fecha ni hora, asigna por defecto la fecha y hora actual del sistema: '{now_iso}'.\n"
        "El campo 'suggested_measured_at' DEBE estar siempre en formato ISO YYYY-MM-DDTHH:MM.\n\n"
        "REGLAS CRÍTICAS DE INSTRUMENTO ('suggested_origin'):\n"
        "1. Si el usuario menciona explícitamente un instrumento (ej. 'con 1 oxímetro', 'smartwatch', 'termómetro axilar'), extráelo fielmente.\n"
        "2. Si NO menciona ningún instrumento explícito, ASUME OBLIGATORIAMENTE el instrumento clínico estándar para esa métrica:\n"
        "   - Para temperature: 'Termómetro clínico infrarrojo de cabina'\n"
        "   - Para heart_rate: 'Pulsioxímetro / Monitor cardíaco de cabina'\n"
        "   - Para blood_pressure: 'Tensiómetro digital de brazo'\n"
        "   - Para oxygen_saturation: 'Pulsioxímetro de cabina'\n"
        "   - Para glucose: 'Glucómetro capilar telemétrico'\n"
        "   - Para sleep: 'Sensor de biotelemetría de sueño'\n"
        "¡NUNCA dejes 'suggested_origin' en null o vacío si identificaste una métrica!\n\n"
        "REGLAS DE SEGURIDAD Y CONFIRMACIÓN:\n"
        "- Si el texto reporta posibles emergencias críticas (dolor en el pecho, falta de aire súbita, sangrado profuso), responde con status: 'safety_notice'.\n"
        "- Si es una lectura válida, usa status: 'needs_confirmation'. En 'message', confirma haber recibido la telemetría con tono ingenioso de misión espacial, menciona el indicador, valor, origen asumido/detectado y fecha/hora, y pide verificar en el formulario antes de confirmar.\n\n"
        "REGLAS DE RECOMENDACIONES CLÍNICAS Y OPERACIONALES (EVIDENCIA NASA):\n"
        "No generes frases genéricas ni cálculos matemáticos fríos. Basa tus recomendaciones en la evidencia biomédica espacial de la NASA:\n"
        f"- Contexto Temperatura: {NASA_EVIDENCE_CONTEXT['temperature']}\n"
        f"- Contexto Pulso: {NASA_EVIDENCE_CONTEXT['heart_rate']}\n"
        f"- Contexto Presión: {NASA_EVIDENCE_CONTEXT['blood_pressure']}\n"
        f"- Contexto Oxígeno: {NASA_EVIDENCE_CONTEXT['oxygen_saturation']}\n"
        f"- Contexto Glucosa: {NASA_EVIDENCE_CONTEXT['glucose']}\n"
        f"- Contexto Sueño: {NASA_EVIDENCE_CONTEXT['sleep']}\n"
        "Combina la cifra actual y la situación del astronauta (si tiene fiebre/alta temperatura, fatiga, esfuerzo) con consejos prácticos de cabina (hidratación, ventilador, pausas activas, ropa térmica, re-medición).\n\n"
        "RESPONDE EXCLUSIVAMENTE CON UN OBJETO JSON VÁLIDO con este formato exacto:\n"
        "{\n"
        '  "status": "needs_confirmation",\n'
        '  "message": "🛰️ ¡Datos recibidos y verificados por el sistema! He identificado tu lectura de frecuencia cardíaca: 115 lpm (origen: Oxímetro, medición: 2026-11-13 a las 11:00 AM). Por protocolo de seguridad de la misión espacial, por favor verifica que las cifras en el formulario coincidan exactamente antes de confirmar tu registro en SQLite local.",\n'
        '  "candidate": {\n'
        '    "kind": "measurement",\n'
        '    "metric": "heart_rate",\n'
        '    "values": [115.0],\n'
        '    "unit": "lpm",\n'
        '    "original_text": "...",\n'
        '    "suggested_origin": "Oxímetro",\n'
        '    "suggested_measured_at": "2026-11-13T11:00"\n'
        "  },\n"
        '  "recommendations": "Recomendación coherente con la NASA y las circunstancias..."\n'
        "}"
    )

    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": config["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Transcripción del astronauta: {text}"},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(config["url"], headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                content = data["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                if isinstance(parsed, dict) and "status" in parsed:
                    _normalize_candidates(parsed, text, now_iso)
                    if parsed.get("status") == "needs_confirmation" and not parsed.get("candidate"):
                        # Propuesta sin candidato válido: no se puede confirmar; usa el motor local.
                        logger.warning("El LLM propuso confirmación sin candidato válido; uso motor local.")
                        return None
                    cand = parsed.get("candidate")
                    if cand and isinstance(cand, dict):
                        if not cand.get("original_text"):
                            cand["original_text"] = text
                        if "values" in cand and isinstance(cand["values"], list):
                            cand["values"] = [float(v) for v in cand["values"]]
                        metric = cand.get("metric")
                        if not cand.get("suggested_origin") and metric in DEFAULT_MISSION_INSTRUMENTS:
                            cand["suggested_origin"] = DEFAULT_MISSION_INSTRUMENTS[metric]
                        if not cand.get("suggested_measured_at"):
                            cand["suggested_measured_at"] = now_iso

                    if "recommendations" in parsed:
                        recs = parsed["recommendations"]
                        if isinstance(recs, list):
                            parsed["recommendations"] = [str(r).strip() for r in recs if str(r).strip()]
                        elif isinstance(recs, str):
                            parsed["recommendations"] = recs.strip()

                    parsed["content_origin"] = "prototype_template_not_clinical_protocol"
                    parsed["rule_set_version"] = "0.2.0"
                    parsed["clinical_assessment"] = "not_performed"
                    parsed["communication_sent"] = False
                    parsed["source_ids"] = []
                    parsed["recorded"] = False
                    parsed["llm_used"] = True
                    return parsed
    except (httpx.HTTPError, ValueError, OSError, json.JSONDecodeError, KeyError) as ex:
        logger.warning("Llamada al LLM falló (%s). Empleando motor determinista local.", ex)

    return None


METRIC_DISPLAY_NAMES = {
    "temperature": "temperatura corporal",
    "heart_rate": "pulso y frecuencia cardíaca",
    "blood_pressure": "presión arterial",
    "oxygen_saturation": "saturación de oxígeno",
    "glucose": "glucosa",
    "sleep": "horas de sueño",
}


def has_metric_records(metric: str, personal: dict[str, Any] | None) -> bool:
    """Verifica de forma estricta si existen registros válidos para el indicador en la ventana."""
    if not personal:
        return False
    msg = (personal.get("message") or "").lower()
    if not msg or "no hay registros" in msg or "sin registros" in msg:
        return False
    if metric == "sleep":
        if "nights_recorded" in personal:
            return int(personal.get("nights_recorded") or 0) > 0
        return True
    if "series" in personal:
        series = personal.get("series", [])
        return any(int(s.get("records") or 0) > 0 for s in series)
    return True


def generate_deterministic_analysis_recommendation(
    metric: str,
    personal: dict[str, Any] | None,
    education: dict[str, Any] | None,
) -> str:
    """Genera recomendaciones inteligentes y contextuales cuando el LLM está fuera de línea."""
    label = METRIC_DISPLAY_NAMES.get(metric, metric)
    if not has_metric_records(metric, personal):
        return (
            f"Todavía no se puede analizar: no tienes registros confirmados de {label} en esta sesión (últimos 7 días). "
            "Por favor, registra al menos una medición para generar el análisis asistido con evidencia de la NASA."
        )

    msg = (personal or {}).get("message", "")

    # Extracción de números clave si existen en el mensaje de cálculo
    max_match = re.search(r"máximo\s+([0-9]+(?:[,\.][0-9]+)?)", msg)
    avg_match = re.search(r"Promedio\s+([0-9]+(?:[,\.][0-9]+)?)", msg)
    max_val = float(max_match.group(1).replace(",", ".")) if max_match else None
    avg_val = float(avg_match.group(1).replace(",", ".")) if avg_match else None

    if metric == "temperature":
        if (max_val and max_val >= 38.0) or (avg_val and avg_val >= 38.0):
            return (
                f"Tus registros muestran valores febriles (pico de {max_val or avg_val} °C). En microgravedad, "
                "la ausencia de corrientes de convección natural reduce la disipación del calor corporal ('fiebre espacial' documentada por la NASA). "
                "Recomendamos suspender ejercicios de alta exigencia, incrementar el flujo de ventilación de tu cabina, "
                "mantener hidratación activa con electrolitos frescos y repetir la medición en 30 minutos notificando a control de misión."
            )
        if (max_val and max_val >= 37.5) or (avg_val and avg_val >= 37.5):
            return (
                f"Tus registros muestran una temperatura moderadamente elevada ({avg_val or max_val} °C promedio). "
                "Según investigaciones de la NASA en la ISS, la temperatura central de los astronautas suele subir cerca de 1 °C en órbita. "
                "Asegúrate de regular la climatización de tu módulo, retirar prendas térmicas sobrantes y beber agua con regularidad."
            )
        return (
            "Tus lecturas de temperatura se mantienen en rangos basales estables. Ten en cuenta que la NASA ha evidenciado "
            "que la temperatura corporal sube mucho más rápido durante el ejercicio en microgravedad, por lo que es esencial "
            "mantener una ventilación adecuada e hidratación continua antes y después de cada sesión."
        )

    if metric == "heart_rate":
        if (max_val and max_val >= 100) or (avg_val and avg_val >= 95):
            return (
                f"Tus registros reflejan pulsaciones elevadas (hasta {max_val or avg_val} lpm). La NASA señala que la redistribución cefálica "
                "de fluidos y la menor volemia en ingravidez aumentan la respuesta taquicárdica para sostener el gasto cardíaco. "
                "Sugerimos reposo en módulo, ejercicios de respiración lenta e ingesta de líquidos con sales minerales."
            )
        return (
            f"Tu frecuencia cardíaca promedio ({avg_val or 'estable'} lpm) muestra un comportamiento adecuado. Para mitigar "
            "el desacondicionamiento cardiovascular propio de las misiones espaciales según los protocolos de la NASA, "
            "continúa cumpliendo con tu pauta diaria de entrenamiento resistivo y aeróbico."
        )

    if metric == "blood_pressure":
        return (
            "Para prevenir la intolerancia ortostática y caídas de presión arterial analizadas por la NASA tras estancias en microgravedad, "
            "se recomienda utilizar prendas de contrapresión durante transiciones operacionales y asegurar una adecuada reposición de líquidos y sodio."
        )

    if metric == "oxygen_saturation":
        return (
            "En entornos de presión reducida o trajes espaciales, la NASA prioriza vigilar la oxigenación para evitar hipoxia hipobárica. "
            "Si observas saturaciones bajas, verifica de inmediato el sello del módulo/traje y los analizadores de concentración de oxígeno."
        )

    if metric == "glucose":
        return (
            "Los estudios de la NASA indican alteraciones subclínicas en la sensibilidad a la insulina durante vuelos espaciales. "
            "Mantén un horario regular en las raciones alimentarias, prioriza carbohidratos de bajo índice glucémico y mantén tu actividad física."
        )

    if metric == "sleep":
        return (
            "La privación de sueño y el desajuste circadiano por los múltiples amaneceres orbitales son riesgos clave en la NASA. "
            "Sugerimos modular la iluminación azul antes de dormir, emplear antifaz y tapones, y mantener una rutina de sueño constante de 8 horas."
        )

    return (
        "Recomendación asistida: Mantén una monitorización continua de tus signos vitales y consulta las directrices de soporte de vida "
        "de la misión espacial ante cualquier cambio inusual."
    )


async def generate_analysis_recommendation(
    metric: str,
    personal: dict[str, Any] | None,
    education: dict[str, Any] | None,
    recent_entries: list[Any] | None = None,
    now: datetime | None = None,
) -> str:
    """Genera una recomendación rica, empática y contextual sintetizando el historial del usuario y la evidencia NASA."""
    config = get_llm_config()
    if not config:
        return generate_deterministic_analysis_recommendation(metric, personal, education)

    if not has_metric_records(metric, personal):
        label = METRIC_DISPLAY_NAMES.get(metric, metric)
        return (
            f"Todavía no se puede analizar: no tienes registros confirmados de {label} en esta sesión (últimos 7 días). "
            "Por favor, registra al menos una medición para generar el análisis asistido con evidencia de la NASA."
        )

    personal_msg = (personal or {}).get("message", "")

    edu_text = (education or {}).get("text", "")
    nasa_context = NASA_EVIDENCE_CONTEXT.get(metric, edu_text)

    prompt = (
        "Eres el oficial médico virtual y asistente IA de vuelo espacial ASTRA.\n"
        "El astronauta acaba de solicitar un análisis de sus registros de salud o ha confirmado una medición.\n\n"
        f"INDICADOR EVALUADO: {metric}\n"
        f"HISTORIAL Y CÁLCULOS DEL ASTRONAUTA:\n{personal_msg}\n\n"
        f"EVIDENCIA CIENTÍFICA NASA (Human Research Program / OSDR):\n{nasa_context}\n\n"
        "MISIÓN:\n"
        "Genera una recomendación médica y operacional personalizada, humana y basada en la evidencia de la NASA.\n"
        "Toma en cuenta:\n"
        "1. Sus cifras reales (si son altas, normales o bajas; por ejemplo si tiene fiebre o 38.7 °C, abórdalo directamente).\n"
        "2. El fenómeno fisiológico en microgravedad (sobrecalentamiento por falta de convección, redistribución de líquidos, etc.).\n"
        "3. Acciones operacionales concretas para el astronauta en la nave (ventilación de cabina o traje, hidratación con sales/electrolitos, pausas activas, descanso, avisar a control de misión).\n"
        "REGLAS:\n"
        "- NO repitas fríamente los números o fórmulas matemáticas ('con menos de 3 registros...').\n"
        "- NO digas siempre lo mismo: sé perspicaz, empático y profesional.\n"
        "- Extensión: 2 o 3 oraciones concisas y directas en español.\n"
    )

    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": config["model"],
        "messages": [
            {"role": "system", "content": "Eres un asistente médico de vuelo espacial conciso, empático y resolutivo."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(config["url"], headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                reply_text = data["choices"][0]["message"]["content"].strip()
                if reply_text:
                    return reply_text
    except (httpx.HTTPError, ValueError, OSError, json.JSONDecodeError, KeyError) as ex:
        logger.warning("Fallo al generar recomendación de análisis con LLM: %s", ex)

    return generate_deterministic_analysis_recommendation(metric, personal, education)
