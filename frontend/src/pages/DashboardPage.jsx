import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, Volume2, VolumeX } from 'lucide-react'
import Sidebar from '../components/layout/Sidebar'
import ProfileCard from '../components/dashboard/ProfileCard'
import MetricCard from '../components/dashboard/MetricCard'
import SystemsPanel from '../components/dashboard/SystemsPanel'
import RecordsComparisonPanel from '../components/dashboard/RecordsComparisonPanel'
import AstraVoicePanel from '../components/voice/AstraVoicePanel'
import AstraAura, { useAstraOverlay } from '../components/voice/AstraAura'
import useHealthData from '../hooks/useHealthData'
import { loadSyntheticAll, recordWellnessAction, updateProfileImage } from '../api/client'
import { localDateKey } from '../data/format'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'
import PageSkeleton from '../components/ui/PageSkeleton'
import Skeleton, { SkeletonGroup } from '../components/ui/Skeleton'
import { useLanguage } from '../app/LanguageContext'
import '../styles/dashboard.css'
import '../styles/health-monitor.css'
import '../styles/mind-tracker.css'
import '../styles/body-explorer.css'
import '../styles/space-health-insights.css'
import '../styles/smart-alerts.css'
import '../styles/mission-challenges.css'
import '../styles/health-analytics.css'
import '../styles/wellness-guide.css'
import '../styles/astra-voice.css'
import '../styles/responsive.css'
import '../styles/page-skeleton.css'

const MindTrackerPage = lazy(() => import('./MindTrackerPage'))
const BodyExplorerPage = lazy(() => import('./BodyExplorerPage'))
const SmartAlertsPage = lazy(() => import('./SmartAlertsPage'))
const MissionChallengesPage = lazy(() => import('./MissionChallengesPage'))
const WellnessGuidePage = lazy(() => import('./WellnessGuidePage'))
const HumanVisualizer = lazy(() => import('../components/dashboard/HumanVisualizer'))
const VitalsModal = lazy(() => import('../components/modals/VitalsModal'))

const CARD_ORDER = [
  'muscle_mass',
  'heart_rate',
  'sleep',
  'blood_pressure',
  'oxygen_saturation',
  'temperature',
  'glucose',
]

export default function DashboardPage({ onNotify, session, entryGreeting, onLogout, onUserUpdated }) {
  const { language, tr } = useLanguage()
  const greetingText = entryGreeting?.mode === 'register'
    ? tr('Bienvenido a ASTRA. ¿Cómo te sientes hoy?', 'Welcome to ASTRA. How are you feeling today?')
    : tr('Bienvenido de nuevo a ASTRA. ¿Cómo te sientes hoy?', 'Welcome back to ASTRA. How are you feeling today?')
  const [activePage, setActivePage] = useState('Dashboard')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMetric, setModalMetric] = useState('')
  const openVitalsFor = (code) => { setModalMetric(code); setModalOpen(true) }
  const [greetingVisible, setGreetingVisible] = useState(false)
  const [greetingSpeaking, setGreetingSpeaking] = useState(false)
  const [typedGreeting, setTypedGreeting] = useState('')
  const [greetingRunCount, setGreetingRunCount] = useState(0)
  const greetingTimer = useRef(null)
  const typingTimer = useRef(null)
  const greetingRun = useRef(0)
  const { latest, entries, history, loading, reload } = useHealthData()
  const { snap: astraSnap, reply: astraReply, onAstraState } = useAstraOverlay()
  const sessionStartedAt = session?.created_at
  // Día de misión: el día del primer registro es el día 0 y se cuenta por fechas del calendario.
  const firstRecordAt = entries.reduce((first, entry) => (!first || entry.measured_at < first ? entry.measured_at : first), null)
  const calendarStart = (iso) => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  const sessionDay = firstRecordAt
    ? Math.max(0, Math.round((calendarStart(new Date().toISOString()) - calendarStart(firstRecordAt)) / 86400000))
    : 0

  const speakGreeting = useCallback(() => {
    const run = ++greetingRun.current
    setGreetingRunCount((c) => c + 1)
    window.clearTimeout(greetingTimer.current)
    window.clearInterval(typingTimer.current)
    setGreetingSpeaking(true)
    setGreetingVisible(true)
    setTypedGreeting('')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTypedGreeting(greetingText)
    } else {
      let characterCount = 0
      typingTimer.current = window.setInterval(() => {
        characterCount += 1
        setTypedGreeting(greetingText.slice(0, characterCount))
        if (characterCount >= greetingText.length) window.clearInterval(typingTimer.current)
      }, 55)
    }
    greetingTimer.current = window.setTimeout(() => setGreetingVisible(false), 9000)
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(greetingText)
    utterance.lang = language === 'en' ? 'en-US' : 'es-CO'
    utterance.rate = 0.92
    utterance.volume = 0.85
    utterance.voice = window.speechSynthesis.getVoices().find((voice) => voice.lang?.toLowerCase().startsWith(language)) || null
    utterance.onstart = () => setGreetingSpeaking(true)
    const finish = () => {
      if (run !== greetingRun.current) return
      setGreetingSpeaking(false)
      window.clearTimeout(greetingTimer.current)
      greetingTimer.current = window.setTimeout(() => setGreetingVisible(false), 6000)
    }
    utterance.onend = finish
    utterance.onerror = finish
    window.speechSynthesis.speak(utterance)
  }, [greetingText, language])

  const toggleGreeting = () => {
    if (greetingSpeaking) {
      greetingRun.current += 1
      window.speechSynthesis?.cancel()
      setGreetingSpeaking(false)
      window.clearTimeout(greetingTimer.current)
      setGreetingVisible(false)
    } else {
      speakGreeting()
    }
  }

  useEffect(() => {
    if (entryGreeting) speakGreeting()
    return () => {
      greetingRun.current += 1
      window.clearTimeout(greetingTimer.current)
      window.clearInterval(typingTimer.current)
      window.speechSynthesis?.cancel()
    }
  }, [entryGreeting?.id, speakGreeting])

  useEffect(() => {
    if (!session?.user?.id) return
    recordWellnessAction('onboarding_completed', localDateKey(new Date().toISOString())).catch(() => {})
  }, [session?.user?.id])

  const selectPage = (page) => {
    setActivePage(page)
    const action = page === 'Body Explorer' ? 'explore_body' : null
    if (action) recordWellnessAction(action, localDateKey(new Date().toISOString())).catch(() => {})
  }

  const saved = async () => {
    await reload()
    onNotify?.(tr('Registro confirmado y guardado en SQLite.', 'Record confirmed and saved.'))
  }

  const loadDemoData = async () => {
    try {
      await loadSyntheticAll()
      await reload()
      onNotify?.(tr('Datos sintéticos de 3 días cargados en todos los indicadores.', '3 days of synthetic data loaded for all metrics.'))
    } catch (error) {
      onNotify?.(error.message)
    }
  }

  const voiceSaved = async () => {
    await reload()
    onNotify?.('Registro por voz confirmado y guardado en SQLite.')
  }

  const saveProfileImage = async (url) => {
    const user = await updateProfileImage(url)
    onUserUpdated?.(user)
    onNotify?.(url ? tr('Foto de perfil actualizada.', 'Profile photo updated.') : tr('Se restauró la imagen predeterminada.', 'Default image restored.'))
  }

  const renderDashboard = () => (
    <div className="dashboard-main-layout">
      {/* Columna Izquierda: Información clínica, métricas y tareas */}
      <div className="dashboard-content-column">
        {/* Profile Card con datos reales */}
        <ProfileCard
          user={session?.user}
          sessionDay={sessionDay}
          sessionStartedAt={sessionStartedAt}
          lastEntry={entries[0]}
          onChangeProfileImage={saveProfileImage}
        />

        {/* 6 Tarjetas de Métricas con datos reales */}
        <div className="metrics-grid-pro">
          {CARD_ORDER.map((code) => (
            <MetricCard
              key={code}
              code={code}
              entry={latest[code]}
              historySeries={history?.[code]?.series?.[0]}
              loading={loading}
              onOpenRegister={openVitalsFor}
            />
          ))}
          <RecordsComparisonPanel entries={entries} loading={loading} />
        </div>

        {/* Fila: Sistemas de los últimos 7 días + comparación de registros */}
        <div className="dashboard-systems-row">
          <SystemsPanel entries={entries} loading={loading} />
        </div>
      </div>

      {/* Columna Derecha: Humano Holográfico 3D */}
      <div className="dashboard-visualizer-column">
        <Suspense fallback={<SkeletonGroup label={tr('Cargando modelo…', 'Loading model…')} className="body-model-loading"><Skeleton w="min(42%, 200px)" h="68%" radius="42% 42% 22% 22%" /></SkeletonGroup>}>
          <HumanVisualizer
            isWaving={greetingSpeaking || greetingVisible}
            onToggleGreeting={toggleGreeting}
            greetingSpeaking={greetingSpeaking}
            greetingRun={greetingRunCount}
          />
        </Suspense>
        <AstraAura snap={astraSnap} reply={astraReply} />
        {greetingVisible && (
          <div className={`dashboard-greeting ${greetingSpeaking ? 'is-speaking' : ''} ${typedGreeting.length < greetingText.length ? 'is-typing' : ''}`}>
            <div className="dashboard-greeting__halo" aria-hidden="true"><i /><i /><i /></div>
            <p role="status" aria-label={greetingText}><span aria-hidden="true">{typedGreeting}</span></p>
            <div className="dashboard-greeting__wave" aria-hidden="true">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div>
          </div>
        )}
      </div>
    </div>
  )

  const renderPage = () => {
    if (activePage === 'Mind Tracker') return <MindTrackerPage onNotify={onNotify} />
    if (activePage === 'Body Explorer') return <BodyExplorerPage onNotify={onNotify} onOpenVitals={() => setModalOpen(true)} />
    if (activePage === 'Smart Alerts') {
      return <SmartAlertsPage onNotify={onNotify} onOpenVitals={() => setModalOpen(true)} />
    }
    if (activePage === 'Mission Challenges') {
      return <MissionChallengesPage onNotify={onNotify} onOpenVitals={() => setModalOpen(true)} sessionDay={sessionDay} />
    }
    if (activePage === 'Wellness Guide') return <WellnessGuidePage onNotify={onNotify} />
    return renderDashboard()
  }

  return (
    <main className="app-shell-pro">
      <div className="space-vignette" />

      {/* Sidebar fijo a la izquierda */}
      <Sidebar
        activeItem={activePage}
        onSelect={selectPage}
        onNotify={onNotify}
        sessionDay={sessionDay}
        sessionStartedAt={firstRecordAt}
        onLogout={onLogout}
      />

      {/* Contenido principal del dashboard */}
      <div className="dashboard-viewport">
        {/* Barra superior con onda ECG y botón de cierre de sesión */}
        <header className="dashboard-top-bar">
          <div className="dashboard-top-bar__status">
            <LanguageSwitcher />
            <svg className="ecg-pulse-svg" viewBox="0 0 50 18" fill="none" aria-hidden="true">
              <path
                d="M 0 9 H 14 L 18 2 L 23 16 L 27 6 L 30 11 L 33 9 H 50"
                stroke="#31dcff"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <button className="top-bar-logout-btn" onClick={loadDemoData} title={tr('Cargar datos sintéticos de 3 días', 'Load 3 days of synthetic data')} type="button">
              <span>{tr('Datos de prueba (3 días)', 'Demo data (3 days)')}</span>
            </button>
            {onLogout && (
              <button
                className="top-bar-logout-btn"
                onClick={onLogout}
                title={tr('Cerrar sesión', 'Log out')}
                type="button"
              >
                <LogOut size={13} />
                <span>{tr('Cerrar sesión', 'Log out')}</span>
              </button>
            )}
          </div>
        </header>

        <Suspense fallback={<PageSkeleton page={activePage} tr={tr} />}>
          {renderPage()}
        </Suspense>
      </div>

      {modalOpen && <Suspense fallback={null}><VitalsModal key={modalMetric || 'free'} open={modalOpen} initialMetric={modalMetric} onClose={() => { setModalOpen(false); setModalMetric('') }} onSaved={saved} /></Suspense>}
      <AstraVoicePanel onNotify={onNotify} onSaved={voiceSaved} onStateChange={onAstraState} />
    </main>
  )
}
