// ─── Vigilar precio ──────────────────────────────────────────────────────────
// Guarda en el navegador la búsqueda del destino ganador y, al volver a abrir
// la app, compara su precio de entonces con el de ahora (POST /price-check, la
// misma matemática que la búsqueda). Sin cuentas ni emails: solo avisa dentro
// de la app. Lógica pura, sin red.

export const WATCH_KEY = "flyndme_watches";
export const CHECKS_KEY = "flyndme_watch_checks";
// Cada búsqueda vigilada se vuelve a consultar como mucho cada 30 min: recargar
// la página no repite la llamada (cuenta para el límite de peticiones por IP).
export const CHECK_EVERY_MS = 30 * 60 * 1000;
export const MAX_WATCHES = 3;
export const WATCH_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

export function watchId({ origins, passengers, departureDate, returnDate, tripType, destination, nonStop }) {
  const legs = (origins || []).map((o, i) => `${String(o).toUpperCase()}x${Math.max(1, Number(passengers?.[i]) || 1)}`).join(",");
  const ret = tripType === "roundtrip" ? returnDate || "" : "";
  return `${String(destination).toUpperCase()}|${legs}|${departureDate}|${ret}${nonStop ? "|direct" : ""}`;
}

/** Crea una vigilancia a partir de la búsqueda y del total que ve el usuario. */
export function makeWatch(params, totalEUR, now = Date.now()) {
  const tripType = params.tripType === "roundtrip" ? "roundtrip" : "oneway";
  const w = {
    origins: (params.origins || []).map((o) => String(o).toUpperCase()),
    passengers: (params.origins || []).map((_, i) => Math.max(1, Number(params.passengers?.[i]) || 1)),
    departureDate: params.departureDate,
    returnDate: tripType === "roundtrip" ? params.returnDate || "" : "",
    tripType,
    destination: String(params.destination).toUpperCase(),
    nonStop: params.nonStop === true,
    savedTotalEUR: Math.round(Number(totalEUR)),
    createdAt: now,
  };
  return { ...w, id: watchId(w) };
}

/**
 * localStorage o null. En algunos navegadores (cookies bloqueadas, modo
 * privado estricto) LEER window.localStorage ya lanza SecurityError.
 */
export function safeStorage(win = typeof window === "undefined" ? undefined : window) {
  try {
    const s = win?.localStorage;
    s?.getItem(WATCH_KEY);
    return s || null;
  } catch {
    return null;
  }
}

/** Última comprobación de cada vigilancia: { [id]: { at, totalEUR|null } }. */
export function readChecks(storage) {
  try {
    const v = JSON.parse(storage?.getItem(CHECKS_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Guarda solo las comprobaciones de vigilancias que siguen activas. */
export function writeChecks(storage, checks, activeIds) {
  const keep = {};
  for (const id of activeIds || []) if (checks?.[id]) keep[id] = checks[id];
  try { storage?.setItem(CHECKS_KEY, JSON.stringify(keep)); } catch { /* sin espacio */ }
  return keep;
}

/** ¿Hay que volver a preguntar el precio? (nunca comprobada o hace más de CHECK_EVERY_MS) */
export function isCheckDue(check, now = Date.now(), everyMs = CHECK_EVERY_MS) {
  const at = Number(check?.at);
  return !Number.isFinite(at) || now - at >= everyMs || at > now;
}

export function readWatches(storage) {
  try {
    const raw = storage?.getItem(WATCH_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((w) => w && w.id && Number.isFinite(w.savedTotalEUR)) : [];
  } catch {
    return [];
  }
}

export function writeWatches(storage, list) {
  try { storage?.setItem(WATCH_KEY, JSON.stringify(list)); } catch { /* sin localStorage */ }
}

/** Añade (o sustituye la misma) y conserva solo las MAX_WATCHES más recientes. */
export function addWatch(list, watch) {
  const rest = (list || []).filter((w) => w.id !== watch.id);
  return [watch, ...rest].slice(0, MAX_WATCHES);
}

export function removeWatch(list, id) {
  return (list || []).filter((w) => w.id !== id);
}

/** Vigilancias que aún tienen sentido: viaje no pasado y creadas hace < 30 días. */
export function activeWatches(list, today, now = Date.now()) {
  return (list || []).filter((w) =>
    w.departureDate >= today && now - (Number(w.createdAt) || 0) < WATCH_TTL_DAYS * DAY_MS);
}

/**
 * ¿Ha bajado de verdad? Solo si el ahorro supera el mayor entre minAbs y
 * minPct del total guardado (mismo criterio que el aviso de fecha más barata).
 */
export function priceDrop(savedTotalEUR, currentTotalEUR, { minAbs = 15, minPct = 0.05 } = {}) {
  const saved = Number(savedTotalEUR), now = Number(currentTotalEUR);
  if (!Number.isFinite(saved) || !Number.isFinite(now) || saved <= 0 || now <= 0) return null;
  const saving = saved - now;
  if (saving < Math.max(minAbs, saved * minPct)) return null;
  return { savingEUR: Math.round(saving), currentTotalEUR: Math.round(now) };
}
