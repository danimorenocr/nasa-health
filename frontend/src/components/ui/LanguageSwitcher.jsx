import { Languages } from 'lucide-react'
import { useLanguage } from '../../app/LanguageContext'

export default function LanguageSwitcher({ className = '' }) {
  const { language, setLanguage } = useLanguage()
  return (
    <div className={`language-switcher ${className}`} role="group" aria-label={language === 'en' ? 'Interface language' : 'Idioma de la interfaz'}>
      <Languages size={15} aria-hidden="true" />
      <button type="button" className={language === 'es' ? 'is-active' : ''} onClick={() => setLanguage('es')} aria-pressed={language === 'es'} aria-label="Español">ES</button>
      <span aria-hidden="true">/</span>
      <button type="button" className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'} aria-label="English">EN</button>
    </div>
  )
}
