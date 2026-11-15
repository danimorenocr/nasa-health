import { createContext, useContext, useEffect, useState } from 'react'
import { setApiLanguage } from '../api/client'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    let saved = 'es'
    try { saved = localStorage.getItem('astra-language') === 'en' ? 'en' : 'es' } catch { /* sin almacenamiento */ }
    setApiLanguage(saved)
    return saved
  })

  useEffect(() => {
    document.documentElement.lang = language
    setApiLanguage(language)
    try { localStorage.setItem('astra-language', language) } catch { /* Storage may be disabled. */ }
  }, [language])

  const tr = (spanish, english) => language === 'en' ? english : spanish
  return <LanguageContext.Provider value={{ language, setLanguage, tr }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}
