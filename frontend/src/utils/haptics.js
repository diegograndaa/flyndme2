// Háptica sutil de conmutador de cabina: un toque de 10 ms en móviles que lo
// soportan (Android). Donde no existe (iOS Safari, escritorio) no hace nada.
export function tapHaptic(ms = 10) {
  try {
    if (typeof navigator !== "undefined") navigator.vibrate?.(ms);
  } catch { /* sin háptica */ }
}
