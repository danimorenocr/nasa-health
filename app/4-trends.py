"""Calculos deterministas sobre registros confirmados de sueño. No diagnostican ni definen normalidad.

Reglas explicitas:
- Cada registro se asigna a la fecha local de su medicion (measured_at, con el desfase tz_offset_minutes).
  Esa fecha es la de captura: puede ser la manana despues de dormir, no una "noche" verificada.
- Un contexto que menciona siesta/nap se cuenta aparte y no entra en las noches.
- Misma fecha con valores identicos: duplicado, se cuenta una vez. Valores distintos: conflicto,
  esa fecha queda fuera de las cuentas y se lista. Nunca se suman ni se promedian entre si.
- Valores fuera de 0-24 h son imposibles como duracion diaria: se excluyen y se listan.
- Las fechas sin registro no se estiman.
"""

from datetime import datetime, timedelta, timezone

from .engine import normalize

SYNTHETIC_ORIGIN = "SINTÉTICO - datos de ejemplo"
MIN_NIGHTS_FOR_CHANGE = 3

EDUCATION = {
    "source_id": "nasa-sleep-risk",
    "text": (
        "NASA indica que el desempeño de los astronautas depende de dormir suficiente y con buena calidad. "
        "La experiencia en vuelo muestra que la falta de sueño es común y que hay alteraciones del ritmo "
        "circadiano; juntas llevan a fatiga y errores en las tareas. También señala que factores del "
        "ambiente, como ruido, temperatura, vibración y luz, dificultan dormir en el espacio."
    ),
    "scope": (
        "Explicación general sobre astronautas. No evalúa a la persona que registró las cifras "
        "ni define cuántas horas son suficientes."
    ),
}

CANNOT_CONCLUDE = [
    "La causa de los cambios.",
    "La calidad del sueño: solo hay horas declaradas, no mediciones de un instrumento.",
    "Si las horas son suficientes o normales para esa persona.",
    "Ningún diagnóstico ni evaluación médica.",
]


def _h(x):
    text = f"{x:.1f}".rstrip("0").rstrip(".") if abs(x - round(x)) > 1e-9 else str(round(x))
    return text.replace(".", ",")


def _parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def analyze_sleep(entries, as_of, days, tz_offset_minutes=0):
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    today = as_of.astimezone(tz).date()
    start = today - timedelta(days=days - 1)
    by_date, naps, invalid, ignored_units = {}, [], [], 0
    synthetic = False
    for e in entries:
        c = e.candidate
        if c.get("kind") != "measurement" or c.get("metric") != "sleep":
            continue
        local = _parse(e.measured_at).astimezone(tz)
        if not (start <= local.date() <= today):
            continue
        if c.get("unit") != "h" or len(c.get("values", [])) != 1:
            ignored_units += 1
            continue
        value = float(c["values"][0])
        item = {"date": local.date().isoformat(), "hours": value, "entry_id": e.id}
        if not 0 < value <= 24:
            invalid.append(item)
            continue
        if e.origin == SYNTHETIC_ORIGIN:
            synthetic = True
        if "siesta" in normalize(e.context) or "nap" in normalize(e.context).split():
            naps.append(item)
        else:
            by_date.setdefault(item["date"], []).append(item)
    nights, conflicts, duplicates = [], [], 0
    for date in sorted(by_date):
        items = by_date[date]
        values = {i["hours"] for i in items}
        if len(values) == 1:
            duplicates += len(items) - 1
            nights.append({"date": date, "hours": items[0]["hours"]})
        else:
            conflicts.append({"date": date, "values": sorted(values)})
    all_dates = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    seen = set(by_date)
    missing = [d for d in all_dates if d not in seen]
    n = len(nights)
    stats = None
    if n:
        hs = [x["hours"] for x in nights]
        lo = min(nights, key=lambda x: x["hours"])
        hi = max(nights, key=lambda x: x["hours"])
        stats = {
            "mean_hours": round(sum(hs) / n, 2),
            "min": lo,
            "max": hi,
            "first": nights[0],
            "last": nights[-1],
            "change_last_minus_first_hours": round(nights[-1]["hours"] - nights[0]["hours"], 2)
            if n >= MIN_NIGHTS_FOR_CHANGE
            else None,
        }
    if n == 0:
        text = f"No hay registros de sueño válidos y confirmados en los últimos {days} días."
    else:
        text = (
            f"Hay registros en {n} de los últimos {days} días. Promedio: {_h(stats['mean_hours'])} h "
            f"(mínimo {_h(stats['min']['hours'])} h, máximo {_h(stats['max']['hours'])} h)."
        )
        if n >= MIN_NIGHTS_FOR_CHANGE:
            f, la, d = stats["first"]["hours"], stats["last"]["hours"], stats["change_last_minus_first_hours"]
            move = "sin diferencia" if d == 0 else f"{_h(abs(d))} h {'más' if d > 0 else 'menos'}"
            text += f" El primer registro fue de {_h(f)} h y el último de {_h(la)} h: {move}."
        else:
            text += f" Con menos de {MIN_NIGHTS_FOR_CHANGE} registros no describo un cambio."
        if missing:
            text += f" Faltan {len(missing)} fechas sin registro; no las estimo."
        if conflicts:
            text += f" {len(conflicts)} fecha(s) con valores distintos quedaron fuera para no mezclarlos."
    if synthetic:
        text = "Datos sintéticos de ejemplo, no son de una persona real. " + text
    return {
        "metric": "sleep",
        "window": {
            "days": days,
            "from": start.isoformat(),
            "to": today.isoformat(),
            "tz_offset_minutes": tz_offset_minutes,
            "date_basis": "fecha local de la medición declarada (captura), no verificada como noche",
        },
        "personal_calculation": {
            "message": text,
            "nights_recorded": n,
            "days_in_window": days,
            "coverage": round(n / days, 2),
            "nights": nights,
            "stats": stats,
            "missing_dates": missing,
            "conflicting_dates": conflicts,
            "duplicates_collapsed": duplicates,
            "naps_excluded": naps,
            "invalid_excluded": invalid,
            "ignored_other_units": ignored_units,
        },
        "education": {**EDUCATION, "kind": "general_source_explanation"},
        "cannot_conclude": CANNOT_CONCLUDE,
        "synthetic": synthetic,
        "calculation_origin": "deterministic_code",
        "clinical_assessment": "not_performed",
    }
