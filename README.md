# Salud espacial: backend textual

FastAPI + SQLAlchemy + SQLite, con interfaz mínima de prueba y conector público NASA OSDR. Prototipo local para **datos ficticios**, no para decisiones clínicas. Sin ML, LLM, claves ni cuentas. La demo (`/demo`) ofrece dictado por voz opcional y respuesta por voz hablada con la Web Speech API del navegador (SpeechRecognition y SpeechSynthesis): el audio se procesa en el navegador (nunca en el backend), puede no funcionar sin internet, la transcripción queda editable y nada se guarda sin confirmación. No se ha desplegado ni subido a un repositorio.

## Arranque (Python 3.10+)

```sh
python -m venv .venv
# Linux/macOS:
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.lock
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

Abre http://127.0.0.1:8000/demo. Contrato interactivo en http://127.0.0.1:8000/docs y JSON en `/openapi.json`. La demo no necesita CDN ni Node. El Swagger UI de `/docs` carga JS/CSS de CDN: necesita internet para su interfaz, no para el contrato JSON ni para `/demo`.

Para desarrollo también sirve `pip install -e '.[dev]'`. La instalación inicial necesita internet; después el backend y la demo corren sin red. OSDR usa red solo al pedir estudios no disponibles en caché o al actualizarlos. Se incluyen dos copias de metadatos públicos con fecha/procedencia.

## Prueba rápida

1. Envía `Pulso 82 lpm`. Aún no aparece ningún registro.
2. Revisa el texto, valor y unidad. Introduce `Pulsómetro ficticio` como origen y confirma.
3. Pregunta `¿Cuál fue mi último pulso?` o `¿Qué registros tengo?`: el asistente recuerda tus mediciones en SQLite local y te responde por texto y por voz.
4. Recarga la página: el registro sigue. Consulta su historial o descarga el JSON.
5. Envía `Temperatura 37`: debe pedir unidad. Envía `Me duele el pecho y me falta el aire`: muestra un aviso genérico y aclara que **no ha avisado a nadie**.
6. Consulta `OSD-656` en OSDR. Verás investigación de proteínas de orina de Inspiration4, no pulso en vivo ni resultados de un modelo.

## Qué entrega

- Conversación de voz continua en el front React (botón "Activar Astra"): palabra clave "Astra", saludo hablado, turnos de conversación con respuesta por voz y confirmación hablada (origen + sí/no) antes de guardar cualquier lectura. Solo escucha con la pestaña abierta y la pantalla activa; el reconocimiento usa el servicio de voz del navegador y puede necesitar internet. Detalle y límites en el README del front.
- API `/api/v1`: sesiones aisladas, texto, confirmación, descarte, registros, memoria de consultas, historial por indicador/unidad, transcripción de audio grabado (`/api/v1/transcribe`), exportación y borrado.
- Registro por voz y notas de audio: botón de grabación real con `MediaRecorder` para notas de audio, detención y cancelación, estados visibles (`grabando`, `transcribiendo`, `revisar`, `guardando`, `guardado`, `error`), dictado en vivo opcional por Web Speech API. Soporte de números hablados en español ("ochenta y dos", "treinta y siete coma dos", "ciento veinte sobre ochenta"), unidades habladas (incluyendo variantes como "pulsaiones por minuto" o "pulsaciones por minuto" -> `lpm`), y extracción de lotes de mediciones múltiples sin perder el paciente activo ni inventar datos ausentes.
- Transcripción honesta en el servidor: si `OPENAI_API_KEY` o `GROQ_API_KEY` no están configuradas en el entorno, el servidor y la interfaz lo indican con total honestidad sin fingir transcripciones simuladas. El audio nunca se persiste crudo ni se loguea.
- Lectura de recomendaciones reales devueltas por el sistema: tras confirmar y guardar un registro, la app recupera el análisis determinista oficial (`/api/v1/analysis/{metric}`) con cálculos de tendencia y fuente educativa NASA, y los lee en voz alta con controles para escuchar, detener y repetir, manteniendo el texto siempre visible.
- Memoria local de registros: el asistente recuerda los datos confirmados en la sesión y responde preguntas sobre indicadores puntuales (ej. pulso, temperatura), último registro general, síntomas o resumen total.
- Análisis determinista de los seis indicadores (`/api/v1/analysis/{metric}`): promedio, mínimo/máximo y cambio entre registros confirmados. Todas las lecturas del mismo día se conservan (solo sueño deduplica por fecha); los contextos no comparables se separan (pulso en reposo vs tras ejercicio; glucosa en ayunas vs tras comer) y las palabras negadas no clasifican. Lo que el prototipo no procesa (límites propios, no médicos) se conserva y se marca "requiere revisión". La explicación con fuente NASA va en un bloque aparte de los cálculos. Sin umbrales clínicos ni clasificación de normalidad. Series sintéticas de prueba por indicador (`/api/v1/synthetic/{metric}`), siempre marcadas.
- SQLite conserva datos y sesiones al reiniciar. La demo conserva el token en `sessionStorage` al recargar esa pestaña. No hay login ni recuperación si se pierde el token. **30 días sin acceso (`SESSION_TTL_DAYS`) caducan la sesión y sus registros**; cualquier acceso autenticado renueva el plazo, depurados al siguiente acceso de sesión/creación. Pendientes: 2 minutos, consumibles una vez.
- Fecha de medición separada del registro, con zona horaria y rechazo de fechas futuras. No mezcla unidades ni convierte en silencio.
- Conector OSDR de solo lectura: estudio, organismo, material, técnicas, descripción, publicaciones y catálogo de archivos con URL/fecha. Caché local y aviso si la fuente no responde. **No descarga mediciones individuales ni entrena nada.**

## Verificar

```sh
python -m pytest -q
ruff check app tests scripts
python -m compileall -q app
python -m pip check
```

Pruebas de navegador opcionales (requieren Node; no el backend): `npm ci`, `npx playwright install chromium`, `npm run test:e2e`. En Windows cambia el comando `.venv/bin/python` por `.venv/Scripts/python.exe` en `playwright.config.ts`.

## Límites esenciales

No mide, diagnostica, prescribe ni clasifica cifras como normales/anormales. El aviso por palabras es ilustrativo, puede equivocarse y **no es triage**. No hay protocolo clínico de misión ni comunicación conectados. La validación es de formato, no de plausibilidad médica. SQLite no está cifrado y los tokens no son autenticación de personas. Usa un solo proceso/worker, enlazado a localhost; no abrir a internet. Ver [arquitectura y límites](docs/ARCHITECTURE.md), [API](docs/API.md) y [procedencia OSDR](docs/OSDR.md).
