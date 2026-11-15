import { useState } from 'react'
import {
  Calendar,
  Globe,
  LogOut,
  Menu,
  Rocket,
  X,
} from 'lucide-react'
import { navItems } from '../../data/dashboardData'
import { useLanguage } from '../../app/LanguageContext'

const NAV_EN = {
  Dashboard: 'Dashboard',
  'Mind Tracker': 'Mind Tracker',
  'Body Explorer': 'Body Explorer',
  'Smart Alerts': 'Smart Alerts',
  'Mission Challenges': 'Missions & Badges',
  'Wellness Guide': 'Wellness Guide',
}

const NAV_ES = {
  Dashboard: 'Panel principal',
  'Mind Tracker': 'Bienestar emocional',
  'Body Explorer': 'Explorador corporal',
  'Smart Alerts': 'Avisos inteligentes',
  'Mission Challenges': 'Misiones e insignias',
  'Wellness Guide': 'Guía de bienestar',
}

function Brand() {
  return (
    <div className="brand">
      <img src="/assets/logo3.png" alt="ASTRA HEALTH Logo" className="brand__logo-img" />
      <div className="brand__text">
        <strong>ASTRA</strong>
        <small>HEALTH</small>
      </div>
    </div>
  )
}

export default function Sidebar({
  activeItem = 'Dashboard',
  onSelect,
  onNotify,
  sessionDay = 145,
  sessionStartedAt,
  onLogout,
}) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const { language, tr } = useLanguage()

  const selectItem = (label) => {
    setOpen(false)
    const available = [
      'Dashboard',
      'Mind Tracker',
      'Body Explorer',
      'Smart Alerts',
      'Mission Challenges',
      'Wellness Guide',
    ]
    if (available.includes(label)) {
      onSelect?.(label)
      return
    }
    onNotify?.(tr(`${NAV_ES[label] || label} estará disponible en la próxima misión.`, `${NAV_EN[label] || label} will be available in the next mission.`))
  }

  return (
    <>
      <button className="mobile-menu" onClick={() => setOpen(true)} aria-label={tr('Abrir navegación', 'Open navigation')}>
        <Menu size={21} />
      </button>

      <button
        className={`sidebar-backdrop ${open ? 'is-visible' : ''}`}
        onClick={() => setOpen(false)}
        aria-label={tr('Cerrar navegación', 'Close navigation')}
      />

      <aside id="main-sidebar" className={`sidebar glass-panel ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
        <button
          className="sidebar__close"
          onClick={() => setOpen(false)}
          aria-label={tr('Cerrar navegación', 'Close navigation')}
          type="button"
        >
          <X size={18} />
        </button>

        <button
          className="sidebar__collapse"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? tr('Expandir navegación', 'Expand navigation') : tr('Reducir navegación', 'Collapse navigation')}
          aria-expanded={!collapsed}
          aria-controls="main-sidebar"
          title={collapsed ? tr('Expandir menú', 'Expand menu') : tr('Reducir menú', 'Collapse menu')}
          type="button"
        >
          <Menu size={18} />
        </button>

        <Brand />

        <nav className="sidebar__nav" aria-label={tr('Navegación principal', 'Main navigation')}>
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${activeItem === label ? 'nav-item--active' : ''}`}
              onClick={() => selectItem(label)}
              title={collapsed ? (language === 'en' ? NAV_EN[label] : NAV_ES[label]) : undefined}
              aria-label={language === 'en' ? NAV_EN[label] : NAV_ES[label]}
              type="button"
            >
              <Icon size={16} strokeWidth={1.6} />
              <span>{language === 'en' ? NAV_EN[label] : NAV_ES[label]}</span>
            </button>
          ))}
        </nav>

        <div className="mission-card" title={collapsed ? tr(`Día ${sessionDay} de misión`, `Mission day ${sessionDay}`) : undefined}>
          <div className="mission-card__badge">
            <Rocket size={13} className="mission-card__rocket-icon" />
            <span className="eyebrow">{tr('CONTEXTO DE MISIÓN', 'MISSION CONTEXT')}</span>
          </div>

          <strong className="mission-card__day">{tr('Día', 'Day')} {sessionDay}</strong>

          <div className="mission-card__lines">
            <p>
              <Calendar size={12} />
              <span>{tr('Primer registro (día 0)', 'First record (day 0)')}: {sessionStartedAt ? new Date(sessionStartedAt).toLocaleDateString(language === 'en' ? 'en-US' : 'es-CO') : tr('aún sin registros', 'no records yet')}</span>
            </p>
            <p>
              <Globe size={12} />
              <span>{tr('Misión orbital · Microgravedad', 'Orbital mission · Microgravity')}</span>
            </p>
          </div>

        </div>

        {onLogout && (
          <button
            className="sidebar__logout-btn"
            onClick={onLogout}
            title={tr('Cerrar sesión', 'Log out')}
            aria-label={tr('Cerrar sesión', 'Log out')}
            type="button"
          >
            <LogOut size={14} />
            <span>{tr('Cerrar sesión', 'Log out')}</span>
          </button>
        )}
      </aside>
    </>
  )
}
