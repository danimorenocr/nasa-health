"""Reglas de formato demostrativas, NO algoritmo clínico ni clasificador validado."""

import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta

URGENT_MESSAGE = (
    "Esto podría requerir ayuda urgente. No esperes a completar este registro: contacta al responsable "
    "médico o al servicio de emergencia disponible y sigue el protocolo aprobado para tu ubicación o misión. "
    "Este prototipo no tiene un protocolo de misión cargado y no ha avisado a nadie. No puedo diagnosticarte."
)

METRIC_LABELS = {
    "heart_rate": "pulso",
    "temperature": "temperatura",
    "blood_pressure": "presión arterial",
    "oxygen_saturation": "saturación de oxígeno",
    "glucose": "glucosa",
    "sleep": "sueño",
}

METRIC_EXAMPLES = {
    "heart_rate": "Pulso 82 lpm",
    "temperature": "Temperatura 37,2 °C",
    "blood_pressure": "Presión 120/80 mmHg",
    "oxygen_saturation": "Saturación 98 %",
    "glucose": "Glucosa 95 mg/dL",
    "sleep": "Dormí 7 horas",
}


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


def _get_field(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _format_date(iso_str):
    if not iso_str:
        return "fecha no indicada"
    try:
        clean = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        return dt.strftime("%d/%m/%Y a las %H:%M UTC")
    except (ValueError, TypeError):
        return iso_str


def _format_measurement(cand):
    values = cand.get("values", [])
    unit = cand.get("unit", "")
    parts = []
    for v in values:
        if isinstance(v, float) and v.is_integer():
            parts.append(str(int(v)))
        else:
            parts.append(str(v).replace(".", ","))
    val_str = "/".join(parts)
    return f"{val_str} {unit}".strip()


def handle_memory_query(s, text, entries, matches):
    # 1. Consulta sobre la capacidad de memoria / "¿tienes memoria?"
    if (
        re.search(
            r"\b(tienes memoria|que recuerdas|que sabes de mi|que tienes en memoria|como funciona tu memoria)\b",
            s,
        )
        or s in {"memoria", "recuerdas"}
    ):
        return reply(
            "information",
            "Sí, tengo memoria local en SQLite de los registros y síntomas confirmados en esta sesión. "
            "Puedes preguntarme por tu último registro («¿cuál fue mi último registro?»), por un indicador puntual "
            "(«¿cuál fue mi último pulso?») o pedir un resumen de todo lo guardado («¿qué registros tengo?»).",
        )

    # 2. Consulta sobre un indicador específico (ej. pulso, temperatura, sueño)
    if len(matches) == 1:
        metric = matches[0]
        label = METRIC_LABELS.get(metric, metric)
        metric_entries = [
            e
            for e in (entries or [])
            if (_get_field(e, "candidate") or {}).get("kind") == "measurement"
            and (_get_field(e, "candidate") or {}).get("metric") == metric
        ]
        if not metric_entries:
            return reply(
                "information",
                f"No tienes registros de {label} en la memoria de esta sesión. "
                f"Puedes registrar uno escribiendo, por ejemplo: «{METRIC_EXAMPLES[metric]}».",
            )
        latest = metric_entries[0]
        cand = _get_field(latest, "candidate") or {}
        val_str = _format_measurement(cand)
        origin = _get_field(latest, "origin", "")
        context = _get_field(latest, "context", "")
        orig_part = f" (origen: «{origin}»" + (f", contexto: «{context}»" if context else "") + ")" if origin else ""
        date_str = _format_date(_get_field(latest, "measured_at") or _get_field(latest, "recorded_at"))
        count_part = (
            f" Tienes {len(metric_entries)} registro(s) de {label} en total en esta sesión."
            if len(metric_entries) > 1
            else ""
        )
        return reply(
            "information",
            f"Tu último registro de {label} en memoria es de {val_str}{orig_part}, medido el {date_str}.{count_part}",
        )

    # 3. Consulta sobre múltiples indicadores a la vez
    if len(matches) > 1 and re.search(r"\b(cual|que|como|cuando|ultimo|recuerdas|historial)\b", s):
        answers = []
        for m in matches:
            m_entries = [e for e in (entries or []) if (_get_field(e, "candidate") or {}).get("metric") == m]
            label = METRIC_LABELS.get(m, m)
            if m_entries:
                latest_m = m_entries[0]
                cand = _get_field(latest_m, "candidate") or {}
                date_str = _format_date(_get_field(latest_m, "measured_at") or _get_field(latest_m, "recorded_at"))
                answers.append(f"{label}: {_format_measurement(cand)} ({date_str})")
            else:
                answers.append(f"{label}: sin registros")
        return reply("information", f"En memoria de esta sesión: {'; '.join(answers)}.")

    # 4. Consulta de síntomas
    if re.search(r"\b(sintoma|sintomas)\b", s) and re.search(
        r"\b(ultimo|ultimos|que|cuales|cuantos|recuerdas|registrad|guardad|mis)\b", s
    ):
        symptom_entries = [e for e in (entries or []) if (_get_field(e, "candidate") or {}).get("kind") == "symptom"]
        if not symptom_entries:
            return reply("information", "No tienes síntomas registrados en la memoria de esta sesión.")
        latest = symptom_entries[0]
        cand = _get_field(latest, "candidate") or {}
        date_str = _format_date(_get_field(latest, "measured_at") or _get_field(latest, "recorded_at"))
        origin = _get_field(latest, "origin", "")
        orig_part = f" (origen declarado: «{origin}»)" if origin else ""
        return reply(
            "information",
            f"Tu último síntoma registrado en memoria es «{cand.get('original_text', '')}»{orig_part}, "
            f"guardado el {date_str}. Tienes {len(symptom_entries)} síntoma(s) registrado(s) en esta sesión.",
        )

    # 5. Consulta general del último registro (sin indicador específico)
    if not matches and (
        re.search(
            r"\b(ultimo registro|ultima lectura|ultima medicion|ultimo dato|que fue lo ultimo|lo ultimo que registre|lo ultimo|cual fue mi ultimo)\b",
            s,
        )
        or (
            re.search(r"\b(ultimo|ultima|reciente)\b", s)
            and re.search(r"\b(registro|medicion|lectura|dato|guarde|registre)\b", s)
        )
    ):
        if not entries:
            return reply(
                "information",
                "Aún no tienes registros confirmados en esta sesión. Puedes registrar una medición con su unidad "
                "(por ejemplo: «Pulso 82 lpm») o describir un síntoma y confirmarlo.",
            )
        latest = entries[0]
        cand = _get_field(latest, "candidate") or {}
        date_str = _format_date(_get_field(latest, "measured_at") or _get_field(latest, "recorded_at"))
        origin = _get_field(latest, "origin", "")
        context = _get_field(latest, "context", "")
        orig_part = f" (origen: «{origin}»" + (f", contexto: «{context}»" if context else "") + ")" if origin else ""
        if cand.get("kind") == "measurement":
            m = cand.get("metric")
            label = METRIC_LABELS.get(m, m)
            val_str = _format_measurement(cand)
            return reply(
                "information",
                f"Tu registro confirmado más reciente es de {label}: {val_str}{orig_part}, medido el {date_str}.",
            )
        return reply(
            "information",
            f"Tu registro confirmado más reciente es el síntoma declarado: «{cand.get('original_text', '')}»{orig_part}, "
            f"registrado el {date_str}.",
        )

    # 6. Resumen o recuento de todos los registros en memoria
    if (
        re.search(
            r"\b(que registros tengo|que registros hay|cuales son mis registros|cuantos registros|cuantas mediciones|cuantas lecturas|mis registros|resumen de registros|resumen de datos|que he registrado|que tengo guardado|que datos tengo|ver mis registros|lista de registros)\b",
            s,
        )
        or s in {"registros", "mis registros", "resumen"}
    ):
        if not entries:
            return reply(
                "information",
                "Aún no tienes registros confirmados en esta sesión. Para guardar uno en la memoria local, "
                "escribe una lectura (por ejemplo: «Pulso 82 lpm») o síntoma y confírmalo.",
            )
        counts = defaultdict(int)
        for e in entries:
            cand = _get_field(e, "candidate") or {}
            kind = cand.get("kind")
            if kind == "measurement":
                m = cand.get("metric")
                label = METRIC_LABELS.get(m, m)
                counts[label] += 1
            elif kind == "symptom":
                counts["síntomas"] += 1
        breakdown = ", ".join(
            f"{cnt} de {name}" if name != "síntomas" else f"{cnt} síntoma(s)" for name, cnt in counts.items()
        )
        latest = entries[0]
        cand = _get_field(latest, "candidate") or {}
        date_str = _format_date(_get_field(latest, "measured_at") or _get_field(latest, "recorded_at"))
        if cand.get("kind") == "measurement":
            m = cand.get("metric")
            label = METRIC_LABELS.get(m, m)
            recent_info = f"{label} ({_format_measurement(cand)}) el {date_str}"
        else:
            recent_info = f"síntoma «{cand.get('original_text', '')}» el {date_str}"
        return reply(
            "information",
            f"Tienes {len(entries)} registro(s) confirmado(s) en la memoria de esta sesión: {breakdown}. "
            f"El más reciente es {recent_info}.",
        )

    return None

SPANISH_WORDS_MAP = {
    "cero": 0, "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11, "doce": 12,
    "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16, "diecisiete": 17,
    "dieciocho": 18, "diecinueve": 19, "veinte": 20, "veintiun": 21, "veintiuno": 21,
    "veintiuna": 21, "veintidos": 22, "veintitres": 23, "veinticuatro": 24, "veinticinco": 25,
    "veintiseis": 26, "veintisiete": 27, "veintiocho": 28, "veintinueve": 29, "treinta": 30,
    "cuarenta": 40, "cincuenta": 50, "sesenta": 60, "setenta": 70, "ochenta": 80,
    "noventa": 90, "cien": 100, "ciento": 100, "doscientos": 200, "doscientas": 200,
    "trescientos": 300, "trescientas": 300, "cuatrocientos": 400, "cuatrocientas": 400,
    "quinientos": 500, "quinientas": 500, "seiscientos": 600, "seiscientas": 600,
    "setecientos": 700, "setecientas": 700, "ochocientos": 800, "ochocientas": 800,
    "novecientos": 900, "novecientas": 900, "mil": 1000,
}
TENS_WORDS = {"veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"}
UNITS_WORDS = {"un", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"}


def _words_to_int(words):
    if not words:
        return None
    total = 0
    current = 0
    for w in words:
        if w not in SPANISH_WORDS_MAP:
            return None
        v = SPANISH_WORDS_MAP[w]
        if v == 1000:
            current = max(1, current) * 1000
            total += current
            current = 0
        elif v == 100 and current > 0:
            current *= 100
        else:
            current += v
    return total + current


def _parse_int_phrase(tokens, start_idx):
    i = start_idx
    words = []
    while i < len(tokens):
        w = normalize(tokens[i])
        if w == "y":
            if (
                words
                and words[-1] in TENS_WORDS
                and (i + 1 < len(tokens))
                and normalize(tokens[i + 1]) in UNITS_WORDS
            ):
                i += 1
                continue
            break
        elif w in SPANISH_WORDS_MAP:
            words.append(w)
            i += 1
        else:
            break
    if words:
        val = _words_to_int(words)
        if val is not None:
            return val, i
    return None, start_idx


def _parse_number_at(tokens, start_idx):
    tok = tokens[start_idx]
    if tok.isdigit():
        val1 = int(tok)
        next_idx = start_idx + 1
    else:
        val1, next_idx = _parse_int_phrase(tokens, start_idx)

    if val1 is None:
        return None, start_idx

    # Blood pressure: <num1> sobre <num2>
    if next_idx < len(tokens) and normalize(tokens[next_idx]) == "sobre":
        after_sobre = next_idx + 1
        if after_sobre < len(tokens):
            if tokens[after_sobre].isdigit():
                val2 = int(tokens[after_sobre])
                return f"{val1}/{val2}", after_sobre + 1
            val2, after2 = _parse_int_phrase(tokens, after_sobre)
            if val2 is not None:
                return f"{val1}/{val2}", after2

    # Decimals: <num1> coma/punto/con <num2>
    if next_idx < len(tokens) and normalize(tokens[next_idx]) in {"coma", "punto", "con"}:
        after_dec = next_idx + 1
        if after_dec < len(tokens):
            if tokens[after_dec].isdigit():
                dec_val = tokens[after_dec]
                return f"{val1}.{dec_val}", after_dec + 1
            dec_val, after2 = _parse_int_phrase(tokens, after_dec)
            if dec_val is not None:
                return f"{val1}.{dec_val}", after2

    return str(val1), next_idx


def convert_spanish_spoken_numbers(text):
    token_pattern = r"\d+(?:[.,/]\d+)?|[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9_°%]+(?:/[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9_]+)?|[^\w\s]"
    tokens = re.findall(token_pattern, text)
    result = []
    i = 0
    while i < len(tokens):
        if re.match(r"^\d+[.,/]\d+$", tokens[i]):
            result.append(tokens[i])
            i += 1
            continue

        parsed_str, next_i = _parse_number_at(tokens, i)
        if parsed_str is not None and next_i > i:
            result.append(parsed_str)
            i = next_i
        else:
            result.append(tokens[i])
            i += 1
    return " ".join(result)


def normalize_spoken_units(text):
    s = text
    # Heart rate aliases (explicitly recognizes 'pulsaiones por minuto')
    s = re.sub(
        r"\b(pulsaiones por minuto|pulsaciones por minuto|latidos por minuto)\b",
        "lpm",
        s,
        flags=re.IGNORECASE,
    )
    # Oxygen saturation
    s = re.sub(r"\b(por ciento|porciento|porcentaje)\b", "%", s, flags=re.IGNORECASE)
    # Blood pressure
    s = re.sub(
        r"\b(milimetros de mercurio|milímetros de mercurio|milimetros|milímetros)\b",
        "mmhg",
        s,
        flags=re.IGNORECASE,
    )
    # Temperature
    s = re.sub(
        r"\b(grados centigrados|grados centígrados|centigrados|centígrados|grados celsius|celsius|grados c)\b",
        "°c",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"\b(grados fahrenheit|fahrenheit|grados f)\b",
        "°f",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"\bgrados\b(?!\s*f)",
        "°c",
        s,
        flags=re.IGNORECASE,
    )
    # Glucose
    s = re.sub(
        r"\b(miligramos por decilitro|miligramos sobre decilitro)\b",
        "mg/dl",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"\b(milimoles por litro|milimoles sobre litro)\b",
        "mmol/l",
        s,
        flags=re.IGNORECASE,
    )
    # Sleep
    s = re.sub(r"\b(horas de sueno|horas de sueño|horas de dormir)\b", "h", s, flags=re.IGNORECASE)
    return s


SPANISH_MONTHS = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}

KNOWN_INSTRUMENTS = [
    (r"\box[ií]metro(?: de pulso)?\b", "Oxímetro"),
    (r"\bpuls[oó]metro(?: de dedo)?\b", "Pulsómetro"),
    (r"\btensi[oó]metro(?: de brazo| de muñeca)?\b", "Tensiómetro"),
    (r"\bterm[oó]metro(?: digital)?\b", "Termómetro"),
    (r"\bgluc[oó]metro\b", "Glucómetro"),
    (r"\bapple watch\b", "Apple Watch"),
    (r"\bgarmin\b", "Garmin"),
    (r"\bsmartwatch\b", "Reloj inteligente"),
    (r"\breloj inteligente\b", "Reloj inteligente"),
    (r"\bbanda cardiaca|banda cardíaca\b", "Banda cardíaca"),
]


def extract_origin_info(text):
    origin = None
    span = None
    for pattern, label in KNOWN_INSTRUMENTS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            origin = label
            phrase_regex = rf"(?:(?:lo\s+(?:hice|med[ií])|medid[oa]|tomad[oa])\s+)?(?:con|en|usando|utilizando)\s+(?:(?:un[a]?|1|el|la|mi)\s+)?{pattern[2:-2]}"
            phrase_match = re.search(phrase_regex, text, re.IGNORECASE)
            if phrase_match:
                span = phrase_match.span()
            else:
                span = m.span()
            break
    if not origin:
        gen_match = re.search(
            r"\b(?:(?:lo\s+(?:hice|med[ií])|medid[oa]|tomad[oa])\s+)?(?:con|en|usando|utilizando)\s+(?:(?:un[a]?|1|el|la|mi)\s+)?([a-záéíóúñA-ZÁÉÍÓÚÑ0-9\s-]{3,30}?)(?=\s+(?:y\s+eso|eso\s+fue|el\s+\d|a\s+las?|ayer|hoy|\.)|$)",
            text,
            re.IGNORECASE,
        )
        if gen_match:
            candidate_orig = gen_match.group(1).strip()
            if candidate_orig.lower() not in {
                "lpm",
                "mmhg",
                "celsius",
                "temperatura",
                "pulso",
                "presion",
                "saturacion",
                "glucosa",
                "sueno",
            }:
                origin = candidate_orig.capitalize()
                span = gen_match.span()
    return origin, span


DEFAULT_INSTRUMENTS = {
    "temperature": "Termómetro clínico infrarrojo de cabina",
    "heart_rate": "Pulsioxímetro / Monitor cardíaco de cabina",
    "blood_pressure": "Tensiómetro digital de brazo",
    "oxygen_saturation": "Pulsioxímetro de cabina",
    "glucose": "Glucómetro capilar telemétrico",
    "sleep": "Sensor de biotelemetría de sueño",
}


def extract_time_clause(text):
    time_regex = (
        r"(?:(?:y\s+)?(?:eso\s+fue\s+|fue\s+|a\s+las?|a\s+la))\s+"
        r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|de la mañana|de la tarde|de la noche)\b"
    )
    m = re.search(time_regex, text, re.IGNORECASE)
    if m:
        h = int(m.group(1))
        mi = int(m.group(2)) if m.group(2) else 0
        ampm_str = m.group(3) or ""
        ampm = ampm_str.lower().replace(".", "").replace(" ", "")
        if ("pm" in ampm or "tarde" in ampm or "noche" in ampm) and h < 12:
            h += 12
        elif ("am" in ampm or "mañana" in ampm) and h == 12:
            h = 0
        time_part = f" a las {m.group(1)}{(':' + m.group(2)) if m.group(2) else ''} {ampm_str.upper() if ampm_str else ''}".strip()
        return h, mi, time_part, m.span()
    return None, None, None, None


def extract_datetime_info(text, now=None):
    if now is None:
        now = datetime.now()

    # 1. Fecha explícita con nombre de mes (ej. 13 de noviembre de 2026 a las 11 A.M.)
    date_regex = (
        r"(?:(?:y\s+)?(?:eso\s+fue\s+|fue\s+|el\s+))?"
        r"(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)"
        r"(?:\s+de\s+(\d{4}))?"
        r"(?:\s+(?:a\s+las?|a\s+la)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|de la mañana|de la tarde|de la noche)?)?"
    )
    m = re.search(date_regex, text, re.IGNORECASE)
    if m:
        day = int(m.group(1))
        month_name = m.group(2).lower()
        month = SPANISH_MONTHS.get(month_name, 1)
        year_str = m.group(3)
        year = int(year_str) if year_str else now.year
        hour_str = m.group(4)
        min_str = m.group(5)
        ampm_str = m.group(6)

        hour = now.hour
        minute = now.minute
        spans = [m.span()]

        if hour_str:
            hour = int(hour_str)
            minute = int(min_str) if min_str else 0
            if ampm_str:
                ampm = ampm_str.lower().replace(".", "").replace(" ", "")
                if ("pm" in ampm or "tarde" in ampm or "noche" in ampm) and hour < 12:
                    hour += 12
                elif ("am" in ampm or "mañana" in ampm) and hour == 12:
                    hour = 0
            time_part = f" a las {hour_str}{(':' + min_str) if min_str else ''} {ampm_str.upper() if ampm_str else ''}".strip()
        else:
            th, tmi, tpart, tspan = extract_time_clause(text)
            if th is not None:
                hour, minute, time_part = th, tmi, tpart
                spans.append(tspan)
            else:
                time_part = ""

        suggested_iso = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}"
        year_part = f" de {year}" if year_str else ""
        space_before_time = " " if time_part else ""
        suggested_str = f"{day} de {month_name}{year_part}{space_before_time}{time_part}".strip()
        return suggested_iso, suggested_str, spans

    # 2. Fechas relativas: hoy, ayer, antier, anteayer, esta mañana, esta tarde, esta noche
    rel_regex = (
        r"(?:(?:y\s+)?(?:eso\s+fue\s+|fue\s+|el\s+))?"
        r"\b(hoy|ayer|el día de ayer|antier|anteayer|esta mañana|esta tarde|esta noche)\b"
        r"(?:\s+(?:a\s+las?|a\s+la)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|de la mañana|de la tarde|de la noche)?)?"
    )
    m_rel = re.search(rel_regex, text, re.IGNORECASE)
    if m_rel:
        rel_word = m_rel.group(1).lower()
        hour_str = m_rel.group(2)
        min_str = m_rel.group(3)
        ampm_str = m_rel.group(4)
        spans = [m_rel.span()]

        if "ayer" in rel_word:
            target_date = now - timedelta(days=1)
            display_word = "ayer"
        elif "antier" in rel_word or "anteayer" in rel_word:
            target_date = now - timedelta(days=2)
            display_word = "antier"
        else:
            target_date = now
            display_word = "hoy"

        hour = now.hour
        minute = now.minute

        if hour_str:
            hour = int(hour_str)
            minute = int(min_str) if min_str else 0
            if ampm_str:
                ampm = ampm_str.lower().replace(".", "").replace(" ", "")
                if ("pm" in ampm or "tarde" in ampm or "noche" in ampm) and hour < 12:
                    hour += 12
                elif ("am" in ampm or "mañana" in ampm) and hour == 12:
                    hour = 0
            time_part = f" a las {hour_str}{(':' + min_str) if min_str else ''} {ampm_str.upper() if ampm_str else ''}".strip()
        else:
            th, tmi, tpart, tspan = extract_time_clause(text)
            if th is not None:
                hour, minute, time_part = th, tmi, tpart
                spans.append(tspan)
            elif "mañana" in rel_word:
                hour = 8
                minute = 0
                time_part = " (mañana)"
            elif "tarde" in rel_word:
                hour = 15
                minute = 0
                time_part = " (tarde)"
            elif "noche" in rel_word:
                hour = 20
                minute = 0
                time_part = " (noche)"
            else:
                time_part = ""

        suggested_iso = f"{target_date.year:04d}-{target_date.month:02d}-{target_date.day:02d}T{hour:02d}:{minute:02d}"
        suggested_str = f"{display_word}{time_part}".strip()
        return suggested_iso, suggested_str, spans

    # 3. Solo hora mencionada sin fecha (ej. "a las 11 am")
    th, tmi, tpart, tspan = extract_time_clause(text)
    if th is not None:
        suggested_iso = f"{now.year:04d}-{now.month:02d}-{now.day:02d}T{th:02d}:{tmi:02d}"
        suggested_str = f"hoy {tpart}"
        return suggested_iso, suggested_str, [tspan]

    return None, None, None


def build_confirmation_message(cand, suggested_origin=None, suggested_measured_at_str=None):
    metric = cand.get("metric")
    label = METRIC_LABELS.get(metric, metric)
    val_str = _format_measurement(cand)
    parts = [f"🛰️ ¡Datos recibidos y verificados por el sistema! He identificado tu lectura de {label}: {val_str}."]
    details = []
    if suggested_origin:
        details.append(f"origen detectado: «{suggested_origin}»")
    if suggested_measured_at_str:
        details.append(f"medición: {suggested_measured_at_str}")
    if details:
        parts[0] = f"🛰️ ¡Datos recibidos y verificados por el sistema! He identificado tu lectura de {label}: {val_str} ({', '.join(details)})."
    parts.append("Por protocolo de seguridad de la misión espacial, por favor verifica que las cifras en el formulario coincidan exactamente antes de confirmar tu registro en SQLite local.")
    return " ".join(parts)


def build_batch_confirmation_message(measurements, suggested_origin=None, suggested_measured_at_str=None):
    items = []
    for m in measurements:
        label = METRIC_LABELS.get(m.get("metric"), m.get("metric"))
        items.append(f"{label} ({_format_measurement(m)})")
    summary = ", ".join(items)
    parts = [f"🛰️ ¡Datos recibidos y verificados por el sistema! Se identificaron {len(measurements)} mediciones: {summary}."]
    details = []
    if suggested_origin:
        details.append(f"origen detectado: «{suggested_origin}»")
    if suggested_measured_at_str:
        details.append(f"medición: {suggested_measured_at_str}")
    if details:
        parts[0] = f"🛰️ ¡Datos recibidos y verificados por el sistema! Se identificaron {len(measurements)} mediciones: {summary} ({', '.join(details)})."
    parts.append("Por protocolo de seguridad de la misión espacial, por favor verifica los datos en pantalla e indica el instrumento u origen antes de confirmar tu registro en SQLite local.")
    return " ".join(parts)


DESCRIPTORS = [
    ("blood_pressure", r"presion|tension"),
    ("heart_rate", r"pulso|frecuencia cardiaca|pulsacion|pulsaion|latido|ritmo cardiaco"),
    ("temperature", r"temperatura|fiebre|grados|cent[ií]grad"),
    ("oxygen_saturation", r"saturacion|spo2"),
    ("glucose", r"glucosa|glicemia"),
    ("sleep", r"dormi|sueno|horas de dormir"),
]


def parse_single_measurement_clause(s_clause, original_clause):
    matches = [
        metric
        for metric, pattern in DESCRIPTORS
        if re.search(pattern, s_clause) or re.search(pattern, normalize(original_clause))
    ]
    if len(matches) != 1:
        return None
    metric = matches[0]
    numeric = re.sub(r"(\d),(\d)", r"\1.\2", s_clause.replace("spo2", "saturacion"))
    values = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", numeric)]
    expected = 2 if metric == "blood_pressure" else 1
    if len(values) != expected or re.search(r"-\s*\d", s_clause):
        return {"error": "bad_values", "metric": metric}

    fahrenheit = bool(re.search(r"°\s*f\b|fahrenheit|grados f\b", s_clause))
    celsius = bool(re.search(r"°\s*c\b|celsius|cent[ií]grad|grados c\b", s_clause)) or (
        bool(re.search(r"\bgrados\b", s_clause)) and not fahrenheit
    )
    mg = bool(re.search(r"mg\s*/\s*dl\b", s_clause))
    mmol = bool(re.search(r"mmol\s*/\s*l\b", s_clause))
    if (metric == "temperature" and celsius and fahrenheit) or (metric == "glucose" and mg and mmol):
        return {"error": "conflict_units", "metric": metric}

    unit = None
    if metric == "heart_rate" and re.search(r"\b(lpm|bpm)\b|latidos por minuto", s_clause):
        unit = "lpm"
    elif metric == "temperature":
        unit = "°C" if celsius else "°F" if fahrenheit else None
    elif metric == "blood_pressure" and re.search(r"\bmmhg\b", s_clause):
        unit = "mmHg"
    elif metric == "oxygen_saturation" and re.search(r"%|por ciento", s_clause):
        unit = "%"
    elif metric == "glucose":
        unit = "mg/dL" if mg else "mmol/L" if mmol else None
    elif metric == "sleep" and re.search(r"\b(h|horas?)\b", s_clause):
        unit = "h"

    if not unit:
        return {"error": "missing_unit", "metric": metric}

    return {
        "kind": "measurement",
        "metric": metric,
        "values": values,
        "unit": unit,
        "original_text": original_clause.strip(),
    }


def interpret(text, entries=None):
    text = text.strip()
    full_s_raw = normalize(text)
    if re.search(
        r"pecho|respir|falta (?:el )?aire|desmay|inconscien|sangrado|hemorrag|suicid|matarme|no quiero vivir",
        full_s_raw,
    ):
        return reply("safety_notice", URGENT_MESSAGE)
    if re.search(r"\b(co2|cabina|dioxido|radiacion)\b", full_s_raw):
        return reply(
            "information",
            "Las condiciones de cabina se registran por separado. No las convierto "
            "en diagnóstico ni criterio de triage personal. Esta versión registra indicadores personales.",
        )
    if re.search(r"\b(mide|mideme|escan|camara|escuch|microfono)\b", full_s_raw):
        return reply(
            "information",
            "No puedo medir por texto, voz o cámara. Escribe la lectura real de un "
            "instrumento y su unidad, y confirma después el origen.",
        )
    if re.search(r"dosis|medicamento|medicina|diagnost|receta|que (?:me )?tomo|tengo una enfermedad", full_s_raw):
        return reply(
            "information",
            "No doy diagnósticos, dosis ni tratamientos. Se requiere contenido clínico "
            "revisado y el protocolo aprobado de la misión; no están cargados en esta versión.",
        )

    # 1. Detectar origen / instrumento y fecha / hora de la medición en el texto
    suggested_origin, orig_span = extract_origin_info(text)
    suggested_iso, suggested_str, dt_span = extract_datetime_info(text)

    # Limpiar fecha y origen del texto que busca mediciones numéricas para que números de fecha
    # (ej. 13 de noviembre, año 2026, hora 11, '1 oximetro') no interfieran en los valores del indicador
    metric_text = text
    spans = []
    if orig_span:
        spans.append(orig_span)
    if dt_span:
        if isinstance(dt_span, list):
            spans.extend(dt_span)
        else:
            spans.append(dt_span)
    spans.sort(key=lambda x: x[0], reverse=True)
    for start, end in spans:
        metric_text = metric_text[:start] + " " + metric_text[end:]
    metric_text = " ".join(metric_text.split())

    s_raw = normalize(metric_text)

    # Normalizar unidades habladas y números hablados en español
    s_spoken = normalize_spoken_units(s_raw)
    s = convert_spanish_spoken_numbers(s_spoken).lower()

    matches = [
        metric
        for metric, pattern in DESCRIPTORS
        if re.search(pattern, s) or re.search(pattern, s_raw)
    ]

    # 2. Detección de consulta a la memoria / historial
    query_pattern = (
        r"\b(memoria|recuerdas?|guardad[ao]s?|almacenad[ao]s?|historial|historico|resumen|"
        r"cuant[ao]s?|que registros|cuales registros|mis registros|que datos|mis datos|"
        r"que he registrado|que guarde|que registre|que tengo guardado|"
        r"ultim[oa]s?|reciente|anterior|previo|"
        r"cual fue|cual es|que fue|como estuv|como est|cuando fue|cuanto fue|cuanto dormi|"
        r"cuantas horas|he registrado|tengo registros?|hay registros?)\b|\?"
    )
    is_query = bool(re.search(query_pattern, s_raw)) or s_raw in {
        "memoria",
        "recuerdas",
        "registros",
        "mis registros",
        "resumen",
    }
    if is_query:
        has_question_words = bool(
            re.search(
                r"\b(cual|que|como|cuando|cuanto|cuanta|recuerdas|tienes|historial|resumen|ultimo|ultima)\b|\?",
                s_raw,
            )
        )
        if not re.search(r"\d", s) or has_question_words:
            mem_reply = handle_memory_query(s_raw, text, entries, matches)
            if mem_reply is not None:
                return mem_reply

    # 3. Intento de extracción multi-métrica (ej. si el audio dice pulso X y temperatura Y)
    if len(matches) > 1:
        clause_split = r"(?<=[^\d/])\s+y\s+|(?<!\d)\s*,\s*|\s*,\s*(?!\d)|\s*;\s*|\s+ademas\s+|\s+e\s+"
        text_num = convert_spanish_spoken_numbers(text)
        raw_clauses = [
            c.strip()
            for c in re.split(clause_split, text_num, flags=re.IGNORECASE)
            if c.strip()
        ]
        s_clauses = [
            c.strip()
            for c in re.split(clause_split, s)
            if c.strip()
        ]
        if len(s_clauses) > 1:
            if len(raw_clauses) != len(s_clauses):
                raw_clauses = s_clauses
            parsed_clauses = [
                parse_single_measurement_clause(sc, rc) for sc, rc in zip(s_clauses, raw_clauses)
            ]
            active_results = [p for p in parsed_clauses if p is not None]
            # Si alguna cláusula relevante falló con error de unidad o valor:
            missing_errors = [p for p in active_results if p.get("error") == "missing_unit"]
            conflict_errors = [p for p in active_results if p.get("error") == "conflict_units"]
            bad_val_errors = [p for p in active_results if p.get("error") == "bad_values"]
            if conflict_errors:
                return reply("needs_clarification", "Hay dos unidades. Envía una sola lectura con una única unidad.")
            if missing_errors:
                metric_err = missing_errors[0]["metric"]
                label_err = METRIC_LABELS.get(metric_err, metric_err)
                return reply(
                    "needs_clarification",
                    f"Falta una unidad compatible para {label_err}. Especifica lpm, "
                    "°C/°F, mmHg, %, mg/dL, mmol/L o horas según el indicador. No asumo unidades.",
                )
            if bad_val_errors:
                return reply(
                    "needs_clarification",
                    "No pude separar una lectura inequívoca. Escribe indicador, "
                    "valor y unidad (por ejemplo, presión 120/80 mmHg). No he guardado nada.",
                )

            valid_measurements = [p for p in active_results if p.get("kind") == "measurement"]
            if len(valid_measurements) > 1:
                batch_origin = suggested_origin or "Instrumentos de cabina"
                now_fallback = datetime.now().strftime("%Y-%m-%dT%H:%M")
                for m in valid_measurements:
                    m["suggested_origin"] = suggested_origin or DEFAULT_INSTRUMENTS.get(m.get("metric"), "Instrumento declarado")
                    m["suggested_measured_at"] = suggested_iso or now_fallback
                cand = {"kind": "batch", "measurements": valid_measurements, "original_text": text}
                cand["suggested_origin"] = batch_origin
                cand["suggested_measured_at"] = suggested_iso or now_fallback
                msg = build_batch_confirmation_message(valid_measurements, batch_origin, suggested_str)
                return reply("needs_confirmation", msg, cand)
            if len(valid_measurements) == 1:
                cand = valid_measurements[0]
                cand["original_text"] = text
                origin_final = suggested_origin or DEFAULT_INSTRUMENTS.get(cand.get("metric"), "Instrumento declarado")
                cand["suggested_origin"] = origin_final
                cand["suggested_measured_at"] = suggested_iso or datetime.now().strftime("%Y-%m-%dT%H:%M")
                msg = build_confirmation_message(cand, origin_final, suggested_str)
                return reply("needs_confirmation", msg, cand)

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
        fahrenheit = bool(re.search(r"°\s*f\b|fahrenheit|grados f\b", s))
        celsius = bool(re.search(r"°\s*c\b|celsius|cent[ií]grad|grados c\b", s)) or (
            bool(re.search(r"\bgrados\b", s)) and not fahrenheit
        )
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
        cand = {
            "kind": "measurement",
            "metric": metric,
            "values": values,
            "unit": unit,
            "original_text": text,
        }
        origin_final = suggested_origin or DEFAULT_INSTRUMENTS.get(metric, "Instrumento declarado")
        cand["suggested_origin"] = origin_final
        cand["suggested_measured_at"] = suggested_iso or datetime.now().strftime("%Y-%m-%dT%H:%M")
        msg = build_confirmation_message(cand, origin_final, suggested_str)
        return reply("needs_confirmation", msg, cand)
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


