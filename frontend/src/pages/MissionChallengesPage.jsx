import { useEffect, useMemo, useState } from 'react'
import { Award, Heart, Hexagon, Moon, Shield, Sparkles, Sun, Target } from 'lucide-react'
import Panel from '../components/ui/Panel'
import Skeleton, { SkeletonGroup } from '../components/ui/Skeleton'
import { getRewards } from '../api/client'
import { useLanguage } from '../app/LanguageContext'

const BADGE_EN = {
  first_contact: { name: 'First contact', condition: 'Complete the initial walkthrough.' },
  heart_in_orbit: { name: 'Heart in orbit', condition: 'Save your first check-in; optional scales may stay empty.' },
  rest_guardian: { name: 'Rest guardian', condition: 'Record sleep on 3 different dates; no required number of hours.' },
  stellar_mind: { name: 'Stellar mind', condition: 'Voluntarily finish a breathing session.' },
  gravity_strength: { name: 'Gravity strength', condition: 'Complete your first weekly mission.' },
  protective_shield: { name: 'Protective shield', condition: 'Set your first personal reminder.' },
  orbital_consistency: { name: 'Orbital consistency', condition: 'Check in on 5 different days; they need not be consecutive.' },
  integral_explorer: { name: 'Whole-body explorer', condition: 'Explore Body Explorer, including the whole-body view.' },
}

const BADGE_META = {
  first_contact: { icon: 'helmet', condition: 'Completar el recorrido inicial.' },
  heart_in_orbit: { icon: 'heart', condition: 'Guardar el primer check-in; las escalas opcionales pueden quedar vacías.' },
  rest_guardian: { icon: 'moon', condition: 'Registrar sueño en 3 fechas distintas, sin exigir una cantidad de horas.' },
  stellar_mind: { icon: 'sparkle', condition: 'Finalizar voluntariamente una sesión de respiración.' },
  gravity_strength: { icon: 'hex', condition: 'Completar la primera misión semanal.' },
  protective_shield: { icon: 'shield', condition: 'Configurar el primer recordatorio propio.' },
  orbital_consistency: { icon: 'target', condition: 'Hacer check-in en 5 días distintos; no necesitan ser consecutivos.' },
  integral_explorer: { icon: 'sun', condition: 'Explorar el Explorador corporal, incluida la vista de todo el cuerpo.' },
}

const BADGE_CATALOG = [
  { code: 'first_contact', name: 'Primer contacto', xp: 50, target: 1 },
  { code: 'heart_in_orbit', name: 'Corazón en órbita', xp: 75, target: 1 },
  { code: 'rest_guardian', name: 'Guardián del descanso', xp: 75, target: 3 },
  { code: 'stellar_mind', name: 'Mente estelar', xp: 50, target: 1 },
  { code: 'gravity_strength', name: 'Fuerza gravitacional', xp: 125, target: 1 },
  { code: 'protective_shield', name: 'Escudo protector', xp: 150, target: 1 },
  { code: 'orbital_consistency', name: 'Constancia orbital', xp: 100, target: 5 },
  { code: 'integral_explorer', name: 'Explorador integral', xp: 100, target: 2 },
]

const EMPTY_REWARDS = {
  xp: 0,
  badges: BADGE_CATALOG.map((badge) => ({ ...badge, progress: 0, unlocked: false })),
  weekly_mission: {
    name: 'Operación Bienestar',
    week: '',
    complete: false,
    xp_awarded: false,
    conditions: [
      { code: 'check_in', label: 'Completar un check-in', complete: false },
      { code: 'pause', label: 'Completar una pausa voluntaria', complete: false },
    ],
  },
}

function BadgeIcon({ icon }) {
  if (icon === 'helmet') return <span className="custom-badge-icon">⛑</span>
  if (icon === 'heart') return <Heart size={20} />
  if (icon === 'moon') return <Moon size={20} />
  if (icon === 'sparkle') return <Sparkles size={20} />
  if (icon === 'hex') return <Hexagon size={20} />
  if (icon === 'shield') return <Shield size={20} />
  if (icon === 'target') return <Target size={20} />
  if (icon === 'sun') return <Sun size={20} />
  return <Award size={20} />
}

export default function MissionChallengesPage({ onNotify }) {
  const { language, tr } = useLanguage()
  const badgeName = (badge) => language === 'en' ? BADGE_EN[badge.code]?.name || badge.name : badge.name
  const [rewards, setRewards] = useState(EMPTY_REWARDS)
  const [rewardsLoading, setRewardsLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState('first_contact')

  useEffect(() => {
    getRewards().then(setRewards).catch(() => {
      // El catálogo bloqueado sigue visible si el backend aún no fue reiniciado.
    }).finally(() => setRewardsLoading(false))
  }, [])

  const badges = rewards?.badges || []
  const selected = badges.find((badge) => badge.code === selectedCode) || badges[0]
  const mission = rewards?.weekly_mission
  const totalAvailable = useMemo(() => badges.reduce((sum, badge) => sum + badge.xp, 0) + 150, [badges])
  const xpProgress = totalAvailable ? Math.min(100, ((rewards?.xp || 0) / totalAvailable) * 100) : 0

  return (
    <div className="challenges-page-pro" aria-label={tr('Misiones e insignias', 'Missions and badges')}>
      <header className="page-header-pro">
        <div>
          <h1>{tr('Misiones e insignias', 'Missions and badges')}</h1>
          <p>{tr('OBJETIVOS OPCIONALES · SIN PREMIAR VALORES DE SALUD', 'OPTIONAL GOALS · NO REWARDS FOR HEALTH VALUES')}</p>
        </div>
      </header>

      <Panel className="challenges-hero-card">
        <div className="hero-astronaut-avatar-wrap">
          <img src="/assets/astronauta.png" alt={tr('Astronauta', 'Astronaut')} className="hero-astronaut-img" loading="lazy" decoding="async" />
        </div>
        <div className="hero-level-info">
          <span className="hero-kicker">{tr('PROGRESO PERSONAL', 'PERSONAL PROGRESS')}</span>
          <h2>{rewardsLoading ? <Skeleton w={110} h={42} /> : `${rewards?.xp || 0} XP`}</h2>
          <p className="hero-desc">{tr('Los puntos reconocen acciones voluntarias, no cómo te sentiste.', 'Points recognize voluntary actions, not how you felt.')}</p>
          <div className="hero-progress-container">
            <div className="hero-xp-track"><div className="hero-xp-bar-fill" style={{ width: `${xpProgress}%` }} /></div>
            <div className="hero-xp-meta"><span>{rewardsLoading ? <Skeleton w={72} h={12} /> : `${badges.filter((badge) => badge.unlocked).length} ${tr('insignias', 'badges')}`}</span><span>{rewardsLoading ? <Skeleton w={150} h={12} /> : mission?.complete ? tr('Misión semanal completa', 'Weekly mission complete') : tr('Misión semanal en progreso', 'Weekly mission in progress')}</span></div>
          </div>
        </div>
        <div className="hero-xp-ring-wrap">
          <svg viewBox="0 0 100 100" className="hero-ring-svg">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255, 214, 90, 0.15)" strokeWidth="7" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#ffd25a" strokeWidth="7" strokeDasharray="251.2" strokeDashoffset={251.2 * (1 - xpProgress / 100)} strokeLinecap="round" transform="rotate(-90 50 50)" className="gold-ring-glow" />
          </svg>
          <div className="hero-ring-inner"><strong>{rewardsLoading ? <Skeleton w={34} h={30} /> : rewards?.xp || 0}</strong><small>XP</small></div>
        </div>
      </Panel>

      <Panel className="challenges-weekly-card">
        <div className="weekly-card-header">
          <div>
            <span className="section-title">{tr('MISIÓN SEMANAL', 'WEEKLY MISSION')}</span>
            <h3>{tr(mission?.name || 'Operación Bienestar', 'Operation Wellbeing')}</h3>
            <span className="weekly-xp-badge">+150 XP · {tr('una vez esta semana', 'once this week')}</span>
          </div>
        </div>

        <p className="mission-helper">{tr('Es opcional y se renueva cada semana. No exige diario ni valores específicos de salud.', 'Optional and renewed weekly. No journal or specific health values required.')}</p>
        <div className="weekly-metrics-grid mission-conditions-grid">
          {rewardsLoading ? (
            <SkeletonGroup label={tr('Cargando progreso semanal…', 'Loading weekly progress…')} className="weekly-skeleton">
              {[0, 1].map((index) => <div key={index} style={{ display: 'grid', gap: 8 }}><Skeleton w="70%" h={12} /><Skeleton w="100%" h={8} radius="6px" /></div>)}
            </SkeletonGroup>
          ) : (mission?.conditions || []).map((condition) => (
            <div className={`weekly-metric-item mission-condition ${condition.complete ? 'is-complete' : ''}`} key={condition.code}>
              <div className="metric-header-row"><span>{language === 'en' ? (condition.code === 'check_in' ? 'Complete a check-in' : 'Take a voluntary break') : condition.label}</span><strong>{condition.complete ? tr('Listo', 'Done') : tr('Pendiente', 'Pending')}</strong></div>
              <div className="metric-track"><div className="metric-bar-fill" style={{ width: condition.complete ? '100%' : '0%' }} /></div>
            </div>
          ))}
        </div>
        {mission?.xp_awarded && <span className="mission-awarded">{tr(`XP entregado para ${mission.week}; no volverá a sumarse.`, `XP awarded for ${mission.week}; it will not be added again.`)}</span>}
      </Panel>

      <Panel className="challenges-badges-collection-card">
        <span className="section-title">{tr('COLECCIÓN DE INSIGNIAS · LOGROS ÚNICOS', 'BADGE COLLECTION · ONE-TIME ACHIEVEMENTS')}</span>
        <div className="badges-hex-row">
          {rewardsLoading ? (
            <SkeletonGroup label={tr('Cargando insignias…', 'Loading badges…')}>
              <Skeleton w="100%" h={92} radius="12px" />
            </SkeletonGroup>
          ) : badges.map((badge) => (
            <button
              key={badge.code}
              className={`badge-item-wrap ${badge.unlocked ? 'badge--gold' : 'badge--blue'} ${selectedCode === badge.code ? 'is-selected' : ''}`}
              onClick={() => setSelectedCode(badge.code)}
              type="button"
            >
              <div className="badge-hexagon"><div className="badge-hexagon-inner"><BadgeIcon icon={BADGE_META[badge.code]?.icon} /></div></div>
              <span className="badge-label">{badgeName(badge)}</span>
              <span className="badge-xp">{badge.xp} XP</span>
              {!badge.unlocked && <div className="badge-mini-track"><div className="badge-mini-fill" style={{ width: `${Math.min(100, (badge.progress / badge.target) * 100)}%` }} /></div>}
            </button>
          ))}
        </div>

        {selected && (
          <div className="next-badge-footer-bar">
            <div className="next-badge-info">
              <span className="next-badge-kicker">{selected.unlocked ? tr('INSIGNIA CONSEGUIDA', 'BADGE EARNED') : tr('CÓMO CONSEGUIRLA', 'HOW TO EARN IT')}</span>
              <strong>{badgeName(selected)} · {selected.xp} XP</strong>
              <p>{language === 'en' ? BADGE_EN[selected.code]?.condition : BADGE_META[selected.code]?.condition}</p>
              <span className="badge-condition-progress">{tr('Progreso', 'Progress')}: {selected.progress}/{selected.target}</span>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
