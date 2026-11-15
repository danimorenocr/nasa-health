import { useCallback, useEffect, useRef, useState } from 'react'
import { STATUS } from '../../voice/astraVoice'
import { useLanguage } from '../../app/LanguageContext'

const HOLD_MS = 5000 // la respuesta de Astra se queda visible unos segundos al terminar de hablar
const BARS = Array.from({ length: 21 }, (_, index) => index)

export function phaseOf(status) {
  switch (status) {
    case STATUS.WAKE: return 'idle'
    case STATUS.LISTENING:
    case STATUS.AWAIT_ORIGIN:
    case STATUS.AWAIT_CONFIRM: return 'listening'
    case STATUS.THINKING: return 'thinking'
    case STATUS.GREETING:
    case STATUS.SPEAKING: return 'speaking'
    case STATUS.ERROR: return 'error'
    default: return 'off'
  }
}

// Estado de Astra para pintar el dashboard: fase actual y la última respuesta (que se
// mantiene visible un momento después de hablar).
export function useAstraOverlay() {
  const [snap, setSnap] = useState(null)
  const [reply, setReply] = useState({ text: '', visible: false })
  const timer = useRef(null)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onAstraState = useCallback((next) => {
    setSnap(next)
    window.clearTimeout(timer.current)
    const speaking = next.status === STATUS.SPEAKING || next.status === STATUS.GREETING
    if (speaking) {
      setReply({ text: next.lastAstraText || '', visible: true })
    } else if (next.status === STATUS.OFF || next.status === STATUS.THINKING) {
      setReply((current) => (current.visible ? { ...current, visible: false } : current))
    } else {
      timer.current = window.setTimeout(() => setReply((current) => ({ ...current, visible: false })), HOLD_MS)
    }
  }, [])

  return { snap, reply, onAstraState }
}

// Resplandor alrededor del muñeco: cambia de color según lo que hace Astra y muestra
// qué está pasando (escuchando, procesando, o su respuesta con ondas de sonido).
export default function AstraAura({ snap, reply }) {
  const { tr } = useLanguage()
  const phase = phaseOf(snap?.status)
  if (phase === 'off') return null

  const showReply = reply.visible && phase !== 'thinking' && phase !== 'listening'
  let caption = null
  if (phase === 'thinking') {
    caption = (
      <p className="astra-aura__text astra-aura__text--thinking" role="status">
        {tr('Procesando', 'Processing')}
        <span className="astra-aura__dots" aria-hidden="true"><i /><i /><i /></span>
      </p>
    )
  } else if (phase === 'listening') {
    caption = (
      <p className="astra-aura__text astra-aura__text--listening" role="status">
        {snap?.lastUserText ? `“${snap.lastUserText}”` : tr('Te escucho…', "I'm listening…")}
      </p>
    )
  } else if (showReply && reply.text) {
    caption = (
      <>
        <p className="astra-aura__text astra-aura__text--speaking" role="status">{reply.text}</p>
        <div className="astra-aura__wave" aria-hidden="true">
          {BARS.map((bar) => <i key={bar} style={{ '--bar': bar }} />)}
        </div>
      </>
    )
  } else if (phase === 'idle') {
    caption = <p className="astra-aura__hint">{tr('Di “Hey Astra”', 'Say “Hey Astra”')}</p>
  } else if (phase === 'error') {
    caption = <p className="astra-aura__text">{snap?.detail || tr('Error de voz', 'Voice error')}</p>
  }

  return (
    <div className={`astra-aura astra-aura--${phase} ${showReply ? 'is-replying' : ''}`} aria-live="polite">
      <div className="astra-aura__glow" aria-hidden="true" />
      <div className="astra-aura__ring" aria-hidden="true" />
      {caption && <div className="astra-aura__caption">{caption}</div>}
    </div>
  )
}
