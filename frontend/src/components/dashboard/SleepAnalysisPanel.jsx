import { useState } from 'react'
import { BedDouble } from 'lucide-react'
import Panel from '../ui/Panel'
import Skeleton, { SkeletonGroup } from '../ui/Skeleton'
import { loadSyntheticSleep } from '../../api/client'
import { useLanguage } from '../../app/LanguageContext'

export default function SleepAnalysisPanel({ analysis, loading = false, onReload, onNotify, onOpenVitals }) {
  const { tr } = useLanguage()
  const [busy, setBusy] = useState(false)

  const loadExample = async () => {
    setBusy(true)
    try {
      await loadSyntheticSleep()
      await onReload?.()
      onNotify?.(tr('Datos sintéticos de sueño cargados.', 'Sample sleep data loaded.'))
    } catch (e) {
      onNotify?.(e.message)
    } finally {
      setBusy(false)
    }
  }

  const calc = analysis?.personal_calculation
  const stats = calc?.stats

  // Porcentaje calculado a partir de las horas reales vs 8h recomendadas
  const percentage = stats?.mean_hours
    ? Math.min(100, Math.max(0, Math.round((stats.mean_hours / 8) * 100)))
    : null

  const daysRecorded = calc?.nights_recorded || 0
  const daysTotal = calc?.days_in_window || 7

  return (
    <Panel className="sleep-panel-pro">
      <div className="sleep-panel-pro__header">
        <BedDouble size={16} className="sleep-icon" />
        <span className="section-title">
          {tr('ANÁLISIS DE SUEÑO', 'SLEEP ANALYSIS')} · {analysis?.window?.days || 7} {tr('DÍAS', 'DAYS')}
        </span>
      </div>

      <div className="sleep-panel-pro__content">
        {loading ? (
          <SkeletonGroup label="Cargando análisis de sueño…">
            <Skeleton w={96} h={96} radius="50%" />
            <Skeleton w="70%" h={14} />
            <Skeleton w="50%" h={12} />
          </SkeletonGroup>
        ) : stats ? (
          <>
            {/* Ring circular con valor real */}
            <div className="sleep-ring-wrap">
              <svg viewBox="0 0 100 100" className="sleep-ring-svg">
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="rgba(49, 220, 255, 0.15)"
                  strokeWidth="9"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="#00d2ff"
                  strokeWidth="9"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 * (1 - (percentage || 0) / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                  className="sleep-ring-glow"
                />
              </svg>
              <div className="sleep-ring-value">
                <strong>{stats.mean_hours != null ? `${stats.mean_hours} h` : '—'}</strong>
                <small>ref. 8 h</small>
              </div>
            </div>

            {/* Información textual real */}
            <div className="sleep-panel-pro__info">
              <h3>{tr('Media del periodo', 'Period average')}</h3>
              <p>{tr('Promedio', 'Average')}: {stats.mean_hours} h · ({stats.min.hours}h - {stats.max.hours}h)</p>
              <p className="sleep-note">{tr('Horas declaradas; el arco compara la media con una referencia de 8 h. No es una evaluación de calidad.', 'Self-reported hours; the arc compares the average with an 8-hour reference. It does not assess sleep quality.')}</p>

              {/* Segmentos de días registrados */}
              <div className="sleep-segments-bar" title={tr(`${daysRecorded} de ${daysTotal} noches registradas`, `${daysRecorded} of ${daysTotal} nights recorded`)}>
                {[...Array(Math.min(10, daysTotal))].map((_, i) => (
                  <span
                    key={i}
                    className={`sleep-segment ${i < daysRecorded ? 'is-active' : ''}`}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="sleep-empty-state">
            <p className="sleep-empty-text">{tr('Sin datos de sueño registrados en el periodo.', 'No sleep data recorded in this period.')}</p>
            <div className="sleep-empty-actions">
              <button
                className="primary-pill-btn btn--compact"
                onClick={onOpenVitals}
                type="button"
              >
                {tr('+ Registrar sueño', '+ Record sleep')}
              </button>
              <button
                className="secondary-pill-btn btn--compact"
                onClick={loadExample}
                disabled={busy}
                type="button"
              >
                {busy ? tr('Cargando…', 'Loading…') : tr('Cargar datos de ejemplo', 'Load sample data')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
