// El plan gratuito de Render mantiene la primera petición abierta hasta que
// el proceso arranca (unos 30 s). Cortarla a los 5 s y reintentar aborta
// justo ese arranque, y la cuenta se queda en «Un momento…».
export const COLD_START_MS = 45000;

export function fetchSignal(ms = COLD_START_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return {
    signal: ctrl.signal,
    done() { clearTimeout(timer); },
    abort() { clearTimeout(timer); ctrl.abort(); },
  };
}
