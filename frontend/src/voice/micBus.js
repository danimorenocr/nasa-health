// Aviso entre funciones que usan el micrófono del navegador. Astra escucha "Hey Astra"
// de fondo; mientras otra función (dictado del diario, nota de voz) lo necesita, se pausa
// y se reanuda sola al terminar, para que no se pisen.
export const micBusy = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('astra:mic', { detail: { busy: true } }))
}

export const micFree = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('astra:mic', { detail: { busy: false } }))
}
