# Astra Health — front (React + Vite)

Tablero de salud de misión con datos sintéticos. Prototipo de hackathon: no es un
dispositivo médico y no evalúa si una cifra es normal o anormal.

## Conversación de voz "Astra"

El botón flotante (abajo a la derecha) activa la asistente de voz:

1. **Activar Astra**: empieza a escuchar la palabra clave **"Astra"** (también
   puedes pulsar **Hablar ahora** para saltarla).
2. Al oírla responde **"Lista para escucharte"** y queda en turnos de
   conversación: hablas, Astra contesta en voz alta y vuelve a escuchar.
3. Si le das una lectura ("pulso ochenta y dos bpm"), Astra te pide **el
   instrumento u origen** y luego una **confirmación hablada (sí o no)** antes
   de guardar. Decir "no" (o dos respuestas ambiguas) descarta sin guardar.
4. Puedes preguntarle por tus registros ("¿cuál fue mi último pulso?") y te los
   lee. Con **"hasta luego"** / "apágate" vuelve al modo palabra clave; con el
   botón **Apagar Astra** el micrófono queda libre del todo.

Límites honestos del modo voz:

- Solo escucha **con la pestaña abierta y la pantalla activa**: no hay escucha
  con la pestaña cerrada ni con el celular bloqueado.
- El reconocimiento lo ejecuta el **servicio de voz del navegador** (Chrome o
  Edge recomendados) y **puede necesitar internet**; la síntesis de voz es
  local. Si el navegador no soporta alguna pieza, el panel lo dice y el
  registro por teclado sigue disponible.
- **Nada se guarda sin la confirmación hablada** de la usuaria. Los avisos de
  síntomas urgentes los redacta el backend y siempre aclaran que **nadie ha
  sido alertado**: Astra no contacta médicos ni deriva emergencias.
- La palabra clave depende del reconocimiento del navegador y puede no oírla
  siempre; por eso existe el botón **Hablar ahora** como camino confiable.

## Desarrollo

```sh
npm ci
npm run dev       # Vite (necesita el backend en el mismo origen o proxy)
npm run build     # genera dist/; el backend la sirve con FRONT_DIST=.../dist
npm run lint      # eslint
npm test          # pruebas del motor de voz (node:test, sin dependencias)
```

Prueba e2e ad-hoc de la conversación de voz (no forma parte de `npm test`):
con el backend corriendo en `127.0.0.1:8123` sirviendo `dist/`
(`FRONT_DIST=$PWD/dist`), instala playwright sin guardarlo
(`npm i --no-save playwright && npx playwright install chromium`) y corre
`node tests/e2e/voice.e2e.mjs`. Simula el micrófono y la síntesis en la página
y verifica contra el backend real que la lectura confirmada por voz se guarda
y que la rechazada no.
