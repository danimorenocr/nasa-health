import { useMemo } from 'react'
import Panel from '../ui/Panel'
import Skeleton from '../ui/Skeleton'
import { localDateKey } from '../../data/format'
import { useLanguage } from '../../app/LanguageContext'

// Cuántos registros confirmados llevas hoy, en 7 días y en toda la misión.
export default function RecordsComparisonPanel({ entries = [], loading = false }) {
  const { tr } = useLanguage()
  const counts = useMemo(() => {
    const todayKey = localDateKey(new Date().toISOString())
    const weekAgo = new Date().getTime() - 7 * 86400000
    return {
      today: entries.filter((e) => localDateKey(e.measured_at) === todayKey).length,
      week: entries.filter((e) => new Date(e.measured_at).getTime() >= weekAgo).length,
      total: entries.length,
    }
  }, [entries])
  const rows = [
    { label: tr('Registros de hoy', "Today's records"), value: counts.today },
    { label: tr('Últimos 7 días', 'Last 7 days'), value: counts.week },
    { label: tr('Toda la misión', 'Entire mission'), value: counts.total },
  ]

  return (
    <Panel className="comparisons-panel">
      <span className="section-title">{tr('COMPARACIONES · MIS REGISTROS', 'COMPARISONS · MY RECORDS')}</span>
      <div className="comparisons-list">
        {rows.map((row) => (
          <div key={row.label} className="comparison-row">
            <span>{row.label}</span>
            <span className="comp-tag tag--stable">{loading ? <Skeleton w={24} h={14} /> : row.value}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
