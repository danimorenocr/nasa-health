// Adaptador de voz del navegador para el motor de astraVoice.js.
//
// Usa la Web Speech API (SpeechRecognition + SpeechSynthesis), igual que la
// demo /demo del backend: el reconocimiento lo ejecuta el servicio de voz del
// navegador (puede necesitar internet) y la síntesis es local. Solo funciona
// con la pestaña abierta; no hay escucha con pestaña cerrada ni pantalla
// bloqueada. Si falta alguna pieza, `supported` es false y `reason` lo explica.

export function createBrowserSpeech({ isMuted = () => false } = {}) {
  const SR = typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  const synthOk = Boolean(synth) && typeof SpeechSynthesisUtterance !== 'undefined'
  const supported = Boolean(SR) && synthOk

  const reason = !SR && !synthOk
    ? 'Este navegador no tiene reconocimiento ni síntesis de voz (prueba Chrome o Edge). Puedes registrar con el teclado.'
    : !SR
      ? 'Este navegador no tiene reconocimiento de voz (prueba Chrome o Edge). Puedes registrar con el teclado.'
      : 'Este navegador no puede hablar las respuestas (síntesis de voz ausente). Puedes registrar con el teclado.'

  const pickSpanishVoice = () => {
    try {
      const voices = synth.getVoices ? synth.getVoices() : []
      return voices.find((v) => v.lang && (v.lang.startsWith('es-CO') || v.lang.startsWith('es')))
    } catch {
      return undefined
    }
  }

  const speak = (text) => new Promise((resolve) => {
    if (!synthOk || !text || isMuted()) {
      resolve()
      return
    }
    try {
      synth.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'es-CO'
      utterance.rate = 1
      const voice = pickSpanishVoice()
      if (voice) utterance.voice = voice
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      synth.speak(utterance)
    } catch {
      resolve()
    }
  })

  const stopSpeaking = () => {
    if (!synthOk) return
    try { synth.cancel() } catch { /* ya detenida */ }
  }

  // mode 'wake': continuo, solo resultados finales (vigilar la palabra clave).
  // mode 'turn': una frase, con resultados parciales para mostrar en pantalla.
  // mode 'collect': continuo, con parciales; el motor decide cuándo cortar (ventana de silencio).
  const createRecognition = (mode) => {
    const rec = new SR()
    rec.lang = 'es-CO'
    rec.continuous = mode === 'wake' || mode === 'collect'
    rec.interimResults = mode !== 'wake'
    const wrapper = {
      onresult: null,
      onerror: null,
      onend: null,
      start: () => rec.start(),
      stop: () => rec.stop(),
    }
    rec.onresult = (event) => {
      if (!wrapper.onresult) return
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result.isFinal) finalText += ` ${result[0].transcript}`
        else interimText += ` ${result[0].transcript}`
      }
      if (finalText.trim()) {
        wrapper.onresult({ isFinal: true, transcript: finalText.trim() })
      } else if (mode !== 'wake' && interimText.trim()) {
        wrapper.onresult({ isFinal: false, transcript: interimText.trim() })
      }
    }
    rec.onerror = (event) => wrapper.onerror?.({ error: event.error || 'unknown' })
    rec.onend = () => wrapper.onend?.()
    return wrapper
  }

  return { supported, reason: supported ? '' : reason, createRecognition, speak, stopSpeaking }
}
