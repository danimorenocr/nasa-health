import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Activity, Brain, CircleDot, FileDown, Heart, Plus, UserRound, Waves } from 'lucide-react'
import * as THREE from 'three'
import Panel from '../components/ui/Panel'
import Skeleton, { SkeletonGroup } from '../components/ui/Skeleton'
import { getCheckIns, listEntries, recordWellnessAction } from '../api/client'
import { formatValue, formatWhen, localDateKey } from '../data/format'
import { downloadReportPdf } from '../data/reportPdf'
import { useLanguage } from '../app/LanguageContext'

const SpaceHealthInsightsPage = lazy(() => import('./SpaceHealthInsightsPage'))
const WHOLE_BODY = 'Todo el cuerpo'

const SYSTEM_EN = {
  'Todo el cuerpo': { name: 'Whole body', description: 'Everything you have recorded across all systems, plus space health information and your report.', action: 'Review your records and download the report' },
  Cerebro: { name: 'Brain', description: 'Sleep and isolation may affect concentration.', action: 'Scheduled cognitive routine' },
  Corazón: { name: 'Heart', description: 'Microgravity changes how the heart pumps and adapts.', action: 'Scheduled cardiovascular exercise' },
  Pulmones: { name: 'Lungs', description: 'Breathing capacity is monitored throughout the mission.', action: 'Daily guided breathing' },
  Músculos: { name: 'Muscles', description: 'Muscle mass needs regular stimulation in microgravity.', action: 'Resistance exercise' },
  Digestivo: { name: 'Digestive', description: 'Nutrition and digestion are monitored during the mission.', action: 'Mission nutrition plan' },
  Inmunológico: { name: 'Immune', description: 'Space-related stress may change the immune response.', action: 'Regular medical monitoring' },
}
const BODY_METRIC_EN = { muscle_mass: 'Muscle weight', sleep: 'Reported sleep', heart_rate: 'Heart rate', blood_pressure: 'Blood pressure', oxygen_saturation: 'Oxygen saturation', glucose: 'Glucose', temperature: 'Temperature' }

// Cada sistema muestra solo los indicadores que el backend registra de verdad.
// Sin datos reales se dice "Sin registros"; no se simulan estados clínicos.
const SYSTEM_DEFS = [
  {
    name: WHOLE_BODY,
    icon: UserRound,
    description: 'Todo lo que has registrado en todos los sistemas, más la información de salud en el espacio y tu informe.',
    metrics: [
      { code: 'heart_rate', label: 'Frecuencia cardíaca' }, { code: 'blood_pressure', label: 'Presión arterial' },
      { code: 'oxygen_saturation', label: 'Saturación de oxígeno' }, { code: 'temperature', label: 'Temperatura' },
      { code: 'glucose', label: 'Glucosa' }, { code: 'sleep', label: 'Sueño declarado' }, { code: 'muscle_mass', label: 'Peso de músculos' },
    ],
    action: 'Revisa tus registros y descarga el informe',
  },
  { name: 'Cerebro', icon: Brain, description: 'El sueño y el aislamiento pueden afectar la concentración.', metrics: [{ code: 'sleep', label: 'Sueño declarado' }], action: 'Rutina cognitiva programada' },
  { name: 'Corazón', icon: Heart, description: 'La microgravedad cambia la forma en que el corazón bombea y se adapta.', metrics: [{ code: 'heart_rate', label: 'Frecuencia cardíaca' }, { code: 'blood_pressure', label: 'Presión arterial' }], action: 'Ejercicio cardiovascular programado' },
  { name: 'Pulmones', icon: Waves, description: 'La capacidad respiratoria se monitorea durante toda la misión.', metrics: [{ code: 'oxygen_saturation', label: 'Saturación de oxígeno' }], action: 'Respiración guiada diaria' },
  { name: 'Músculos', icon: Activity, description: 'La masa muscular requiere estímulo constante en microgravedad.', metrics: [{ code: 'muscle_mass', label: 'Peso de músculos' }], action: 'Ejercicio de resistencia' },
  { name: 'Digestivo', icon: CircleDot, description: 'La nutrición y digestión se controlan durante la misión.', metrics: [{ code: 'glucose', label: 'Glucosa' }], action: 'Plan nutricional de misión' },
  { name: 'Inmunológico', icon: Plus, description: 'El estrés espacial puede modificar la respuesta inmunológica.', metrics: [{ code: 'temperature', label: 'Temperatura' }], action: 'Control médico periódico' },
]

function buildSystems(latest, language) {
  return SYSTEM_DEFS.map((def) => {
    const records = def.metrics.map(({ code, label }) => {
      const entry = latest?.[code]
      return entry
        ? `${language === 'en' ? BODY_METRIC_EN[code] : label}: ${formatValue(entry.candidate)} ${entry.candidate.unit} · ${formatWhen(entry.measured_at, language)}`
        : `${language === 'en' ? BODY_METRIC_EN[code] : label}: ${language === 'en' ? 'no records' : 'sin registros'}`
    })
    const hasData = def.metrics.some(({ code }) => latest?.[code])
    return {
      ...def,
      status: def.metrics.length === 0 ? (language === 'en' ? 'No connected metric' : 'Sin indicador conectado') : hasData ? (language === 'en' ? 'Records available' : 'Con registros') : (language === 'en' ? 'No records' : 'Sin registros'),
      records: records.length ? records : [language === 'en' ? 'This prototype does not record a metric for this system' : 'Este prototipo no registra un indicador de este sistema'],
    }
  })
}

const bodyHitZones = [
  { id: 'brain', system: 'Cerebro', color: '#b98cff', shape: 'sphere', position: [0, 5.55, 0.3], markerPosition: [0, 6.02, 0.68], scale: [0.48, 0.58, 0.48] },
  { id: 'immune', system: 'Inmunológico', color: '#68f5a7', shape: 'sphere', position: [0, 4.92, 0.45], markerPosition: [0, 5.02, 0.72], scale: [0.28, 0.3, 0.28] },
  { id: 'lungs', system: 'Pulmones', color: '#56a8ff', shape: 'box', position: [0.12, 4.42, 0.35], markerPosition: [0.38, 4.43, 0.74], scale: [0.92, 0.58, 0.5] },
  { id: 'heart', system: 'Corazón', color: '#ff718b', shape: 'sphere', position: [-0.24, 4.34, 0.82], markerPosition: [-0.25, 4.58, 0.9], scale: [0.3, 0.34, 0.28] },
  { id: 'digestive', system: 'Digestivo', color: '#ffb45e', shape: 'box', position: [0, 3.62, 0.42], markerPosition: [0, 3.7, 0.7], scale: [0.82, 0.78, 0.5] },
  { id: 'muscle-arm-left', system: 'Músculos', color: '#48e5ed', shape: 'box', position: [-0.88, 4.18, 0.18], rotation: [0, 0, -0.82], scale: [0.34, 1.25, 0.34] },
  { id: 'muscle-arm-right', system: 'Músculos', color: '#48e5ed', shape: 'box', position: [0.84, 3.72, 0.12], markerPosition: [0.82, 4.14, 0.58], rotation: [0, 0, -0.08], scale: [0.34, 1.45, 0.34] },
]

function TouchBeacon({ active, color, hovered, position, phase }) {
  const pulse = useRef()

  useFrame(({ clock }) => {
    if (!pulse.current) return
    const wave = (Math.sin(clock.elapsedTime * 2.25 + phase) + 1) / 2
    const emphasis = active ? 0.22 : hovered ? 0.16 : 0.1
    pulse.current.scale.setScalar(1 + wave * emphasis)
  })

  return (
    <group ref={pulse} position={position} renderOrder={30}>
      <mesh raycast={() => null}>
        <sphereGeometry args={[active ? 0.078 : 0.068, 18, 14]} />
        <meshBasicMaterial
          color={hovered ? '#ffffff' : color}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh raycast={() => null} scale={active ? 1.65 : hovered ? 1.55 : 1.42}>
        <sphereGeometry args={[0.1, 18, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={active ? 0.28 : hovered ? 0.23 : 0.16}
          blending={THREE.AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function BodyHitZone({ zone, phase, showBeacon, selected, hovered, onPointerDown, onPointerUp, onPointerOver, onPointerOut }) {
  const active = selected === zone.system
  const isHovered = hovered === zone.system

  return (
    <>
      <mesh
        position={zone.position}
        rotation={zone.rotation || [0, 0, 0]}
        scale={zone.scale}
        userData={{ bodySystem: zone.system }}
        onPointerDown={(event) => onPointerDown(event, zone.system)}
        onPointerUp={(event) => onPointerUp(event, zone.system)}
        onPointerCancel={(event) => onPointerOut(event, zone.system)}
        onPointerOver={(event) => onPointerOver(event, zone.system)}
        onPointerOut={(event) => onPointerOut(event, zone.system)}
      >
        {zone.shape === 'sphere'
          ? <sphereGeometry args={[1, 22, 16]} />
          : <boxGeometry args={[1, 1, 1]} />}
        <meshBasicMaterial
          transparent
          opacity={0}
          colorWrite={false}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {showBeacon && (
        <TouchBeacon active={active} color={zone.color} hovered={isHovered} position={zone.markerPosition} phase={phase} />
      )}
    </>
  )
}

function ExplorerModel({ selected, onSelect }) {
  const group = useRef()
  const gestures = useRef(new Map())
  const [hovered, setHovered] = useState(null)
  const { scene } = useGLTF('/assets/holograming_man.glb')
  const model = useMemo(() => cloneSkeleton(scene), [scene])

  useEffect(() => {
    model.traverse((node) => {
      if (!node.isMesh) return
      if (node.name.toLowerCase().includes('sphere')) {
        node.visible = false
        return
      }
      const hologramMaterial = node.material.clone()
      hologramMaterial.transparent = true
      hologramMaterial.opacity = 0.8
      hologramMaterial.depthWrite = true
      hologramMaterial.side = THREE.FrontSide
      node.material = hologramMaterial
    })
    const raisedUpperArm = model.getObjectByName('upper_arm.R_030')
    const raisedForearm = model.getObjectByName('forearm.R_031')
    if (raisedUpperArm) raisedUpperArm.quaternion.set(-0.4075, -0.6086, 0.3288, 0.5962)
    if (raisedForearm) raisedForearm.quaternion.set(0.2275, -0.1996, 0.1682, 0.9381)
  }, [model])

  useFrame((state) => {
    if (group.current) group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.22) * 0.045
  })

  const pointerPosition = (event) => event.nativeEvent || event

  const handlePointerDown = (event, system) => {
    const pointer = pointerPosition(event)
    const multiTouch = gestures.current.size > 0
    if (multiTouch) {
      gestures.current.forEach((current) => { current.multiTouch = true })
    }
    gestures.current.set(pointer.pointerId, {
      system,
      x: pointer.clientX,
      y: pointer.clientY,
      multiTouch,
    })
  }

  const handlePointerUp = (event, system) => {
    const pointer = pointerPosition(event)
    const start = gestures.current.get(pointer.pointerId)
    gestures.current.delete(pointer.pointerId)
    if (!start || start.multiTouch || start.system !== system) return
    const moved = Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y)
    if (moved > 8) return
    event.stopPropagation()
    onSelect(system)
  }

  const handlePointerOver = (event, system) => {
    event.stopPropagation()
    setHovered(system)
    const canvas = event.nativeEvent?.target
    if (canvas?.style) canvas.style.cursor = 'pointer'
  }

  const handlePointerOut = (event, system) => {
    const pointer = pointerPosition(event)
    gestures.current.delete(pointer.pointerId)
    setHovered((current) => current === system ? null : current)
    const canvas = event?.nativeEvent?.target
    if (canvas?.style) canvas.style.cursor = 'grab'
  }

  // El modelo es una sola escena: las zonas invisibles viven en este mismo grupo,
  // por lo que mantienen su posición al rotar o acercar la cámara.
  return (
    <group ref={group} scale={1.08} position={[0.08, -0.42, 0]}>
      <primitive object={model} />
      {bodyHitZones.map((zone, index) => (
        <BodyHitZone
          key={zone.id}
          zone={zone}
          phase={index * 0.57}
          showBeacon={Boolean(zone.markerPosition)}
          selected={selected}
          hovered={hovered}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        />
      ))}
    </group>
  )
}

function BodyModel({ selected, onSelect, latest }) {
  const { tr } = useLanguage()
  const hr = latest?.heart_rate
  const o2 = latest?.oxygen_saturation
  const temp = latest?.temperature
  const gluc = latest?.glucose
  return (
    <div className="body-model-stage" aria-label={tr(`Modelo corporal interactivo. Zona seleccionada: ${selected}`, `Interactive body model. Selected area: ${SYSTEM_EN[selected]?.name || selected}`)}>
      <div className="body-orbit body-orbit--one" /><div className="body-orbit body-orbit--two" />
      <div className="body-platform"><i /><i /><i /></div>
      <Suspense fallback={<div className="body-model-loading">{tr('Sincronizando modelo…', 'Syncing model…')}</div>}>
        <Canvas key="body-explorer-fixed-camera" camera={{ position: [0, 2.35, 14.2], fov: 32 }} dpr={[1, 1.7]} gl={{ alpha: true, antialias: true }}>
          <ambientLight intensity={0.5} color="#43dcff" />
          <pointLight position={[2, 3, 4]} intensity={8} color="#00bfff" distance={10} />
          <pointLight position={[-2, 0, 3]} intensity={6} color="#70f5ff" distance={9} />
          <ExplorerModel selected={selected} onSelect={onSelect} />
          <OrbitControls target={[0, 2.35, 0.6]} enableZoom={false} enablePan={false} minPolarAngle={Math.PI / 2} maxPolarAngle={Math.PI / 2} />
        </Canvas>
      </Suspense>
      <div className="body-callout body-callout--mood"><small>{tr('TEMPERATURA', 'TEMPERATURE')}</small><strong>{temp ? <>{formatValue(temp.candidate)} <em>{temp.candidate.unit}</em></> : '—'}</strong></div>
      <div className="body-callout body-callout--heart"><small>{tr('FREC. CARDÍACA', 'HEART RATE')}</small><strong>{hr ? <>{formatValue(hr.candidate)} <em>{hr.candidate.unit}</em></> : '—'}</strong></div>
      <div className="body-callout body-callout--oxygen"><small>{tr('SATURACIÓN O₂', 'OXYGEN SAT. O₂')}</small><strong>{o2 ? <>{formatValue(o2.candidate)}<em>{o2.candidate.unit}</em></> : '—'}</strong></div>
      <div className="body-callout body-callout--activity"><small>{tr('GLUCOSA', 'GLUCOSE')}</small><strong>{gluc ? <>{formatValue(gluc.candidate)} <em>{gluc.candidate.unit}</em></> : '—'}</strong></div>
    </div>
  )
}

const TREND_COLORS = ['#50e6ff', '#ffb45e']
const TREND_COLOR_BY_METRIC = { muscle_mass: '#48e5ed', heart_rate: '#ff9d83', blood_pressure: '#ffb45e', sleep: '#b98cff', oxygen_saturation: '#56a8ff', glucose: '#ffb45e', temperature: '#68f5a7' }

// Seguimiento de 24 horas de un indicador: cada lectura en su hora real.
const TREND_RANGES = [1, 7, 30, 90]

function DetailTrend24({ code, label, entries, end }) {
  const { language, tr } = useLanguage()
  const [range, setRange] = useState(1)
  const start = end - range * 24 * 3600000
  const rows = entries
    .filter((e) => e.candidate?.kind === 'measurement' && e.candidate.metric === code && new Date(e.measured_at).getTime() >= start)
    .sort((a, b) => new Date(a.measured_at) - new Date(b.measured_at))
  const unit = rows.at(-1)?.candidate.unit || ''
  const sameUnit = rows.filter((e) => e.candidate.unit === unit)
  const lineCount = code === 'blood_pressure' ? 2 : 1
  const color = TREND_COLOR_BY_METRIC[code] || TREND_COLORS[0]
  const title = `${label}${unit ? ` (${unit})` : ''}`
  const rangeName = range === 1 ? tr('24 h', '24 h') : `${range} ${tr('días', 'days')}`
  const tabs = (
    <div className="body-trend-range" role="group" aria-label={tr('Periodo de la gráfica', 'Chart period')}>
      {TREND_RANGES.map((value) => (
        <button key={value} type="button" className={range === value ? 'is-active' : ''} aria-pressed={range === value} onClick={(event) => { event.stopPropagation(); setRange(value) }}>
          {value === 1 ? '24 h' : `${value} ${tr('d', 'd')}`}
        </button>
      ))}
    </div>
  )

  if (sameUnit.length === 0) {
    return <div className="body-trend"><h4 className="body-trend-title">{title}</h4>{tabs}<p className="chart-empty">{range === 1 ? tr('Sin registros en las últimas 24 horas.', 'No records in the last 24 hours.') : tr(`Sin registros en los últimos ${range} días.`, `No records in the last ${range} days.`)}</p></div>
  }

  const all = sameUnit.flatMap((e) => e.candidate.values.slice(0, lineCount))
  let min = Math.min(...all)
  let max = Math.max(...all)
  if (min === max) { min -= 1; max += 1 }
  const left = 27
  const right = 266
  const top = 10
  const bottom = 82
  const x = (t) => left + ((new Date(t).getTime() - start) / (end - start)) * (right - left)
  const y = (v) => top + (1 - (v - min) / (max - min)) * (bottom - top)
  const hour = (t) => new Date(t).toLocaleTimeString(language === 'en' ? 'en-US' : 'es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
  const ticks = [0, 1, 2, 3, 4].map((i) => start + (i * (end - start)) / 4)
  const tickLabel = (t) => range === 1
    ? hour(t)
    : new Date(t).toLocaleDateString(language === 'en' ? 'en-US' : 'es-CO', { day: '2-digit', month: '2-digit' })

  return (
    <div className="body-trend">
      <h4 className="body-trend-title">{title} <small>{sameUnit.length} {tr('lecturas', 'readings')} · {rangeName}</small></h4>
      {tabs}
      <svg className="body-detail-chart" viewBox="0 0 270 104" role="img" aria-label={tr(`Seguimiento de ${label} (${rangeName})`, `Tracking of ${label} (${rangeName})`)}>
        {[max, (max + min) / 2, min].map((tick, index) => {
          const gy = top + index * ((bottom - top) / 2)
          return <g key={index}><line x1={left} x2={right} y1={gy} y2={gy} className="body-detail-grid" /><text x="1" y={gy + 4} className="body-detail-label">{tick.toFixed(1)}</text></g>
        })}
        {Array.from({ length: lineCount }, (_, line) => {
          const pts = sameUnit.filter((e) => e.candidate.values[line] != null).map((e) => [x(e.measured_at), y(e.candidate.values[line])])
          const path = pts.map(([px, py], i) => `${i ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
          const stroke = line === 0 ? color : '#ffffff'
          return <g key={line}><path d={path} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity={line ? 0.6 : 1} />{pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="3.2" fill={stroke} />)}</g>
        })}
        {ticks.map((t, i) => <text key={i} x={x(t)} y="100" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="body-detail-label">{tickLabel(t)}</text>)}
      </svg>
      {code === 'blood_pressure' && <small className="body-trend-note">{tr('Línea de color: sistólica · línea blanca: diastólica', 'Colored line: systolic · white line: diastolic')}</small>}
    </div>
  )
}

export default function BodyExplorerPage({ onNotify, onOpenVitals }) {
  const { language, tr } = useLanguage()
  const [selected, setSelected] = useState(WHOLE_BODY)
  const isWhole = selected === WHOLE_BODY
  const [latest, setLatest] = useState({})
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  const [entries, setEntries] = useState([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [reportRange, setReportRange] = useState(1)
  const [busyPdf, setBusyPdf] = useState(false)
  const systems = useMemo(() => buildSystems(latest, language), [latest, language])
  const detail = systems.find((system) => system.name === selected) || systems[0]

  useEffect(() => {
    let cancelled = false
    listEntries().then((data) => {
      if (cancelled) return
      const list = data.entries || []
      const byMetric = {}
      for (const entry of list) {
        const code = entry.candidate?.metric
        if (entry.candidate?.kind !== 'measurement' || !code) continue
        if (!byMetric[code] || entry.measured_at > byMetric[code].measured_at) byMetric[code] = entry
      }
      setEntries(list)
      setLatest(byMetric)
      setNowMs(Date.now())
    }).catch(() => { }).finally(() => { if (!cancelled) setEntriesLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const chooseSystem = (name) => {
    setSelected(name)
    setNowMs(Date.now())
    if (name === WHOLE_BODY) recordWellnessAction('explore_insights', localDateKey(new Date().toISOString())).catch(() => {})
    onNotify(tr(`Explorando sistema: ${name}.`, `Exploring system: ${SYSTEM_EN[name]?.name || name}.`))
  }

  const handleReportPdf = async () => {
    setBusyPdf(true)
    try {
      const checkIns = await getCheckIns(Math.max(7, reportRange)).then((d) => d.check_ins || []).catch(() => [])
      await downloadReportPdf({ entries, range: reportRange, language, checkIns })
      onNotify?.(tr('Informe PDF descargado.', 'PDF report downloaded.'))
    } catch (error) {
      onNotify?.(error.message || tr('No se pudo generar el PDF.', 'Could not generate the PDF.'))
    } finally {
      setBusyPdf(false)
    }
  }

  return (
    <section className="body-explorer" aria-label={tr('Explorador del cuerpo humano', 'Human body explorer')}>
      <div className="body-register-bar">
        {isWhole && (
          <button className="body-report-btn" onClick={handleReportPdf} disabled={busyPdf || !entriesLoaded} type="button">
            <FileDown size={17} />
            {busyPdf ? tr('Generando PDF…', 'Generating PDF…') : tr('Descargar informe PDF', 'Download PDF report')}
          </button>
        )}
        <button className="primary-pill-btn" onClick={onOpenVitals} type="button">{tr('Registrar datos', 'Record data')}</button>
      </div>
      <div className="body-main-grid">
        <Panel className="body-systems-card">
          <span className="body-kicker">{tr('SISTEMAS', 'SYSTEMS')}</span>
          <nav>{systems.map(({ name, icon: Icon }) => <button key={name} className={selected === name ? 'is-active' : ''} onClick={() => chooseSystem(name)}><Icon size={20} strokeWidth={1.45} /><span>{language === 'en' ? SYSTEM_EN[name]?.name : name}</span></button>)}</nav>
        </Panel>

        <BodyModel selected={selected} onSelect={chooseSystem} latest={latest} />

        <Panel className="body-detail-card">
          <div className="body-detail-top">
            <span className="body-kicker">{tr('DETALLE', 'DETAIL')}</span>
            <h2>{language === 'en' ? SYSTEM_EN[detail.name]?.name : detail.name}</h2>
            {entriesLoaded ? <span className="body-status-chip">{detail.status}</span> : <Skeleton w={120} h={22} radius="14px" />}
            {!entriesLoaded ? (
              <SkeletonGroup label={tr('Cargando seguimiento de 24 horas…', 'Loading 24-hour tracking…')}>
                <Skeleton w="100%" h={130} />
              </SkeletonGroup>
            ) : isWhole ? (
              <p className="chart-empty">{tr('Abajo ves el seguimiento, los sistemas y el informe de todo tu cuerpo.', 'Below you can see tracking, systems and the report for your whole body.')}</p>
            ) : detail.metrics.length === 0 ? (
              <p className="chart-empty">{tr('Este sistema no tiene indicadores conectados.', 'This system has no connected metrics.')}</p>
            ) : (
              detail.metrics.map(({ code, label }) => (
                <DetailTrend24 key={code} code={code} label={language === 'en' ? BODY_METRIC_EN[code] : label} entries={entries} end={nowMs} />
              ))
            )}
          </div>
          <div className="body-detail-sections">
            <div className="body-detail-block">
              <h3>{tr('EN EL ESPACIO', 'IN SPACE')}</h3>
              <p>{language === 'en' ? SYSTEM_EN[detail.name]?.description : detail.description}</p>
            </div>
            <div className="body-detail-block">
              <h3>{tr('QUÉ SE REGISTRA', 'WHAT IS RECORDED')}</h3>
              <ul>{detail.records.map((record) => <li key={record}>{record}</li>)}</ul>
            </div>
            <div className="body-detail-block">
              <h3>{tr('ACCIONES PREVENTIVAS', 'PREVENTIVE ACTIONS')}</h3>
              <ul><li>{language === 'en' ? SYSTEM_EN[detail.name]?.action : detail.action}</li></ul>
            </div>
          </div>
        </Panel>
      </div>

      {isWhole && (
        <Suspense fallback={<SkeletonGroup label={tr('Cargando vista de todo el cuerpo…', 'Loading whole-body view…')}><Skeleton w="100%" h={260} radius="14px" /></SkeletonGroup>}>
          <SpaceHealthInsightsPage onNotify={onNotify} range={reportRange} onRangeChange={setReportRange} />
        </Suspense>
      )}
    </section>
  )
}

useGLTF.preload('/assets/holograming_man.glb')
