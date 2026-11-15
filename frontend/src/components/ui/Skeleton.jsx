// Marcador de carga: bloque con brillo animado. `w`/`h` aceptan px o cualquier unidad CSS.
export default function Skeleton({ w = '100%', h = 14, radius, className = '', style }) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width: typeof w === 'number' ? `${w}px` : w, height: typeof h === 'number' ? `${h}px` : h, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  )
}

// Contenedor accesible: avisa a lectores de pantalla que el contenido está cargando.
export function SkeletonGroup({ label = 'Cargando datos…', className = '', children }) {
  return (
    <div className={`skeleton-group ${className}`} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
