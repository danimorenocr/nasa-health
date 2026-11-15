import { useEffect, useMemo, useState } from 'react'
import Panel from '../ui/Panel'
import Skeleton from '../ui/Skeleton'
import { getCheckIns } from '../../api/client'
import { formatDay, localDateKey } from '../../data/format'
import { useLanguage } from '../../app/LanguageContext'

const SYSTEMS = [
  { name: 'Cardiovascular', en: 'Cardiovascular', metrics: ['heart_rate', 'blood_pressure'] },
  { name: 'Metabólica', en: 'Metabolic', metrics: ['glucose'] },
  { name: 'Descanso', en: 'Rest', metrics: ['sleep'] },
  { name: 'Músculos', en: 'Muscles', metrics: ['muscle_mass'] },
  { name: 'Psicológica', en: 'Psychological', metrics: [], mind: true },
]

function lastDays(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - count + 1 + index)
    return localDateKey(date.toISOString())
  })
}

// Días con al menos un registro real por sistema, sin estimar los que faltan.
export default function SystemsPanel({ entries = [], loading = false }) {
  const { language, tr } = useLanguage()
  const days = useMemo(() => lastDays(7), [])
  // Psicológica: días con un check-in de Bienestar emocional.
  const [checkInDates, setCheckInDates] = useState(() => new Set())
  useEffect(() => {
    let cancelled = false
    getCheckIns(7).then((data) => {
      if (!cancelled) setCheckInDates(new Set((data.check_ins || []).map((item) => item.date)))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const recorded = useMemo(() => {
    const map = {}
    entries.forEach((entry) => {
      if (entry.candidate?.kind !== 'measurement') return
      const code = entry.candidate.metric
      if (!map[code]) map[code] = new Set()
      map[code].add(localDateKey(entry.measured_at))
    })
    return map
  }, [entries])

  return (
    <Panel className="systems-heatmap-panel">
      <div className="heatmap-header">
        <span className="section-title">{tr('SISTEMAS · ÚLTIMOS 7 DÍAS', 'SYSTEMS · LAST 7 DAYS')}</span>
        <div className="heatmap-days-labels">{days.map((day) => <span key={day}>{formatDay(day, language)}</span>)}</div>
      </div>
      <div className="heatmap-rows-list">
        {SYSTEMS.map((system) => (
          <div key={system.name} className="heatmap-system-row">
            <span className="system-row-name">
              {language === 'en' ? system.en : system.name}
              {system.mind && <small className="system-row-note">{tr('bienestar emocional', 'emotional wellbeing')}</small>}
            </span>
            <div className="heatmap-blocks-row">
              {days.map((day) => loading
                ? <Skeleton key={day} w={22} h={22} radius="6px" />
                : <span key={day} className={`heatmap-cell ${(system.mind ? checkInDates.has(day) : system.metrics.some((code) => recorded[code]?.has(day))) ? 'cell--stable' : 'cell--empty'}`} />)}
            </div>
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span className="legend-chip"><span className="chip-square square--stable" /> {tr('con registro', 'recorded')}</span>
        <span className="legend-chip"><span className="chip-square square--empty" /> {tr('sin registro', 'no record')}</span>
      </div>
    </Panel>
  )
}
