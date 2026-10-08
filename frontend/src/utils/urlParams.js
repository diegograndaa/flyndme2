// ─── Parser/sanitizador de parámetros de búsqueda en URL ─────────────────────
// Extraído de App.jsx (Mejora 15). Valida cada parámetro contra los valores
// que la app realmente acepta: una URL manipulada o con typos ya no inyecta
// estado inválido (p. ej. ?cabin=FOO acababa en un 400 del backend).

const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRIP_TYPES = new Set(["oneway", "roundtrip"]);
const OPTIMIZE = new Set(["total", "fairness"]);
const CABINS = new Set(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]);
const CURRENCIES = new Set(["EUR", "GBP", "USD"]);
// Mismo tope que el backend (MAX_ORIGINS): más ciudades acabarían en un 400.
export const MAX_LINK_ORIGINS = 8;

// AAAA-MM-DD que además existe en el calendario (2026-13-45 o 2026-02-30 no).
function isRealDate(s) {
  if (!s || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Parsea un querystring de "copiar enlace de búsqueda" (?o=MAD&o=LON&dep=...).
 * Devuelve null si no hay orígenes válidos; si no, un objeto con SOLO los
 * campos presentes y válidos (los inválidos se descartan en silencio).
 */
export function parseSearchLinkParams(search) {
  const params = new URLSearchParams(search || "");
  if (params.has("share")) return null; // los share links van por otro flujo

  const origins = params.getAll("o")
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => IATA_RE.test(s))
    .slice(0, MAX_LINK_ORIGINS);
  if (!origins.length) return null;

  const out = { origins };

  const dep = params.get("dep");
  if (isRealDate(dep)) out.departureDate = dep;

  const ret = params.get("ret");
  if (isRealDate(ret) && (!out.departureDate || ret > out.departureDate)) out.returnDate = ret;

  const trip = params.get("trip");
  if (trip && TRIP_TYPES.has(trip)) out.tripType = trip;

  const opt = params.get("opt");
  if (opt && OPTIMIZE.has(opt)) out.optimizeBy = opt;

  if (params.get("direct") === "1") out.directOnly = true;

  const cabin = (params.get("cabin") || "").toUpperCase();
  if (CABINS.has(cabin)) out.cabinClass = cabin;

  const cur = (params.get("cur") || "").toUpperCase();
  if (CURRENCIES.has(cur)) out.currency = cur;

  return out;
}
