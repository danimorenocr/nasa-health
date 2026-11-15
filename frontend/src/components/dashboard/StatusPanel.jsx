import Panel from '../ui/Panel'
import { METRIC_LABELS, formatValue, formatWhen } from '../../data/format'

const TOTAL = Object.keys(METRIC_LABELS).length

export default function StatusPanel({ latest, count, error }) {
  const withData = Object.keys(latest).length
  return (
    <Panel className="status-panel">
      <span className="section-title">REGISTROS DE LA SESIÓN</span>
      <div className="status-summary">
        <div className="score-ring" style={{ '--fill': `${(withData / TOTAL) * 100}%` }}>
          <strong>{withData}</strong><span>de {TOTAL}</span>
        </div>
        <div>
          <strong>{count} registros confirmados</strong>
          <p>{error || 'Sin evaluación clínica: el sistema solo guarda lo que confirmas.'}</p>
        </div>
      </div>
      <div className="status-rows">
        {Object.entries(METRIC_LABELS).map(([code, label]) => {
          const entry = latest[code]
          return (
            <div key={code}>
              <span>{label}</span>
              <em className="status-rows__value">
                {entry ? `${formatValue(entry.candidate)} ${entry.candidate.unit} · ${formatWhen(entry.measured_at)}` : 'Sin registro'}
              </em>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
