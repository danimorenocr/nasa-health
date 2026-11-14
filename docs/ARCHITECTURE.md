# Arquitectura y límites

Un monolito local: `app/main.py` contiene API, autorización temporal y entrega de tres recursos estáticos permitidos; `schemas.py` valida entradas y tipa las respuestas principales; `engine.py` separa interpretación textual de almacenamiento; `db.py` define modelos SQLAlchemy/SQLite; `catalog.py` contiene indicadores/fuentes; `trends.py` y `vitals.py` hacen los cálculos deterministas de análisis (sueño y signos puntuales, respectivamente); `research.py` consulta metadatos públicos OSDR. `demo/` es HTML/CSS/JS sin build.

Dependencias de ejecución: FastAPI (rutas/contrato), Uvicorn (servidor), SQLAlchemy (persistencia), Pydantic (validación). Biblioteca estándar para HTTP OSDR, tiempo y tokens. No hay pandas, sklearn, motores de voz o proveedores IA. Pytest/httpx/ruff y Playwright son herramientas de pruebas/desarrollo. `requirements.lock` fija el entorno Python probado; `pyproject.toml` describe dependencias directas.

## Datos

- `local_session`: hash SHA-256 del token aleatorio de 256 bits, última actividad y una propuesta pendiente con caducidad. Nunca se guarda el token en claro en SQLite.
- `entry`: candidato confirmado, origen, contexto, fecha de medición UTC y de registro UTC. Índice por sesión y fecha. Clave foránea con borrado en cascada.
- `research_cache`: documento de metadatos públicos, identificador y fecha. No se relaciona con sesiones ni lecturas personales.

Ruta por defecto: `data/health.sqlite3`; configurable con `DATABASE_PATH`. Datos/archivos auxiliares, caches y entornos están excluidos del ZIP y `.gitignore`. Un reinicio conserva registros; 30 días sin acceso autenticado (`SESSION_TTL_DAYS`) caducan la sesión, que se depura al siguiente acceso autenticado o creación de sesión. Borrar sesión borra sus registros/propuesta, no metadatos públicos OSDR ni archivos JSON ya exportados. SQLite usa foreign_keys, WAL y secure_delete; no promete borrado forense de discos, copias o descargas.

El token vive solo en `sessionStorage` del navegador; persiste al recargar la misma pestaña, no constituye recuperación de cuenta. Si desaparece, no se puede recuperar esa sesión desde la demo. No hay registro, roles, personas reales, sincronización ni vinculación a astronautas reales.

## Confirmación y concurrencia

Interpretar texto no crea un registro. Genera una propuesta revisable que caduca tras 120 s. Otro mensaje reemplaza la propuesta anterior; descartar la elimina; confirmar la consume y guarda una sola vez. Validación y consumo se serializan en el mismo proceso. Una prueba manda dos confirmaciones simultáneas y solo una tiene éxito. Usar un solo worker; la coordinación multiproceso/distribuida no se ha implementado.

El endpoint de confirmación no acepta valor, unidad ni indicador editados: toma el candidato previamente propuesto por el servidor. Para corregirlos hay que enviar un mensaje nuevo. Se requieren origen e indicador/unidad claros; la fecha opcional debe incluir zona horaria y no estar en el futuro. La fecha se convierte a UTC. El contexto es texto libre; no se infiere de él un diagnóstico.

## Seguridad de prototipo

Máximo 2.000 caracteres por texto y 8 KiB por cuerpo API, 120 peticiones/min/IP, 1.000 sesiones y 2.000 registros/sesión. Mismo origen; no se habilita CORS abierto. Tokens de sesión en cabecera, no en URL; respuestas no cacheables; cámara/micrófono deshabilitados; fuentes sanitizadas por renderizado `textContent`, no HTML. Sin logs de cuerpo; ejecutar con `--no-access-log`. Los datos de sesión nunca se incluyen en solicitudes OSDR.

La demo no usa recursos externos. `/docs` usa Swagger UI de CDN según FastAPI; no envía datos de sesiones por defecto, pero requiere red para cargar la interfaz. `/openapi.json` no necesita red. No se han hecho pentests ni validación para datos personales. No exponer internet, múltiples usuarios reales o datos clínicos con este diseño.

## Límites médicos y textuales

Registra pulso, presión de dos componentes, temperatura, saturación, glucosa y sueño. Acepta solo formatos descritos, un indicador por mensaje y números en dígitos. No entiende toda frase en español, números escritos con palabras, varias lecturas ni detalles complejos de fecha/condiciones dentro del mensaje. Puede pedir aclaración aunque una persona entienda el texto. No es un LLM.

No hay umbrales clínicos, tratamiento, dosis, guías de medición de misión ni procedimientos. Una cifra aceptada no está validada médicamente. El sistema no dice que esté sana la persona, ni asigna una causa como aislamiento. Las unidades distintas se mantienen en series separadas: nunca hay conversiones, medias ni cambios calculados entre unidades. Los análisis calculan promedios y cambios solo dentro de la misma unidad y contexto, sin tendencias ni clasificaciones clínicas. `recorded_at` y `measured_at` cumplen funciones distintas; la primera nunca se presenta como fecha real del instrumento.

El aviso de urgencia se dispara por algunas palabras, incluidas negaciones o hipótesis: puede dar falsos positivos y falsos negativos. Su ausencia no descarta urgencia. Prioriza contacto humano y reconoce que no hay protocolo ni comunicación reales, sin afirmar que se haya notificado a nadie. No sustituye un motor de seguridad clínica revisado.

## Qué es oficial y qué no

El reto NASA Space Apps plantea indicadores y una herramienta de autoevaluación visual; no impone este stack, endpoints, TTL, formatos, reglas o experiencia. Todo eso es decisión de este prototipo. Los metadatos OSDR sí provienen de la API pública; las reglas de interpretación/seguridad no son protocolos NASA. NASA no ha aprobado este software.
