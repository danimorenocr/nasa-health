import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, BarChart3, Bell, CalendarDays, Check, ChevronDown, Edit3,
  Heart, History, LockKeyhole, Mic, MicOff, NotebookPen, Pause, Play, Sparkles, Square, Trash2, Volume2, VolumeX, X,
} from 'lucide-react'
import Panel from '../components/ui/Panel'
import {
  createJournalEntry, createReminder, deleteJournalEntry, deleteReminder,
  getCheckIns, getRewards, loadSyntheticMind, listJournalEntries, listReminders,
  recordWellnessAction, saveCheckIn, updateJournalEntry, updateReminder,
} from '../api/client'
import { localDateKey } from '../data/format'
import { useLanguage } from '../app/LanguageContext'
import { micBusy, micFree } from '../voice/micBus'

const MOOD_WORDS = ['Cansado', 'Tranquilo', 'Tenso', 'Con energía', 'Nostálgico']
const MOOD_FACES = ['☹', '🙁', '😐', '🙂', '☺']
const SCALE_FIELDS = [
  { key: 'stress', label: 'Estrés', low: '1 = nada', high: '5 = muy alto', icon: Sparkles },
  { key: 'isolation', label: 'Aislamiento', low: '1 = nada', high: '5 = muy alto', icon: Heart },
  { key: 'concentration', label: 'Concentración', low: '1 = muy difícil', high: '5 = muy fácil', icon: Activity },
  { key: 'energy', label: 'Energía', low: '1 = muy baja', high: '5 = muy alta', icon: BarChart3 },
  { key: 'sleep_difficulty', label: 'Dificultad para dormir', low: '1 = ninguna', high: '5 = mucha', icon: Pause },
]
const HISTORY_SERIES = [
  { key: 'mood_score', label: 'Ánimo', color: '#37e3ff' },
  { key: 'stress', label: 'Estrés', color: '#9a78ff' },
  { key: 'isolation', label: 'Aislamiento', color: '#3b9fff' },
  { key: 'concentration', label: 'Concentración', color: '#46d9bd' },
  { key: 'energy', label: 'Energía', color: '#f7c76a' },
  { key: 'sleep_difficulty', label: 'Dificultad para dormir', color: '#f287b7' },
]
const SERIES_EN = {
  mood_score: 'Mood', stress: 'Stress', isolation: 'Isolation', concentration: 'Concentration',
  energy: 'Energy', sleep_difficulty: 'Trouble sleeping',
}
const SCALE_NAME_EN = { stress: 'Stress', isolation: 'Isolation', concentration: 'Concentration', energy: 'Energy', sleep_difficulty: 'Trouble sleeping' }

const emptyCheckIn = { mood_score: '', mood_word: '', stress: '', isolation: '', concentration: '', energy: '', sleep_difficulty: '' }
const todayKey = () => localDateKey(new Date().toISOString())
const localDateTimeValue = (iso) => {
  const value = new Date(iso)
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function JournalHistoryDialog({ entries, language, tr, onClose, onEdit, onDelete }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    document.documentElement.classList.add('mind-dialog-open')
    if (dialog && !dialog.open) dialog.showModal()
    return () => document.documentElement.classList.remove('mind-dialog-open')
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="mind-journal-dialog"
      aria-labelledby="mind-journal-history-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}
    >
      <div className="mind-journal-dialog__heading">
        <div>
          <span className="mind-kicker"><History aria-hidden="true" /> {tr('DIARIO PRIVADO', 'PRIVATE JOURNAL')}</span>
          <h2 id="mind-journal-history-title">{tr('Historial de entradas', 'Entry history')}</h2>
          <p>{tr('Solo tú puedes consultar y modificar estas entradas.', 'Only you can view and change these entries.')}</p>
        </div>
        <button className="mind-journal-dialog__close" type="button" onClick={() => dialogRef.current?.close()} aria-label={tr('Cerrar historial', 'Close history')}><X size={21} /></button>
      </div>
      <div className="mind-journal-dialog__list">
        {entries.length ? entries.map((entry) => <article key={entry.id}>
          <time dateTime={entry.date}><CalendarDays size={15} aria-hidden="true" /> {new Date(`${entry.date}T12:00:00`).toLocaleDateString(language === 'en' ? 'en-US' : 'es-CO')}</time>
          <p>{entry.text}</p>
          <div className="mind-journal-dialog__actions">
            <button onClick={() => onEdit(entry)} type="button"><Edit3 size={14} /> {tr('Editar', 'Edit')}</button>
            <button onClick={() => onDelete(entry.id)} type="button"><Trash2 size={14} /> {tr('Borrar', 'Delete')}</button>
          </div>
        </article>) : <p className="mind-journal-dialog__empty">{tr('Todavía no hay entradas guardadas.', 'No saved entries yet.')}</p>}
      </div>
      <p className="mind-journal-dialog__note">{tr('El diario no se usa para XP, diagnósticos ni informes.', 'Journal text is not used for XP, diagnoses or reports.')}</p>
    </dialog>
  )
}

function createMeditationAudio() {
  if (typeof window === 'undefined') return null
  const audio = new Audio('/assets/MusicaMeditar.mp3')
  audio.loop = true
  audio.volume = 0.55
  return audio
}

function recentDays(count, language) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date()
    day.setHours(12, 0, 0, 0)
    day.setDate(day.getDate() - (count - 1 - index))
    return {
      key: localDateKey(day.toISOString()),
      label: count === 7
        ? day.toLocaleDateString(language === 'en' ? 'en-US' : 'es-CO', { weekday: 'short' }).replace('.', '')
        : day.toLocaleDateString(language === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short' }).replace('.', ''),
    }
  })
}

function HistoryChart({ checkIns, range, now }) {
  const { language, tr } = useLanguage()
  const days = useMemo(() => recentDays(range, language), [range, language])
  const byDate = useMemo(() => new Map(checkIns.map((item) => [item.date, item])), [checkIns])
  const chart = useMemo(() => {
    const left = 34
    const right = 718
    const top = 15
    const bottom = 207
    const x = (index) => left + (index / Math.max(1, days.length - 1)) * (right - left)
    const y = (value) => bottom - ((value - 1) / 4) * (bottom - top)
    if (range === 1) {
      // 24 horas: cada check-in en la hora real en que se guardó.
      const start = now - 24 * 3600000
      const tx = (time) => left + ((time - start) / (now - start)) * (right - left)
      const recent = checkIns
        .map((item) => ({ item, time: new Date(item.updated_at || item.created_at).getTime() }))
        .filter(({ time }) => Number.isFinite(time) && time >= start && time <= now)
        .sort((a, b) => a.time - b.time)
      const hourSeries = HISTORY_SERIES.map((meta) => {
        let path = ''
        const points = []
        recent.forEach(({ item, time }) => {
          const raw = item[meta.key]
          const value = raw === '' || raw == null ? NaN : Number(raw)
          if (!Number.isFinite(value) || value < 1 || value > 5) return
          const point = { x: tx(time), y: y(value), value, date: new Date(time).toLocaleTimeString(language === 'en' ? 'en-US' : 'es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) }
          path += `${points.length ? ' L' : ' M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
          points.push(point)
        })
        return { ...meta, path: path.trim(), points }
      })
      const hourLabels = [0, 1, 2, 3, 4].map((i) => {
        const time = start + (i * (now - start)) / 4
        return { key: `h${i}`, x: tx(time), label: new Date(time).toLocaleTimeString(language === 'en' ? 'en-US' : 'es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) }
      })
      return { series: hourSeries, labels: hourLabels, left, right, top, bottom }
    }
    const series = HISTORY_SERIES.map((meta) => {
      let path = ''
      let previous = false
      const points = []
      days.forEach((day, index) => {
        const raw = byDate.get(day.key)?.[meta.key]
        const value = raw === '' || raw == null ? NaN : Number(raw)
        if (!Number.isFinite(value) || value < 1 || value > 5) {
          previous = false
          return
        }
        const point = { x: x(index), y: y(value), value, date: day.key }
        points.push(point)
        path += `${previous ? ' L' : ' M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
        previous = true
      })
      return { ...meta, path: path.trim(), points }
    })
    const labels = days.map((day, index) => ({ ...day, x: x(index) }))
      .filter((_, index) => range === 7 || index === 0 || index === range - 1 || index % Math.ceil(range / 5) === 0)
    return { series, labels, left, right, top, bottom }
  }, [byDate, days, range, now, checkIns, language])
  const hasData = chart.series.some((item) => item.points.length > 0)

  return (
    <div className="mind-chart-wrap">
      <div className="mind-chart-legend">
        {HISTORY_SERIES.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{language === 'en' ? SERIES_EN[item.key] : item.label}</span>)}
      </div>
      <div className="mind-chart-viewport">
        <svg className="mind-line-chart" viewBox="0 0 750 250" role="img" aria-label={range === 1 ? tr('Historial real de las últimas 24 horas.', 'Real history for the last 24 hours.') : tr(`Historial real de los últimos ${range} días. Los días sin datos quedan vacíos.`, `Real history for the last ${range} days. Days without data remain empty.`)}>
          {[1, 2, 3, 4, 5].map((value) => {
            const y = chart.bottom - ((value - 1) / 4) * (chart.bottom - chart.top)
            return <g key={value}><line className="mind-chart-gridline" x1={chart.left} x2={chart.right} y1={y} y2={y} /><text className="mind-chart-axis" x="11" y={y + 4}>{value}</text></g>
          })}
          {chart.labels.map((day) => <text className="mind-chart-axis mind-chart-day" key={day.key} x={day.x} y="239" textAnchor={day.x === chart.left ? 'start' : day.x === chart.right ? 'end' : 'middle'}>{day.label}</text>)}
          {chart.series.map((item) => <g key={item.key}>
            <path className="mind-chart-line" d={item.path} stroke={item.color} />
            {item.points.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r={range === 7 ? 5 : 3.5} fill={item.color}><title>{`${language === 'en' ? SERIES_EN[item.key] : item.label}: ${point.value} · ${point.date}`}</title></circle>)}
          </g>)}
        </svg>
        {!hasData && <p className="mind-chart-empty">{range === 1 ? tr('Sin check-ins guardados en las últimas 24 horas.', 'No check-ins saved in the last 24 hours.') : tr('Aquí aparecerá tu historial cuando guardes un check-in.', 'Your history will appear here after you save a check-in.')}</p>}
      </div>
    </div>
  )
}

export default function MindTrackerPage({ onNotify }) {
  const { language, tr } = useLanguage()
  const [checkIns, setCheckIns] = useState([])
  const [checkInDate, setCheckInDate] = useState(todayKey())
  const [checkIn, setCheckIn] = useState(emptyCheckIn)
  const [journalEntries, setJournalEntries] = useState([])
  const [journalForm, setJournalForm] = useState({ id: null, entry_date: todayKey(), text: '' })
  const [journalHistoryOpen, setJournalHistoryOpen] = useState(false)
  const journalTextRef = useRef(null)
  const [reminders, setReminders] = useState([])
  const [reminderForm, setReminderForm] = useState({ id: null, kind: 'pause', title: '', remind_at: '' })
  const [reminderOpen, setReminderOpen] = useState(false)
  const [breathing, setBreathing] = useState('idle')
  const [breathingSeconds, setBreathingSeconds] = useState(0)
  const [pauseCompleted, setPauseCompleted] = useState(false)
  const [saving, setSaving] = useState(false)
const scaleQueue = useRef(Promise.resolve())
  const [historyRange, setHistoryRange] = useState(1)
const [historyNow, setHistoryNow] = useState(() => Date.now())
  const [dictating, setDictating] = useState(false)
  const [dictationMessage, setDictationMessage] = useState('')
  const recognitionRef = useRef(null)
  const dictationBaseRef = useRef('')
  const ambientRef = useRef(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const speechSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      try { recognitionRef.current.stop() } catch { /* ya se detuvo */ }
    }
    if (ambientRef.current) {
      try { ambientRef.current.pause() } catch {}
      ambientRef.current = null
    }
  }, [])

  const stopDictation = () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      try { recognitionRef.current.stop() } catch { /* ya se detuvo */ }
    }
    recognitionRef.current = null
    setDictating(false)
    micFree()
  }

  const toggleDictation = () => {
    if (dictating) { stopDictation(); return }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const recognition = new SpeechRecognition()
    recognition.lang = language === 'en' ? 'en-US' : 'es-CO'
    recognition.continuous = true
    recognition.interimResults = true
    dictationBaseRef.current = journalForm.text.trim()
    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0].transcript
      setJournalForm((form) => ({ ...form, text: [dictationBaseRef.current, transcript.trim()].filter(Boolean).join(' ') }))
    }
    recognition.onerror = (event) => {
      setDictationMessage(event.error === 'not-allowed' ? tr('Permite el micrófono para dictar. También puedes escribir.', 'Allow microphone access to dictate. You can also type.') : tr('El dictado se interrumpió; el texto ya capturado sigue editable.', 'Dictation stopped; captured text remains editable.'))
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) { recognitionRef.current = null; setDictating(false); micFree() }
    }
    recognitionRef.current = recognition
    try {
      micBusy()
      recognition.start()
      setDictating(true)
      setDictationMessage(tr('Escuchando… Detén el dictado para revisar el texto antes de guardarlo.', 'Listening… Stop dictation and review the text before saving.'))
    } catch {
      recognitionRef.current = null
      setDictationMessage(tr('No se pudo iniciar el dictado en este navegador.', 'Could not start dictation in this browser.'))
    }
  }

  const stopAmbient = () => {
    if (ambientRef.current) {
      try {
        ambientRef.current.pause()
        ambientRef.current.currentTime = 0
      } catch {}
    }
  }

  const pauseAmbient = () => {
    if (ambientRef.current) {
      try { ambientRef.current.pause() } catch {}
    }
  }

  const playAmbient = () => {
    if (!soundEnabled) return
    try {
      if (!ambientRef.current) ambientRef.current = createMeditationAudio()
      ambientRef.current?.play().catch(() => {
        onNotify?.(tr('Toca el botón de sonido para reproducir la música de meditación.', 'Tap sound button to start meditation music.'))
      })
    } catch {
      onNotify?.(tr('No se pudo reproducir la música de meditación.', 'Could not play meditation music.'))
    }
  }

  const toggleBreathing = () => {
    if (breathing === 'running') {
      pauseAmbient()
      setBreathing('paused')
    } else {
      playAmbient()
      setBreathing('running')
    }
  }

  const toggleSound = () => {
    if (soundEnabled) {
      pauseAmbient()
      setSoundEnabled(false)
    } else {
      setSoundEnabled(true)
      if (breathing === 'running') {
        try {
          if (!ambientRef.current) ambientRef.current = createMeditationAudio()
          ambientRef.current?.play().catch(() => {})
        } catch {}
      }
    }
  }

  const loadMindData = async (selectedDate = checkInDate) => {
    const [checkInData, journalData, reminderData, rewardData] = await Promise.all([
      getCheckIns(3650), listJournalEntries(), listReminders(), getRewards(),
    ])
    const loadedCheckIns = checkInData.check_ins || []
    setCheckIns(loadedCheckIns)
    setJournalEntries(journalData.entries || [])
    setReminders(reminderData.reminders || [])
    setPauseCompleted(Boolean(rewardData.weekly_mission?.conditions?.find((item) => item.code === 'pause')?.complete))
    const selected = loadedCheckIns.find((item) => item.date === selectedDate)
    setCheckIn(selected ? { ...emptyCheckIn, ...selected } : emptyCheckIn)
  }

  useEffect(() => { loadMindData().catch((error) => onNotify?.(error.message)) }, [])

  useEffect(() => {
    if (breathing !== 'running') return undefined
    const timer = window.setInterval(() => setBreathingSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [breathing])

  const updateCheckIn = (key, value) => setCheckIn((current) => ({ ...current, [key]: value }))
  const selectCheckInDate = (value) => {
    setCheckInDate(value)
    const selected = checkIns.find((item) => item.date === value)
    setCheckIn(selected ? { ...emptyCheckIn, ...selected } : emptyCheckIn)
  }

  // Cada vez que cambia una escala se guarda de una vez (en orden) y se avisa.
  // El check-in necesita ánimo y palabra; sin ellos la escala queda en pantalla
  // y se guardará junto con el check-in.
  const handleLoadDemo = async () => {
    try {
      const result = await loadSyntheticMind()
      await loadMindData(checkInDate)
      onNotify?.(tr(`Datos de prueba de bienestar cargados (${result.check_ins} días).`, `Wellbeing demo data loaded (${result.check_ins} days).`))
    } catch (error) { onNotify?.(error.message) }
  }

  const handleScaleChange = (item, value) => {
    const next = { ...checkIn, [item.key]: value }
    setCheckIn(next)
    if (!next.mood_score || !next.mood_word) {
      onNotify?.(tr('Elige primero el ánimo y una palabra: así se guardan también tus escalas.', 'First choose a mood level and a word so your scales can be saved too.'))
      return
    }
    const payload = { mood_score: Number(next.mood_score), mood_word: next.mood_word }
    for (const { key } of SCALE_FIELDS) if (next[key]) payload[key] = Number(next[key])
    const name = language === 'en' ? SCALE_NAME_EN[item.key] : item.label
    const date = checkInDate
    scaleQueue.current = scaleQueue.current.then(async () => {
      try {
        const result = await saveCheckIn(date, payload)
        const saved = result.check_in
        setCheckIns((list) => [...list.filter((entry) => entry.date !== date), saved].sort((a, b) => a.date.localeCompare(b.date)))
        setCheckIn((current) => ({ ...current, id: saved.id }))
        onNotify?.(value
          ? tr(`Guardado: ${name} = ${value}.`, `Saved: ${name} = ${value}.`)
          : tr(`Guardado: ${name} sin responder.`, `Saved: ${name} left unanswered.`))
      } catch (error) { onNotify?.(error.message) }
    })
  }

  const handleSaveCheckIn = async () => {
    if (!checkIn.mood_score || !checkIn.mood_word) {
      onNotify?.(tr('Elige un nivel de ánimo y una palabra. Las demás escalas son opcionales.', 'Choose a mood level and a word. Other scales are optional.'))
      return
    }
    setSaving(true)
    try {
      const payload = { mood_score: Number(checkIn.mood_score), mood_word: checkIn.mood_word }
      for (const { key } of SCALE_FIELDS) if (checkIn[key]) payload[key] = Number(checkIn[key])
      const result = await saveCheckIn(checkInDate, payload)
      await loadMindData(checkInDate)
      onNotify?.(result.status === 'updated' ? tr('Check-in actualizado.', 'Check-in updated.') : tr('Check-in guardado.', 'Check-in saved.'))
    } catch (error) { onNotify?.(error.message) }
    finally { setSaving(false) }
  }

  const resetJournal = () => { stopDictation(); setJournalForm({ id: null, entry_date: todayKey(), text: '' }) }
  const editJournal = (entry) => {
    stopDictation()
    setJournalForm({ id: entry.id, entry_date: entry.date, text: entry.text })
    setJournalHistoryOpen(false)
    window.requestAnimationFrame(() => journalTextRef.current?.focus())
  }
  const handleSaveJournal = async () => {
    if (dictating) stopDictation()
    if (!journalForm.text.trim()) return onNotify?.(tr('Escribe algo antes de guardar la entrada.', 'Write something before saving the entry.'))
    try {
      const payload = { entry_date: journalForm.entry_date, text: journalForm.text.trim() }
      if (journalForm.id) await updateJournalEntry(journalForm.id, payload)
      else await createJournalEntry(payload)
      const data = await listJournalEntries()
      setJournalEntries(data.entries || [])
      resetJournal()
      onNotify?.(tr('Entrada privada guardada.', 'Private entry saved.'))
    } catch (error) { onNotify?.(error.message) }
  }
  const handleDeleteJournal = async (id) => {
    try {
      await deleteJournalEntry(id)
      setJournalEntries((items) => items.filter((item) => item.id !== id))
      if (journalForm.id === id) resetJournal()
      onNotify?.(tr('Entrada eliminada.', 'Entry deleted.'))
    } catch (error) { onNotify?.(error.message) }
  }

  const finishBreathing = async () => {
    stopAmbient()
    setBreathing('idle')
    setBreathingSeconds(0)
    try {
      await recordWellnessAction('breathing_completed', todayKey())
      onNotify?.(tr('Sesión de respiración finalizada voluntariamente.', 'Breathing session finished voluntarily.'))
    } catch (error) { onNotify?.(error.message) }
  }
  const completePause = async () => {
    try {
      await recordWellnessAction('pause_completed', todayKey())
      setPauseCompleted(true)
      onNotify?.(tr('Pausa marcada como realizada.', 'Break marked as completed.'))
    } catch (error) { onNotify?.(error.message) }
  }

  const resetReminder = () => {
    setReminderForm({ id: null, kind: 'pause', title: '', remind_at: '' })
    setReminderOpen(false)
  }
  const handleSaveReminder = async () => {
    if (!reminderForm.title.trim() || !reminderForm.remind_at) return onNotify?.(tr('Completa el aviso y su fecha.', 'Enter a reminder and its date.'))
    try {
      const payload = { kind: reminderForm.kind, title: reminderForm.title.trim(), remind_at: new Date(reminderForm.remind_at).toISOString() }
      if (reminderForm.id) await updateReminder(reminderForm.id, payload)
      else await createReminder(payload)
      const data = await listReminders()
      setReminders(data.reminders || [])
      resetReminder()
      onNotify?.(tr('Recordatorio guardado. No se marcará como realizado automáticamente.', 'Reminder saved. It will not be marked completed automatically.'))
    } catch (error) { onNotify?.(error.message) }
  }
  const handleDeleteReminder = async (id) => {
    try {
      await deleteReminder(id)
      setReminders((items) => items.filter((item) => item.id !== id))
      if (reminderForm.id === id) resetReminder()
      onNotify?.(tr('Recordatorio eliminado.', 'Reminder deleted.'))
    } catch (error) { onNotify?.(error.message) }
  }

  return (
    <section className="mind-tracker" aria-label={tr('Bienestar psicológico', 'Mental wellbeing')}>
      <div className="mind-top-grid">
        <Panel className="mind-checkin-card">
          <div className="mind-card-heading">
            <span className="mind-kicker"><Activity aria-hidden="true" /> {tr('CHECK-IN DIARIO', 'DAILY CHECK-IN')}</span>
            <label className="mind-date-field"><CalendarDays aria-hidden="true" size={16} /><span className="sr-only">{tr('Fecha del check-in', 'Check-in date')}</span><input type="date" max={todayKey()} value={checkInDate} onChange={(event) => selectCheckInDate(event.target.value)} /></label>
          </div>
          <div className="mind-checkin-content">
            <h2>{tr('¿Cómo te sientes hoy?', 'How are you feeling today?')}</h2>
            <p>{tr('Elige tus respuestas. Nada aparece seleccionado de antemano.', 'Choose your answers. Nothing is preselected.')}</p>
            <fieldset className="mind-choice-group mind-score-group">
              <legend>{tr('Ánimo · 1 es muy bajo y 5 es muy alto', 'Mood · 1 is very low and 5 is very high')}</legend>
              <div className="mind-score-options">
                {MOOD_FACES.map((face, index) => <button key={index} className={Number(checkIn.mood_score) === index + 1 ? 'is-selected' : ''} onClick={() => updateCheckIn('mood_score', index + 1)} type="button" aria-label={tr(`Ánimo ${index + 1} de 5`, `Mood ${index + 1} of 5`)} aria-pressed={Number(checkIn.mood_score) === index + 1}><span aria-hidden="true">{face}</span><small>{index + 1}</small></button>)}
              </div>
            </fieldset>
            <fieldset className="mind-choice-group mind-word-group">
              <legend>{tr('Elige una palabra', 'Choose a word')}</legend>
              <div className="mind-mood-options">
                {MOOD_WORDS.map((word) => <button key={word} className={checkIn.mood_word === word ? 'is-selected' : ''} onClick={() => updateCheckIn('mood_word', word)} type="button" aria-pressed={checkIn.mood_word === word}>{language === 'en' ? ({ Cansado: 'Tired', Tranquilo: 'Calm', Tenso: 'Tense', 'Con energía': 'Energetic', Nostálgico: 'Nostalgic' }[word]) : word}</button>)}
              </div>
            </fieldset>
            <button className="primary-button mind-save-button" onClick={handleSaveCheckIn} disabled={saving} type="button"><Check size={17} /> {saving ? tr('Guardando…', 'Saving…') : checkIn.id ? tr('Actualizar check-in', 'Update check-in') : tr('Guardar check-in', 'Save check-in')}</button>
          </div>
        </Panel>

        <Panel className="mind-scales-card">
          <div className="mind-card-heading"><span className="mind-kicker"><BarChart3 aria-hidden="true" /> {tr('ESCALAS OPCIONALES', 'OPTIONAL SCALES')}</span><small className="mind-history-note">{tr('Se guardan al cambiarlas', 'Saved when you change them')}</small></div>
          <div className="mind-scales">
            {SCALE_FIELDS.map((item) => <label className="mind-scale-input" key={item.key}>
              <item.icon aria-hidden="true" className="mind-scale-icon" size={21} />
              <span><strong>{language === 'en' ? SCALE_NAME_EN[item.key] : item.label}</strong><small>{language === 'en' ? ({ stress: '1 = none · 5 = very high', isolation: '1 = none · 5 = very high', concentration: '1 = very hard · 5 = very easy', energy: '1 = very low · 5 = very high', sleep_difficulty: '1 = none · 5 = a lot' }[item.key]) : `${item.low} · ${item.high}`}</small></span>
              <select value={checkIn[item.key]} onChange={(event) => handleScaleChange(item, event.target.value)}><option value="">{tr('Sin responder', 'No answer')}</option>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select>
            </label>)}
          </div>
        </Panel>

        <Panel className="mind-journal-card">
          <div className="mind-card-heading"><span className="mind-kicker"><NotebookPen aria-hidden="true" /> {tr('DIARIO EMOCIONAL', 'EMOTIONAL JOURNAL')}</span><LockKeyhole aria-label={tr('Privado', 'Private')} size={17} /></div>
          <div className="mind-journal-form">
            <label className="sr-only" htmlFor="mind-journal-date">{tr('Fecha de la entrada', 'Entry date')}</label>
            <input id="mind-journal-date" type="date" max={todayKey()} value={journalForm.entry_date} onChange={(event) => setJournalForm((form) => ({ ...form, entry_date: event.target.value }))} />
            <label className="sr-only" htmlFor="mind-journal-text">{tr('Entrada privada', 'Private entry')}</label>
            <textarea ref={journalTextRef} id="mind-journal-text" value={journalForm.text} onChange={(event) => setJournalForm((form) => ({ ...form, text: event.target.value }))} placeholder={tr('Escribe una entrada privada…', 'Write a private entry…')} readOnly={dictating} />
            <div className="mind-dictation-row"><button className={dictating ? 'is-listening' : ''} type="button" onClick={toggleDictation} disabled={!speechSupported}>{dictating ? <MicOff size={15} /> : <Mic size={15} />}{dictating ? tr('Detener dictado', 'Stop dictation') : tr('Dictar en vivo', 'Dictate live')}</button><small>{dictationMessage || (speechSupported ? tr('El navegador puede procesar tu voz mediante un servicio externo. Revisa el texto antes de guardarlo.', 'Your browser may process speech through an external service. Review the text before saving.') : tr('El dictado en vivo no está disponible en este navegador.', 'Live dictation is unavailable in this browser.'))}</small></div>
            <div className="mind-form-actions">{journalForm.id && <button type="button" onClick={resetJournal}>{tr('Cancelar', 'Cancel')}</button>}<button className="primary-button" type="button" onClick={handleSaveJournal}>{journalForm.id ? tr('Actualizar', 'Update') : tr('Guardar', 'Save')}</button></div>
          </div>
          <button className="mind-journal-history-button" type="button" onClick={() => setJournalHistoryOpen(true)} aria-haspopup="dialog">
            <span><History size={18} aria-hidden="true" /><span><strong>{tr('Ver historial del diario', 'View journal history')}</strong><small>{journalEntries.length ? tr('Entradas privadas guardadas', 'Saved private entries') : tr('Tus entradas aparecerán aquí', 'Your entries will appear here')}</small></span></span>
            <span className="mind-journal-history-count">{journalEntries.length}</span>
          </button>
        </Panel>
      </div>

      <div className="mind-bottom-grid">
        <Panel className="mind-weekly-card">
          <div className="mind-card-heading mind-history-heading"><span className="mind-kicker"><BarChart3 aria-hidden="true" /> {historyRange === 1 ? tr('HISTORIAL · ÚLTIMAS 24 HORAS', 'HISTORY · LAST 24 HOURS') : <>{tr('HISTORIAL · ÚLTIMOS', 'HISTORY · LAST')} {historyRange} {tr('DÍAS', 'DAYS')}</>}</span><button type="button" className="mind-demo-button" onClick={handleLoadDemo}>{tr('Cargar datos de prueba', 'Load demo data')}</button><div className="mind-range-tabs" role="group" aria-label={tr('Período del historial', 'History period')}>{[1, 7, 30, 90].map((range) => <button type="button" key={range} className={historyRange === range ? 'is-selected' : ''} onClick={() => { setHistoryNow(Date.now()); setHistoryRange(range) }} aria-pressed={historyRange === range}>{range === 1 ? '24 h' : `${range} ${tr('días', 'days')}`}</button>)}</div></div>
          <p className="mind-history-note">{historyRange === 1 ? tr('En 24 h cada check-in aparece a la hora en que lo guardaste. No se estiman horas sin registro.', 'In 24 h each check-in appears at the time you saved it. Hours without records are not estimated.') : tr('Cada gráfica usa tus check-ins. Un día sin respuesta queda vacío, nunca se convierte en cero.', 'Charts use your check-ins. A day without an answer stays empty; it is never shown as zero.')}</p>
          <HistoryChart checkIns={checkIns} range={historyRange} now={historyNow} />
        </Panel>

        <Panel className="mind-wellness-card">
          <div className="mind-card-heading"><span className="mind-kicker"><Sparkles aria-hidden="true" /> {tr('HERRAMIENTAS DE BIENESTAR', 'WELLBEING TOOLS')}</span></div>
          <button className={`mind-breath is-${breathing}`} onClick={toggleBreathing} type="button" aria-label={breathing === 'idle' ? tr('Comenzar respiración', 'Start breathing') : breathing === 'running' ? tr('Pausar respiración', 'Pause breathing') : tr('Continuar respiración', 'Resume breathing')}><Sparkles aria-hidden="true" size={28} /><span>{breathing === 'running' ? tr('Respira suave', 'Breathe gently') : breathing === 'paused' ? tr('En pausa', 'Paused') : tr('Comenzar', 'Start')}<strong>{Math.floor(breathingSeconds / 60)}:{String(breathingSeconds % 60).padStart(2, '0')}</strong></span></button>
          <div className="mind-breath-controls"><button onClick={toggleBreathing} disabled={breathing === 'idle'} type="button">{breathing === 'running' ? <Pause size={13} /> : <Play size={13} />} {breathing === 'running' ? tr('Pausar', 'Pause') : tr('Continuar', 'Resume')}</button><button onClick={finishBreathing} disabled={breathing === 'idle'} type="button"><Square size={12} /> {tr('Terminar', 'Finish')}</button></div>
          <button className="mind-sound-toggle" onClick={toggleSound} type="button" aria-pressed={soundEnabled}>{soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}{soundEnabled ? tr('Sonido ambiental: activado', 'Ambient sound: on') : tr('Sonido ambiental: apagado', 'Ambient sound: off')}</button>
          <p>{tr('Sin retenciones obligatorias. Sonido suave opcional; puedes parar cuando quieras.', 'No mandatory breath holds. Optional gentle sound; stop whenever you want.')}</p>
          <button className={`mind-wellness-task ${pauseCompleted ? 'is-complete' : ''}`} onClick={completePause} type="button"><span><Heart aria-hidden="true" size={17} /> {tr('Pausa voluntaria', 'Optional break')}</span><small>{pauseCompleted ? tr('Realizada', 'Completed') : tr('Marcar como realizada', 'Mark as completed')}</small></button>
          <button className="mind-reminder-toggle" type="button" onClick={() => setReminderOpen((open) => !open)} aria-expanded={reminderOpen}><span><Bell aria-hidden="true" size={17} /> {reminderForm.id ? tr('Editar recordatorio', 'Edit reminder') : tr('Nuevo recordatorio', 'New reminder')}</span><ChevronDown aria-hidden="true" size={17} /></button>
          {reminderOpen && <div className="mind-reminder-form"><label className="sr-only" htmlFor="mind-reminder-kind">{tr('Tipo de recordatorio', 'Reminder type')}</label><select id="mind-reminder-kind" value={reminderForm.kind} onChange={(event) => setReminderForm((form) => ({ ...form, kind: event.target.value }))}><option value="pause">{tr('Pausa', 'Break')}</option><option value="contact">{tr('Contactar a alguien', 'Contact someone')}</option></select><label className="sr-only" htmlFor="mind-reminder-title">{tr('Nombre del aviso', 'Reminder name')}</label><input id="mind-reminder-title" value={reminderForm.title} onChange={(event) => setReminderForm((form) => ({ ...form, title: event.target.value }))} placeholder={tr('Ej. Escribir a casa', 'E.g. Write home')} /><label className="sr-only" htmlFor="mind-reminder-date">{tr('Fecha y hora del aviso', 'Reminder date and time')}</label><input id="mind-reminder-date" type="datetime-local" value={reminderForm.remind_at} onChange={(event) => setReminderForm((form) => ({ ...form, remind_at: event.target.value }))} /><div className="mind-form-actions"><button onClick={resetReminder} type="button">{tr('Cancelar', 'Cancel')}</button><button className="primary-button" onClick={handleSaveReminder} type="button">{tr('Guardar aviso', 'Save reminder')}</button></div></div>}
          <div className="mind-reminder-list">{reminders.map((item) => <article key={item.id}><span><strong>{item.title}</strong><small>{new Date(item.remind_at).toLocaleString(language === 'en' ? 'en-US' : 'es-CO')}</small></span><button aria-label={tr(`Editar ${item.title}`, `Edit ${item.title}`)} onClick={() => { setReminderForm({ id: item.id, kind: item.kind, title: item.title, remind_at: localDateTimeValue(item.remind_at) }); setReminderOpen(true) }} type="button"><Edit3 size={13} /></button><button aria-label={tr(`Borrar ${item.title}`, `Delete ${item.title}`)} onClick={() => handleDeleteReminder(item.id)} type="button"><Trash2 size={13} /></button></article>)}</div>
          <button className="mind-support-button" disabled type="button">{tr('Apoyo · No disponible en esta demo', 'Support · Unavailable in this demo')}</button>
        </Panel>
      </div>
      {journalHistoryOpen && <JournalHistoryDialog entries={journalEntries} language={language} tr={tr} onClose={() => setJournalHistoryOpen(false)} onEdit={editJournal} onDelete={handleDeleteJournal} />}
    </section>
  )
}
