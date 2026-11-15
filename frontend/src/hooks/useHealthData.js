import { useCallback, useEffect, useState } from 'react'
import { getHistory, getSleepAnalysis, listEntries } from '../api/client'

const TRENDS = ['sleep', 'heart_rate']

// Registros reales de la sesión: último valor por indicador y series para tendencias.
export default function useHealthData() {
  const [state, setState] = useState({ loading: true, error: '', entries: [], count: 0, history: {}, sleep: null })

  const reload = useCallback(async () => {
    try {
      const [list, sleep, ...series] = await Promise.all([
        listEntries(),
        getSleepAnalysis().catch(() => null),
        ...TRENDS.map((m) => getHistory(m)),
      ])
      setState({
        loading: false, error: '', entries: list.entries, count: list.count, sleep,
        history: Object.fromEntries(TRENDS.map((m, i) => [m, series[i]])),
      })
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }))
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const latest = {}
  for (const entry of state.entries) {
    const c = entry.candidate
    if (c.kind !== 'measurement') continue
    if (!latest[c.metric] || entry.measured_at > latest[c.metric].measured_at) latest[c.metric] = entry
  }
  return { ...state, latest, reload }
}
