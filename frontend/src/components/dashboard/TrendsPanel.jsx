import { useId, useMemo, useState } from 'react'
import { BarChart3, ChevronDown } from 'lucide-react'
import Panel from '../ui/Panel'
import Skeleton, { SkeletonGroup } from '../ui/Skeleton'
import { useLanguage } from '../../app/LanguageContext'

function seriesOf(historyItem) {
  const series = [...(historyItem?.series ?? [])].sort(
    (a, b) => b.points.length - a.points.length
  )[0]
  return series ? { unit: series.unit, points: series.points } : { unit: '', points: [] }
}

export default function TrendsPanel({ history, loading = false, onOpenVitals }) {
  const { tr } = useLanguage()
  const [range, setRange] = useState('Últimos 7 días')
  const gradientId = useId().replace(/:/g, '')

  const heart = useMemo(() => seriesOf(history?.heart_rate), [history])
  const sleep = useMemo(() => seriesOf(history?.sleep), [history])

  // Normalizar datos de puntos
  const hasData = heart.points.length >= 2 || sleep.points.length >= 2

  // Generar path SVG para una serie
  const makePath = (points, width = 300, height = 70) => {
    if (!points || points.length < 2) return ''
    const values = points.map((p) => p.values[0])
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const pad = 6
    const coords = values.map((val, idx) => {
      const x = pad + (idx / (values.length - 1)) * (width - pad * 2)
      const y = pad + (1 - (val - min) / span) * (height - pad * 2)
      return [x, y]
    })
    return coords.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  }

  const heartPath = useMemo(() => makePath(heart.points), [heart.points])
  const sleepPath = useMemo(() => makePath(sleep.points), [sleep.points])

  return (
    <Panel className="trends-panel-pro">
      <div className="trends-panel-pro__header">
        <div className="trends-title-wrap">
          <BarChart3 size={16} className="trends-icon" />
          <span className="section-title">{tr('TENDENCIAS', 'TRENDS')}</span>
        </div>

        <button className="range-dropdown-btn" type="button" title={tr('Periodo de tiempo', 'Time range')}>
          <span>{tr(range, 'Last 7 days')}</span>
          <ChevronDown size={13} />
        </button>
      </div>

      <div className="trends-legend">
        <span className="legend-item legend--pulse">
          <span className="legend-dot" /> {tr('Pulso', 'Heart rate')} {heart.unit && `(${heart.unit})`}
        </span>
        <span className="legend-item legend--sleep">
          <span className="legend-dot" /> {tr('Sueño', 'Sleep')} {sleep.unit && `(${sleep.unit})`}
        </span>
      </div>

      <div className="trends-chart-container">
        {loading ? (
          <SkeletonGroup label="Cargando tendencias…" className="trends-skeleton">
            <Skeleton w="100%" h={90} />
            <Skeleton w="60%" h={12} />
          </SkeletonGroup>
        ) : hasData ? (
          <>
            <div className="trends-axis-y">
              <span>{tr('Máx', 'Max')}</span>
              <span>{tr('Med', 'Avg')}</span>
              <span>{tr('Mín', 'Min')}</span>
            </div>

            <div className="trends-svg-wrap">
              <svg viewBox="0 0 300 70" className="trends-multiline-svg" preserveAspectRatio="none">
                <line x1="0" y1="10" x2="300" y2="10" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                <line x1="0" y1="35" x2="300" y2="35" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                <line x1="0" y1="60" x2="300" y2="60" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

                {heartPath && (
                  <path
                    d={heartPath}
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {sleepPath && (
                  <path
                    d={sleepPath}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>

              <div className="trends-axis-x">
                <span>{tr('Inicio', 'Start')}</span>
                <span>{tr('Intermedio', 'Middle')}</span>
                <span>{tr('Reciente', 'Recent')}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="trends-empty-state">
            <p>{tr('Se requieren al menos 2 registros reales para dibujar la tendencia.', 'At least 2 real records are needed to draw a trend.')}</p>
            <button className="primary-pill-btn btn--compact" onClick={onOpenVitals} type="button">
              {tr('+ Registrar signos', '+ Record vitals')}
            </button>
          </div>
        )}
      </div>
    </Panel>
  )
}
