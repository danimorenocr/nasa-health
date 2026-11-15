# API v0.2

Base local: `http://127.0.0.1:8000`. Contrato generado con esquemas de entrada y respuestas principales: `/openapi.json`; explorador `/docs`. Errores `{ "detail": "..." }` en español. No hay compatibilidad automática con los nombres camelCase de la primera base TypeScript.

| Método | Ruta | Autorización | Función |
|---|---|---|---|
| GET | `/health` | No | Disponibilidad técnica y SQLite |
| GET | `/api/v1/capabilities` | No | Capacidades/fuentes/límites reales |
| GET | `/api/v1/indicators` | No | Indicadores, unidades y ejemplos |
| GET | `/api/v1/guidance` | No | Orientación de bienestar con fuentes, límites y preguntas del reto |
| POST | `/api/v1/sessions` | No | Token temporal aleatorio |
| GET | `/api/v1/session` | Bearer | Comprobar/reanudar sesión |
| POST | `/api/v1/messages` | Bearer | Interpretar texto y proponer revisión |
| POST | `/api/v1/confirmations` | Bearer | Confirmar candidato vigente |
| DELETE | `/api/v1/pending` | Bearer | Descartar candidato |
| GET | `/api/v1/entries?limit=100&offset=0` | Bearer | Registro paginado, últimos primero |
| GET | `/api/v1/history?metric=heart_rate&days=30` | Bearer | Serie cronológica por unidad |
| GET | `/api/v1/analysis/{metric}?days=7&tz_offset_minutes=-300` | Bearer | Cálculos + explicación con fuente, separados |
| POST | `/api/v1/synthetic/{metric}` | Bearer | Carga 7 días de datos ficticios marcados |
| GET | `/api/v1/export` | Bearer | Todos los registros, fuentes y límites |
| DELETE | `/api/v1/session` | Bearer | Eliminar sesión y registros |
| GET | `/api/v1/safety` | No | Aviso genérico, sin protocolo ni envío |
| GET | `/api/v1/research/studies` | No | Copias locales de estudios públicos |
| GET | `/api/v1/research/studies/OSD-656` | No | Estudio público: caché o consulta NASA |

`Authorization: Bearer TOKEN`. Crear sesión devuelve `token`, `storage: sqlite`, `expires_after_idle_hours: 720` y `expires_after_idle_days: 30` (configurable con `SESSION_TTL_DAYS`, 1–365). La identidad es la posesión del token; no es login de una persona.

## Análisis de indicadores (v0.3)

`GET /api/v1/analysis/{metric}` acepta `sleep`, `heart_rate`, `blood_pressure`, `oxygen_saturation`, `temperature` y `glucose` (sesión requerida; `days` 1–90). Devuelve `personal_calculation` (cuentas por código), `education` (fuente aparte de los cálculos), `cannot_conclude`, `synthetic` y `clinical_assessment: not_performed`. Otro código da 422.

Reglas comunes a todos los indicadores: cada registro se asigna a la fecha local de su `measured_at`; las unidades nunca se mezclan ni se convierten (°C y °F, mg/dL y mmol/L son series separadas); varias lecturas el mismo día son normales y se conservan todas (no hay "conflicto" ni "duplicado" por compartir fecha; esa regla es solo de sueño); las fechas sin registro no se estiman; con menos de 3 registros no se describe un cambio. En pulso, "en reposo" y "tras ejercicio" se analizan en grupos separados; en glucosa, "en ayunas" y "tras comer"; los grupos nunca se comparan entre sí y una palabra clave negada ("no estaba en reposo") o un contexto ambiguo no clasifica: cae en "contexto no clasificado".

Los cortes numéricos (pulso >300 lpm, temperatura fuera de 25–45 °C / 77–113 °F, glucosa >1000 mg/dL o >55 mmol/L, presión con sistólica <= diastólica) son límites de procesamiento del prototipo, NO umbrales médicos ni verdad fisiológica: esas lecturas no entran en las cuentas, pero se conservan y se listan en `not_processed` como "requiere revisión". Caso distinto: una saturación >100 % supera la propia escala del porcentaje (0–100).

`POST /api/v1/synthetic/{metric}` carga 7 días ficticios (origen `SINTÉTICO - datos de ejemplo`) y reemplaza solo las sintéticas de ese indicador en la sesión: no toca registros confirmados ni sintéticos de otros indicadores. El análisis antepone "Datos sintéticos de ejemplo" cuando incluye alguna.

### Sueño

El análisis de sueño conserva su propio formato (`nights`, `coverage`, `missing_dates`, siestas aparte, fechas por captura no verificadas como noche) y su fuente `nasa-sleep-risk`.

Ejemplo de mensaje:
```json
{"text":"Presión 120/80 mmHg"}
```
Devuelve `status`, `message`, `candidate`, `source_ids`, `clinical_assessment: not_performed`, `communication_sent: false`, `pending_id`, `pending_expires_at`, `recorded: false`. `content_origin: prototype_template_not_clinical_protocol` y `rule_set_version` identifican las plantillas. `source_ids` está vacío porque las respuestas no son instrucciones clínicas NASA; las fuentes generales del reto están en capacidades. Los estados posibles: `needs_confirmation`, `needs_clarification`, `safety_notice`, `information`. Solo el primero contiene propuesta confirmable.

Ejemplo de confirmación (sustituye UUID por `pending_id` real):
```json
{"pending_id":"96f624c6-9e1a-4828-b9b2-9f79fa9607f7","confirmed":true,"origin":"Tensiómetro ficticio","context":"Solo prueba","measured_at":"2026-11-14T09:00:00-05:00"}
```
`measured_at` es opcional; por defecto se usa la hora de registro. Confirmar no admite valor/unidad diferentes al candidato, ni guardar sin un candidato de esa misma sesión. Devuelve 201, `entry`, `clinical_assessment` y mensaje. Un segundo intento es 409, también tras caducidad (2 min).

Un registro contiene `id`, `recorded_at`, `measured_at`, `candidate`, `origin`, `context`, `confirmed_by_user: true`, `clinical_assessment: not_performed`. La historia acepta códigos de `/indicators`, ordena por `measured_at` y devuelve `series: [{unit, points: [{t,values,unit,origin,context,entry_id}]}]`. Una presión conserva ambos valores juntos. No promedia unidades diferentes ni pinta estado clínico. `limit` 1–500; `offset` >=0; `days` 1–3650.

Errores: 401 token ausente/vencido; 403 origen ajeno; 409 propuesta obsoleta/caducada o límite de registros; 413 cuerpo >8 KiB; 422 forma/fecha/indicador inválidos; 429 rate limit; 502 consulta OSDR fallida sin copia; 503 límite de sesiones.

OSDR usa un identificador `OSD-` + entero positivo (máx. 6 dígitos), nunca una URL suministrada. `?refresh=true` pide actualización, con mínimo 5 min entre consultas por estudio; normalmente la caché se usa durante un día. Si la fuente falla y existe copia, devuelve `stale: true` y `upstream_error`; sin copia, 502. `cached`, `retrieved_at`, `file_count_total`, `files_truncated`, `measurement_data_downloaded: false` y `used_for_training: false` distinguen lo verificado. Ver [OSDR](OSDR.md).
