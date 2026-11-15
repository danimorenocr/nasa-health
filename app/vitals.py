"""Calculos deterministas sobre registros confirmados de signos/indicadores puntuales.

No diagnostican ni definen normalidad. Reglas explicitas, iguales para todos los indicadores:

- Cada lectura confirmada es una observacion: varias lecturas el mismo dia son normales y
  NUNCA se descartan ni se etiquetan como conflicto por compartir fecha (no son noches de
  sueño). Se muestran todas, agrupadas por unidad y contexto comparable.
- Las unidades nunca se mezclan ni se convierten: cada unidad forma su propia serie.
- Los contextos no comparables (p. ej. pulso en reposo vs tras ejercicio, glucosa en ayunas vs
  tras comer) se analizan en grupos separados y nunca se comparan entre si. Una palabra clave
  negada ("no estaba en reposo") o ambigua (mezcla reposo y ejercicio) NO clasifica: cae en
  "contexto no clasificado", nunca en un grupo seguro por coincidencia de palabra.
- Los cortes numericos son LIMITES DE PROCESAMIENTO DEL PROTOTIPO, no verdad fisiologica ni
  umbrales clinicos. Una lectura fuera de ellos NO se descarta: se conserva, se excluye solo
  de las cuentas automaticas y se lista como "no procesada, requiere revision". Excepcion de
  escala: una saturacion >100 % supera la propia escala de porcentaje (0-100).
- Las fechas sin registro no se estiman. Con menos de 3 lecturas no se describe un cambio.
"""

from datetime import timedelta, timezone

from .engine import normalize
from .trends import SYNTHETIC_ORIGIN, _h, _parse

MIN_READINGS_FOR_CHANGE = 3

# Negadores que anulan una palabra clave de contexto cercana (hasta 3 palabras antes).
NEGATORS = ("no", "sin", "ni", "nunca", "tampoco")

# Grupos de contexto comparables: (clave, etiqueta, palabras clave en el contexto normalizado).
REST_GROUP = ("rest", "en reposo", ("reposo", "descanso"))
EXERCISE_GROUP = (
    "exercise",
    "tras ejercicio",
    ("ejercicio", "actividad fisica", "entren", "correr", "caminata", "gym", "gimnasio"),
)
FASTING_GROUP = ("fasting", "en ayunas", ("ayunas", "ayuno"))
POST_MEAL_GROUP = (
    "post_meal",
    "tras comer",
    ("tras comer", "despues de comer", "despues del desayuno", "postprandial", "comida"),
)
OTHER_GROUP = ("other", "contexto no clasificado", ())

# Limites de procesamiento del prototipo por unidad (lo, hi): NO son umbrales medicos.
VITAL_SPECS = {
    "heart_rate": {
        "code": "heart_rate",
        "name": "Pulso",
        "units": {"lpm": (0, 300)},
        "value_names": None,
        "groups": [REST_GROUP, EXERCISE_GROUP],
        "education": {
            "source_id": "nasa-cv-risk",
            "text": (
                "NASA indica que la exposición al ambiente del vuelo espacial puede contribuir "
                "al desacondicionamiento cardiovascular y a cambios en la función y estructura "
                "del corazón y los vasos. Las tripulaciones podrían tener el desempeño afectado "
                "y resultados cardiovasculares adversos durante y después del vuelo."
            ),
            "scope": (
                "Explicación general sobre astronautas. El pulso se relaciona con ese sistema, "
                "pero esta fuente no interpreta lecturas personales ni dice qué valor conviene a alguien."
            ),
        },
        "cannot": [
            "La causa de los cambios.",
            "Si un valor es normal o adecuado para esa persona.",
            "Comparaciones entre reposo y ejercicio: solo se comparan registros del mismo contexto.",
            "Ningún diagnóstico ni evaluación médica.",
        ],
    },
    "blood_pressure": {
        "code": "blood_pressure",
        "name": "Presión arterial",
        "units": {"mmHg": (0, 400)},
        "value_names": ("sistólica", "diastólica"),
        "groups": [],
        "education": {
            "source_id": "nasa-orthostatic-intolerance",
            "text": (
                "Un reporte técnico de NASA señala que la intolerancia ortostática después del "
                "vuelo espacial sigue siendo una preocupación: varios astronautas no pudieron "
                "completar una prueba de postura erguida el día del aterrizaje tras meses en el "
                "espacio. Una hipotensión ortostática severa podría afectar la salud de la "
                "tripulación y el éxito de la misión."
            ),
            "scope": (
                "Reporte sobre astronautas al volver a la gravedad. No interpreta cifras "
                "personales de presión arterial ni define rangos normales."
            ),
        },
        "cannot": [
            "La causa de los cambios.",
            "Si una cifra es normal, alta o baja para esa persona.",
            "Cómo respondería la persona al ponerse de pie o al volver a la gravedad.",
            "Ningún diagnóstico ni evaluación médica.",
        ],
    },
    "oxygen_saturation": {
        "code": "oxygen_saturation",
        "name": "Saturación de oxígeno",
        # (0, 100] no es un corte arbitrario: es la escala misma del porcentaje.
        "units": {"%": (0, 100)},
        "value_names": None,
        "groups": [],
        "education": {
            "source_id": "nasa-hypoxia-risk",
            "text": (
                "NASA describe el riesgo de hipoxia: usar una atmósfera de cabina a presión "
                "reducida en ciertas operaciones podría exponer a la tripulación a hipoxia "
                "hipobárica leve, con posibles efectos en la presión intracraneal, la visión, "
                "el desempeño cognitivo, la función sensomotora y la calidad del sueño."
            ),
            "scope": (
                "Trata de la atmósfera de cabina y de las caminatas espaciales, no de la "
                "saturación medida a una persona. No interpreta valores ni da umbrales."
            ),
        },
        "cannot": [
            "La causa de los cambios.",
            "Si un porcentaje es normal o suficiente para esa persona.",
            "La presión de oxígeno del ambiente donde se midió.",
            "Ningún diagnóstico ni evaluación médica.",
        ],
    },
    "temperature": {
        "code": "temperature",
        "name": "Temperatura corporal",
        "units": {"°C": (25, 45), "°F": (77, 113)},
        "value_names": None,
        "groups": [],
        "education": {
            "source_id": "nasa-body-temperature-rfi",
            "text": (
                "NASA busca mejores formas de monitorizar la temperatura corporal de los "
                "astronautas: la evidencia emergente sugiere que puede ser más alta en "
                "microgravedad y subir más rápido durante el ejercicio, y quiere saber si eso "
                "causa molestias o sobrecalentamiento en ejercicio, caminatas espaciales y "
                "aterrizajes."
            ),
            "scope": (
                "Solicitud de investigación basada en evidencia emergente, no una conclusión "
                "establecida. No interpreta tu temperatura ni define qué es fiebre."
            ),
        },
        "cannot": [
            "La causa de los cambios.",
            "Si una temperatura es normal, fiebre o hipotermia para esa persona.",
            "La calidad o el sitio de la medición (oral, axilar, etc.).",
            "Ningún diagnóstico ni evaluación médica.",
        ],
    },
    "glucose": {
        "code": "glucose",
        "name": "Glucosa",
        "units": {"mg/dL": (0, 1000), "mmol/L": (0, 55)},
        "value_names": None,
        "groups": [FASTING_GROUP, POST_MEAL_GROUP],
        "education": {
            "source_id": "nasa-spaceflight-insulin-2002",
            "text": (
                "Un estudio reimpreso en el servidor técnico de NASA (2002) resume décadas de "
                "investigación que sugieren cambios subclínicos en la secreción y sensibilidad "
                "a la insulina y en la tolerancia a la glucosa durante la microgravedad."
            ),
            "scope": (
                "Hipótesis de investigación publicada en 2002, no una guía clínica vigente. "
                "No interpreta cifras personales de glucosa ni define rangos."
            ),
        },
        "cannot": [
            "La causa de los cambios.",
            "Si un valor es normal o adecuado para esa persona.",
            "Comparaciones entre ayunas y después de comer: solo se comparan registros del mismo contexto.",
            "Ningún diagnóstico ni evaluación médica.",
        ],
    },
}


def _keyword_negated(text, start):
    """True si un negador aparece en las 3 palabras anteriores a la palabra clave."""
    before = text[:start].split()
    return any(w in NEGATORS for w in before[-3:])


def _group_of(context, groups):
    """Grupo comparable del contexto. Palabra negada o mezcla ambigua: no clasifica."""
    text = normalize(context)
    matched = set()
    for key, _label, keywords in groups:
        for k in keywords:
            start = text.find(k)
            while start != -1:
                if not _keyword_negated(text, start):
                    matched.add(key)
                    break
                start = text.find(k, start + 1)
    if len(matched) == 1:
        return matched.pop()
    return "other"


def _fmt_values(values, unit, names):
    parts = [_h(v) for v in values]
    joined = "/".join(parts) if names else parts[0]
    return f"{joined} {unit}"


def _processable(values, bounds):
    return all(bounds[0] < v <= bounds[1] for v in values)


def analyze_vital(entries, as_of, days, tz_offset_minutes, spec):
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    today = as_of.astimezone(tz).date()
    start = today - timedelta(days=days - 1)
    per_series = {}  # (unit, group) -> [reading]
    not_processed, ignored_incompatible = [], 0
    synthetic = False
    expected_len = 2 if spec["value_names"] else 1
    for e in entries:
        c = e.candidate
        if c.get("kind") != "measurement" or c.get("metric") != spec["code"]:
            continue
        local = _parse(e.measured_at).astimezone(tz)
        if not (start <= local.date() <= today):
            continue
        unit = c.get("unit")
        values = c.get("values", [])
        if unit not in spec["units"] or len(values) != expected_len:
            ignored_incompatible += 1
            continue
        values = [float(v) for v in values]
        item = {
            "t": e.measured_at,
            "date": local.date().isoformat(),
            "values": values,
            "unit": unit,
            "entry_id": e.id,
        }
        bounds = spec["units"][unit]
        if not _processable(values, bounds):
            if unit == "%" and any(v > 100 for v in values):
                reason = "scale"
                detail = "supera la escala del porcentaje (0-100)"
            else:
                reason = "prototype_limit"
                detail = (
                    f"fuera del intervalo que este prototipo procesa automáticamente "
                    f"({_h(bounds[0])}-{_h(bounds[1])} {unit}); es un límite del prototipo, "
                    "no un criterio médico"
                )
            not_processed.append({**item, "reason": reason, "detail": detail})
            continue
        if spec["value_names"] and values[0] <= values[1]:
            # Pareja que el prototipo no procesa automaticamente; puede ser un dato real
            # capturado en orden distinto o un extremo: se conserva y requiere revision.
            not_processed.append(
                {
                    **item,
                    "reason": "pair_not_processed",
                    "detail": (
                        "la sistólica no supera a la diastólica; el prototipo no procesa "
                        "la pareja automáticamente y requiere revisión"
                    ),
                }
            )
            continue
        if e.origin == SYNTHETIC_ORIGIN:
            synthetic = True
        group = _group_of(e.context, spec["groups"]) if spec["groups"] else "all"
        per_series.setdefault((unit, group), []).append(item)

    series_out = []
    notes = []
    group_labels = {key: label for key, label, _ in spec["groups"]}
    group_labels["other"] = "contexto no clasificado"
    group_labels["all"] = None
    for (unit, group) in sorted(per_series):
        # La consulta ya ordena por instante y desempata por orden de captura (rowid);
        # esta ordenacion estable solo asegura el orden por instante dentro de la serie.
        readings = sorted(per_series[(unit, group)], key=lambda r: r["t"])
        label = group_labels[group]
        head = spec["name"] if label is None else f"{spec['name']} {label}"
        n = len(readings)
        dates = len({r["date"] for r in readings})
        columns = list(zip(*(r["values"] for r in readings)))
        mean = [round(sum(col) / n, 2) for col in columns]
        first, last = readings[0], readings[-1]
        change = (
            [round(l - f, 2) for f, l in zip(first["values"], last["values"])]
            if n >= MIN_READINGS_FOR_CHANGE
            else None
        )
        stats = {
            "mean": mean,
            "min": min(readings, key=lambda r: r["values"][0]),
            "max": max(readings, key=lambda r: r["values"][0]),
            "first": first,
            "last": last,
            "change_last_minus_first": change,
        }
        points = [{"t": r["t"], "date": r["date"], "values": r["values"]} for r in readings]
        summary = (
            f"{head}: {n} registro(s) en {dates} fecha(s) dentro de los últimos {days} días "
            f"(unidad {unit}). Promedio {_fmt_values(mean, unit, spec['value_names'])} "
            f"(mínimo {_fmt_values(stats['min']['values'], unit, spec['value_names'])}, "
            f"máximo {_fmt_values(stats['max']['values'], unit, spec['value_names'])})."
        )
        if change is not None:
            if all(d == 0 for d in change):
                move = "sin diferencia"
            else:
                magnitudes = "/".join(_h(abs(d)) for d in change)
                signs = "/".join("más" if d > 0 else "menos" for d in change)
                move = f"{magnitudes} {unit} {signs}"
            summary += (
                f" El primer registro fue {_fmt_values(first['values'], unit, spec['value_names'])} "
                f"y el último {_fmt_values(last['values'], unit, spec['value_names'])}: {move}."
            )
        else:
            summary += f" Con menos de {MIN_READINGS_FOR_CHANGE} registros no describo un cambio."
        series_out.append(
            {
                "unit": unit,
                "context_group": group,
                "context_label": label,
                "records": n,
                "dates": dates,
                "points": points,
                "stats": stats,
                "summary": summary,
            }
        )
        notes.append(summary)

    if not notes:
        text = f"No hay registros de {spec['name'].lower()} procesables en los últimos {days} días."
    else:
        text = " ".join(notes)
    extra = []
    if not_processed:
        extra.append(
            f"{len(not_processed)} registro(s) no se procesaron automáticamente: se conservan "
            "y quedan listados para revisión (límite del prototipo o de escala, no un juicio médico)."
        )
    if spec["groups"] and any(s["context_group"] == "other" for s in series_out):
        extra.append(
            "Los registros sin un contexto comparable claro se cuentan en su propio grupo y no se mezclan."
        )
    if extra:
        text = text + " " + " ".join(extra)
    if synthetic:
        text = "Datos sintéticos de ejemplo, no son de una persona real. " + text

    return {
        "metric": spec["code"],
        "window": {
            "days": days,
            "from": start.isoformat(),
            "to": today.isoformat(),
            "tz_offset_minutes": tz_offset_minutes,
            "date_basis": "fecha local de la medición declarada",
        },
        "personal_calculation": {
            "message": text,
            "series": series_out,
            "not_processed": not_processed,
            "ignored_incompatible": ignored_incompatible,
        },
        "education": {**spec["education"], "kind": "general_source_explanation"},
        "cannot_conclude": spec["cannot"],
        "synthetic": synthetic,
        "calculation_origin": "deterministic_code",
        "clinical_assessment": "not_performed",
    }


# Series sinteticas de 7 dias, claramente marcadas, una por indicador.
SYNTHETIC_VITALS = {
    "heart_rate": {
        "values": [[72], [74], [71], [75], [73], [78], [80]],
        "unit": "lpm",
        "context": "En reposo. Historial de prueba, no es de una persona real",
        "text": "Pulso {v} lpm en reposo (sintético)",
    },
    "blood_pressure": {
        "values": [[118, 76], [120, 78], [119, 77], [122, 80], [121, 79], [124, 82], [125, 83]],
        "unit": "mmHg",
        "context": "Historial de prueba, no es de una persona real",
        "text": "Presión {v} mmHg (sintético)",
    },
    "oxygen_saturation": {
        "values": [[98], [97], [98], [97], [96], [97], [96]],
        "unit": "%",
        "context": "Historial de prueba, no es de una persona real",
        "text": "Saturación {v} % (sintético)",
    },
    "temperature": {
        "values": [[36.6], [36.7], [36.5], [36.8], [36.9], [37.0], [37.2]],
        "unit": "°C",
        "context": "Historial de prueba, no es de una persona real",
        "text": "Temperatura {v} °C (sintético)",
    },
    "muscle_mass": {
        "values": [[32.1], [32.2], [32.1], [32.3], [32.4], [32.3], [32.5]],
        "unit": "kg",
        "context": "Báscula de composición corporal. Historial de prueba, no es de una persona real",
        "text": "Músculos {v} kg (sintético)",
    },
    "glucose": {
        "values": [[90], [92], [88], [95], [91], [97], [99]],
        "unit": "mg/dL",
        "context": "En ayunas. Historial de prueba, no es de una persona real",
        "text": "Glucosa {v} mg/dL en ayunas (sintético)",
    },
}


def synthetic_payload(metric):
    spec = SYNTHETIC_VITALS[metric]
    out = []
    for values in spec["values"]:
        label = "/".join(_h(v) for v in values)
        out.append(
            {
                "candidate": {
                    "kind": "measurement",
                    "metric": metric,
                    "values": values,
                    "unit": spec["unit"],
                    "original_text": spec["text"].format(v=label),
                },
                "context": spec["context"],
            }
        )
    return out
