import { useId, useMemo } from 'react'

const width = 300
const height = 118
const padding = 8

export default function MiniChart({ title, records, unit, color }) {
  const gradientId = useId().replace(/:/g, '')
  const data = useMemo(() => records.map((r) => r.values[0]), [records])
  const points = useMemo(() => {
    const lo = Math.min(...data)
    const span = Math.max(...data) - lo || 1
    return data.map((value, index) => [
      padding + (index / (data.length - 1)) * (width - padding * 2),
      padding + (1 - (value - lo) / span) * (height - padding * 2),
    ])
  }, [data])

  if (records.length < 2) {
    return (
      <div className="mini-chart">
        <p>{title}</p>
        <p className="mini-chart__empty">
          {records.length ? 'Falta al menos un registro más para dibujar la tendencia.' : 'Sin registros en este periodo.'}
        </p>
      </div>
    )
  }

  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${path} L ${points.at(-1)[0]} ${height} L ${points[0][0]} ${height} Z`
  const last = points.at(-1)
  const day = (iso) => new Date(iso).toLocaleDateString('es-CO')

  return (
    <div className="mini-chart">
      <p>{title}{unit && ` (${unit})`}</p>
      <div className="mini-chart__canvas">
        <div className="chart-grid"><i /><i /><i /><i /></div>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".38" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={last[0]} cy={last[1]} r="7" fill={color} opacity=".2" />
          <circle cx={last[0]} cy={last[1]} r="3.6" fill="#efffff" stroke={color} strokeWidth="2" />
        </svg>
      </div>
      <div className="chart-labels"><span>{day(records[0].t)}</span><span>último: {data.at(-1)} {unit}</span><span>{day(records.at(-1).t)}</span></div>
    </div>
  )
}
