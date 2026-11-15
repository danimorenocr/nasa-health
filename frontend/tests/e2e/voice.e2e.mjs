// E2E ad-hoc de la conversación de voz de Astra (ver README; no corre en npm test).
/* eslint-disable no-undef -- mezcla código Node (playwright) con código inyectado en la página */
// Front compilado servido por el backend real en 127.0.0.1:8123.
// SpeechRecognition y speechSynthesis se simulan en la página; la "voz" de la
// usuaria la inyecta el test y las respuestas habladas quedan en __spoken.
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:8123'
const EMAIL = `astra-e2e-${Date.now()}@example.com`
const PASSWORD = 'mision-sintetica-2026'

const initScript = () => {
  class FakeRec {
    constructor() {
      this.lang = ''
      this.continuous = false
      this.interimResults = false
      this.onresult = null
      this.onerror = null
      this.onend = null
      window.__recs.push(this)
    }

    start() {
      this.started = true
      window.__currentRec = this
    }

    stop() { this.stopped = true }
    abort() { this.stopped = true }
  }
  window.__recs = []
  window.__currentRec = null
  window.__spoken = []
  window.SpeechRecognition = FakeRec
  window.webkitSpeechRecognition = FakeRec
  window.__drive = (text) => {
    const rec = window.__currentRec
    if (!rec || !rec.onresult) throw new Error('no active recognition')
    const item = [{ transcript: text, confidence: 1 }]
    item.isFinal = true
    rec.onresult({ resultIndex: 0, results: [item] })
  }
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text }
  }
  const synthStub = {
    cancel() {},
    getVoices: () => [],
    speak(utterance) {
      window.__spoken.push(utterance.text)
      setTimeout(() => utterance.onend?.(), 5)
    },
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synthStub, configurable: true })
}

const step = (name) => console.log('STEP:', name)

const statusIs = (page, text) =>
  page.waitForFunction(
    (expected) => document.querySelector('.astra-voice__status')?.textContent.includes(expected),
    text,
    { timeout: 8000 },
  )

// Dice una frase y espera una respuesta hablada NUEVA que contenga el fragmento.
// Si se pasa statusText, además espera ese estado (garantiza que el siguiente
// reconocimiento ya está activo antes de "hablar" otra vez).
const driveAndWait = async (page, text, fragment, statusText) => {
  const before = await page.evaluate(() => window.__spoken.length)
  await page.evaluate((utterance) => window.__drive(utterance), text)
  await page.waitForFunction(
    ({ n, frag }) => window.__spoken.slice(n).some((spoken) => spoken.includes(frag)),
    { n: before, frag: fragment },
    { timeout: 8000 },
  )
  if (statusText) await statusIs(page, statusText)
}

const entryCount = (page) =>
  page.evaluate(async () => {
    const token = sessionStorage.getItem('astra-health-session-v1')
    const res = await fetch('/api/v1/entries?limit=50', { headers: { Authorization: `Bearer ${token}` } })
    return (await res.json()).entries || []
  })

const run = async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(initScript)
  const page = await context.newPage()
  globalThis.__page = page
  const shots = []

  step('goto')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })

  step('register')
  await page.getByRole('tab', { name: 'Crear cuenta' }).click()
  await page.fill('input[name="name"]', 'Astronauta E2E')
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.fill('input[name="confirmation"]', PASSWORD)
  await page.getByRole('button', { name: /crear cuenta y continuar/i }).click()
  await page.waitForSelector('.dashboard-top-bar', { timeout: 10000 })

  step('activate')
  await page.getByRole('button', { name: 'Activar Astra por voz' }).click()
  await statusIs(page, 'Escuchando: di "Astra"')

  step('wake word')
  await driveAndWait(page, 'Astra', 'Lista para escucharte.', 'Escuchando tu turno')
  await page.screenshot({ path: '/tmp/e2e-listening.png' })
  shots.push('/tmp/e2e-listening.png')

  step('reading -> origin')
  await driveAndWait(page, 'pulso ochenta y dos lpm', 'instrumento o de qué origen', 'Falta el instrumento u origen')

  step('origin -> confirm')
  await driveAndWait(page, 'pulsómetro de muñeca', '¿Lo confirmas?', 'Confirma por voz')
  await page.screenshot({ path: '/tmp/e2e-confirm.png' })
  shots.push('/tmp/e2e-confirm.png')

  step('yes -> saved')
  await driveAndWait(page, 'sí', 'Registro confirmado', 'Escuchando tu turno')
  const saved = await entryCount(page)
  if (saved.length !== 1) throw new Error(`expected 1 entry, got ${saved.length}`)
  const entry = saved[0]
  if (entry.candidate.metric !== 'heart_rate' || entry.candidate.values[0] !== 82) {
    throw new Error(`unexpected entry: ${JSON.stringify(entry.candidate)}`)
  }
  if (entry.origin !== 'pulsómetro de muñeca') throw new Error(`unexpected origin: ${entry.origin}`)

  step('second reading -> decline')
  await driveAndWait(page, 'pulso noventa lpm', 'instrumento o de qué origen', 'Falta el instrumento u origen')
  await driveAndWait(page, 'pulsómetro', '¿Lo confirmas?', 'Confirma por voz')
  await driveAndWait(page, 'no', 'no guardé nada', 'Escuchando tu turno')
  const after = await entryCount(page)
  if (after.length !== 1) throw new Error('declined reading was saved')

  step('memory question')
  await driveAndWait(page, '¿cuál fue mi último pulso?', '82', 'Escuchando tu turno')

  step('voice exit -> wake mode')
  await driveAndWait(page, 'hasta luego', 'si me necesitas de nuevo', 'Escuchando: di "Astra"')

  step('power off')
  await page.getByRole('button', { name: 'Apagar Astra' }).click()
  await statusIs(page, 'Astra voz apagada')
  const recsStopped = await page.evaluate(() => window.__recs.every((r) => r.stopped))
  if (!recsStopped) throw new Error('some recognition was left running after power off')

  step('mobile')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Activar Astra', exact: true }).click()
  await statusIs(page, 'Escuchando: di "Astra"')
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector('.astra-voice__panel')
    return panel ? panel.getBoundingClientRect().right > window.innerWidth + 1 : false
  })
  if (overflow) throw new Error('mobile panel overflows viewport')
  await page.screenshot({ path: '/tmp/e2e-mobile.png' })
  shots.push('/tmp/e2e-mobile.png')

  console.log(JSON.stringify({ ok: true, email: EMAIL, savedEntry: entry, shots }, null, 2))
  await browser.close()
}

run().catch(async (error) => {
  console.error('E2E FAILED:', error.message)
  try {
    const dump = await globalThis.__page?.evaluate(() => ({
      spoken: window.__spoken,
      status: document.querySelector('.astra-voice__status')?.textContent,
    }))
    console.error('PAGE DUMP:', JSON.stringify(dump, null, 2))
  } catch { console.error('no dump') }
  process.exit(1)
})
