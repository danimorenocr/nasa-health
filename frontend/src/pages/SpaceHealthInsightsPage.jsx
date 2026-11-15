import { useEffect, useMemo, useState } from 'react'
import Panel from '../components/ui/Panel'
import Skeleton, { SkeletonGroup } from '../components/ui/Skeleton'
import { exportData, getAnalysis, listEntries, listResearchStudies } from '../api/client'
import { formatDay, formatValue, formatWhen, localDateKey } from '../data/format'
import { useLanguage } from '../app/LanguageContext'

const METRIC_EN = { muscle_mass: 'Muscles', sleep: 'Sleep', heart_rate: 'Heart rate', glucose: 'Glucose', oxygen_saturation: 'Oxygen saturation', blood_pressure: 'Blood pressure' }

const METRICS = [
  { code: 'sleep', label: 'Sueño', color: '#36d9fa' },
  { code: 'heart_rate', label: 'Pulso', color: '#f287b7' },
  { code: 'glucose', label: 'Glucosa', color: '#46d9bd' },
  { code: 'oxygen_saturation', label: 'Saturación', color: '#f7c76a' },
  { code: 'blood_pressure', label: 'Presión', color: '#ab8af7' },
  { code: 'muscle_mass', label: 'Músculos', color: '#48e5ed' },
]

function Hourly24Chart({ entries, metric, end }) {
  const { language, tr } = useLanguage()
  const metricName = language === 'en' ? METRIC_EN[metric.code] : metric.label
  const start = end - 24 * 3600000
  const rows = useMemo(() => entries
    .filter((entry) => entry.candidate?.kind === 'measurement' && entry.candidate.metric === metric.code)
    .sort((a, b) => new Date(a.measured_at) - new Date(b.measured_at)), [entries, metric.code])
  const unit = rows.at(-1)?.candidate.unit
  const chartRows = rows.filter((entry) => entry.candidate.unit === unit && Number.isFinite(Number(entry.candidate.values?.[0])))
  const values = chartRows.map((entry) => Number(entry.candidate.values[0]))
  let min = values.length ? Math.min(...values) : 0
  let max = values.length ? Math.max(...values) : 1
  if (min === max) { min -= 1; max += 1 }
  const left = 38
  const right = 965
  const top = 18
  const bottom = 170
  const x = (time) => left + ((time - start) / (end - start)) * (right - left)
  const y = (value) => bottom - (value - min) / (max - min) * (bottom - top)
  const points = chartRows.map((entry, index) => ({ x: x(new Date(entry.measured_at).getTime()), y: y(values[index]), value: values[index], at: entry.measured_at }))
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const ticks = Array.from({ length: 7 }, (_, index) => ({ index, time: start + (index * (end - start)) / 6 }))
  const hour = (time) => new Date(time).toLocaleTimeString(language === 'en' ? 'en-US' : 'es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })

  return <>
    <div className="shi-plot" role="img" aria-label={tr(`Seguimiento de 24 horas de ${metric.label}. ${points.length} lecturas.`, `24-hour tracking of ${metricName}. ${points.length} readings.`)}>
      <svg viewBox="0 0 1000 205" preserveAspectRatio="none">
        {[0, .5, 1].map((fraction) => <g key={fraction}><line x1={left} x2={right} y1={bottom - fraction * (bottom - top)} y2={bottom - fraction * (bottom - top)} className="shi-grid-line" /><text x="3" y={bottom - fraction * (bottom - top) + 4} className="shi-axis-label">{(min + fraction * (max - min)).toFixed(max - min < 3 ? 1 : 0)}</text></g>)}
        {ticks.map(({ index, time }) => <text key={index} x={x(time)} y="198" textAnchor={index === 0 ? 'start' : index === 6 ? 'end' : 'middle'} className="shi-axis-label">{hour(time)}</text>)}
        <path d={path} fill="none" stroke={metric.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => <circle key={point.at} cx={point.x} cy={point.y} r="5" fill={metric.color}><title>{`${hour(point.at)}: ${point.value}`}</title></circle>)}
      </svg>
      {points.length === 0 && <p className="shi-empty-plot">{tr(`Sin registros de ${metric.label.toLowerCase()} en las últimas 24 horas.`, `No ${metricName.toLowerCase()} records in the last 24 hours.`)}</p>}
    </div>
    <div className="shi-chart-caption"><span>{tr(`${points.length} lecturas de ${metric.label.toLowerCase()} en las últimas 24 horas.`, `${points.length} ${metricName.toLowerCase()} readings in the last 24 hours.`)}</span><span>{tr('El eje muestra la hora real de cada medición; no se estiman horas sin registro.', 'The axis shows the actual time of each measurement; hours without records are not estimated.')}</span></div>
    {metric.code === 'blood_pressure' && points.length > 0 && <p className="shi-unit-note">{tr('La gráfica muestra el primer valor (sistólica); la tarjeta conserva ambos valores.', 'The chart shows the first value (systolic); the card keeps both values.')}</p>}
  </>
}

function daysInRange(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - count + 1 + index)
    return localDateKey(date.toISOString())
  })
}

function InsightChart({ entries, metric, range }) {
  const { language, tr } = useLanguage()
  const metricName = language === 'en' ? METRIC_EN[metric.code] : metric.label
  const days = useMemo(() => daysInRange(range), [range])
  const byDay = useMemo(() => {
    const results = new Map()
    entries.forEach((entry) => {
      if (entry.candidate?.kind !== 'measurement' || entry.candidate.metric !== metric.code) return
      const day = localDateKey(entry.measured_at)
      if (!results.has(day) || entry.measured_at > results.get(day).measured_at) results.set(day, entry)
    })
    return results
  }, [entries, metric.code])
  const recorded = days.map((day) => byDay.get(day)).filter(Boolean)
  const units = [...new Set(recorded.map((entry) => entry.candidate.unit))]
  const chartEntries = units.length > 1 ? recorded.filter((entry) => entry.candidate.unit === recorded.at(-1)?.candidate.unit) : recorded
  const values = chartEntries.map((entry) => Number(entry.candidate.values?.[0])).filter(Number.isFinite)
  let min = values.length ? Math.min(...values) : 0
  let max = values.length ? Math.max(...values) : 1
  if (min === max) { min -= 1; max += 1 }
  const left = 38
  const right = 965
  const top = 18
  const bottom = 170
  const x = (index) => left + index / Math.max(1, range - 1) * (right - left)
  const y = (value) => bottom - (value - min) / (max - min) * (bottom - top)
  let path = ''
  let previous = false
  const points = []
  days.forEach((day, index) => {
    const entry = byDay.get(day)
    const value = Number(entry?.candidate?.values?.[0])
    if (!entry || !chartEntries.includes(entry) || !Number.isFinite(value)) { previous = false; return }
    const point = { x: x(index), y: y(value), value, day }
    points.push(point)
    path += `${previous ? ' L' : ' M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    previous = true
  })
  const ticks = days.map((day, index) => ({ day, index })).filter(({ index }) => range === 7 || index === 0 || index === range - 1 || index % Math.ceil(range / 6) === 0)

  return <>
    <div className="shi-plot" role="img" aria-label={tr(`Gráfica de ${metric.label}. ${recorded.length} fechas con registros en ${range} días; las fechas sin datos quedan vacías.`, `${metricName} chart. ${recorded.length} recorded dates in ${range} days; dates without data remain empty.`)}>
      <svg viewBox="0 0 1000 205" preserveAspectRatio="none">
        {[0, .5, 1].map((fraction) => <g key={fraction}><line x1={left} x2={right} y1={bottom - fraction * (bottom - top)} y2={bottom - fraction * (bottom - top)} className="shi-grid-line" /><text x="3" y={bottom - fraction * (bottom - top) + 4} className="shi-axis-label">{(min + fraction * (max - min)).toFixed(max - min < 3 ? 1 : 0)}</text></g>)}
        {ticks.map(({ day, index }) => <text key={day} x={x(index)} y="198" textAnchor={index === 0 ? 'start' : index === range - 1 ? 'end' : 'middle'} className="shi-axis-label">{formatDay(day, language)}</text>)}
        <path d={path.trim()} fill="none" stroke={metric.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => <circle key={point.day} cx={point.x} cy={point.y} r="5" fill={metric.color}><title>{`${point.day}: ${point.value}`}</title></circle>)}
      </svg>
      {points.length === 0 && <p className="shi-empty-plot">{tr(`Sin registros de ${metric.label.toLowerCase()} en este período.`, `No ${metricName.toLowerCase()} records in this period.`)}</p>}
    </div>
    <div className="shi-chart-caption"><span>{tr(`Registraste ${metric.label.toLowerCase()} en ${recorded.length} de los últimos ${range} días.`, `You recorded ${metricName.toLowerCase()} on ${recorded.length} of the last ${range} days.`)}</span><span>{tr(`${range - recorded.length} fechas sin registro; no se estiman.`, `${range - recorded.length} dates without records; no estimates are made.`)}</span></div>
    {units.length > 1 && <p className="shi-unit-note">{tr(`Hay unidades distintas. La gráfica muestra solo ${chartEntries.at(-1)?.candidate.unit}; las tarjetas conservan el valor original.`, `Different units were recorded. The chart shows only ${chartEntries.at(-1)?.candidate.unit}; cards keep the original values.`)}</p>}
    {metric.code === 'blood_pressure' && recorded.length > 0 && <p className="shi-unit-note">{tr('La gráfica muestra el primer valor (sistólica); la tarjeta conserva ambos valores.', 'The chart shows the first value (systolic); the card keeps both values.')}</p>}
  </>
}

export default function SpaceHealthInsightsPage({ onNotify, range: controlledRange, onRangeChange }) {
  const { language, tr } = useLanguage()
  const [entries, setEntries] = useState([])
  const [entriesError, setEntriesError] = useState(false)
  const [entriesLoading, setEntriesLoading] = useState(true)
  const [studies, setStudies] = useState([])
  const [studiesLoading, setStudiesLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState('sleep')
  const [internalRange, setInternalRange] = useState(1)
  const range = controlledRange ?? internalRange
  const [nowMs, setNowMs] = useState(() => Date.now())
  const changeRange = (value) => {
    setNowMs(Date.now())
    if (onRangeChange) onRangeChange(value)
    else setInternalRange(value)
  }
  const [analysis, setAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [busyExport, setBusyExport] = useState(false)

  useEffect(() => {
    let cancelled = false
    listEntries().then((data) => { if (!cancelled) setEntries(data?.entries || []) })
      .catch((error) => { if (!cancelled) { setEntriesError(true); onNotify?.(error.message) } })
      .finally(() => { if (!cancelled) setEntriesLoading(false) })
    listResearchStudies().then((data) => { if (!cancelled) setStudies(data?.studies || []) }).catch(() => {})
      .finally(() => { if (!cancelled) setStudiesLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setAnalysis(null)
    setAnalysisLoading(true)
    getAnalysis(selectedCode, range).then((result) => { if (!cancelled) setAnalysis(result) }).catch(() => {})
      .finally(() => { if (!cancelled) setAnalysisLoading(false) })
    return () => { cancelled = true }
  }, [selectedCode, range])

  const days = useMemo(() => daysInRange(range), [range])
  const visibleEntries = useMemo(() => {
    if (range === 1) {
      const since = nowMs - 24 * 3600000
      return entries.filter((entry) => entry.candidate?.kind === 'measurement' && new Date(entry.measured_at).getTime() >= since)
    }
    return entries.filter((entry) => entry.candidate?.kind === 'measurement' && days.includes(localDateKey(entry.measured_at)))
  }, [entries, days, range, nowMs])
  const latestByMetric = useMemo(() => {
    const latest = new Map()
    visibleEntries.forEach((entry) => {
      const code = entry.candidate.metric
      if (!latest.has(code) || entry.measured_at > latest.get(code).measured_at) latest.set(code, entry)
    })
    return latest
  }, [visibleEntries])
  const selectedMetric = METRICS.find((item) => item.code === selectedCode)

  const handleExport = async () => {
    setBusyExport(true)
    try {
      const report = await exportData()
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `astra-health-export-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      onNotify?.(tr('Datos JSON descargados con tus registros reales.', 'JSON file downloaded with your real records.'))
    } catch (error) { onNotify?.(error.message) }
    finally { setBusyExport(false) }
  }

  if (entriesLoading) return (
    <div className="space-insights-page" aria-label={tr('Salud en el espacio', 'Space Health Insights')}>
      <header className="shi-header"><div><h1>{tr('Salud en el', 'Space Health')} <span>{tr('espacio', 'Insights')}</span></h1><p>{tr('Resumen de tus registros · no es una evaluación médica', 'Summary of your records · not a medical evaluation')}</p></div></header>
      <SkeletonGroup label={tr('Cargando indicadores y gráficas…', 'Loading metrics and charts…')}>
        <div className="shi-metrics">{METRICS.map((metric) => <Panel key={metric.code} className="shi-metric"><Skeleton w="55%" h={12} /><Skeleton w="42%" h={26} /><Skeleton w="75%" h={11} /></Panel>)}</div>
        <Panel className="shi-chart-panel"><Skeleton w="42%" h={24} /><Skeleton w="100%" h={205} /><Skeleton w="60%" h={12} /></Panel>
        <div className="shi-bottom-grid"><Panel className="shi-info-panel"><Skeleton w="48%" h={18} /><Skeleton w="100%" h={12} /><Skeleton w="90%" h={12} /></Panel><Panel className="shi-research-panel"><Skeleton w="55%" h={18} />{[0, 1].map((index) => <Skeleton key={index} w="100%" h={44} radius="10px" />)}</Panel></div>
      </SkeletonGroup>
    </div>
  )

  return <div className="space-insights-page" aria-label={tr('Salud en el espacio', 'Space Health Insights')}>
    <header className="shi-header">
      <div>
        <h1>{tr('Salud en el', 'Space Health')} <span>{tr('espacio', 'Insights')}</span></h1>
        <p>{tr('Resumen de tus registros · no es una evaluación médica', 'Summary of your records · not a medical evaluation')}</p>
      </div>
      <div className="shi-header-actions">
        <div className="shi-range" role="group" aria-label={tr('Período', 'Period')}>
          {[1, 7, 14, 30].map((daysCount) => <button key={daysCount} type="button" className={range === daysCount ? 'is-active' : ''} onClick={() => changeRange(daysCount)} aria-pressed={range === daysCount}>{daysCount === 1 ? '24 h' : `${daysCount} ${tr('días', 'days')}`}</button>)}
        </div>
      </div>
    </header>
    <div className="shi-guidance"><span>{tr('Cada tarjeta muestra tu último dato registrado dentro del período. Toca una tarjeta o una pestaña para cambiar la gráfica.', 'Each card shows your latest record within the period. Tap a card or tab to change the chart.')}</span><small>{tr('REGISTROS CONFIRMADOS', 'CONFIRMED RECORDS')}</small></div>
    <div className="shi-metrics">{METRICS.map((metric) => {
      const entry = latestByMetric.get(metric.code)
      return <button key={metric.code} className={`shi-metric ${selectedCode === metric.code ? 'is-active' : ''}`} style={{ '--shi-accent': metric.color }} type="button" onClick={() => setSelectedCode(metric.code)} aria-pressed={selectedCode === metric.code}><span className="shi-metric-label"><i />{language === 'en' ? METRIC_EN[metric.code] : metric.label}</span><strong>{entry ? <>{formatValue(entry.candidate)} <small>{entry.candidate.unit}</small></> : '—'}</strong><span className="shi-metric-foot">{entriesError ? tr('No se pudieron cargar los registros', 'Could not load records') : entry ? `${tr('Registrado', 'Recorded')} ${formatWhen(entry.measured_at, language)}` : entriesLoading ? tr('Cargando…', 'Loading…') : tr('Sin registros en este período', 'No records in this period')}</span></button>
    })}</div>
    <Panel className="shi-chart-panel"><div className="shi-chart-top"><div className="shi-tabs" role="group" aria-label={tr('Indicador de la gráfica', 'Chart metric')}>{METRICS.map((metric) => <button type="button" key={metric.code} className={selectedCode === metric.code ? 'is-active' : ''} onClick={() => setSelectedCode(metric.code)} aria-pressed={selectedCode === metric.code}>{language === 'en' ? METRIC_EN[metric.code] : metric.label}</button>)}</div><small>{range === 1 ? tr('Seguimiento de 24 horas · cada lectura en su hora real', '24-hour tracking · each reading at its actual time') : tr('Un dato = un punto · sin línea de tendencia inventada', 'One record = one point · no invented trend line')}</small></div>{entriesError ? <p className="shi-empty-plot">{tr('No se pudieron cargar tus registros. Comprueba la conexión con el backend.', 'Could not load your records. Check the backend connection.')}</p> : range === 1 ? <Hourly24Chart entries={visibleEntries} metric={selectedMetric} end={nowMs} /> : <InsightChart entries={visibleEntries} metric={selectedMetric} range={range} />}</Panel>
    <div className="shi-bottom-grid"><Panel className="shi-info-panel"><h2>{tr('◆ SOBRE ESTE TEMA EN EL ESPACIO', '◆ ABOUT THIS TOPIC IN SPACE')}</h2>{analysisLoading ? <SkeletonGroup label={tr('Cargando información educativa…', 'Loading educational information…')}><Skeleton w="100%" h={12} /><Skeleton w="90%" h={12} /><Skeleton w="75%" h={12} /></SkeletonGroup> : analysis?.education ? <><p>{analysis.education.text}</p><small>{analysis.education.scope}</small></> : <p>{tr(`La información educativa para ${selectedMetric.label.toLowerCase()} no está disponible en este momento.`, `Educational information about ${METRIC_EN[selectedMetric.code].toLowerCase()} is unavailable right now.`)}</p>}{analysis?.cannot_conclude?.length > 0 && <p className="shi-limit">{tr(`Este resumen no determina ${analysis.cannot_conclude.join(', ').toLowerCase()}.`, 'This summary does not provide a clinical conclusion.')}</p>}<p className="shi-scope">{tr('Información general y educativa. No interpreta tus registros ni es una recomendación para ti.', 'General educational information. It does not interpret your records or make a personal recommendation.')}</p><button type="button" className="shi-export" onClick={handleExport} disabled={busyExport}>{busyExport ? tr('Descargando…', 'Downloading…') : tr('Descargar mis datos JSON →', 'Download my data as JSON →')}</button></Panel><Panel className="shi-research-panel"><h2>{tr('◆ EXPLORAR INVESTIGACIÓN NASA · OSDR', '◆ EXPLORE NASA RESEARCH · OSDR')}</h2>{studiesLoading ? <SkeletonGroup label={tr('Cargando estudios…', 'Loading studies…')}>{[0, 1].map((index) => <Skeleton key={index} w="100%" h={44} radius="10px" />)}</SkeletonGroup> : studies.length ? studies.slice(0, 3).map((study) => <div className="shi-study" key={study.accession}><span><strong>{study.title}</strong><small>{tr('Copia local del', 'Local copy from')} {study.retrieved_at ? formatDay(study.retrieved_at, language) : '—'}{study.stale ? tr(' · desactualizada', ' · outdated') : ''}</small></span>{study.api_url ? <a href={study.api_url} target="_blank" rel="noreferrer">{study.accession}</a> : <em>{study.accession}</em>}</div>) : <p>{tr('No hay estudios en la copia local.', 'No studies in the local copy.')}</p>}<p className="shi-scope">{tr('Investigación pública, separada de tus registros personales. No es un protocolo clínico.', 'Public research, separate from your personal records. Not a clinical protocol.')}</p></Panel></div>
  </div>
}
