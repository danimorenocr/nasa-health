"""Calculos deterministas sobre registros confirmados de signos/indicadores puntuales.

No diagnostican ni definen normalidad. Reglas explicitas, iguales para todos los indicadores:

- Cada registro se asigna a la fecha local de su medicion (measured_at, con tz_offset_minutes).
- Las unidades nunca se mezclan ni se convierten: cada unidad forma su propia serie.
- Los contextos no comparables (p. ej. pulso en reposo vs tras ejercicio, glucosa en ayunas vs
  tras comer) se analizan en grupos separados y nunca se comparan entre si. Un contexto libre
  que no encaja en un grupo definido queda en "contexto no clasificado".
- Misma fecha y unidad con valores identicos: duplicado, cuenta una vez. Con valores distintos:
  conflicto, esa fecha queda fuera de las cuentas del grupo y se lista. Nunca se suman ni se
  promedian entre si.
- Valores imposibles como lectura del indicador (rangos de validacion de datos, NO umbrales
  clinicos) se excluyen y se listan.
- Las fechas sin registro no se estiman. Con menos de 3 fechas no se describe un cambio.
"""

from datetime import timedelta, timezone

from .engine import normalize
from .trends import SYNTHETIC_ORIGIN, _h, _parse

MIN_DATES_FOR_CHANGE = 3

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

VITAL_SPECS = {
    "heart_rate": {
        "code": "heart_rate",
        "name": "Pulso",
        "units": {"lpm": (0, 300)},  # validacion de lectura imposible, no umbral clinico
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
        "units": {"mmHg": (0, 400)},  # validacion de lectura imposible por componente
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
        "units": {"%": (0, 100)},  # por encima de 100 % es imposible como porcentaje
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
        # Intervalos compatibles con una temperatura corporal medida a una persona; fuera de
        # ellos se asume error de captura. No son umbrales de fiebre ni de salud.
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
        # Limites de lectura imposible/absurda por unidad, no umbrales clinicos.
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


def _group_of(context, groups):
    text = normalize(context)
    for key, _label, keywords in groups:
        if any(k in text for k in keywords):
            return key
    return "other"


def _fmt_values(values, unit, names):
    parts = [_h(v) for v in values]
    if names:
        joined = "/".join(parts)
    else:
        joined = parts[0]
    return f"{joined} {unit}"


def _valid(values, bounds):
    return all(bounds[0] < v <= bounds[1] for v in values)


def analyze_vital(entries, as_of, days, tz_offset_minutes, spec):
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    today = as_of.astimezone(tz).date()
    start = today - timedelta(days=days - 1)
    per_series = {}  # (unit, group) -> {date: [item]}
    conflicts, invalid, other_metrics_ignored = [], [], 0
    duplicates = 0
    synthetic = False
    expected_len = 2 if spec["value_names"] else 1
    for e in entries:
        c = e.candidate
        if c.get("kind") != "measurement":
            continue
        if c.get("metric") != spec["code"]:
            continue
        local = _parse(e.measured_at).astimezone(tz)
        if not (start <= local.date() <= today):
            continue
        unit = c.get("unit")
        values = c.get("values", [])
        if unit not in spec["units"] or len(values) != expected_len:
            other_metrics_ignored += 1
            continue
        values = [float(v) for v in values]
        item = {"date": local.date().isoformat(), "values": values, "entry_id": e.id}
        if not _valid(values, spec["units"][unit]):
            invalid.append(item)
            continue
        if spec["value_names"] and values[0] <= values[1]:
            # Sistolica debe superar a diastolica; si no, la captura es incoherente.
            invalid.append(item)
            continue
        if e.origin == SYNTHETIC_ORIGIN:
            synthetic = True
        group = _group_of(e.context, spec["groups"]) if spec["groups"] else "all"
        per_series.setdefault((unit, group), {}).setdefault(item["date"], []).append(item)

    series_out = []
    notes = []
    group_labels = {key: label for key, label, _ in spec["groups"]}
    group_labels["other"] = "contexto no clasificado"
    group_labels["all"] = None
    for (unit, group) in sorted(per_series):
        by_date = per_series[(unit, group)]
        points = []
        for date in sorted(by_date):
            items = by_date[date]
            distinct = {tuple(i["values"]) for i in items}
            if len(distinct) == 1:
                duplicates += len(items) - 1
                points.append({"date": date, "values": items[0]["values"]})
            else:
                conflicts.append(
                    {
                        "date": date,
                        "unit": unit,
                        "context_group": group,
                        "values": sorted(list(v) for v in distinct),
                    }
                )
        label = group_labels[group]
        head = spec["name"] if label is None else f"{spec['name']} {label}"
        if not points:
            series_out.append(
                {
                    "unit": unit,
                    "context_group": group,
                    "context_label": label,
                    "records": 0,
                    "dates": 0,
                    "points": [],
                    "stats": None,
                    "summary": f"{head}: sin registros válidos en la ventana (solo conflictos o excluidos).",
                }
            )
            continue
        n = len(points)
        columns = list(zip(*(p["values"] for p in points)))
        mean = [round(sum(col) / n, 2) for col in columns]
        first, last = points[0], points[-1]
        change = (
            [round(l - f, 2) for f, l in zip(first["values"], last["values"])]
            if n >= MIN_DATES_FOR_CHANGE
            else None
        )
        stats = {
            "mean": mean,
            "min": min(points, key=lambda p: p["values"][0]),
            "max": max(points, key=lambda p: p["values"][0]),
            "first": first,
            "last": last,
            "change_last_minus_first": change,
        }
        summary = (
            f"{head}: registros en {n} de los últimos {days} días (unidad {unit}). "
            f"Promedio {_fmt_values(mean, unit, spec['value_names'])} "
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
            summary += f" Con menos de {MIN_DATES_FOR_CHANGE} fechas no describo un cambio."
        series_out.append(
            {
                "unit": unit,
                "context_group": group,
                "context_label": label,
                "records": n,
                "dates": n,
                "points": points,
                "stats": stats,
                "summary": summary,
            }
        )
        notes.append(summary)

    if not notes:
        text = f"No hay registros de {spec['name'].lower()} válidos y confirmados en los últimos {days} días."
    else:
        text = " ".join(notes)
    extra = []
    if conflicts:
        extra.append(
            f"{len(conflicts)} fecha(s) con valores distintos quedaron fuera para no mezclarlos."
        )
    if invalid:
        extra.append(f"{len(invalid)} registro(s) imposibles como lectura se excluyeron.")
    if spec["groups"] and any(s["context_group"] == "other" for s in series_out):
        extra.append(
            "Los registros sin un contexto comparable se cuentan en su propio grupo y no se mezclan."
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
            "conflicting_dates": conflicts,
            "duplicates_collapsed": duplicates,
            "invalid_excluded": invalid,
            "ignored_incompatible": other_metrics_ignored,
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
