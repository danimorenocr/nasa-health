# Orientación de bienestar y prevención (`/api/v1/guidance`)

Contenido educativo curado por el equipo, servido desde `app/guidance.py` y mostrado en la página "Wellness Guide" del front. Responde en producto a las cinco preguntas del reto NASA Space Apps 2026 (Health Monitoring Software) y separa tres cosas que no deben mezclarse:

1. **Medidas preventivas con respaldo** (`measures`): cada una declara acción, contexto de aplicación (`space`, `terrestrial` o `both`), evidencia, límites y fuentes. Las de la Tierra (p. ej. la referencia de actividad física de la OMS) nunca se presentan como protocolo de vuelo.
2. **Orientación por indicador** (`indicators`): qué mide, con qué instrumentos documentados (ISS y Tierra), para qué sirve, cómo se relaciona con los riesgos espaciales (relación general documentada, no causalidad individual), señales de aviso sin umbrales inventados, y qué NO muestra.
3. **Lo que requiere evaluación médica** (`medical_only`): medicamentos y dosis, tratamiento personalizado, planes individuales de ejercicio y salud mental evaluada. Ninguno se automatiza ni se sugiere desde la app.

## Preguntas del reto cubiertas

| Pregunta del reto | Dónde se responde |
|---|---|
| ¿Qué mediciones se pueden realizar en el espacio? | `indicators[].instruments` (equipos CHeCS/HMS documentados por JAXA y NASA) |
| ¿Por qué es necesario un examen? | `indicators[].purpose` + línea base pre-vuelo (FAQ de NASA) |
| ¿Cómo afectan los riesgos espaciales a los indicadores? | `hazards` + `indicators[].spaceflight_links` (HRP, HRR) |
| ¿Cuándo requiere atención de la tripulación o de médicos en tierra? | `indicators[].attention` (señales por síntomas y cambios de patrón, sin cifras de corte propias) |
| ¿Qué medidas previenen una afección crítica? | `measures` (con contexto, evidencia y límites) |

## Reglas editoriales del contenido

- Toda afirmación lleva `source_ids` resolubles en `sources` (URL, `reviewed_at`, `scope`). La prueba `tests/test_guidance.py` lo exige.
- Sin umbrales clínicos, sin "normal/anormal", sin dosis ni tratamientos. `clinical_assessment: not_performed` y `generated_by_ai: false` van en la respuesta.
- Una relación riesgo-indicador documentada en astronautas se describe como general; nunca como causalidad sobre la lectura de una persona.
- Lo que el sistema no cubre (radiación, ambiente de cabina, salud mental validada, nutrición, canal médico) está explícito en `not_monitored`.
- El checklist histórico de kit médico de 2001 que circula en nasa.gov NO se usa como fuente: es un documento de su época, no una configuración vigente. La referencia de equipos es la página de operaciones médicas de JAXA.
- Las fuentes pueden quedar obsoletas: cada una lleva su fecha de revisión y su alcance.

## Actualizar el contenido

Editar `app/guidance.py`, verificar la URL de cada fuente nueva, ajustar `reviewed_at` y correr `pytest tests/test_guidance.py` (valida cobertura de los seis indicadores, fuentes resolubles y ausencia de umbrales). Regenerar `openapi.json` si cambia la superficie del endpoint.
