import { Bell, LogOut } from 'lucide-react'

const headerCopy = {
  Dashboard: { title: 'Centro de control', subtitle: 'DASHBOARD · ¿CÓMO ESTOY HOY? ¿QUÉ DEBO HACER?' },
  'Mind Tracker': { title: 'Bienestar psicológico', subtitle: 'MIND TRACKER · CHECK-IN · DIARIO · EVOLUCIÓN' },
  'Body Explorer': { title: 'Cuerpo humano', subtitle: 'BODY EXPLORER · EXPLORA CADA SISTEMA.' },
}

export default function DashboardHeader({ page = 'Dashboard', onNotify, user, onLogout }) {
  const copy = headerCopy[page] ?? headerCopy.Dashboard

  return (
    <header className="dashboard-header">
      <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
      <div className="dashboard-header__actions">
        <button className="user-pill" onClick={onLogout} title="Cerrar sesión">
          <div className="avatar avatar--small" aria-hidden="true" />
          {user?.name || 'Astronauta'}
          <LogOut size={14} />
        </button>
      </div>
    </header>
  )
}
