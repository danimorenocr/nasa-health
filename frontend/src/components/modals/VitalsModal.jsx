import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Check,
  Droplet,
  Dumbbell,
  Gauge,
  HeartPulse,
  Mic,
  Moon,
  Square,
  Thermometer,
  X,
} from 'lucide-react'
import { confirmPending, discardPending, sendMessage, transcribeAudio } from '../../api/client'
import { METRIC_LABELS, formatValue, formatWhen } from '../../data/format'
import { useLanguage } from '../../app/LanguageContext'
import { micBusy, micFree } from '../../voice/micBus'

const INDICATOR_EN = {
  heart_rate: { label: 'Heart rate', description: 'Beats per minute' },
  blood_pressure: { label: 'Blood pressure', description: 'Systolic and diastolic' },
  temperature: { label: 'Temperature', description: 'In °C or °F' },
  oxygen_saturation: { label: 'Oxygen saturation', description: 'SpO₂ percentage' },
  glucose: { label: 'Glucose', description: 'Choose the measured unit' },
  sleep: { label: 'Sleep', description: 'Self-reported hours and minutes' },
  muscle_mass: { label: 'Muscles', description: 'Muscle weight in kg' },
}

const INDICATORS = [
  { code: 'heart_rate', label: 'Pulso', description: 'Latidos por minuto', unit: 'bpm', icon: HeartPulse },
  { code: 'blood_pressure', label: 'Presión', description: 'Sistólica y diastólica', unit: 'mmHg', icon: Activity },
  { code: 'temperature', label: 'Temperatura', description: 'En °C o °F', units: ['°C', '°F'], icon: Thermometer },
  { code: 'oxygen_saturation', label: 'Saturación', description: 'Porcentaje de SpO₂', unit: '%', icon: Gauge },
  { code: 'glucose', label: 'Glucosa', description: 'Elige la unidad medida', units: ['mg/dL', 'mmol/L'], icon: Droplet },
  { code: 'sleep', label: 'Sueño', description: 'Horas y minutos declarados', unit: 'h', icon: Moon },
  { code: 'muscle_mass', label: 'Músculos', description: 'Peso en kg', unit: 'kg', icon: Dumbbell },
]

const FREE_TEXT = 'free_text'

const EMPTY_DRAFT = {
  value: '',
  systolic: '',
  diastolic: '',
  hours: '',
  minutes: '',
  unit: '',
  origin: '',
  context: '',
  measuredAt: '',
  text: '',
}

const DICTATION_ERRORS = {
  'not-allowed': 'Permiso de micrófono denegado. Puedes seguir escribiendo con el teclado.',
  'service-not-allowed': 'Permiso de micrófono denegado. Puedes seguir escribiendo con el teclado.',
  'audio-capture': 'No se encontró un micrófono disponible.',
  network: 'El servicio de dictado del navegador no respondió; suele necesitar internet.',
  'no-speech': 'No se detectó voz. Inténtalo de nuevo o escribe con el teclado.',
}

function localDateTimeNow() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

function requiredNumber(value, label) {
  if (String(value).trim() === '') throw new Error(`Completa ${label}.`)
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} debe ser un número igual o mayor que cero.`)
  return number
}

function createMessage(metric, draft) {
  if (metric === 'blood_pressure') {
    const systolic = requiredNumber(draft.systolic, 'la presión sistólica')
    const diastolic = requiredNumber(draft.diastolic, 'la presión diastólica')
    return `Presión ${systolic}/${diastolic} mmHg`
  }

  if (metric === 'sleep') {
    const hours = draft.hours === '' ? 0 : requiredNumber(draft.hours, 'las horas')
    const minutes = draft.minutes === '' ? 0 : requiredNumber(draft.minutes, 'los minutos')
    if (minutes > 59) throw new Error('Los minutos deben estar entre 0 y 59.')
    if (draft.hours === '' && draft.minutes === '') throw new Error('Completa las horas o los minutos de sueño.')
    const totalHours = Number((hours + minutes / 60).toFixed(2))
    return `Dormí ${totalHours} horas`
  }

  const value = requiredNumber(draft.value, 'el valor')
  if (metric === 'heart_rate') return `Pulso ${value} bpm`
  if (metric === 'oxygen_saturation') return `Saturación ${value} %`
  if (metric === 'muscle_mass') return `Músculos ${value} kg`
  if (metric === 'temperature') {
    if (!draft.unit) throw new Error('Elige °C o °F.')
    return `Temperatura ${value} ${draft.unit}`
  }
  if (metric === 'glucose') {
    if (!draft.unit) throw new Error('Elige mg/dL o mmol/L.')
    return `Glucosa ${value} ${draft.unit}`
  }
  throw new Error('Elige un indicador para continuar.')
}

function StepIndicator({ step }) {
  const { tr } = useLanguage()
  return (
    <div className="registration-progress" aria-label={tr(`Paso ${step} de 3`, `Step ${step} of 3`)}>
      <div className="registration-progress__dots" aria-hidden="true">
        {[1, 2, 3].map((number) => <span key={number} className={number <= step ? 'is-active' : ''} />)}
      </div>
      <span>{tr('Paso', 'Step')} {step} {tr('de', 'of')} 3</span>
    </div>
  )
}

// Las recomendaciones generadas por el prototipo (LLM o plantilla local) NO se
// muestran en la UI: la revisión solo presenta los candidatos y el texto propios.

export default function VitalsModal({ open, onClose, onSaved, initialMetric = '' }) {
  const { language, tr } = useLanguage()
  const metricName = (code) => language === 'en' ? INDICATOR_EN[code]?.label || code : METRIC_LABELS[code] || code
  const startMetric = INDICATORS.some((item) => item.code === initialMetric) ? initialMetric : ''
  const [step, setStep] = useState(startMetric ? 2 : 1)
  const [metric, setMetric] = useState(startMetric)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [proposal, setProposal] = useState(null)
  const [reply, setReply] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedEntries, setSavedEntries] = useState([])
  const [voiceSource, setVoiceSource] = useState(null)
  const [voiceState, setVoiceState] = useState('idle') // idle | recording | transcribing | dictating
  const [voiceMsg, setVoiceMsg] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const recognitionRef = useRef(null)
  const dictationBaseRef = useRef('')

  const srSupported = typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const mediaSupported = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined'

  const stopVoice = () => {
    try { recognitionRef.current?.stop() } catch { /* ya detenido */ }
    recognitionRef.current = null
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() } catch { /* ya detenido */ }
    recorderRef.current = null
    streamRef.current?.getTracks?.().forEach((track) => track.stop())
    streamRef.current = null
    setVoiceState('idle')
    micFree()
  }

  useEffect(() => stopVoice, [])

  if (!open) return null

  const isFreeText = metric === FREE_TEXT
  const indicator = INDICATORS.find((item) => item.code === metric)
  const candidate = proposal?.candidate
  const batchMeasurements = candidate?.kind === 'batch' ? candidate.measurements : null
  const lastSaved = savedEntries.at(-1)
  const savedByMetric = Object.fromEntries(
    savedEntries.filter((entry) => entry.candidate?.kind === 'measurement').map((entry) => [entry.candidate.metric, entry])
  )
  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }))

  const reset = () => {
    stopVoice()
    setStep(1)
    setMetric('')
    setDraft(EMPTY_DRAFT)
    setProposal(null)
    setReply(null)
    setError('')
    setBusy(false)
    setSavedEntries([])
    setVoiceSource(null)
    setVoiceMsg('')
  }

  const run = async (action) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    if (proposal) await discardPending().catch(() => {})
    reset()
    onClose()
  }

  const chooseMetric = (code) => {
    if (code !== metric) setDraft(EMPTY_DRAFT)
    stopVoice()
    setMetric(code)
    setReply(null)
    setError('')
    setVoiceSource(null)
    setVoiceMsg('')
    setStep(2)
  }

  const propose = (event) => {
    event.preventDefault()
    run(async () => {
      const text = isFreeText ? draft.text.trim() : createMessage(metric, draft)
      if (isFreeText && text.length < 3) throw new Error('Escribe o dicta una lectura o síntoma primero.')
      const data = await sendMessage(text, { voice: isFreeText && Boolean(voiceSource) })
      if (data.status !== 'needs_confirmation' || !data.pending_id) {
        setReply(data)
        return
      }
      // El backend (extractor determinista o LLM) sugiere origen y fecha; se usan
      // solo como prellenado editable, nunca se guardan solos.
      const suggested = data.candidate?.suggested_origin
      const suggestedAt = data.candidate?.suggested_measured_at

      // Dictado o nota de voz con una o varias lecturas: se guardan de una vez.
      // Sin instrumento dicho se anota "Dato declarado por voz"; sin hora, la actual.
      const spokenReading = data.candidate?.kind === 'measurement' || data.candidate?.kind === 'batch'
      if (isFreeText && voiceSource && spokenReading) {
        const spokenOrigin = data.candidate.explicit_origin ? String(suggested || '').trim().slice(0, 120) : ''
        const spokenAt = data.candidate.explicit_time && suggestedAt ? new Date(suggestedAt) : new Date()
        try {
          const saved = await confirmPending({
            pending_id: data.pending_id,
            origin: spokenOrigin.length >= 2 ? spokenOrigin : 'Dato declarado por voz',
            context: '',
            measured_at: (Number.isNaN(spokenAt.getTime()) ? new Date() : spokenAt).toISOString(),
          })
          const newEntries = saved.entries?.length ? saved.entries : [saved.entry]
          setSavedEntries((current) => [...current, ...newEntries])
          setStep(1)
          setMetric('')
          setDraft(EMPTY_DRAFT)
          setProposal(null)
          setReply(null)
          setVoiceSource(null)
          setVoiceMsg('')
          await onSaved(newEntries.length)
          return
        } catch {
          // Si no se pudo (p. ej. hora futura), se muestra la revisión normal.
        }
      }
      setDraft((current) => ({
        ...current,
        origin: current.origin || suggested || '',
        measuredAt: current.measuredAt || suggestedAt || localDateTimeNow(),
      }))
      setProposal(data)
      setReply(null)
      setStep(3)
    })
  }

  const editMeasurement = () => run(async () => {
    await discardPending().catch(() => {})
    setProposal(null)
    setStep(2)
  })

  const confirm = (event) => {
    event.preventDefault()
    run(async () => {
      let saved
      try {
        saved = await confirmPending({
          pending_id: proposal.pending_id,
          origin: (draft.origin || '').trim(),
          context: draft.context,
          measured_at: new Date(draft.measuredAt).toISOString(),
        })
      } catch (caught) {
        if (caught.status === 409) {
          setProposal(null)
          setStep(2)
          throw new Error('La confirmación venció. Revisa el dato y vuelve a continuar.')
        }
        throw caught
      }
      const newEntries = saved.entries?.length ? saved.entries : [saved.entry]
      setSavedEntries((current) => [...current, ...newEntries])
      setStep(1)
      setMetric('')
      setDraft(EMPTY_DRAFT)
      setProposal(null)
      setReply(null)
      setError('')
      setVoiceSource(null)
      setVoiceMsg('')
      await onSaved(newEntries.length)
    })
  }

  // Nota de voz: se graba y se envía al backend, que la reenvía a un proveedor
  // externo de transcripción solo si tiene clave. La transcripción cae en el
  // cuadro de texto editable; nada se guarda sin confirmación.
  const startRecording = async () => {
    setVoiceMsg('')
    setError('')
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setVoiceMsg('Permiso de micrófono denegado o no disponible. Puedes seguir escribiendo con el teclado.')
      return
    }
    streamRef.current = stream
    chunksRef.current = []
    micBusy()
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data) }
    recorder.onstop = async () => {
      streamRef.current?.getTracks?.().forEach((track) => track.stop())
      streamRef.current = null
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      chunksRef.current = []
      setVoiceState('transcribing')
      setVoiceMsg('Transcribiendo la nota de voz…')
      try {
        const data = await transcribeAudio(blob)
        if (data.status === 'success' && data.text) {
          setDraft((current) => ({ ...current, text: [current.text.trim(), data.text].filter(Boolean).join(' ') }))
          setVoiceSource('note')
          setVoiceMsg('Transcripción lista en el cuadro de texto: revísala y corrígela antes de enviar.')
        } else {
          setVoiceMsg(data.message || 'No se pudo transcribir la nota de voz. Puedes escribir con el teclado.')
        }
      } catch (caught) {
        setVoiceMsg(caught.message)
      } finally {
        setVoiceState('idle')
      }
    }
    recorder.start()
    setVoiceState('recording')
    setVoiceMsg('Grabando… habla con calma y pulsa detener al terminar.')
  }

  // Dictado en vivo con Web Speech API: el audio puede salir del equipo hacia el
  // servicio del navegador. También cae en el cuadro editable.
  const startDictation = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    setVoiceMsg('')
    setError('')
    const recognition = new SR()
    recognition.lang = language === 'en' ? 'en-US' : 'es-CO'
    recognition.continuous = true
    recognition.interimResults = true
    dictationBaseRef.current = draft.text
    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript
      const base = dictationBaseRef.current
      setDraft((current) => ({ ...current, text: [base.trim(), transcript.trim()].filter(Boolean).join(' ') }))
      setVoiceSource('dictation')
    }
    recognition.onerror = (event) => {
      setVoiceMsg(DICTATION_ERRORS[event.error] || 'El dictado falló. Puedes seguir escribiendo con el teclado.')
    }
    recognition.onend = () => setVoiceState((current) => (current === 'dictating' ? 'idle' : current))
    recognitionRef.current = recognition
    try {
      micBusy()
      recognition.start()
      setVoiceState('dictating')
      setVoiceMsg('Escuchando… el texto aparece abajo y puedes corregirlo.')
    } catch {
      setVoiceMsg('No se pudo iniciar el dictado del navegador.')
    }
  }

  const renderValueFields = () => {
    if (metric === 'blood_pressure') {
      return (
        <div className="measurement-split">
          <label className="measurement-field">
            <span>{tr('Sistólica', 'Systolic')}</span>
            <div><input type="number" min="0" step="any" inputMode="decimal" value={draft.systolic} onChange={(event) => updateDraft('systolic', event.target.value)} required autoFocus /><small>mmHg</small></div>
          </label>
          <span className="measurement-split__divider" aria-hidden="true">/</span>
          <label className="measurement-field">
            <span>{tr('Diastólica', 'Diastolic')}</span>
            <div><input type="number" min="0" step="any" inputMode="decimal" value={draft.diastolic} onChange={(event) => updateDraft('diastolic', event.target.value)} required /><small>mmHg</small></div>
          </label>
        </div>
      )
    }

    if (metric === 'sleep') {
      return (
        <div className="measurement-split measurement-split--sleep">
          <label className="measurement-field">
            <span>{tr('Horas', 'Hours')}</span>
            <div><input type="number" min="0" step="1" inputMode="numeric" value={draft.hours} onChange={(event) => updateDraft('hours', event.target.value)} autoFocus /><small>h</small></div>
          </label>
          <label className="measurement-field">
            <span>{tr('Minutos', 'Minutes')}</span>
            <div><input type="number" min="0" max="59" step="1" inputMode="numeric" value={draft.minutes} onChange={(event) => updateDraft('minutes', event.target.value)} /><small>min</small></div>
          </label>
        </div>
      )
    }

    return (
      <>
        <label className="measurement-value">
          <span className="sr-only">{tr('Valor de', 'Value of')} {metricName(indicator.code)}</span>
          <input type="number" min="0" step="any" inputMode="decimal" value={draft.value} onChange={(event) => updateDraft('value', event.target.value)} placeholder="—" required autoFocus />
          {indicator.unit && <small>{indicator.unit}</small>}
        </label>
        {indicator.units && (
          <div className="unit-selector" aria-label={tr('Unidad de medida', 'Unit of measurement')}>
            {indicator.units.map((unit) => (
              <button type="button" key={unit} className={draft.unit === unit ? 'is-selected' : ''} aria-pressed={draft.unit === unit} onClick={() => updateDraft('unit', unit)}>{unit}</button>
            ))}
          </div>
        )}
      </>
    )
  }

  const renderFreeTextFields = () => (
    <>
      <label className="modal-field">
        <span>{tr('Lecturas o síntoma', 'Readings or symptom')} <b>{tr('Obligatorio', 'Required')}</b></span>
        <textarea
          className="modal-textarea"
          value={draft.text}
          onChange={(event) => updateDraft('text', event.target.value)}
          placeholder={tr('Ej.: pulso 82 bpm y temperatura 37,2 °C, o escribe un síntoma. Puedes mezclar varias lecturas con sus unidades.', 'E.g. heart rate 82 bpm and temperature 37.2 °C, or describe a symptom. You can include multiple readings and units.')}
          rows={4}
          maxLength={2000}
          required
          autoFocus
        />
      </label>

      {(mediaSupported || srSupported) && (
        <div className="voice-actions">
          {mediaSupported && (
            <button
              type="button"
              className={`secondary-button voice-button ${voiceState === 'recording' ? 'is-active' : ''}`}
              onClick={voiceState === 'recording' ? stopVoice : startRecording}
              disabled={busy || voiceState === 'transcribing' || voiceState === 'dictating'}
            >
              {voiceState === 'recording' ? <Square size={13} /> : <Mic size={13} />}
              <span>{voiceState === 'recording' ? tr('Detener grabación', 'Stop recording') : voiceState === 'transcribing' ? tr('Transcribiendo…', 'Transcribing…') : tr('Grabar nota de voz', 'Record voice note')}</span>
            </button>
          )}
          {srSupported && (
            <button
              type="button"
              className={`secondary-button voice-button ${voiceState === 'dictating' ? 'is-active' : ''}`}
              onClick={voiceState === 'dictating' ? stopVoice : startDictation}
              disabled={busy || voiceState === 'recording' || voiceState === 'transcribing'}
            >
              {voiceState === 'dictating' ? <Square size={13} /> : <Mic size={13} />}
              <span>{voiceState === 'dictating' ? tr('Detener dictado', 'Stop dictation') : tr('Dictar en vivo', 'Dictate live')}</span>
            </button>
          )}
        </div>
      )}
      {mediaSupported && (
        <p className="voice-hint">
          {tr('La nota de voz se envía al servidor y este la reenvía a un servicio externo de transcripción (OpenAI o Groq) solo si tiene clave configurada; si no la tiene, el audio no sale y se te avisa. El dictado en vivo lo procesa el navegador y puede necesitar internet. Nada se guarda sin tu confirmación.', 'The voice note is sent to the server and forwarded to an external transcription service (OpenAI or Groq) only if a key is configured; otherwise the audio is not forwarded and you are notified. Live dictation is processed by your browser and may need internet. Nothing is saved without your confirmation.')}
        </p>
      )}
      {voiceMsg && <p className="voice-status" role="status">{voiceMsg}</p>}
    </>
  )

  // El backend devuelve `recommendations` como texto o lista (solo si hay LLM configurado).
  const recommendations = [proposal?.recommendations].flat().filter((text) => typeof text === 'string' && text.trim())

  const renderCandidateReview = () => {
    if (batchMeasurements) {
      return batchMeasurements.map((m, index) => (
        <div key={`${m.metric}-${index}`}><dt>{metricName(m.metric)}</dt><dd>{formatValue(m)} {m.unit}</dd></div>
      ))
    }
    if (candidate?.kind === 'symptom') {
      return <div><dt>{tr('Síntoma o contexto declarado', 'Reported symptom or context')}</dt><dd>{candidate.original_text}</dd></div>
    }
    if (candidate?.kind === 'measurement') {
      return (
        <>
          <div><dt>{tr('Indicador', 'Metric')}</dt><dd>{metricName(candidate.metric)}</dd></div>
          <div><dt>{tr('Valor', 'Value')}</dt><dd>{formatValue(candidate)} {candidate.unit}</dd></div>
        </>
      )
    }
    return null
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && close()}>
      <div className="vitals-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="vitals-title">
        <button type="button" className="modal-close" onClick={close} aria-label={tr('Cerrar registro', 'Close form')} disabled={busy}><X /></button>

        <span className="section-title">{tr('REGISTRO MANUAL', 'MANUAL ENTRY')}</span>
        <StepIndicator step={step} />

        {step === 1 && (
          <section>
            {lastSaved && (
              <div className="registration-success" role="status">
                <Check aria-hidden="true" />
                <span>{tr('Se guardó', 'Saved')} <strong>{lastSaved.candidate?.kind === 'measurement' ? metricName(lastSaved.candidate.metric) : tr('síntoma/contexto', 'symptom/context')}</strong>{lastSaved.candidate?.kind === 'measurement' ? `: ${formatValue(lastSaved.candidate)} ${lastSaved.candidate.unit}` : ''}{savedEntries.length > 1 ? tr(` (${savedEntries.length} registros en total)`, ` (${savedEntries.length} records total)`) : ''}</span>
              </div>
            )}
            <h2 id="vitals-title">{savedEntries.length ? tr('¿Qué más vas a registrar?', 'What else would you like to record?') : tr('¿Qué vas a registrar?', 'What would you like to record?')}</h2>
            <p className="modal-intro">
              {savedEntries.length
                ? tr(`Llevas ${savedEntries.length} ${savedEntries.length === 1 ? 'dato' : 'datos'} en esta ronda. Puedes añadir otro o terminar.`, `You have ${savedEntries.length} ${savedEntries.length === 1 ? 'record' : 'records'} in this round. Add another or finish.`)
                : tr('Elige solo los indicadores que quieras registrar. Ninguno es obligatorio.', 'Choose only the metrics you want to record. None is required.')}
            </p>
            <div className="indicator-options">
              {INDICATORS.map(({ code, label, description, icon: Icon }) => {
                const savedEntry = savedByMetric[code]
                return (
                  <button type="button" key={code} className={savedEntry ? 'is-saved' : ''} onClick={() => chooseMetric(code)}>
                    {savedEntry ? <Check aria-hidden="true" /> : <Icon aria-hidden="true" />}
                    <span>
                      <strong>{language === 'en' ? INDICATOR_EN[code]?.label : label}</strong>
                      <small>{savedEntry ? `${formatValue(savedEntry.candidate)} ${savedEntry.candidate.unit}` : language === 'en' ? INDICATOR_EN[code]?.description : description}</small>
                    </span>
                  </button>
                )
              })}
              <button type="button" className="indicator-option--free" onClick={() => chooseMetric(FREE_TEXT)}>
                <Mic aria-hidden="true" />
                <span>
                  <strong>{tr('Voz o texto libre', 'Voice or free text')}</strong>
                  <small>{tr('Nota de voz, dictado o varias lecturas a la vez', 'Voice note, dictation or multiple readings at once')}</small>
                </span>
              </button>
            </div>
            {savedEntries.length > 0 && (
              <>
                <button type="button" className="primary-button registration-finish" onClick={close}>{tr('Terminar', 'Finish')}</button>
                <p className="registration-optional">{tr('Los indicadores que no elijas quedarán sin registrar.', 'Metrics you do not choose will remain unrecorded.')}</p>
              </>
            )}
          </section>
        )}

        {step === 2 && (indicator || isFreeText) && (
          <form onSubmit={propose}>
            <button type="button" className="modal-back" onClick={() => setStep(1)} disabled={busy}><ArrowLeft /> {tr('Volver', 'Back')}</button>
            <h2 id="vitals-title">{isFreeText ? tr('Voz o texto libre', 'Voice or free text') : metricName(indicator.code)}</h2>
            <p className="modal-intro">
              {isFreeText
                ? tr('El backend interpreta tu texto (extractor local, o un modelo de IA externo si el servidor tiene clave). Tú revisas todo antes de guardar.', 'The backend interprets your text (local extractor or an external AI model if configured). You review everything before saving.')
                : tr('Escribe exactamente lo que marcó el instrumento. No evaluamos si la cifra es normal.', 'Enter exactly what the instrument displayed. We do not assess whether a value is normal.')}
            </p>

            {isFreeText ? renderFreeTextFields() : <div className="measurement-entry">{renderValueFields()}</div>}

            {!isFreeText && (
              <>
                <label className="modal-field">
                  <span>{tr('Instrumento u origen', 'Instrument or source')} <em>{tr('Opcional', 'Optional')}</em></span>
                  <input value={draft.origin} onChange={(event) => updateDraft('origin', event.target.value)} placeholder={tr('Ej.: Pulsómetro, termómetro o dato declarado', 'E.g. pulse oximeter, thermometer or self-reported value')} maxLength="120" />
                </label>
                <label className="modal-field">
                  <span>{tr('Contexto', 'Context')} <em>{tr('Opcional', 'Optional')}</em></span>
                  <input value={draft.context} onChange={(event) => updateDraft('context', event.target.value)} placeholder={tr('Ej.: En reposo, después de comer…', 'E.g. at rest, after a meal…')} maxLength="500" />
                </label>
              </>
            )}

            {reply && (
              <p className={`modal-reply ${reply.status === 'safety_notice' ? 'modal-reply--warn' : ''}`} role="status">{reply.message}</p>
            )}
            {error && <p className="modal-error" role="alert">{error}</p>}
            <button className="primary-button modal-submit" type="submit" disabled={busy || (isFreeText && voiceState === 'recording' || isFreeText && voiceState === 'dictating')}>{busy ? tr('Preparando revisión…', 'Preparing review…') : tr('Continuar', 'Continue')}</button>
          </form>
        )}

        {step === 3 && proposal && candidate && (
          <form onSubmit={confirm}>
            <button type="button" className="modal-back" onClick={editMeasurement} disabled={busy}><ArrowLeft /> {tr('Editar dato', 'Edit record')}</button>
            <h2 id="vitals-title">{tr('Revisa y confirma', 'Review and confirm')}</h2>
            <p className="modal-intro">{tr('Nada se guarda hasta que presiones “Guardar registro”.', 'Nothing is saved until you press “Save record”.')}</p>

            <dl className="review-card">
              {renderCandidateReview()}
              {isFreeText && (
                <div><dt>{tr('Texto enviado', 'Submitted text')}</dt><dd>{candidate.original_text}</dd></div>
              )}
              <div><dt>{tr('Fecha y hora', 'Date and time')}</dt><dd>{formatWhen(new Date(draft.measuredAt).toISOString(), language)}</dd></div>
            </dl>

            {recommendations.length > 0 && (
              <div className="recommendations-box">
                {recommendations.map((text) => <p key={text}>{text}</p>)}
                <small>
                  Sugerencia generada por un modelo de IA externo. No es consejo médico, no evalúa
                  si tu cifra es normal y puede equivocarse. No se guarda con el registro.
                </small>
              </div>
            )}

            {isFreeText && (
              <>
                <label className="modal-field">
                <span>{tr('Instrumento u origen', 'Instrument or source')} <em>{tr('Opcional', 'Optional')}</em></span>
                <input value={draft.origin} onChange={(event) => updateDraft('origin', event.target.value)} placeholder={tr('Ej.: Pulsómetro, termómetro o dato declarado', 'E.g. pulse oximeter, thermometer or self-reported value')} maxLength="120" />
                </label>
                <label className="modal-field">
                <span>{tr('Contexto', 'Context')} <em>{tr('Opcional', 'Optional')}</em></span>
                <input value={draft.context} onChange={(event) => updateDraft('context', event.target.value)} placeholder={tr('Ej.: En reposo, después de comer…', 'E.g. at rest, after a meal…')} maxLength="500" />
                </label>
              </>
            )}

            {voiceSource && (
              <p className="voice-hint voice-hint--review">
                {tr(`Este texto vino de ${voiceSource === 'note' ? 'una nota de voz transcrita' : 'un dictado en vivo'}: compara números, unidades y negaciones con lo que dijiste. El origen es el instrumento de medición, no la voz.`, `This text came from ${voiceSource === 'note' ? 'a transcribed voice note' : 'live dictation'}: compare numbers, units and negations with what you said. The source is the measuring instrument, not your voice.`)}
              </p>
            )}

            <label className="modal-field modal-field--date">
              <span>{tr('¿La medición fue en otro momento?', 'Was this measured at another time?')}</span>
              <input type="datetime-local" value={draft.measuredAt} max={localDateTimeNow()} onChange={(event) => updateDraft('measuredAt', event.target.value)} required />
            </label>

            {error && <p className="modal-error" role="alert">{error}</p>}
            <div className="modal-actions modal-actions--stacked">
              <button className="primary-button" type="submit" disabled={busy}>{busy ? tr('Guardando…', 'Saving…') : tr('Guardar registro', 'Save record')}</button>
              <button className="secondary-button" type="button" onClick={editMeasurement} disabled={busy}>{tr('Editar', 'Edit')}</button>
            </div>
            <p className="registration-next-hint">{tr('Al guardar volverás al menú para añadir otro indicador o terminar.', 'After saving, you will return to the menu to add another metric or finish.')}</p>
          </form>
        )}
      </div>
    </div>
  )
}
