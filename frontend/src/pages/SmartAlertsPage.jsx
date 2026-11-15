import { useEffect, useMemo, useState } from 'react'
import Panel from '../components/ui/Panel'
import Skeleton, { SkeletonGroup } from '../components/ui/Skeleton'
import { getAnalysis, getCapabilities, listEntries } from '../api/client'
import { METRIC_LABELS, formatDay, formatValue, formatWhen } from '../data/format'
import { useLanguage } from '../app/LanguageContext'

const METRIC_EN = { heart_rate: 'Heart rate', blood_pressure: 'Blood pressure', temperature: 'Temperature', oxygen_saturation: 'Oxygen saturation', glucose: 'Glucose', sleep: 'Sleep' }

const TRACKED_METRICS = ['heart_rate', 'blood_pressure', 'temperature', 'oxygen_saturation', 'glucose', 'sleep']

const round1 = (n) => Math.round(n * 10) / 10

// Reglas técnicas y descriptivas sobre los registros reales. No clasifican
// severidad médica ni explican causas: solo describen qué hay (o falta) en SQLite.

// Etiquetas visibles: descriptivas, sin niveles clínicos (no hay clasificador).
const LEVEL_LABELS = {
  Info: 'Informativo',
  Preventivo: 'Cambio observado',
  Atencion: 'Fuera de rango',
  Critico: 'Crítico',
}
const LEVEL_LABELS_EN = {
  Info: 'Informational',
  Preventivo: 'Observed change',
  Atencion: 'Out of range',
  Critico: 'Critical',
}
const levelLabel = (level, en) => (en ? LEVEL_LABELS_EN : LEVEL_LABELS)[level] || level
function buildAlerts(entries, analyses, language) {
  const en = language === 'en'
  const alerts = []
  const now = Date.now()
  const weekAgo = now - 7 * 86400000

  const latestByMetric = {}
  for (const entry of entries) {
    const code = entry.candidate?.metric
    if (entry.candidate?.kind !== 'measurement' || !code) continue
    if (!latestByMetric[code] || entry.measured_at > latestByMetric[code].measured_at) latestByMetric[code] = entry
  }

  // Último registro de cada indicador con la recomendación guardada: si quedó
  // fuera de parámetros, se muestra como aviso con esa misma recomendación.
  for (const code of TRACKED_METRICS) {
    const entry = latestByMetric[code]
    const rec = entry?.recommendation
    if (!rec?.out_of_range) continue
    const label = en ? METRIC_EN[code] : METRIC_LABELS[code] || code
    const critical = rec.severity === 'critical'
    const value = `${formatValue(entry.candidate)} ${entry.candidate.unit}`
    alerts.unshift({
      id: `range-${code}`,
      metric: code,
      title: label,
      time: formatWhen(entry.measured_at, language),
      level: critical ? 'Critico' : 'Atencion',
      detailTitle: en ? `${label} outside the reference range` : `${label} fuera del rango de referencia`,
      status: en ? 'Pending' : 'Pendiente',
      metricValue: value,
      metricSubtitle: (en ? rec.reason_en || rec.reason : rec.reason) || '',
      reason: en ? `Rule: the latest confirmed ${label.toLowerCase()} record (${value}) is outside the general adult reference range. ${rec.disclaimer_en || ''}` : `Regla: el último registro confirmado de ${label.toLowerCase()} (${value}) está fuera del rango de referencia general para adultos. ${rec.disclaimer || ''}`,
      actions: [en && rec.text_en ? rec.text_en : rec.text, en ? 'Repeat the measurement and record it again' : 'Repite la medición y vuelve a registrarla'],
      timeline: [
        { time: en ? 'Now' : 'Ahora', text: en ? 'Notice generated from the saved recommendation' : 'Aviso generado desde la recomendación guardada' },
        { time: formatDay(entry.measured_at, language), text: en ? 'Out-of-range record' : 'Registro fuera de rango' },
      ],
    })
  }

  for (const code of TRACKED_METRICS) {
    const label = en ? METRIC_EN[code] : METRIC_LABELS[code] || code
    const recent = entries.filter(
      (e) => e.candidate?.kind === 'measurement' && e.candidate?.metric === code
        && new Date(e.measured_at).getTime() >= weekAgo
    )
    if (recent.length === 0) {
      const last = latestByMetric[code]
      alerts.push({
        id: `missing-${code}`,
        metric: code,
        title: label,
        time: en ? 'Now' : 'Ahora',
        level: 'Info',
        detailTitle: en ? `No ${label.toLowerCase()} records in the last 7 days` : `Sin registros de ${label.toLowerCase()} en los últimos 7 días`,
        status: en ? 'Pending' : 'Pendiente',
        metricValue: '0',
        metricSubtitle: last ? (en ? `last record: ${formatWhen(last.measured_at, language)}` : `último registro: ${formatWhen(last.measured_at, language)}`) : (en ? 'no mission records' : 'sin registros en la misión'),
        reason: en ? `Visible rule: this appears when a metric has no confirmed records in the last 7 days. ${last ? `The last record was on ${formatWhen(last.measured_at, language)}.` : 'There are no records for this metric in this session.'}` : `Regla visible: se muestra cuando un indicador no tiene registros confirmados en los últimos 7 días. ${last ? `El último registro es del ${formatWhen(last.measured_at, language)}.` : 'No hay ningún registro de este indicador en la sesión.'}`,
        actions: [en ? `Record ${label.toLowerCase()} using the review and confirmation flow` : `Registrar ${label.toLowerCase()} con el flujo de revisión y confirmación`],
        timeline: [
          { time: en ? 'Now' : 'Ahora', text: en ? 'Notice generated after reviewing records' : 'Aviso generado al revisar los registros' },
          { time: last ? formatDay(last.measured_at, language) : '—', text: last ? (en ? 'Last confirmed record' : 'Último registro confirmado') : (en ? 'No records' : 'Sin registros') },
        ],
      })
    }
  }

  // Sueño: cambio entre el primer y el último registro de la ventana (cálculo del backend).
  const sleepStats = analyses.sleep?.personal_calculation?.stats
  if (sleepStats?.change_last_minus_first_hours != null && sleepStats.change_last_minus_first_hours !== 0) {
    const change = sleepStats.change_last_minus_first_hours
    alerts.push({
      id: 'sleep-change',
      metric: 'sleep',
      title: en ? 'Sleep' : 'Sueño',
      time: en ? 'Now' : 'Ahora',
      level: 'Preventivo',
      detailTitle: en ? `The latest sleep record is ${change > 0 ? 'higher' : 'lower'} than the first in this period` : `El último registro de sueño es ${change > 0 ? 'mayor' : 'menor'} que el primero de la ventana`,
      status: en ? 'Pending' : 'Pendiente',
      metricValue: `${round1(sleepStats.last.hours)} h`,
      metricSubtitle: `${en ? 'period average' : 'promedio de la ventana'}: ${round1(sleepStats.mean_hours)} h`,
      reason: en ? `Visible rule: with at least 3 recorded nights, the first (${round1(sleepStats.first.hours)} h) and latest (${round1(sleepStats.last.hours)} h) records are compared: ${change > 0 ? '+' : ''}${round1(change)} h. This describes data; it is not a clinical assessment.` : `Regla visible: con al menos 3 noches registradas, se compara el primer registro (${round1(sleepStats.first.hours)} h) con el último (${round1(sleepStats.last.hours)} h): ${change > 0 ? '+' : ''}${round1(change)} h. Es una descripción de los datos, no una evaluación clínica.`,
      actions: en ? ['Review sleep records in Body Explorer', 'Record any missing hours'] : ['Revisar los registros de sueño en Explorador corporal', 'Registrar las horas que falten'],
      timeline: [
        { time: en ? 'Now' : 'Ahora', text: en ? 'Notice generated after reviewing records' : 'Aviso generado al revisar los registros' },
        { time: formatDay(sleepStats.first.date, language), text: en ? 'First record in period' : 'Primer registro de la ventana' },
        { time: formatDay(sleepStats.last.date, language), text: en ? 'Last record in period' : 'Último registro de la ventana' },
      ],
    })
  }

  // Signos vitales: misma regla descriptiva por indicador.
  for (const code of TRACKED_METRICS) {
    if (code === 'sleep') continue
    const series = analyses[code]?.personal_calculation?.series?.[0]
    const stats = series?.stats
    const change = stats?.change_last_minus_first
    if (!change || change.every((d) => d === 0)) continue
    const label = en ? METRIC_EN[code] : METRIC_LABELS[code] || code
    const firstText = stats.first.values.join('/')
    const lastText = stats.last.values.join('/')
    const changeText = change.map((d) => `${d > 0 ? '+' : ''}${round1(d)}`).join('/')
    alerts.push({
      id: `change-${code}`,
      metric: code,
      title: label,
      time: en ? 'Now' : 'Ahora',
      level: 'Preventivo',
      detailTitle: en ? `${label}: change between the first and last records in this period` : `${label}: cambio entre el primer y el último registro de la ventana`,
      status: en ? 'Pending' : 'Pendiente',
      metricValue: `${lastText} ${series.unit}`,
      metricSubtitle: `${en ? 'average' : 'promedio'}: ${stats.mean.map(round1).join('/')} ${series.unit}`,
      reason: en ? `Visible rule: with at least 3 records, the first (${firstText} ${series.unit}) is compared with the latest (${lastText} ${series.unit}): ${changeText} ${series.unit}. This describes data; it is not a clinical assessment.` : `Regla visible: con al menos 3 registros, se compara el primero (${firstText} ${series.unit}) con el último (${lastText} ${series.unit}): ${changeText} ${series.unit}. Es una descripción de los datos, no una evaluación clínica.`,
      actions: [en ? `Review ${label.toLowerCase()} history in Body Explorer` : `Revisar la evolución de ${label.toLowerCase()} en Explorador corporal`],
      timeline: [
        { time: en ? 'Now' : 'Ahora', text: en ? 'Notice generated after reviewing records' : 'Aviso generado al revisar los registros' },
        { time: formatDay(stats.first.date, language), text: en ? 'First record in period' : 'Primer registro de la ventana' },
        { time: formatDay(stats.last.date, language), text: en ? 'Last record in period' : 'Último registro de la ventana' },
      ],
    })
  }

  return alerts
}

function AlertChart({ alert, analyses }) {
  const { language, tr } = useLanguage()
  let points = []
  let unit = ''
  if (alert.metric === 'sleep') {
    const nights = analyses.sleep?.personal_calculation?.nights ?? []
    points = nights.map((n) => ({ t: n.date, value: n.hours }))
    unit = 'h'
  } else {
    const series = analyses[alert.metric]?.personal_calculation?.series?.[0]
    points = (series?.points ?? []).map((p) => ({ t: p.t, value: p.values[0] }))
    unit = series?.unit || ''
  }

  if (points.length < 2) {
    return <p className="chart-empty">{tr('Sin registros suficientes en la ventana para dibujar la tendencia.', 'Not enough records in this period to draw a trend.')}</p>
  }

  const width = 400
  const height = 90
  const pad = 5
  const values = points.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) { min -= 1; max += 1 }
  const coords = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / (max - min)) * (height - pad * 2 - 12),
  ])
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const last = coords.at(-1)

  return (
    <div className="alert-detail-chart-wrap">
      <div className="chart-y-axis">
        <span>{round1(max)}</span>
        <span>{round1((max + min) / 2)}</span>
        <span>{round1(min)}</span>
      </div>
      <div className="chart-canvas-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="alert-trend-svg" preserveAspectRatio="none">
          <line x1="0" y1="30" x2={width} y2="30" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" />
          <line x1="0" y1="60" x2={width} y2="60" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" />
          <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx={last[0]} cy={last[1]} r="4.5" fill="#ffffff" stroke="#00b4f0" strokeWidth="2" />
        </svg>
        <div className="chart-x-axis">
          <span>{formatDay(points[0].t, language)}</span>
          <span>{formatDay(points[Math.floor((points.length - 1) / 2)].t, language)}</span>
          <span>{formatDay(points.at(-1).t, language)}</span>
        </div>
      </div>
      <span className="axis-vertical-hint">Unidad: {unit}</span>
    </div>
  )
}

export default function SmartAlertsPage({ onNotify, onOpenVitals }) {
  const { language, tr } = useLanguage()
  const [entries, setEntries] = useState([])
  const [analyses, setAnalyses] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [reviewedIds, setReviewedIds] = useState([])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setLoadError(false)
    const timeout = window.setTimeout(() => {
      if (!cancelled) { setLoadError(true); setLoaded(true) }
    }, 10000)
    listEntries().then((list) => {
      if (cancelled) return
      window.clearTimeout(timeout)
      setEntries(list.entries || [])
      setLoadError(false)
      setLoaded(true)
    }).catch((error) => {
      if (cancelled) return
      window.clearTimeout(timeout)
      setLoadError(true)
      setLoaded(true)
      onNotify?.(error.message)
    })
    TRACKED_METRICS.forEach((code) => {
      getAnalysis(code, 7).then((result) => {
        if (!cancelled) setAnalyses((current) => ({ ...current, [code]: result }))
      }).catch(() => {})
    })
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [retryKey])

  const alerts = useMemo(() => loaded && !loadError ? buildAlerts(entries, analyses, language) : [], [entries, analyses, loaded, loadError, language])
  const currentAlert = alerts.find((a) => a.id === selectedId) || alerts[0]
  const isReviewed = currentAlert ? reviewedIds.includes(currentAlert.id) : false
  const infoCount = alerts.filter((a) => a.level === 'Info').length
  const preventiveCount = alerts.filter((a) => a.level === 'Preventivo').length
  const attentionCount = alerts.filter((a) => a.level === 'Atencion').length
  const criticalCount = alerts.filter((a) => a.level === 'Critico').length
  const resolved = alerts.filter((a) => reviewedIds.includes(a.id))

  const handleMarkReviewed = () => {
    if (!currentAlert) return
    if (!isReviewed) {
      setReviewedIds([...reviewedIds, currentAlert.id])
      onNotify?.(tr(`Aviso "${currentAlert.title}" marcado como revisado.`, `Notice "${currentAlert.title}" marked as reviewed.`))
    } else {
      onNotify?.(tr('Este aviso ya fue revisado.', 'This notice was already reviewed.'))
    }
  }

  const handleContactMedical = async () => {
    try {
      const caps = await getCapabilities()
      onNotify?.(caps?.emergency_protocol?.communication_connected
        ? tr('Canal con el equipo médico disponible.', 'Medical team channel available.')
        : tr('Este prototipo no tiene comunicación con un equipo médico conectada. Nada se envió.', 'This prototype is not connected to a medical team. Nothing was sent.'))
    } catch {
      onNotify?.(tr('Este prototipo no tiene comunicación con un equipo médico conectada. Nada se envió.', 'This prototype is not connected to a medical team. Nothing was sent.'))
    }
  }

  return (
    <div className="smart-alerts-page" aria-label={tr('Alertas preventivas', 'Preventive notices')}>
      {/* Header específico de la página */}
      <header className="page-header-pro">
        <div>
          <h1>{tr('Avisos y cambios observados', 'Notices and observed changes')}</h1>
          <p>{tr('AVISOS INTELIGENTES · REGLAS VISIBLES SOBRE TUS REGISTROS', 'SMART ALERTS · VISIBLE RULES FOR YOUR RECORDS')}</p>
        </div>
      </header>

      {/* 4 Tarjetas de resumen */}
      <div className="alerts-summary-cards-row">
        <Panel className="alert-stat-card card--info">
          <div className="stat-card-top">
            <span className="stat-label">{tr('Informativo', 'Informational')}</span>
            <span className="stat-note">{tr('sin registros recientes', 'no recent records')}</span>
          </div>
          <strong className="stat-number">{loaded ? infoCount : <Skeleton w={36} h={30} />}</strong>
        </Panel>

        <Panel className="alert-stat-card card--warning">
          <div className="stat-card-top">
            <span className="stat-label">{tr('Cambio observado', 'Observed change')}</span>
            <span className="stat-note">{tr('descriptivo, no clínico', 'descriptive, not clinical')}</span>
          </div>
          <strong className="stat-number">{loaded ? preventiveCount : <Skeleton w={36} h={30} />}</strong>
        </Panel>

        <Panel className="alert-stat-card card--attention">
          <div className="stat-card-top">
            <span className="stat-label">{tr('Atención', 'Attention')}</span>
            <span className="stat-note">{tr('fuera del rango de referencia', 'outside reference range')}</span>
          </div>
          <strong className="stat-number">{loaded ? attentionCount : <Skeleton w={36} h={30} />}</strong>
        </Panel>

        <Panel className="alert-stat-card card--critical">
          <div className="stat-card-top">
            <span className="stat-label">{tr('Crítico', 'Critical')}</span>
            <span className="stat-note">{tr('muy lejos del rango', 'far outside range')}</span>
          </div>
          <strong className="stat-number">{loaded ? criticalCount : <Skeleton w={36} h={30} />}</strong>
        </Panel>
      </div>

      {/* Grid Principal: Lista a la izquierda + Detalle a la derecha */}
      <div className="alerts-main-grid">
        {/* Columna Izquierda: Lista de Alertas */}
        <div className="alerts-list-column">
          <Panel className="alerts-feed-panel">
            <span className="section-title">{tr('ALERTAS', 'NOTICES')}</span>
            <div className="alerts-items-feed">
              {!loaded && <SkeletonGroup label={tr('Cargando avisos…', 'Loading notices…')}>
                {[0, 1, 2].map((index) => <Skeleton key={index} w="100%" h={52} radius="12px" />)}
              </SkeletonGroup>}
              {loaded && !loadError && alerts.length === 0 && (
                <p className="chart-empty">{tr('Todos los indicadores tienen registros recientes y sin cambios en la ventana.', 'All metrics have recent records with no changes in this period.')}</p>
              )}
              {loadError && <p className="chart-empty">{tr('No se pudieron cargar los registros. Inténtalo de nuevo.', 'Could not load records. Try again.')}</p>}
              {alerts.map((alert) => {
                const isActive = alert.id === currentAlert?.id
                const isItemReviewed = reviewedIds.includes(alert.id)
                return (
                  <button
                    key={alert.id}
                    className={`alert-feed-item ${isActive ? 'is-active' : ''} item--${alert.level.toLowerCase()}`}
                    onClick={() => setSelectedId(alert.id)}
                    type="button"
                  >
                    <div className="item-bar-indicator" />
                    <div className="item-info">
                      <strong>{alert.title}</strong>
                      <small>{alert.time}</small>
                    </div>
                    <span className={`alert-badge badge--${alert.level.toLowerCase()}`}>
                      {isItemReviewed ? tr('Revisada', 'Reviewed') : levelLabel(alert.level, language === 'en')}
                    </span>
                  </button>
                )
              })}
            </div>

            <span className="section-title section-title--resolved">{tr('RESUELTAS', 'REVIEWED')}</span>
            <div className="resolved-items-feed">
              {loaded && resolved.length === 0 && <p className="chart-empty">{tr('Ninguna avisada como revisada todavía.', 'No notices marked as reviewed yet.')}</p>}
              {resolved.map((item) => (
                <div key={item.id} className="resolved-row">
                  <span>{item.title}</span>
                  <span className="alert-badge badge--resolved">{tr('Revisada', 'Reviewed')}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Columna Derecha: Detalle de la Alerta Seleccionada */}
        <div className="alerts-detail-column">
          <Panel className="alert-detail-panel">
            {!loaded && <SkeletonGroup label={tr('Cargando detalle del aviso…', 'Loading notice details…')}>
              <Skeleton w="30%" h={20} radius="12px" />
              <Skeleton w="70%" h={26} />
              <Skeleton w="100%" h={140} />
              <Skeleton w="90%" h={12} />
              <Skeleton w="75%" h={12} />
            </SkeletonGroup>}
            {!currentAlert && loaded && loadError && <div className="alert-load-state"><p>{tr('No se pudieron consultar los registros. Comprueba que el backend esté funcionando.', 'Could not retrieve records. Check that the backend is running.')}</p><button className="secondary-pill-btn" onClick={() => setRetryKey((value) => value + 1)} type="button">{tr('Reintentar', 'Retry')}</button></div>}
            {!currentAlert && loaded && !loadError && <p className="chart-empty">{tr('No hay avisos basados en tus registros para mostrar.', 'No record-based notices to show.')}</p>}
            {loaded && currentAlert && (
              <>
                <div className="detail-header-row">
                  <div>
                    <span className={`alert-badge badge--${currentAlert.level.toLowerCase()}`}>
                      {isReviewed ? tr('Revisada', 'Reviewed') : levelLabel(currentAlert.level, language === 'en')}
                    </span>
                    <h2>{currentAlert.detailTitle}</h2>
                    <p className="detail-meta">
                      {currentAlert.time} · {isReviewed ? tr('Revisada', 'Reviewed') : currentAlert.status}
                    </p>
                  </div>

                  <div className="detail-stat-bubble">
                    <strong>{currentAlert.metricValue}</strong>
                    <small>{currentAlert.metricSubtitle}</small>
                  </div>
                </div>

                <AlertChart alert={currentAlert} analyses={analyses} />

                {/* Dos bloques explicativos: regla visible + qué hacer */}
                <div className="alert-explanation-grid">
                  <div className="explanation-block">
                    <h3>{tr('POR QUÉ SE GENERÓ', 'WHY IT WAS GENERATED')}</h3>
                    <p>{currentAlert.reason}</p>
                  </div>

                  <div className="explanation-block">
                    <h3>{tr('QUÉ HACER', 'WHAT TO DO')}</h3>
                    <ul className="alert-actions-list">
                      {currentAlert.actions.map((act) => (
                        <li key={act}>
                          <span className="action-bullet" />
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Línea de tiempo */}
                <div className="alert-timeline-row">
                  {currentAlert.timeline.map((item, idx) => (
                    <div key={idx} className="timeline-step">
                      <div className="timeline-node" />
                      <div>
                        <strong>{item.time}</strong>
                        <span>{item.text}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Acciones finales */}
                <div className="alert-footer-actions">
                  <button
                    className="primary-pill-btn"
                    onClick={handleMarkReviewed}
                    type="button"
                  >
                    <span>{isReviewed ? tr('✓ Aviso revisado', '✓ Notice reviewed') : tr('Marcar como revisada', 'Mark as reviewed')}</span>
                  </button>

                  <button
                    className="secondary-pill-btn"
                    onClick={() => onOpenVitals?.()}
                    type="button"
                  >
                    <span>{tr('Registrar datos', 'Record data')}</span>
                  </button>

                  <button
                    className="secondary-pill-btn"
                    onClick={handleContactMedical}
                    type="button"
                  >
                    <span>{tr('Contactar al equipo médico', 'Contact medical team')}</span>
                  </button>

                  <span className="example-rule-hint">{tr('Derivada de tus registros, con regla visible', 'Based on your records, with a visible rule')}</span>
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
