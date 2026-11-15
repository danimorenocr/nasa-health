import { Activity, Droplet, Dumbbell, Heart, Moon, Thermometer } from 'lucide-react'
import Panel from '../ui/Panel'
import Skeleton, { SkeletonGroup } from '../ui/Skeleton'
import { formatValue, formatWhen } from '../../data/format'
import { useLanguage } from '../../app/LanguageContext'

const METRIC_CONFIG = {
  heart_rate: { label: 'Pulso', defaultUnit: 'bpm', icon: Heart },
  sleep: { label: 'Sueño', defaultUnit: 'h', icon: Moon },
  blood_pressure: { label: 'Presión arterial', defaultUnit: 'mmHg', icon: Activity },
  oxygen_saturation: { label: 'Saturación', defaultUnit: '%', icon: Droplet },
  temperature: { label: 'Temperatura', defaultUnit: '°C', icon: Thermometer },
  glucose: { label: 'Glucosa', defaultUnit: 'mg/dL', icon: Droplet },
  muscle_mass: { label: 'Músculos', defaultUnit: 'kg', icon: Dumbbell },
}

export default function MetricCard({ code, entry, historySeries, loading = false, onOpenRegister }) {
  const { language, tr } = useLanguage()
  const meta = METRIC_CONFIG[code] || { label: code, defaultUnit: '', icon: Heart }
  const Icon = meta.icon
  const candidate = entry?.candidate
  const outOfRange = Boolean(candidate && entry?.recommendation?.out_of_range)
  const critical = entry?.recommendation?.severity === 'critical'

  // Puntos reales del historial para dibujar la sparkline
  const pointsData = historySeries?.points || []
  let sparklinePath = ''
  let sparklineArea = ''

  if (pointsData.length >= 2) {
    const values = pointsData.map((p) => p.values[0])
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const w = 100
    const h = 28
    const coords = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 6) - 3
      return [x, y]
    })
    sparklinePath = coords.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    sparklineArea = `${sparklinePath} L 100 32 L 0 32 Z`
  }

  // Cálculo del cambio real entre el último valor y el anterior si existen
  let deltaText = null
  let isUp = true
  if (pointsData.length >= 2) {
    const lastVal = pointsData[pointsData.length - 1].values[0]
    const prevVal = pointsData[pointsData.length - 2].values[0]
    const diff = lastVal - prevVal
    if (prevVal !== 0) {
      const pct = Math.round((diff / prevVal) * 100)
      deltaText = `${pct >= 0 ? '+' : ''}${pct}%`
      isUp = pct >= 0
    }
  }

  if (loading) {
    return (
      <Panel className="metric-card-pro">
        <div className="metric-card-pro__header">
          <Icon size={15} className="metric-card-pro__icon" />
          <span className="metric-card-pro__label">{meta.label}</span>
        </div>
        <SkeletonGroup label={`Cargando ${meta.label}…`}>
          <Skeleton w="55%" h={28} />
          <Skeleton w="80%" h={12} />
        </SkeletonGroup>
      </Panel>
    )
  }

  return (
    <Panel
      className={`metric-card-pro is-clickable ${candidate ? 'is-recorded' : 'is-empty'} ${outOfRange ? (critical ? 'is-critical' : 'is-warning') : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenRegister?.(code)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenRegister?.(code) } }}
      aria-label={`${language === 'en' ? 'Record' : 'Registrar'} ${language === 'en' ? ({ heart_rate: 'Heart rate', sleep: 'Sleep', blood_pressure: 'Blood pressure', oxygen_saturation: 'Oxygen saturation', temperature: 'Temperature', glucose: 'Glucose', muscle_mass: 'Muscles' }[code] || meta.label) : meta.label}`}
    >
      <div className="metric-card-pro__header">
        <Icon size={15} className="metric-card-pro__icon" />
        <span className="metric-card-pro__label">{language === 'en' ? ({ heart_rate: 'Heart rate', sleep: 'Sleep', blood_pressure: 'Blood pressure', oxygen_saturation: 'Oxygen saturation', temperature: 'Temperature', glucose: 'Glucose', muscle_mass: 'Muscles' }[code] || meta.label) : meta.label}</span>
      </div>

      <div className="metric-card-pro__content">
        <div className="metric-card-pro__value-col">
          {candidate ? (
            <>
              <div className="metric-card-pro__value">
                <span>{formatValue(candidate)}</span>
                <small>{candidate.unit || meta.defaultUnit}</small>
              </div>
              <div className="metric-card-pro__meta-row">
                {deltaText && (
                  <span className={`metric-card-pro__trend ${isUp ? 'trend--up' : 'trend--down'}`}>
                    <span className="trend-arrow">{isUp ? '▲' : '▼'}</span>
                    <span>{deltaText}</span>
                  </span>
                )}
                <span className="metric-card-pro__time">
                  {formatWhen(entry.measured_at, language)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="metric-card-pro__value value--empty">
                <span>—</span>
              </div>
              <button
                type="button"
                className="metric-card-pro__add-btn"
              >
                {tr('+ Registrar', '+ Record')}
              </button>
            </>
          )}
        </div>

        <div className="metric-card-pro__chart-col">
          {sparklinePath ? (
            <svg viewBox="0 0 100 32" className="sparkline-svg" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`grad-${code}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2bd5ff" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#2bd5ff" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={sparklineArea} fill={`url(#grad-${code})`} />
              <path
                d={sparklinePath}
                fill="none"
                stroke="#31dcff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div className="sparkline-placeholder">
              <svg viewBox="0 0 100 32" className="sparkline-svg sparkline-svg--empty" preserveAspectRatio="none">
                <path
                  d="M 0 16 Q 25 14, 50 16 T 100 16"
                  fill="none"
                  stroke="rgba(49, 220, 255, 0.25)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
              </svg>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}
