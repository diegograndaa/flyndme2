// `navigator.onLine === false` es fiable (sin red seguro); `true` no garantiza
// llegar al backend, así que solo se usa para cortar antes de esperar en vano.
export function isOffline(nav = typeof navigator !== "undefined" ? navigator : undefined) {
  return Boolean(nav) && nav.onLine === false;
}
