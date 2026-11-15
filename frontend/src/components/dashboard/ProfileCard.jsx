import { useEffect, useState } from 'react'
import { Camera, Link2, Orbit, Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import Panel from '../ui/Panel'
import { formatWhen } from '../../data/format'
import { useLanguage } from '../../app/LanguageContext'

const DEFAULT_AVATAR = '/assets/astronauta.png'

function AvatarImage({ src, alt }) {
  return (
    <img
      key={src || DEFAULT_AVATAR}
      src={src || DEFAULT_AVATAR}
      alt={alt}
      onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR }}
    />
  )
}

export default function ProfileCard({ user, sessionDay = 0, sessionStartedAt, onChangeProfileImage }) {
  const { language, tr } = useLanguage()
  const [editingPhoto, setEditingPhoto] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const profileImageUrl = user?.profile_image_url || ''

  useEffect(() => {
    if (!editingPhoto) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !saving) setEditingPhoto(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [editingPhoto, saving])

  const openEditor = () => {
    setDraftUrl(profileImageUrl)
    setError('')
    setEditingPhoto(true)
  }

  const savePhoto = async (event) => {
    event.preventDefault()
    const value = draftUrl.trim()
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'https:') throw new Error()
    } catch {
      setError(tr('Pega una URL válida que comience por https://', 'Enter a valid URL starting with https://'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onChangeProfileImage?.(value)
      setEditingPhoto(false)
    } catch (requestError) {
      setError(requestError.message || tr('No se pudo guardar la foto.', 'Could not save the photo.'))
    } finally {
      setSaving(false)
    }
  }

  const removePhoto = async () => {
    setSaving(true)
    setError('')
    try {
      await onChangeProfileImage?.(null)
      setDraftUrl('')
      setEditingPhoto(false)
    } catch (requestError) {
      setError(requestError.message || tr('No se pudo restaurar la imagen.', 'Could not restore the image.'))
    } finally {
      setSaving(false)
    }
  }

  const photoModal = editingPhoto && createPortal(
    <div
      className="modal-backdrop profile-photo-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) setEditingPhoto(false)
      }}
    >
      <form className="profile-photo-modal glass-panel" onSubmit={savePhoto} role="dialog" aria-modal="true" aria-labelledby="profile-photo-title">
        <button className="modal-close" type="button" onClick={() => setEditingPhoto(false)} disabled={saving} aria-label={tr('Cerrar', 'Close')}>
          <X size={18} />
        </button>
        <span className="profile-photo-modal__eyebrow">{tr('PERFIL DE MISIÓN', 'MISSION PROFILE')}</span>
        <h2 id="profile-photo-title">{tr('Foto de perfil', 'Profile photo')}</h2>
        <p>{tr('Por ahora puedes usar el enlace directo de una imagen. Después podremos permitir subirla desde el dispositivo.', 'For now, use a direct image URL. Uploading from your device may be added later.')}</p>

        <div className="profile-photo-preview">
          <AvatarImage src={draftUrl.trim()} alt={tr('Vista previa de la foto de perfil', 'Profile photo preview')} />
        </div>

        <label className="profile-photo-field">
          <span>{tr('URL de la imagen', 'Image URL')}</span>
          <div>
            <Link2 size={17} aria-hidden="true" />
            <input
              type="url"
              value={draftUrl}
              onChange={(event) => { setDraftUrl(event.target.value); setError('') }}
              placeholder={tr('https://ejemplo.com/mi-foto.jpg', 'https://example.com/my-photo.jpg')}
              autoFocus
              disabled={saving}
              maxLength={2048}
              required
            />
          </div>
        </label>

        {error && <p className="profile-photo-error" role="alert">{error}</p>}

        <div className="profile-photo-actions">
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? tr('Guardando…', 'Saving…') : tr('Guardar foto', 'Save photo')}
          </button>
          <button className="secondary-button" type="button" onClick={removePhoto} disabled={saving || !profileImageUrl}>
            <Trash2 size={16} />
            {tr('Usar imagen predeterminada', 'Use default image')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )

  return (
    <>
      <Panel className="profile-card">
        <div className="profile-card__avatar-wrap">
          <button className="profile-avatar-button profile-avatar-glow" type="button" onClick={openEditor} aria-label={tr('Cambiar foto de perfil', 'Change profile photo')}>
            <AvatarImage src={profileImageUrl} alt={`${tr('Foto de perfil de', 'Profile photo of')} ${user?.name || tr('Astronauta', 'Astronaut')}`} />
            <span><Camera size={14} /></span>
          </button>
        </div>

        <div className="profile-card__body">
          <h2>{user?.name || 'Maria Torres'}</h2>
          <p className="profile-card__email">{user?.email || 'maria@gmail.com'}</p>
          <div className="profile-card__status">
            <span className="status-dot-green" />
            <span>{tr('Último acceso', 'Last sign-in')}: {sessionStartedAt ? formatWhen(sessionStartedAt, language) : tr('ahora', 'now')}</span>
          </div>
        </div>

        <div className="profile-card__badge-day">
          <Orbit size={18} className="orbit-icon" />
          <span>{tr('Día', 'Day')} {sessionDay}</span>
        </div>
      </Panel>
      {photoModal}
    </>
  )
}
