import { useState } from 'react'
import { Activity, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { loginAccount, registerAccount } from '../api/client'
import LoginAstronaut from '../components/login/LoginAstronaut'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'
import { useLanguage } from '../app/LanguageContext'

export default function LoginPage({ onLogin }) {
  const { tr } = useLanguage()
  const [showPassword, setShowPassword] = useState(false)
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const registering = mode === 'register'

  const changeMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setShowPassword(false)
  }

  const submit = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const email = String(form.get('email') || '').trim()
    const password = String(form.get('password') || '')
    const confirmation = String(form.get('confirmation') || '')

    if (registering && password !== confirmation) {
      setError(tr('Las contraseñas no coinciden.', 'Passwords do not match.'))
      return
    }

    setBusy(true)
    setError('')
    try {
      const session = registering
        ? await registerAccount(name, email, password)
        : await loginAccount(email, password)
      onLogin(session, registering ? 'register' : 'login')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-page__nebula" />
      <div className="login-page__frame" aria-hidden="true">
        <i className="hud-corner hud-corner--tl" />
        <i className="hud-corner hud-corner--tr" />
        <i className="hud-corner hud-corner--bl" />
        <i className="hud-corner hud-corner--br" />
      </div>

      <header className="login-header">
        <div className="login-brand">
          <img src="/assets/logo3.png" alt="" />
          <div><strong>ASTRA</strong><span>HEALTH</span></div>
        </div>
        <LanguageSwitcher />
      </header>

      <section className="login-copy" aria-labelledby="login-heading">
        <p className="login-kicker">{tr('INTELIGENCIA DE SALUD ASTRONAUTA', 'ASTRONAUT HEALTH INTELLIGENCE')}</p>
        <h1 id="login-heading">{tr('Tu salud,', 'Your health,')}<br /><em>{tr('bajo control.', 'under control.')}</em></h1>
        <p className="login-lead">{tr('Monitoreo inteligente para', 'Smart monitoring for')}<br />{tr('misiones espaciales.', 'space missions.')}</p>
        <div className="login-motto"><span /><Activity size={31} /><span /></div>
        <p className="login-motto__text">{tr('MONITOREAR · ANTICIPAR · ACTUAR', 'MONITOR · ANTICIPATE · ACT')}</p>
      </section>

      <section className="login-astronaut" aria-label={tr('Astronauta 3D animado', 'Animated 3D astronaut')}>
        <LoginAstronaut />
      </section>

      <form className={`access-card ${registering ? 'access-card--register' : ''}`} onSubmit={submit}>
        <div className="access-card__edge access-card__edge--top" />
        <div className="access-card__edge access-card__edge--bottom" />
        <div className="access-mode" role="tablist" aria-label={tr('Tipo de acceso', 'Access type')}>
          <button type="button" role="tab" aria-selected={!registering} className={!registering ? 'is-active' : ''} onClick={() => changeMode('login')}>{tr('Ingresar', 'Sign in')}</button>
          <button type="button" role="tab" aria-selected={registering} className={registering ? 'is-active' : ''} onClick={() => changeMode('register')}>{tr('Crear cuenta', 'Create account')}</button>
        </div>
        <div className="access-card__title"><span />{tr('CENTRO DE ACCESO', 'ACCESS CENTER')}<span /></div>
        <h2>{registering ? tr('Crea tu perfil de misión', 'Create your mission profile') : tr('Bienvenido, astronauta', 'Welcome, astronaut')}</h2>
        <p>{registering ? tr('Tus registros quedarán vinculados a esta cuenta.', 'Your records will be linked to this account.') : tr('Ingresa para continuar con tus registros de salud.', 'Sign in to continue with your health records.')}</p>

        {registering && (
          <label className="access-input">
            <UserRound size={24} />
            <input type="text" name="name" placeholder={tr('Nombre completo', 'Full name')} autoComplete="name" minLength="2" maxLength="80" required />
          </label>
        )}

        <label className="access-input">
          <Mail size={24} />
          <input type="email" name="email" placeholder={tr('Correo institucional', 'Institutional email')} autoComplete="username" maxLength="254" required />
        </label>

        <label className="access-input">
          <LockKeyhole size={24} />
          <input type={showPassword ? 'text' : 'password'} name="password" placeholder={tr('Contraseña (mínimo 8 caracteres)', 'Password (at least 8 characters)')} autoComplete={registering ? 'new-password' : 'current-password'} minLength="8" maxLength="128" required />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? tr('Ocultar contraseña', 'Hide password') : tr('Mostrar contraseña', 'Show password')}>
            {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
          </button>
        </label>

        {registering && (
          <label className="access-input">
            <LockKeyhole size={24} />
            <input type={showPassword ? 'text' : 'password'} name="confirmation" placeholder={tr('Confirma la contraseña', 'Confirm password')} autoComplete="new-password" minLength="8" maxLength="128" required />
          </label>
        )}

        <button className="access-submit" type="submit" disabled={busy}>
          {busy ? tr('PROCESANDO…', 'PROCESSING…') : registering ? tr('CREAR CUENTA Y CONTINUAR', 'CREATE ACCOUNT AND CONTINUE') : tr('INGRESAR AL CENTRO DE CONTROL', 'ENTER CONTROL CENTER')} <ArrowRight size={20} />
        </button>
        {error && <p className="access-error" role="alert">{error}</p>}
        <button className="access-alternate" type="button" onClick={() => changeMode(registering ? 'login' : 'register')}>
          {registering ? tr('¿Ya tienes una cuenta? Ingresa', 'Already have an account? Sign in') : tr('¿Aún no tienes cuenta? Regístrate', "Don't have an account? Sign up")}
        </button>
        <div className="access-secure"><ShieldCheck size={18} /> {tr('Contraseña protegida · sesión privada', 'Protected password · private session')}</div>
      </form>

      <footer className="login-footer">ASTRA HEALTH · SPACE MEDICAL INTELLIGENCE</footer>
      <div className="login-footer__bars" aria-hidden="true"><i /><i /><i /><i /></div>
    </main>
  )
}
