import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BookOpen,
  CircleAlert,
  Droplets,
  ExternalLink,
  HeartPulse,
  MoonStar,
  ShieldCheck,
  Stethoscope,
  Thermometer,
  Wind,
  X,
} from 'lucide-react'
import Panel from '../components/ui/Panel'
import { getGuidance } from '../api/client'
import { useLanguage } from '../app/LanguageContext'
import { localizeWellnessGuidance } from '../data/wellnessGuideEnglish'

// Contenido 100% servido por el backend (curado, con fuentes y fechas de
// revisión). Esta página solo lo presenta; no añade criterios propios.

const METRIC_ICONS = {
  heart_rate: HeartPulse,
  temperature: Thermometer,
  blood_pressure: Activity,
  oxygen_saturation: Wind,
  glucose: Droplets,
  sleep: MoonStar,
}

const CONTEXT_LABELS = {
  es: { space: 'En el espacio', terrestrial: 'En la Tierra', both: 'Espacio y Tierra' },
  en: { space: 'In space', terrestrial: 'On Earth', both: 'Space and Earth' },
}

const GUIDE_SECTIONS = [
  {
    id: 'questions',
    title: { es: 'Preguntas del reto NASA', en: 'NASA challenge questions' },
    eyebrow: { es: 'Punto de partida', en: 'Starting point' },
    description: { es: 'Respuestas claras sobre mediciones, exámenes, riesgos y prevención durante una misión.', en: 'Clear answers about measurements, examinations, risks, and prevention during a mission.' },
    icon: BookOpen,
  },
  {
    id: 'measures',
    title: { es: 'Medidas preventivas', en: 'Preventive measures' },
    eyebrow: { es: 'Bienestar con respaldo', en: 'Evidence-based wellness' },
    description: { es: 'Acciones para el espacio y la Tierra, con su evidencia, contexto y límites.', en: 'Actions for space and Earth, including their evidence, context, and limitations.' },
    icon: ShieldCheck,
  },
  {
    id: 'indicators',
    title: { es: 'Guía por indicador', en: 'Guide by indicator' },
    eyebrow: { es: 'Lecturas e instrumentos', en: 'Readings and instruments' },
    description: { es: 'Qué mide cada indicador, para qué sirve y qué información no puede mostrar por sí solo.', en: 'What each indicator measures, what it is used for, and what it cannot show on its own.' },
    icon: Activity,
  },
  {
    id: 'medical',
    title: { es: 'Evaluación médica', en: 'Medical assessment' },
    eyebrow: { es: 'Decisiones clínicas', en: 'Clinical decisions' },
    description: { es: 'Situaciones que requieren la valoración del equipo médico y no dependen de la aplicación.', en: 'Situations that require assessment by the medical team and are not decided by the application.' },
    icon: Stethoscope,
  },
  {
    id: 'limits',
    title: { es: 'Límites de ASTRA', en: 'ASTRA limitations' },
    eyebrow: { es: 'Lo que no monitorea', en: 'What is not monitored' },
    description: { es: 'Aspectos de la salud espacial que no están representados por los indicadores de la plataforma.', en: 'Space-health factors that are not represented by the platform indicators.' },
    icon: CircleAlert,
  },
  {
    id: 'sources',
    title: { es: 'Fuentes y referencias', en: 'Sources and references' },
    eyebrow: { es: 'Biblioteca verificada', en: 'Verified library' },
    description: { es: 'Consulta el origen, alcance y fecha de revisión de las fuentes usadas en esta guía.', en: 'Review the origin, scope, and review date of the sources used in this guide.' },
    icon: ExternalLink,
  },
]

function SourceChips({ ids, sources }) {
  if (!ids?.length) return null
  return (
    <div className="guide-sources">
      {ids.map((id) => {
        const src = sources[id]
        if (!src) return null
        return (
          <a key={id} className="guide-source-chip" href={src.url} target="_blank" rel="noreferrer" title={src.scope}>
            <BookOpen size={12} />
            <span>{src.title}</span>
            <ExternalLink size={11} />
          </a>
        )
      })}
    </div>
  )
}

function MeasureCard({ measure, sources, language = 'es', tr = (spanish) => spanish }) {
  return (
    <article className="guide-measure-card">
      <div className="guide-measure-head">
        <h4>{measure.title}</h4>
        <span className={`guide-context-badge guide-context-badge--${measure.context}`}>
          {CONTEXT_LABELS[language]?.[measure.context] || measure.context}
        </span>
      </div>
      <p>{measure.action}</p>
      <p className="guide-evidence"><strong>{tr('Evidencia: ', 'Evidence: ')}</strong>{measure.evidence}</p>
      <p className="guide-limits"><strong>{tr('Límites: ', 'Limitations: ')}</strong>{measure.limits}</p>
      <SourceChips ids={measure.source_ids} sources={sources} />
    </article>
  )
}

function IndicatorGuide({ item, sources, tr, language }) {
  const Icon = METRIC_ICONS[item.code] || Activity
  return (
    <div className="guide-indicator-detail">
      <div className="guide-indicator-columns">
        <section>
          <h4><Icon size={15} /> {tr('Qué mide y con qué', 'What it measures and how')}</h4>
          <p>{item.what}</p>
          <ul>
            {item.instruments.map((inst) => <li key={inst}>{inst}</li>)}
          </ul>
          <h4>{tr('Para qué sirve', 'What it is used for')}</h4>
          <p>{item.purpose}</p>
        </section>
        <section>
          <h4>{tr('Riesgos espaciales relacionados', 'Related spaceflight risks')}</h4>
          <ul>
            {item.spaceflight_links.map((link) => <li key={link}>{link}</li>)}
          </ul>
          <p className="guide-note">{tr('Relación general documentada en astronautas; no prueba causalidad sobre una lectura personal.', 'A general relationship documented in astronauts; it does not prove causation for a personal reading.')}</p>
          <h4>{tr('Lo que no muestra', 'What it does not show')}</h4>
          <p>{item.not_shown}</p>
        </section>
      </div>
      <div className="guide-attention">
        <h4><CircleAlert size={15} /> {tr('Cuándo podría requerir atención', 'When it may require attention')}</h4>
        <p>{item.attention}</p>
        <SourceChips ids={item.attention_source_ids} sources={sources} />
      </div>
      {item.actions?.length > 0 && (
        <div className="guide-indicator-actions">
          <h4><ShieldCheck size={15} /> {tr('Medidas preventivas con respaldo', 'Evidence-based preventive measures')}</h4>
          <div className="guide-measures-grid">
            {item.actions.map((measure) => <MeasureCard key={measure.id} measure={measure} sources={sources} language={language} tr={tr} />)}
          </div>
        </div>
      )}
      <SourceChips ids={item.source_ids} sources={sources} />
    </div>
  )
}

function SectionContent({ sectionId, guidance, sources, activeCode, onActiveCodeChange, language, tr }) {
  if (sectionId === 'questions') {
    return (
      <div className="guide-challenge-grid">
        {guidance.challenge_questions.map((q) => (
          <article key={q.question} className="guide-challenge-card">
            <h4>{q.question}</h4>
            <p>{q.answer}</p>
            <SourceChips ids={q.source_ids} sources={sources} />
          </article>
        ))}
      </div>
    )
  }

  if (sectionId === 'measures') {
    return (
      <>
        <p className="guide-panel-note">
          {tr(
            'Cada medida declara su contexto, evidencia y límites. Las referencias terrestres no son protocolos de vuelo.',
            'Each measure states its context, evidence, and limitations. Earth-based references are not spaceflight protocols.',
          )}
        </p>
        <div className="guide-measures-grid">
          {guidance.measures.map((measure) => (
            <MeasureCard key={measure.id} measure={measure} sources={sources} language={language} tr={tr} />
          ))}
        </div>
      </>
    )
  }

  if (sectionId === 'indicators') {
    const active = guidance.indicators.find((item) => item.code === activeCode) ?? guidance.indicators[0]
    return (
      <>
        <div className="guide-metric-pills" role="tablist" aria-label={tr('Indicadores', 'Indicators')}>
          {guidance.indicators.map((item) => {
            const Icon = METRIC_ICONS[item.code] || Activity
            return (
              <button
                key={item.code}
                role="tab"
                aria-selected={item.code === active.code}
                className={`guide-metric-pill ${item.code === active.code ? 'is-active' : ''}`}
                onClick={() => onActiveCodeChange(item.code)}
                type="button"
              >
                <Icon size={15} />
                <span>{item.name}</span>
              </button>
            )
          })}
        </div>
        <IndicatorGuide item={active} sources={sources} language={language} tr={tr} />
      </>
    )
  }

  if (sectionId === 'medical') {
    return (
      <>
        <p className="guide-panel-note">
          {tr(
            'Estas decisiones corresponden al equipo médico de la misión; no las toma la aplicación ni la IA.',
            'These decisions belong to the mission medical team; they are not made by the application or AI.',
          )}
        </p>
        <div className="guide-medical-list">
          {guidance.medical_only.map((block) => (
            <article key={block.title} className="guide-medical-item">
              <h4><Stethoscope size={15} /> {block.title}</h4>
              <p>{block.detail}</p>
              <SourceChips ids={block.source_ids} sources={sources} />
            </article>
          ))}
        </div>
      </>
    )
  }

  if (sectionId === 'limits') {
    return (
      <>
        <ul className="guide-not-monitored">
          {guidance.not_monitored.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="guide-note">
          {tr(
            'Los cinco peligros del vuelo espacial de NASA HRP incluyen riesgos que los seis indicadores de ASTRA no capturan.',
            'NASA HRP’s five hazards of human spaceflight include risks that ASTRA’s six indicators do not capture.',
          )}
        </p>
      </>
    )
  }

  return (
    <>
      <p className="guide-panel-note">
        {tr('Contenido curado por el equipo y revisado el', 'Content curated by the team and reviewed on')} {guidance.reviewed_at}. {tr('Cada fuente declara su alcance.', 'Each source states its scope.')}
      </p>
      <ul className="guide-source-list">
        {guidance.sources.map((src) => (
          <li key={src.id}>
            <a href={src.url} target="_blank" rel="noreferrer">
              {src.title} <ExternalLink size={12} />
            </a>
            <span className="guide-source-meta">{tr('Revisada:', 'Reviewed:')} {src.reviewed_at}</span>
            <p>{src.scope}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function GuideSectionDialog({ section, guidance, sources, activeCode, onActiveCodeChange, onClose, language, tr }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    dialog.showModal()
    document.documentElement.classList.add('guide-dialog-open')

    return () => {
      document.documentElement.classList.remove('guide-dialog-open')
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="guide-section-dialog"
      aria-labelledby="guide-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="guide-section-dialog__header">
        <div>
          <span className="section-title">{section.eyebrow[language]}</span>
          <h2 id="guide-dialog-title">{section.title[language]}</h2>
          <p>{section.description[language]}</p>
        </div>
        <button type="button" className="guide-section-dialog__close" onClick={onClose} aria-label={tr('Cerrar', 'Close')}>
          <X size={24} />
        </button>
      </div>
      <div className="guide-section-dialog__body">
        <SectionContent
          sectionId={section.id}
          guidance={guidance}
          sources={sources}
          activeCode={activeCode}
          onActiveCodeChange={onActiveCodeChange}
          language={language}
          tr={tr}
        />
      </div>
      <div className="guide-section-dialog__footer">
        {tr(
          'Información educativa y general. No sustituye la evaluación del equipo médico de la misión.',
          'Educational and general information. It does not replace assessment by the mission medical team.',
        )}
      </div>
    </dialog>
  )
}

export default function WellnessGuidePage({ onNotify }) {
  const { language, tr } = useLanguage()
  const [guidance, setGuidance] = useState(null)
  const [error, setError] = useState('')
  const [activeCode, setActiveCode] = useState('heart_rate')
  const [selectedSection, setSelectedSection] = useState(null)

  useEffect(() => {
    getGuidance()
      .then((data) => setGuidance(data))
      .catch(() => {
        setError(tr('No se pudo cargar la orientación de bienestar.', 'The wellness guide could not be loaded.'))
        onNotify?.(tr('No se pudo cargar la orientación de bienestar.', 'The wellness guide could not be loaded.'))
      })
  }, [onNotify, tr])

  const displayedGuidance = useMemo(() => {
    if (!guidance || language !== 'en') return guidance
    return localizeWellnessGuidance(guidance)
  }, [guidance, language])

  const sources = useMemo(() => {
    const map = {}
    for (const src of displayedGuidance?.sources ?? []) map[src.id] = src
    return map
  }, [displayedGuidance])

  if (error) return <Panel className="guide-error">{error}</Panel>
  if (!guidance) return <Panel className="guide-loading">{tr('Cargando orientación de bienestar…', 'Loading wellness guide…')}</Panel>

  return (
    <div className="wellness-guide-page">
      <header className="page-header-pro guide-header">
        <h1>{tr('Bienestar y prevención', 'Wellness and prevention')}</h1>
        <p>{tr(
          displayedGuidance.intro,
          'Wellness guidance curated by the team using public sources from NASA, JAXA, WHO, and NIH health references. It is educational and general: it is not validated medical advice, does not interpret your readings, and does not replace the mission medical team.',
        )}</p>
      </header>

      <section className="guide-library" aria-label={tr('Secciones de la guía de bienestar', 'Wellness guide sections')}>
        {GUIDE_SECTIONS.map((section, index) => {
          const Icon = section.icon
          return (
            <Panel as="article" key={section.id} className={`guide-library-card guide-library-card--${section.id}`}>
              <div className="guide-library-card__top">
                <span className="guide-library-card__icon"><Icon size={25} /></span>
                <span className="guide-library-card__count">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <span className="section-title">{section.eyebrow[language]}</span>
              <h2>{section.title[language]}</h2>
              <p>{section.description[language]}</p>
              <button type="button" onClick={() => setSelectedSection(section)}>
                {tr('Saber más', 'Learn more')} <span aria-hidden="true">→</span>
              </button>
            </Panel>
          )
        })}
      </section>

      {selectedSection && (
        <GuideSectionDialog
          section={selectedSection}
          guidance={displayedGuidance}
          sources={sources}
          activeCode={activeCode}
          onActiveCodeChange={setActiveCode}
          onClose={() => setSelectedSection(null)}
          language={language}
          tr={tr}
        />
      )}
    </div>
  )
}
