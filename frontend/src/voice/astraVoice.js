// Motor de la conversación de voz de Astra.
//
// Flujo: botón "Activar Astra" -> escucha de la palabra clave "Astra" ->
// "Lista para escucharte" -> turnos hablados contra el backend (/messages,
// /confirmations, /pending). Las lecturas dictadas se guardan solas al terminar el turno
// (tras una ventana de silencio); un síntoma o comentario sí pide un sí/no. El instrumento es opcional
// antes de guardarse; nada se guarda solo.
//
// Es intencionalmente independiente de React: las dependencias (reconocimiento
// de voz, síntesis, API) se inyectan para poder probarlo en Node. El adaptador
// del navegador vive en ./speech.js y el panel en ../components/voice/.

import { METRIC_LABELS } from '../data/format.js'

export const WAKE_WORD = 'astra'

export const STATUS = {
  OFF: 'off',
  UNSUPPORTED: 'unsupported',
  STARTING: 'starting',
  WAKE: 'wake', // esperando la palabra "Astra"
  GREETING: 'greeting', // diciendo "Lista para escucharte"
  LISTENING: 'listening', // turno del usuario (conversación)
  THINKING: 'thinking', // esperando al backend
  SPEAKING: 'speaking', // Astra responde en voz alta
  AWAIT_ORIGIN: 'awaiting_origin', // falta el instrumento/origen de la lectura
  AWAIT_CONFIRM: 'awaiting_confirm', // falta el sí/no para guardar
  ERROR: 'error',
}

const GREETING = 'Lista para escucharte.'

const UNIT_SPEECH = {
  lpm: 'latidos por minuto',
  bpm: 'latidos por minuto',
  mmHg: 'milímetros de mercurio',
  '°C': 'grados Celsius',
  '°F': 'grados Fahrenheit',
  '%': 'por ciento',
  'mg/dL': 'miligramos por decilitro',
  'mmol/L': 'milimoles por litro',
  h: 'horas',
}

// Quita acentos, signos y mayúsculas para comparar lo dicho con palabras clave.
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Lo que se dijo después de la palabra clave ("hey Astra, mi pulso es 80" -> "mi pulso es 80").
export function textAfterWakeWord(text) {
  const match = new RegExp(`(?:^|\\s)${WAKE_WORD}(?![\\p{L}\\d])[\\s,.:;!?-]*`, 'iu').exec(String(text || ''))
  return match ? String(text).slice(match.index + match[0].length).trim() : ''
}

export function containsWakeWord(text) {
  return new RegExp(`(^| )${WAKE_WORD}( |$)`).test(normalize(text))
}

const EXIT_WORDS = new Set([
  'apagar', 'apagate', 'apagarte', 'terminar', 'termina', 'adios', 'chao',
  'hasta luego', 'ya esta', 'suficiente', 'nada mas', 'eso es todo',
])

export function isExit(text) {
  const value = normalize(text)
  if (EXIT_WORDS.has(value)) return true
  // Frases como "apaga astra" o "apagarte astra"
  return value.startsWith('apaga') || value === 'no nada' || value === 'nada gracias'
}

const AFFIRMATIVE = new Set([
  'si', 'confirmo', 'confirmar', 'confirma', 'guarda', 'guardar', 'guardalo',
  'correcto', 'vale', 'dale', 'ok', 'okay', 'perfecto', 'claro', 'afirmativo',
  'por supuesto', 'de acuerdo', 'eso', 'exacto', 'si por favor', 'si guardala',
  'si guardalo', 'confirmado',
])

const NEGATIVE = new Set([
  'no', 'descarta', 'descartar', 'descartalo', 'cancela', 'cancelar', 'borralo',
  'olvidalo', 'olvida', 'negativo', 'no lo guardes', 'no guardar', 'que no',
  'no gracias', 'mejor no',
])

export function isAffirmative(text) {
  const value = normalize(text)
  if (AFFIRMATIVE.has(value)) return true
  return /^(si|confirmo|guarda|claro|vale|dale|ok)\b/.test(value) && !/\bno\b/.test(value)
}

export function isNegative(text) {
  const value = normalize(text)
  if (NEGATIVE.has(value)) return true
  // Dudas ("no sé", "quizás") no son una negativa: se vuelve a preguntar.
  if (/^(no se|quizas|quiza|tal vez|no estoy segur)/.test(value)) return false
  return /\b(no|descarta|cancela|borra|olvida)\b/.test(value)
}

function spokenUnit(unit) {
  return UNIT_SPEECH[unit] || unit || ''
}

function spokenValue(candidate) {
  const values = candidate.values || []
  if (candidate.metric === 'blood_pressure') return values.join(' sobre ')
  return String(values[0])
}

// Frase hablable de lo entendido, sin evaluar si la cifra es normal o no.
const labelOf = (code) => String(METRIC_LABELS[code] || code).toLowerCase()

// ¿Lo dicho nombra un indicador? Si no, es la respuesta a "¿cuánto marcó?".
export function mentionsIndicator(text) {
  return /(pulso|latido|frecuencia|temperatura|fiebre|presion|tension|saturacion|oxigeno|glucosa|azucar|dormi|sueno|musculo)/.test(normalize(text))
}

// Lecturas con datos que faltan (undefined, null, NaN...): se vuelven a pedir en vez de guardarlas.
export function findIncompleteReading(candidate) {
  const items = candidate?.kind === 'batch' ? candidate.measurements || [] : candidate?.kind === 'measurement' ? [candidate] : []
  for (const item of items) {
    const need = item.metric === 'blood_pressure' ? 2 : 1
    const values = Array.isArray(item.values) ? item.values : []
    const complete = values.length >= need && values.slice(0, need).every((v) => v !== null && v !== '' && Number.isFinite(Number(v)))
    if (!complete) return item.metric
  }
  return null
}

// Origen que se anota cuando la lectura se dicta sin nombrar el instrumento.
const VOICE_ORIGIN = 'Dato declarado por voz'

export function describeCandidate(candidate) {
  if (!candidate) return ''
  if (candidate.kind === 'batch') {
    const parts = (candidate.measurements || []).map(
      (m) => `${(METRIC_LABELS[m.metric] || m.metric).toLowerCase()} ${spokenValue(m)} ${spokenUnit(m.unit)}`,
    )
    return `${parts.length} lecturas: ${parts.join(', ')}`
  }
  if (candidate.kind === 'measurement') {
    return `${(METRIC_LABELS[candidate.metric] || candidate.metric).toLowerCase()} ${spokenValue(candidate)} ${spokenUnit(candidate.unit)}`
  }
  if (candidate.kind === 'symptom') {
    const text = String(candidate.original_text || '').slice(0, 200)
    return `un síntoma o comentario tuyo: "${text}"`
  }
  return 'lo que dijiste'
}

// Errores del reconocimiento que no tienen sentido reintentar en esta sesión.
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

const ERROR_TEXT = {
  'not-allowed': 'Permiso de micrófono denegado. Actívalo en el navegador o registra con el teclado.',
  'service-not-allowed': 'Permiso de micrófono denegado. Actívalo en el navegador o registra con el teclado.',
  'audio-capture': 'No se encontró un micrófono disponible en este equipo.',
  'language-not-supported': 'Este navegador no acepta español en el reconocimiento de voz.',
  network: 'El servicio de voz del navegador no respondió; suele necesitar internet.',
}

const errorText = (code) => ERROR_TEXT[code] || 'El reconocimiento de voz falló en este navegador.'

export function createAstraVoice({
  speech, // { supported, reason, createRecognition(mode), speak(text), stopSpeaking() }
  api, // { sendMessage(text), confirmPending(payload), discardPending() }
  onUpdate = () => {},
  onSaved = () => {},
  now = () => new Date(),
  wakeRestartMs = 350,
  settleMs = 3000, // silencio que se espera tras hablar, por si la persona sigue midiéndose
  autoSave = true, // las lecturas dictadas se guardan al terminar el turno, sin pedir sí/no
} = {}) {
  let status = STATUS.OFF
  let detail = ''
  let lastUserText = ''
  let lastAstraText = ''
  let recognition = null
  let stopping = false // apagado pedido por la usuaria
  let pending = null // { pendingId, candidate, origin, unclear }
  let noSpeechRetries = 0
  let restartTimer = null
  let settleTimer = null
  let pausedWake = false // pausada porque otra función usa el micrófono
  let awaitingValue = null // { code, label }: indicador al que se le pidió el valor que faltaba
  let asks = [] // otros indicadores que también faltan por pedir

  const snapshot = () => ({
    status,
    detail,
    lastUserText,
    lastAstraText,
    pendingSummary: pending ? describeCandidate(pending.candidate) : '',
  })

  const setState = (next, info = '') => {
    status = next
    detail = info
    onUpdate(snapshot())
  }

  const say = async (text, { speaking = true } = {}) => {
    lastAstraText = text
    if (speaking) setState(STATUS.SPEAKING, 'Astra está hablando…')
    await speech.speak(text)
  }

  const clearTimer = () => {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  const closeRecognition = () => {
    clearTimer()
    const current = recognition
    recognition = null
    if (current) {
      current.onresult = null
      current.onerror = null
      current.onend = null
      try { current.stop() } catch { /* ya detenido */ }
    }
  }

  const stop = (info = '') => {
    stopping = true
    closeRecognition()
    speech.stopSpeaking()
    pending = null
    awaitingValue = null
    asks = []
    setState(STATUS.OFF, info)
  }

  const fail = (code) => {
    stopping = true
    closeRecognition()
    speech.stopSpeaking()
    pending = null
    setState(STATUS.ERROR, errorText(code))
  }

  const armWake = (info = 'Di "Astra" o pulsa Hablar.') => {
    closeRecognition()
    pending = null
    awaitingValue = null
    asks = []
    noSpeechRetries = 0
    setState(STATUS.WAKE, info)
    const rec = speech.createRecognition('wake')
    recognition = rec
    rec.onresult = (event) => {
      if (event.isFinal && containsWakeWord(event.transcript)) {
        lastUserText = event.transcript.trim()
        // "Hey Astra, mi pulso es 80": si ya dijo algo más, se procesa de una vez, sin saludo.
        const rest = textAfterWakeWord(event.transcript)
        if (rest.length >= 8) {
          closeRecognition()
          handleUtterance(rest)
          return
        }
        beginTurn()
      }
    }
    rec.onerror = (event) => {
      if (stopping) return
      if (FATAL_ERRORS.has(event.error) || event.error === 'network') {
        fail(event.error)
      }
      // 'no-speech' en modo wake no molesta: sigue escuchando vía onend.
    }
    rec.onend = () => {
      if (stopping || status !== STATUS.WAKE || recognition !== rec) return
      // El reconocimiento continuo del navegador se detiene solo tras un rato
      // de silencio: se rearma mientras el modo escucha siga activo.
      restartTimer = setTimeout(() => {
        if (status === STATUS.WAKE && recognition === rec) {
          try { rec.start() } catch { armWake(info) }
        }
      }, wakeRestartMs)
    }
    try {
      rec.start()
    } catch {
      setState(STATUS.ERROR, 'No se pudo iniciar el micrófono del navegador.')
    }
  }

  // Escucha UN turno hablado y llama onFinal con el texto definitivo.
  // Para tomar lecturas (handleUtterance) se deja una ventana de silencio: cada vez
  // que la persona habla se reinicia, y solo al pasar `settleMs` sin voz se procesa
  // todo lo dicho junto. Así puede seguir midiéndose y dictando signos uno tras otro.
  const listenTurn = (state, onFinal) => {
    closeRecognition()
    const settle = onFinal === handleUtterance ? settleMs : 0
    setState(state, settle > 0 ? 'Te escucho. Puedes dictar varios signos seguidos; espero unos segundos de silencio antes de guardar.' : '')
    const rec = speech.createRecognition(settle > 0 ? 'collect' : 'turn')
    recognition = rec
    let gotFinal = false
    let collected = ''
    let interim = ''
    const finishCollect = () => {
      settleTimer = null
      if (recognition !== rec) return
      const text = (collected || interim).trim()
      rec.onresult = null
      rec.onerror = null
      try { rec.stop() } catch { /* ya detenido */ }
      if (!text) return
      onFinal(text)
    }
    rec.onresult = (event) => {
      if (settle > 0) {
        noSpeechRetries = 0
        if (event.isFinal) {
          gotFinal = true
          collected = `${collected} ${event.transcript}`.trim()
          interim = ''
        } else {
          interim = event.transcript.trim()
        }
        lastUserText = `${collected} ${interim}`.trim()
        onUpdate(snapshot())
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(finishCollect, settle)
        return
      }
      if (event.isFinal) {
        gotFinal = true
        noSpeechRetries = 0
        lastUserText = event.transcript.trim()
        // Un turno = una frase: se suelta el reconocimiento de inmediato para
        // que un resultado tardío no procese dos veces lo que siga hablando.
        rec.onresult = null
        rec.onerror = null
        try { rec.stop() } catch { /* ya detenido */ }
        onFinal(event.transcript.trim())
      } else {
        lastUserText = event.transcript.trim()
        onUpdate(snapshot())
      }
    }
    rec.onerror = (event) => {
      if (stopping) return
      if (FATAL_ERRORS.has(event.error) || event.error === 'network') {
        fail(event.error)
      }
      // 'no-speech' se resuelve en onend.
    }
    rec.onend = async () => {
      if (stopping || gotFinal || recognition !== rec || status !== state) return
      recognition = null
      noSpeechRetries += 1
      if (noSpeechRetries >= 2) {
        noSpeechRetries = 0
        const hadPending = Boolean(pending)
        discardQuietly()
        await say(hadPending
          ? 'Como no logro escucharte, no guardé nada. Di "Astra" o pulsa Hablar cuando quieras seguir.'
          : 'No logro escucharte. Di "Astra" o pulsa Hablar cuando quieras seguir.')
        if (stopping) return
        armWake()
        return
      }
      await say('No te escuché. ¿Me lo repites?')
      if (stopping) return
      listenTurn(state, onFinal)
    }
    try {
      rec.start()
    } catch {
      setState(STATUS.ERROR, 'No se pudo iniciar el micrófono del navegador.')
    }
  }

  const discardQuietly = () => {
    const current = pending
    pending = null
    if (current) api.discardPending().catch(() => {})
  }

  const exitToWake = async () => {
    const hadPending = Boolean(pending)
    discardQuietly()
    await say(hadPending
      ? 'De acuerdo, no guardé nada pendiente. Di "Astra" si me necesitas de nuevo.'
      : 'De acuerdo. Di "Astra" si me necesitas de nuevo.')
    if (stopping) return
    armWake()
  }

  const handleUtterance = async (text) => {
    if (isExit(text)) {
      await exitToWake()
      return
    }
    let spoken = text
    if (awaitingValue) {
      const asked = awaitingValue
      awaitingValue = null
      if (isNegative(text)) {
        asks = []
        await say('De acuerdo, lo dejo sin guardar.')
        if (stopping) return
        listenTurn(STATUS.LISTENING, handleUtterance)
        return
      }
      // Solo dijo el valor ("37"): se le antepone el indicador por el que se preguntó.
      if (!mentionsIndicator(text)) spoken = `${asked.label} ${text}`
    }
    setState(STATUS.THINKING, 'Astra está procesando lo que dijiste…')
    let data
    try {
      data = await api.sendMessage(spoken, { voice: true })
    } catch (caught) {
      await say(caught?.message || 'No pude hablar con el servidor. Inténtalo de nuevo.')
      if (stopping) return
      listenTurn(STATUS.LISTENING, handleUtterance)
      return
    }
    if (data.status === 'needs_confirmation' && data.pending_id && data.candidate) {
      pending = { pendingId: data.pending_id, candidate: data.candidate, origin: '', unclear: 0 }
      const summary = describeCandidate(data.candidate)
      const cand = data.candidate
      const incomplete = findIncompleteReading(cand)
      if (incomplete) {
        discardQuietly()
        awaitingValue = { code: incomplete, label: labelOf(incomplete) }
        await say(`No entendí el valor de ${labelOf(incomplete)}. ¿Cuánto marcó?`)
        if (stopping) return
        listenTurn(STATUS.LISTENING, handleUtterance)
        return
      }
      const isReading = cand.kind === 'measurement' || cand.kind === 'batch'
      const spokenOrigin = isReading && cand.explicit_origin ? String(cand.suggested_origin || '').trim().slice(0, 120) : ''
      const spokenWhen = isReading && cand.explicit_time && cand.suggested_measured_at ? new Date(cand.suggested_measured_at) : null
      const hasSpokenTime = Boolean(spokenWhen && !Number.isNaN(spokenWhen.getTime()))

      // Una o varias lecturas dictadas: se guardan de una vez al terminar el turno.
      // Si no dijo el instrumento se anota "Dato declarado por voz" (no se inventa uno)
      // y si no dijo la hora, se usa el momento actual.
      if (autoSave && isReading) {
        setState(STATUS.THINKING, 'Guardando lo que dijiste…')
        const when = hasSpokenTime ? spokenWhen : now()
        try {
          const saved = await api.confirmPending({
            pending_id: data.pending_id,
            origin: spokenOrigin.length >= 2 ? spokenOrigin : VOICE_ORIGIN,
            context: '',
            measured_at: when.toISOString(),
          })
          pending = null
          onSaved(saved.entries?.length || 1)
          const clock = when.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
          // Lo que no se entendió se vuelve a pedir, uno por uno.
          if (data.skipped_codes?.length) asks = data.skipped_codes.map((code) => ({ code, label: labelOf(code) }))
          const next = asks.shift() || null
          awaitingValue = next
          const skippedNote = data.skipped?.length
            ? ` No entendí: ${data.skipped.join(', ')}.${next ? ` ¿Cuánto marcó ${next.label}?` : ''}`
            : next ? ` Falta ${next.label}: ¿cuánto marcó?` : ''
          await say(`Listo, ya guardé ${summary}${spokenOrigin.length >= 2 ? `, medido con ${spokenOrigin}` : ''}${hasSpokenTime ? ` a las ${clock}` : ''}.${skippedNote}${awaitingValue ? '' : ' Puedes seguir con más mediciones.'}`)
          if (stopping) return
          listenTurn(STATUS.LISTENING, handleUtterance)
          return
        } catch (caught) {
          if (caught?.status === 409) {
            pending = null
            await say('La propuesta venció antes de guardarse, así que no guardé nada. Dime las lecturas de nuevo.')
            if (stopping) return
            listenTurn(STATUS.LISTENING, handleUtterance)
            return
          }
          // Por ejemplo, una hora futura: se sigue con la confirmación normal.
        }
      }

      // El instrumento es opcional: no se pregunta. Solo se pide confirmar.
      pending.origin = spokenOrigin
      await say(`Entendí ${summary}${spokenOrigin ? `, medido con ${spokenOrigin}` : ''}. ¿Lo guardo? Puedes decir sí o no.`)
      if (stopping) return
      listenTurn(STATUS.AWAIT_CONFIRM, handleConfirm)
      return
    }
    // Falta el valor de un indicador: se queda esperando solo el número.
    if (data.ask_metric) awaitingValue = { code: data.ask_metric, label: labelOf(data.ask_metric) }
    // needs_clarification, safety_notice o information: se dice tal cual llega
    // del backend (incluido el aviso de que nadie ha sido alertado).
    await say(data.message || 'No tengo respuesta para eso.')
    if (stopping) return
    listenTurn(STATUS.LISTENING, handleUtterance)
  }

  const handleConfirm = async (text) => {
    if (isExit(text)) {
      await exitToWake()
      return
    }
    if (isAffirmative(text)) {
      const current = pending
      setState(STATUS.THINKING, 'Guardando tu confirmación por voz…')
      try {
        const saved = await api.confirmPending({
          pending_id: current.pendingId,
          origin: current.origin,
          context: '',
          measured_at: now().toISOString(),
        })
        pending = null
        onSaved(saved.entries?.length || 1)
        await say(saved.message || 'Registro confirmado.')
      } catch (caught) {
        pending = null
        if (caught?.status === 409) {
          await say('La propuesta venció antes de tu confirmación, así que no guardé nada. Dime la lectura de nuevo y repetimos.')
        } else {
          await say(caught?.message || 'No pude guardar el registro. No guardé nada.')
        }
      }
      if (stopping) return
      listenTurn(STATUS.LISTENING, handleUtterance)
      return
    }
    if (isNegative(text)) {
      discardQuietly()
      await say('De acuerdo, no guardé nada.')
      if (stopping) return
      listenTurn(STATUS.LISTENING, handleUtterance)
      return
    }
    pending.unclear += 1
    if (pending.unclear >= 2) {
      discardQuietly()
      await say('Sigo sin entenderte; por seguridad no guardé nada. Si quieres registrarlo, cuéntame la lectura otra vez.')
      if (stopping) return
      listenTurn(STATUS.LISTENING, handleUtterance)
      return
    }
    await say('No te entendí. ¿Guardo la lectura? Di sí o no.')
    if (stopping) return
    listenTurn(STATUS.AWAIT_CONFIRM, handleConfirm)
  }

  const beginTurn = async () => {
    closeRecognition()
    setState(STATUS.GREETING, 'Astra te está respondiendo…')
    await say(GREETING, { speaking: false })
    if (stopping) return
    listenTurn(STATUS.LISTENING, handleUtterance)
  }

  return {
    start() {
      if (!speech.supported) {
        setState(STATUS.UNSUPPORTED, speech.reason || 'Este navegador no tiene reconocimiento ni síntesis de voz.')
        return
      }
      stopping = false
      setState(STATUS.STARTING, 'Preparando el micrófono…')
      armWake()
    },
    talk() {
      if (status === STATUS.OFF || status === STATUS.UNSUPPORTED || status === STATUS.ERROR) return
      stopping = false
      beginTurn()
    },
    skipSpeech() {
      speech.stopSpeaking()
    },
    // Otra función necesita el micrófono: solo se pausa la escucha de fondo ("Hey Astra").
    pause() {
      if (status !== STATUS.WAKE || stopping) return
      closeRecognition()
      pausedWake = true
      setState(STATUS.WAKE, 'En pausa mientras usas el dictado.')
    },
    resume() {
      if (!pausedWake) return
      pausedWake = false
      if (!stopping && status === STATUS.WAKE) armWake()
    },
    stop,
    getState: snapshot,
  }
}
