# Integración OSDR: alcance y procedencia

No es una conexión a signos vitales ni una base de instrucciones médicas. Es un módulo independiente para explorar y citar investigaciones espaciales, comprobar organismo, material, técnica y archivos disponibles, y evitar confundir estudios humanos, tejidos y modelos animales. No compara las lecturas de una sesión con resultados de estos estudios.

## Fuentes consultadas

- API y esquema oficial: https://visualization.osdr.nasa.gov/biodata/api/
- Descripción OSDR: https://science.nasa.gov/biological-physical/data/osdr/
- Condiciones y recomendaciones de cita: https://science.nasa.gov/reference/osdr-help-terms-and-conditions/
- OSD-656, página leída: https://osdr.nasa.gov/bio/repo/data/studies/OSD-656
- Metadatos reales consultados y copiados el 14 nov 2026:
  - https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-656/
  - https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-656/files/
  - https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-48/
  - https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-48/files/

`research_snapshots/*.json` guarda los campos seleccionados y URLs, fecha real de recuperación y límites. Al iniciar una base vacía se incorporan a `research_cache`. Son copias de metadatos, no datos simulados ni mediciones individuales. Cada actualización declara su fecha y si viene de caché. Las pruebas usan copias o fixtures y no necesitan consultar NASA.

## Qué contienen las dos copias

**OSD-656**: estudio de panel inflamatorio por multiplex/NULISAseq en orina de Inspiration4, organismo Homo sapiens. Su descripción refiere cuatro participantes, una misión de tres días y 203 proteínas. Son diseño y metadatos del estudio, no resultados calculados aquí. El manifiesto tiene cuatro archivos; se guardan sus nombres y URLs, no su contenido.

**OSD-48**: Rodent Research-1; hígado de ratón, transcriptómica/proteómica/epigenómica/histología. No extrapolar a humanos ni a la salud de quien usa la app. El catálogo puede tener más de 500 archivos: se incluyen hasta 500, `file_count_total` conserva el total observado y `files_truncated` indica recorte. No se descargan RNA-Seq, imágenes, matrices ni muestras.

Las fechas/campos del estudio se muestran como metadatos de la fuente, no como hechos clínicos verificados. No se extraen protocolos de laboratorio ni instrucciones terapéuticas del texto remoto. La API entrega JSON jerárquico; los tipos pueden variar entre cadena/lista, por lo que el adaptador los normaliza y rechaza cambios de esquema incompatibles.

## Acceso y red

No hizo falta autenticación, cuenta ni clave para las consultas verificadas. Solo se hacen GET a dominios NASA permitidos con identificador validado, timeout y máximo 2 MB de respuesta. Nunca se envía el texto del usuario, tokens, entradas, síntomas o lecturas. Se consulta solo a petición; no hay polling ni descarga masiva. Caché de un día y actualización explícita con separación mínima de cinco minutos por estudio. Fallo de NASA: copia fechada marcada `stale`, o 502 si no hay copia.

Para refrescar las copias de distribución de forma explícita:
```sh
python scripts/import_osdr.py OSD-656 OSD-48
```
Las copias ya importadas a una base existente no se sobrescriben al reiniciar; consultar el endpoint con `refresh=true` actualiza la caché de esa base cuando lo permite la cadencia.

## Condiciones y licencia

La página de términos explica publicación de archivos/metadatos y pide reconocer OSDR, usar la cita específica de cada dataset y contactar al repositorio con publicaciones que reutilicen datos. No se identificó una licencia universal equivalente a CC0/CC-BY para todos los archivos de estos dos estudios. El campo `license_status: dataset_specific_license_not_verified` lo hace explícito. No se afirma autorización general para redistribuir matrices, muestras humanas o modelos derivados.

Atribución: metadatos cortesía de NASA Open Science Data Repository y autores de cada estudio. Para reutilizar las mediciones, revisar primero la cita/versionado del dataset y las condiciones específicas del archivo. No se ha accedido a contenido controlado ni se han creado cuentas.

## Lo que NO demuestra esta integración

- No hay ingestión de datos de salud reales de usuarios.
- No hay descarga/análisis de mediciones individuales del repositorio.
- No hay entrenamiento, evaluación clínica, detección de enfermedad o personalización científica.
- No hay una población de referencia válida para semáforos o límites médicos.
- No constituye revisión completa de OSDR ni prueba de que no existan otros datasets útiles.

Un siguiente paso científico distinto sería seleccionar una pregunta y dataset adecuados, verificar licencia/diccionario/unidades/diseño, analizar archivos concretos y validar conclusiones. Este conector no hace pasar su catálogo por ese análisis.
