const TOKEN_KEY = 'astra-health-session-v1'

const read = () => { try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null } }
const write = (value) => {
  try { value ? sessionStorage.setItem(TOKEN_KEY, value) : sessionStorage.removeItem(TOKEN_KEY) } catch { /* sin almacenamiento */ }
}

let token = read()
let apiLanguage = 'es'
// El idioma de la página viaja al backend para que el LLM responda en ese idioma.
export const setApiLanguage = (language) => { apiLanguage = language === 'en' ? 'en' : 'es' }

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

async function request(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`/api/v1/${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiError('No hay conexión con el backend.', 0)
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const missingMindRoute = response.status === 404
      && (path.startsWith('mind/') || path === 'rewards')
      && data?.detail === 'Ruta no encontrada.'
    if (missingMindRoute) {
      throw new ApiError('El backend en ejecución es una versión anterior y no puede guardar Mind Tracker. Reinicia el servidor de nasa-health y vuelve a intentarlo.', 404)
    }
    throw new ApiError(data?.detail || 'No se pudo completar la solicitud.', response.status)
  }
  return data
}

// Reanuda la sesión guardada o crea una nueva si venció o no existe.
export async function openSession() {
  if (!token) return null
  try {
    const session = await request('session')
    if (!session.user) return null
    return session
  } catch (error) {
    if (error.status !== 401) throw error
    token = null
    write(null)
    return null
  }
}

const saveAuth = (session) => {
  token = session.token
  write(token)
  return session
}

export const loginAccount = async (email, password) =>
  saveAuth(await request('auth/login', { method: 'POST', body: { email, password } }))

export const registerAccount = async (name, email, password) =>
  saveAuth(await request('auth/register', { method: 'POST', body: { name, email, password } }))

export const closeSession = async () => {
  try { if (token) await request('auth/logout', { method: 'POST' }) } finally { token = null; write(null) }
}
export const updateProfileImage = (profileImageUrl) =>
  request('profile', { method: 'PATCH', body: { profile_image_url: profileImageUrl || null } })
export const hasSession = () => Boolean(token)
export const listEntries = () => request('entries?limit=500')
export const getHistory = (metric, days = 30) => request(`history?metric=${metric}&days=${days}`)
export const getSleepAnalysis = (days = 7) =>
  request(`analysis/sleep?days=${days}&tz_offset_minutes=${-new Date().getTimezoneOffset()}&lang=${apiLanguage}`)
export const loadSyntheticSleep = () => request('synthetic/sleep', { method: 'POST' })
// `voice`: el texto viene de dictado; el backend asume la unidad cuando el indicador solo tiene una.
export const sendMessage = (text, { voice = false } = {}) =>
  request('messages', { method: 'POST', body: { text, lang: apiLanguage, ...(voice ? { assume_units: true } : {}) } })
export const confirmPending = (payload) => request('confirmations', { method: 'POST', body: { confirmed: true, ...payload } })
export const discardPending = () => request('pending', { method: 'DELETE' })
export const getAnalysis = (metric, days = 7) =>
  request(`analysis/${metric}?days=${days}&tz_offset_minutes=${-new Date().getTimezoneOffset()}&lang=${apiLanguage}`)
export const loadSyntheticAll = () => request('synthetic', { method: 'POST' })
export const loadSyntheticMetric = (metric) => request(`synthetic/${metric}`, { method: 'POST' })
export const getCapabilities = () => request('capabilities')
export const getGuidance = () => request('guidance')
export const getSafety = () => request('safety')
export const listResearchStudies = () => request('research/studies')
export const exportData = () => request('export')
export const getCheckIns = (days = 7) => request(`mind/check-ins?days=${days}`)
export const saveCheckIn = (date, payload) =>
  request(`mind/check-ins/${date}`, { method: 'PUT', body: payload })
export const loadSyntheticMind = () => request('mind/synthetic', { method: 'POST' })
export const listJournalEntries = () => request('mind/journal')
export const createJournalEntry = (payload) => request('mind/journal', { method: 'POST', body: payload })
export const updateJournalEntry = (id, payload) => request(`mind/journal/${id}`, { method: 'PUT', body: payload })
export const deleteJournalEntry = (id) => request(`mind/journal/${id}`, { method: 'DELETE' })
export const listReminders = () => request('mind/reminders')
export const createReminder = (payload) => request('mind/reminders', { method: 'POST', body: payload })
export const updateReminder = (id, payload) => request(`mind/reminders/${id}`, { method: 'PUT', body: payload })
export const deleteReminder = (id) => request(`mind/reminders/${id}`, { method: 'DELETE' })
export const recordWellnessAction = (kind, actionDate) =>
  request('mind/actions', { method: 'POST', body: { kind, action_date: actionDate } })
export const getRewards = () => request('rewards')

// Envía una nota de voz al backend, que la reenvía a un proveedor externo de
// transcripción (OpenAI o Groq) SOLO si el servidor tiene clave configurada.
// Si no la tiene, responde status "no_credentials" y el texto nunca sale.
export const transcribeAudio = async (blob) => {
  let response
  try {
    response = await fetch('/api/v1/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': (blob.type || 'audio/webm').split(';')[0],
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
    })
  } catch {
    throw new ApiError('No hay conexión con el backend.', 0)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(data?.detail || data?.message || 'No se pudo transcribir el audio.', response.status)
  }
  return data
}
