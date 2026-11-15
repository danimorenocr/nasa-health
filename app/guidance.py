"""Orientación de bienestar y prevención con fuentes públicas verificadas.

Contenido educativo curado por el equipo, separado de los registros personales
y de cualquier salida de IA. Cada acción declara su contexto de aplicación
(espacio, Tierra o ambos), su evidencia y sus límites. No hay umbrales
clínicos, dosis, ni tratamientos personalizados: eso corresponde al equipo
médico de la misión. Las fechas `reviewed_at` marcan cuándo se revisó cada
fuente; una fuente puede cambiar o quedar obsoleta después.
"""

GUIDANCE_VERSION = "1.0.0"
GUIDANCE_REVIEWED_AT = "2026-11-14"

GUIDANCE_SOURCES = [
    {
        "id": "nasa-hrp-hazards",
        "title": "NASA HRP: los 5 peligros del vuelo espacial tripulado",
        "url": "https://www.nasa.gov/hrp/hazards/",
        "reviewed_at": "2026-11-14",
        "scope": "Marco general de riesgos de la investigación NASA. No interpreta lecturas personales.",
    },
    {
        "id": "nasa-hrr-risks",
        "title": "NASA Human Research Roadmap: registro de riesgos y evidencia",
        "url": "https://humanresearchroadmap.nasa.gov/risks/",
        "reviewed_at": "2026-11-14",
        "scope": "Relaciones generales entre riesgos y evidencia en investigación. No concluye causalidad individual.",
    },
    {
        "id": "nasa-astronaut-exercise",
        "title": "NASA ISS Research: ejercicio de los astronautas (ARED, T2, CEVIS)",
        "url": "https://www.nasa.gov/missions/station/iss-research/astronaut-exercise/",
        "reviewed_at": "2026-11-14",
        "scope": "Describe contramedidas de ejercicio y equipos de la ISS. No es una prescripción personal.",
    },
    {
        "id": "nasa-health-care-faq",
        "title": "NASA: cómo se atiende la salud de los astronautas en el espacio",
        "url": "https://www.nasa.gov/missions/station/faq-the-real-story-about-astronaut-health-care-in-space/",
        "reviewed_at": "2026-11-14",
        "scope": "Organización real de la atención: cirujanos de vuelo, ejercicio programado, línea base y apoyo conductual. No es un protocolo clínico transferible.",
    },
    {
        "id": "nasa-sleep-countermeasures",
        "title": "NASA: siete formas en que los astronautas mejoran el sueño (2016)",
        "url": "https://www.nasa.gov/missions/station/seven-ways-astronauts-improve-sleep-may-help-you-snooze-better-on-earth/",
        "reviewed_at": "2026-11-14",
        "scope": "Contramedidas de sueño y ritmo circadiano usadas por NASA. No valida remedios para una persona concreta.",
    },
    {
        "id": "jaxa-medical-operations",
        "title": "JAXA: operaciones médicas en la ISS (CHeCS, HMS, EHS, CMS)",
        "url": "https://humans-in-space.jaxa.jp/en/biz-lab/med-in-space/healthcare/medops/system/",
        "reviewed_at": "2026-11-14",
        "scope": "Equipos y organización médica de la ISS según JAXA. La lista exacta vigente depende del programa de cada misión.",
    },
    {
        "id": "who-physical-activity-2020",
        "title": "OMS: guías 2020 de actividad física y comportamiento sedentario",
        "url": "https://www.who.int/publications/i/item/9789240015128",
        "reviewed_at": "2026-11-14",
        "scope": "Referencia general de bienestar en la Tierra para adultos sanos. No es una guía de vuelo espacial ni una prescripción individual.",
    },
    {
        "id": "nasa-std-3001-vol2",
        "title": "NASA-STD-3001 Vol. 2 (Rev. F, activa): estándar de sistemas humanos de vuelo espacial",
        "url": "https://standards.nasa.gov/standard/NASA/NASA-STD-3001_VOL_2",
        "reviewed_at": "2026-11-14",
        "scope": "Estándar a nivel de programa (diseño, habitabilidad y salud ambiental). No define triage ni umbrales personales.",
    },
]

HAZARDS = [
    {
        "id": "radiation",
        "name": "Radiación espacial",
        "summary": "Invisible y considerada por NASA uno de los aspectos más peligrosos del vuelo espacial.",
        "source_ids": ["nasa-hrp-hazards"],
    },
    {
        "id": "isolation",
        "name": "Aislamiento y confinamiento",
        "summary": "Respuestas conductuales de grupos que viven lejos de la Tierra en un espacio pequeño por mucho tiempo.",
        "source_ids": ["nasa-hrp-hazards"],
    },
    {
        "id": "distance",
        "name": "Distancia de la Tierra",
        "summary": "Recibir instrucciones, suministros y atención médica se vuelve más difícil cuanto más lejos está la tripulación.",
        "source_ids": ["nasa-hrp-hazards"],
    },
    {
        "id": "gravity",
        "name": "Campos de gravedad",
        "summary": "Músculos, huesos, oído interno y órganos deben ajustarse a cada gravedad: estación, Luna, Marte y el regreso a la Tierra.",
        "source_ids": ["nasa-hrp-hazards"],
    },
    {
        "id": "closed_env",
        "name": "Entornos cerrados u hostiles",
        "summary": "Mantener un ecosistema seguro dentro de la nave: temperatura, presión, iluminación, ruido, microbios y respuestas inmunes.",
        "source_ids": ["nasa-hrp-hazards"],
    },
]

# Medidas preventivas transversales. `context`: space | terrestrial | both.
GENERAL_MEASURES = [
    {
        "id": "exercise-countermeasures",
        "title": "Ejercicio diario como contramedida",
        "context": "space",
        "action": "En la ISS la tripulación sigue planes de ejercicio programados cada día (NASA los programa en torno a 2,5 horas diarias) con tres equipos: ARED (resistencia que simula pesas), la cinta T2 y la bicicleta CEVIS. El objetivo declarado es sostener músculo, hueso, capacidad aeróbica y salud sensomotora.",
        "evidence": "NASA y JAXA documentan el equipamiento y la rutina. NASA también reporta que los resultados varían entre personas y que las contramedidas actuales podrían no bastar en misiones largas: un estudio citado por NASA estima que hasta 17 % de la tripulación podría perder rendimiento muscular, óseo o cardiorrespiratorio si no se refinan.",
        "limits": "No es una prescripción individual: el plan de cada astronauta lo ajustan los especialistas de la misión (ASCR y cirujanos de vuelo).",
        "source_ids": ["nasa-astronaut-exercise", "nasa-health-care-faq", "jaxa-medical-operations"],
    },
    {
        "id": "physical-activity-earth",
        "title": "Actividad física semanal (referencia general en la Tierra)",
        "context": "terrestrial",
        "action": "Referencia OMS 2020 para adultos: al menos 150–300 minutos semanales de actividad moderada (o 75–150 de vigorosa) y fortalecimiento de los grandes grupos musculares 2 o más días por semana.",
        "evidence": "Guías públicas de la OMS sobre actividad física y comportamiento sedentario.",
        "limits": "Referencia poblacional de bienestar, no una prescripción: personas con condiciones de salud deben ajustarla con un profesional. No reemplaza las contramedidas de una misión espacial.",
        "source_ids": ["who-physical-activity-2020"],
    },
    {
        "id": "sleep-schedule",
        "title": "Horario regular de sueño y vigilia",
        "context": "both",
        "action": "NASA programa horarios estrictos de sueño y vigilia antes y durante las misiones, y prepara a la tripulación con días de anticipación cuando habrá un cambio de ritmo circadiano.",
        "evidence": "Primera contramedida de sueño documentada por el equipo de manejo de fatiga de NASA.",
        "limits": "Un horario no garantiza buen sueño por sí solo; el insomnio persistente se consulta con el equipo médico.",
        "source_ids": ["nasa-sleep-countermeasures"],
    },
    {
        "id": "light-management",
        "title": "Gestión de la luz para el ritmo circadiano",
        "context": "both",
        "action": "La ISS ve 16 amaneceres al día; por eso NASA reemplaza la iluminación por paneles (SSLA) que ajustan espectro e intensidad para favorecer alerta o sueño según la hora. En la Tierra, la higiene de sueño incluye minimizar la luz de pantallas por la noche.",
        "evidence": "Documentado por NASA como contramedida no farmacológica, segura y reversible cuando se aplica a tiempo correcto.",
        "limits": "La luz mal programada puede empeorar el desajuste; el ajuste fino en misión corresponde al programa.",
        "source_ids": ["nasa-sleep-countermeasures"],
    },
    {
        "id": "sleep-environment",
        "title": "Ambiente de descanso cuidado",
        "context": "both",
        "action": "Cuartos privados y control de temperatura, iluminación, flujo de aire, ruido y CO2; en la ISS también restricciones para no flotar mientras se duerme.",
        "evidence": "Factores ambientales listados por NASA como parte de sus contramedidas de sueño.",
        "limits": "Astra no mide el ambiente de la cabina; esas lecturas corresponden a los sistemas de la misión (EHS).",
        "source_ids": ["nasa-sleep-countermeasures", "jaxa-medical-operations"],
    },
    {
        "id": "sleep-cbt",
        "title": "Educación de sueño y terapia cognitivo-conductual",
        "context": "both",
        "action": "Educación sobre higiene de sueño y técnicas de terapia cognitivo-conductual (TCC) para manejar los pensamientos que impiden conciliar el sueño.",
        "evidence": "Incluida por NASA entre sus siete contramedidas de sueño para la tripulación.",
        "limits": "La TCC la guía personal entrenado; Astra solo la menciona como opción documentada, no la imparte.",
        "source_ids": ["nasa-sleep-countermeasures"],
    },
    {
        "id": "nutrition-tracking",
        "title": "Nutrición e hidratación supervisadas",
        "context": "space",
        "action": "Los dietistas de NASA definen los nutrientes requeridos y la tripulación registra lo que come cada día en una aplicación; esos datos se revisan semanalmente, junto con análisis de sangre y orina antes, durante y después del vuelo.",
        "evidence": "Descrito por NASA en la organización de su atención de salud.",
        "limits": "Astra no registra comidas ni calcula nutrientes; esta medida se muestra como referencia de cómo opera una misión real.",
        "source_ids": ["nasa-health-care-faq", "jaxa-medical-operations"],
    },
    {
        "id": "social-connection",
        "title": "Contacto social y apoyo conductual",
        "context": "both",
        "action": "Correo, llamadas y videoconferencia con familia y amigos, paquetes de tripulación y teleconferencia con psicólogo si se necesita; NASA también entrena autocuidado y cuidado del equipo.",
        "evidence": "Apoyo psicológico individualizado descrito por NASA como parte estándar de sus misiones.",
        "limits": "Astra no evalúa salud mental ni reemplaza ese apoyo; el aislamiento es un riesgo que el sistema no puede medir con los seis indicadores actuales.",
        "source_ids": ["nasa-health-care-faq", "nasa-hrp-hazards"],
    },
]

# Orientación por indicador. `attention` evita umbrales inventados a propósito:
# el criterio clínico corresponde al protocolo de la misión y al equipo médico.
INDICATOR_GUIDANCE = [
    {
        "code": "heart_rate",
        "name": "Pulso",
        "what": "Latidos por minuto (lpm), declarados con su contexto (en reposo o tras ejercicio).",
        "instruments": [
            "En la ISS: electrocardiógrafo y monitor de presión/ECG del sistema médico (CHeCS); la bicicleta CEVIS muestra la frecuencia cardíaca durante el ejercicio.",
            "En la Tierra: pulsómetro, reloj con sensor o medición manual.",
        ],
        "purpose": "Conocer el patrón personal y notar cambios; junto con los síntomas, ayuda a decidir cuándo consultar.",
        "spaceflight_links": [
            "NASA documenta adaptaciones cardiovasculares del vuelo espacial y riesgo de intolerancia ortostática al volver a la gravedad (relación general en astronautas, no causalidad individual).",
            "El consumo máximo de oxígeno (VO2max) y la capacidad aeróbica disminuyen en vuelos largos según estudios citados por NASA.",
        ],
        "attention": "Busca atención del equipo médico (o del cirujano de vuelo, en una misión) si hay dolor de pecho, falta de aire, desmayo o palpitaciones intensas, o si las lecturas se alejan del patrón personal de forma repetida y sin explicación. Astra no define umbrales: el criterio clínico pertenece al protocolo de la misión.",
        "actions": ["exercise-countermeasures", "physical-activity-earth"],
        "not_shown": "No detecta arritmias ni problemas del corazón, y no sustituye un electrocardiograma interpretado por personal médico.",
        "source_ids": ["jaxa-medical-operations", "nasa-astronaut-exercise", "nasa-cv-risk", "nasa-orthostatic-intolerance"],
    },
    {
        "code": "temperature",
        "name": "Temperatura corporal",
        "what": "Grados Celsius o Fahrenheit declarados (unidades nunca mezcladas).",
        "instruments": [
            "En la ISS: termómetro dentro del instrumental médico a bordo (HMS). NASA además busca formas prácticas de monitorizar la temperatura de forma continua, señal de que hoy es una medición puntual.",
            "En la Tierra: termómetro digital, de oído o de frente.",
        ],
        "purpose": "La fiebre puede ser una señal temprana de infección; en un entorno cerrado y aislado, detectarla pronto importa para toda la tripulación.",
        "spaceflight_links": [
            "Los entornos cerrados u hostiles son uno de los cinco peligros de NASA: incluyen vigilancia de microbios y de las respuestas inmunes de la tripulación.",
            "Antes del lanzamiento la tripulación pasa una cuarentena sanitaria para reducir el riesgo de llevar infecciones a bordo (JAXA).",
        ],
        "attention": "Fiebre persistente o acompañada de otros síntomas (escalofríos, debilidad intensa, confusión) amerita avisar al equipo médico. La app no define qué temperatura es fiebre: ese criterio es clínico.",
        "actions": ["social-connection"],
        "not_shown": "No identifica la causa de una temperatura alta ni distingue infección de otros motivos.",
        "source_ids": ["jaxa-medical-operations", "nasa-hrp-hazards", "nasa-body-temperature-rfi"],
    },
    {
        "code": "blood_pressure",
        "name": "Presión arterial",
        "what": "Sistólica/diastólica en mmHg declaradas por la persona.",
        "instruments": [
            "En la ISS: manguito de presión arterial y monitor combinado presión/ECG del sistema médico (CHeCS).",
            "En la Tierra: tensiómetro de brazo validado.",
        ],
        "purpose": "Seguir la tendencia personal y aportar datos al equipo médico; en vuelo ayuda a vigilar la adaptación cardiovascular.",
        "spaceflight_links": [
            "NASA estudia las adaptaciones cardiovasculares del vuelo y la intolerancia ortostática al regreso (mareo al ponerse de pie), relación general documentada en astronautas.",
        ],
        "attention": "Mareo o desmayo al ponerse de pie, dolor de pecho o lecturas repetidas muy alejadas del patrón personal ameritan aviso al equipo médico. Sin umbrales propios: la interpretación de cifras corresponde al personal médico.",
        "actions": ["exercise-countermeasures", "physical-activity-earth"],
        "not_shown": "No diagnostica hipertensión ni hipotensión; una sola lectura aislada tampoco lo hace un médico.",
        "source_ids": ["jaxa-medical-operations", "nasa-cv-risk", "nasa-orthostatic-intolerance"],
    },
    {
        "code": "oxygen_saturation",
        "name": "Saturación de oxígeno",
        "what": "Porcentaje de saturación de oxígeno en sangre (0–100 %).",
        "instruments": [
            "Pulsioxímetro de dedo, equipo común en medicina aeroespacial; la disponibilidad exacta de cada dispositivo a bordo depende de la configuración médica vigente de la misión.",
        ],
        "purpose": "Vigilar la oxigenación; en contexto de cabina, un cambio puede relacionarse con el ambiente (presión, composición del aire) y no solo con la persona.",
        "spaceflight_links": [
            "NASA documenta el riesgo de salud y desempeño reducidos por hipoxia, ligado a la atmósfera de cabina y a las caminatas espaciales.",
            "El aire de la ISS lo vigila el programa espacial (muestreo y sistemas de soporte vital), no la persona con su pulsioxímetro.",
        ],
        "attention": "Falta de aire, confusión o coloración azulada en labios son motivo de atención inmediata. Una saturación repetidamente distinta a lo habitual amerita aviso al equipo médico. Si varias personas a bordo presentan síntomas a la vez, sospechar del ambiente y avisar de inmediato.",
        "actions": ["sleep-environment"],
        "not_shown": "No mide el CO2 ni la calidad del aire de la cabina, y no identifica la causa de una saturación baja.",
        "source_ids": ["nasa-hypoxia-risk", "jaxa-medical-operations"],
    },
    {
        "code": "glucose",
        "name": "Glucosa",
        "what": "mg/dL o mmol/L declarados, con contexto (en ayunas o tras comer) cuando la persona lo indica.",
        "instruments": [
            "Glucómetro portátil, común en kits médicos. En la ISS existen kits de muestra de sangre y orina cuyo análisis clínico corresponde al programa de la misión.",
        ],
        "purpose": "Aportar antecedentes de energía y metabolismo; útil sobre todo como antecedente y como dato declarado.",
        "spaceflight_links": [
            "Un estudio NASA de 2002 planteó cambios en secreción y sensibilidad a la insulina durante el vuelo espacial: es una hipótesis de investigación, no una guía clínica vigente.",
            "La nutrición en misión se supervisa de cerca (registro diario de ingesta y análisis de muestras), lo que contextualiza la glucosa.",
        ],
        "attention": "Síntomas como temblor, sudoración, confusión o mucha sed y orina frecuente ameritan aviso al equipo médico, igual que valores repetidamente fuera de lo habitual para esa persona. Sin umbrales propios.",
        "actions": ["nutrition-tracking", "physical-activity-earth"],
        "not_shown": "No interpreta diabetes ni ajusta medicación; el contexto (ayunas, comida, ejercicio) cambia por completo la lectura.",
        "source_ids": ["jaxa-medical-operations", "nasa-health-care-faq", "nasa-spaceflight-insulin-2002"],
    },
    {
        "code": "sleep",
        "name": "Sueño declarado",
        "what": "Horas de sueño por noche declaradas por la persona; lo que NO se declara queda como faltante, nunca estimado.",
        "instruments": [
            "Registro declarado (esta aplicación) y los horarios de sueño programados de la misión; en su investigación sobre sueño NASA también usa registros objetivos, pero esa instrumentación no forma parte de este prototipo.",
        ],
        "purpose": "El sueño y el ritmo circadiano sostienen el desempeño y la salud; la pérdida de sueño crónica se asocia a errores y a problemas de salud a largo plazo.",
        "spaceflight_links": [
            "La ISS orbita cada 90 minutos: 16 amaneceres al día desajustan el ritmo circadiano, riesgo documentado por NASA junto con la pérdida de sueño y la sobrecarga de trabajo.",
        ],
        "attention": "Insomnio persistente o somnolencia que interfiere con las tareas amerita hablar con el equipo médico. Los medicamentos para dormir son la última opción documentada por NASA y se prueban en tierra bajo supervisión de cirujanos de vuelo antes de usarse en misión.",
        "actions": ["sleep-schedule", "light-management", "sleep-environment", "sleep-cbt"],
        "not_shown": "Las horas declaradas no miden la calidad del sueño ni detectan trastornos como la apnea.",
        "source_ids": ["nasa-sleep-countermeasures", "nasa-sleep-risk"],
    },
]

# Lo que NO es orientación de bienestar: requiere evaluación del equipo médico.
MEDICAL_ONLY = [
    {
        "title": "Medicamentos, dosis y ayudas para dormir",
        "detail": "Melatonina, cafeína como estrategia de misión, hipnóticos y alertantes: NASA los usa solo cuando las demás opciones no bastan y los prueba en tierra con cada persona bajo supervisión de cirujanos de vuelo. Ninguna dosis se decide con esta aplicación.",
        "source_ids": ["nasa-sleep-countermeasures"],
    },
    {
        "title": "Tratamiento personalizado de cualquier hallazgo",
        "detail": "Interpretar síntomas, diagnosticar y tratar corresponde al equipo médico. La ISS mantiene farmacia y equipo médico a bordo, y si una emergencia lo requiere, la tripulación vuelve a la Tierra en su nave.",
        "source_ids": ["nasa-health-care-faq"],
    },
    {
        "title": "Planes individuales de ejercicio y reacondicionamiento",
        "detail": "Los especialistas de la misión (ASCR) individualizan el ejercicio con pruebas de línea base antes del vuelo y programas de recuperación al regreso. La referencia de actividad de la OMS es general y no sustituye ese trabajo.",
        "source_ids": ["nasa-health-care-faq", "who-physical-activity-2020"],
    },
    {
        "title": "Salud mental evaluada",
        "detail": "El apoyo psicológico en misión lo da un equipo conductual con servicios individualizados. Esta aplicación no evalúa salud mental.",
        "source_ids": ["nasa-health-care-faq"],
    },
]

# Lo que el sistema NO monitorea: riesgos reales fuera de los seis indicadores.
NOT_MONITORED = [
    "Dosis de radiación individual: la vigila el programa de la misión (EHS), no esta app.",
    "Aire, agua y microbios de la cabina: los muestrea y analiza el sistema ambiental de la estación (EHS).",
    "Evaluación validada de salud mental: el aislamiento y la confinación son un riesgo que los seis indicadores no capturan.",
    "Nutrición real: no se registran comidas ni nutrientes.",
    "No hay comunicación conectada con un equipo médico: los avisos de la app no alertan a nadie.",
]

# Cómo responde este módulo a las preguntas del reto NASA Space Apps 2026.
CHALLENGE_QUESTIONS = [
    {
        "question": "¿Qué mediciones se pueden realizar en el espacio?",
        "answer": "La orientación lista, por indicador, los instrumentos documentados en la ISS (electrocardiógrafo, manguito de presión, kits de muestra, equipos de ejercicio con sensores) y las alternativas comunes en la Tierra, con su fuente.",
        "section": "indicators",
    },
    {
        "question": "¿Por qué es necesario un examen?",
        "answer": "Cada indicador declara su propósito. Además, las misiones reales establecen una línea base de salud antes del vuelo y la comparan durante y después; registrar el patrón personal es lo que permite notar cambios.",
        "section": "indicators",
        "source_ids": ["nasa-health-care-faq"],
    },
    {
        "question": "¿Cómo afectan los riesgos de los vuelos espaciales a estos indicadores?",
        "answer": "Los cinco peligros de NASA HRP y los vínculos por indicador describen relaciones generales documentadas en astronautas. Se presentan como relación general, no como causalidad individual.",
        "section": "hazards",
        "source_ids": ["nasa-hrp-hazards", "nasa-hrr-risks"],
    },
    {
        "question": "¿Cuándo podría un resultado requerir la atención de la tripulación o de los médicos de vuelo en tierra?",
        "answer": "Cada indicador lista señales de aviso por síntomas y por alejamiento repetido del patrón personal. No hay umbrales inventados: el criterio clínico pertenece al protocolo de la misión.",
        "section": "indicators",
    },
    {
        "question": "¿Qué medidas se pueden tomar para prevenir una afección crítica de salud?",
        "answer": "Las medidas preventivas con respaldo (ejercicio contramedida, sueño, luz, ambiente, nutrición supervisada, contacto social) declaran su contexto, su evidencia y sus límites, separadas de los tratamientos que requieren evaluación médica.",
        "section": "measures",
    },
]


def build_guidance(extra_sources):
    """Arma la respuesta de /api/v1/guidance.

    `extra_sources` son las fuentes generales del catálogo: varias entradas de
    orientación las citan y deben poder resolverse en la misma respuesta.
    """
    known = {s["id"] for s in extra_sources} | {s["id"] for s in GUIDANCE_SOURCES}
    measures = {m["id"]: m for m in GENERAL_MEASURES}
    indicators = []
    for item in INDICATOR_GUIDANCE:
        missing = [s for s in item["source_ids"] if s not in known]
        if missing:
            raise ValueError(f"Fuentes desconocidas en {item['code']}: {missing}")
        missing_actions = [a for a in item["actions"] if a not in measures]
        if missing_actions:
            raise ValueError(f"Acciones desconocidas en {item['code']}: {missing_actions}")
        indicators.append(dict(item, actions=[measures[a] for a in item["actions"]]))
    return {
        "version": GUIDANCE_VERSION,
        "reviewed_at": GUIDANCE_REVIEWED_AT,
        "intro": "Orientación de bienestar curada por el equipo con fuentes públicas de NASA, JAXA y OMS. Es educativa y general: no es consejo médico validado, no interpreta tus lecturas y no reemplaza al equipo médico de la misión.",
        "challenge_questions": CHALLENGE_QUESTIONS,
        "hazards": HAZARDS,
        "measures": GENERAL_MEASURES,
        "indicators": indicators,
        "medical_only": MEDICAL_ONLY,
        "not_monitored": NOT_MONITORED,
        "sources": GUIDANCE_SOURCES + [s for s in extra_sources if s["id"] not in {g["id"] for g in GUIDANCE_SOURCES}],
        "clinical_assessment": "not_performed",
        "generated_by_ai": False,
    }
