import { lazy, Suspense, useEffect, useState } from 'react'
import { closeSession, hasSession, openSession } from '../api/client'
import LoginPage from '../pages/LoginPage'
import { LanguageProvider } from './LanguageContext'

const DashboardPage = lazy(() => import('../pages/DashboardPage'))

function SessionLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#030d1e', color: '#7dd3fc', fontFamily: 'inherit' }} role="status" aria-label="ASTRA HEALTH">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <span className="toast__pulse" style={{ width: 28, height: 28 }} aria-hidden="true" />
        <small style={{ letterSpacing: '0.18em', fontWeight: 600 }}>ASTRA HEALTH</small>
      </div>
    </div>
  )
}

export default function App() {
  const [notice, setNotice] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [session, setSession] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [entryGreeting, setEntryGreeting] = useState(null)

  // Si la pestaña ya tenía sesión, se reanuda sin pasar por el login.
  useEffect(() => {
    if (!hasSession()) {
      setCheckingSession(false)
      return
    }
    openSession().then((data) => {
      if (data) {
        setSession(data)
        setIsAuthenticated(true)
      }
    }).catch(() => {}).finally(() => setCheckingSession(false))
  }, [])

  const logout = async () => {
    try { await closeSession() } catch { /* el token local se elimina de todos modos */ }
    setSession(null)
    setIsAuthenticated(false)
    setEntryGreeting(null)
  }

  const notify = (message) => {
    setNotice(message)
    window.clearTimeout(notify.timer)
    notify.timer = window.setTimeout(() => setNotice(''), 2600)
  }

  return (
    <LanguageProvider>
      {checkingSession ? (
        <SessionLoading />
      ) : isAuthenticated ? (
        <Suspense fallback={<SessionLoading />}>
          <DashboardPage
            onNotify={notify}
            session={session}
            entryGreeting={entryGreeting}
            onLogout={logout}
            onUserUpdated={(user) => setSession((current) => ({ ...current, user }))}
          />
        </Suspense>
      ) : (
        <LoginPage onLogin={(data, mode) => {
          setSession(data)
          setEntryGreeting({ id: Date.now(), mode })
          setIsAuthenticated(true)
        }} />
      )}
      <div className={`toast ${notice ? 'toast--visible' : ''}`} role="status" aria-live="polite">
        <span className="toast__pulse" />
        {notice}
      </div>
    </LanguageProvider>
  )
}
