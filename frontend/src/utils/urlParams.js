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
// Mismo tope por origen que el backend (MAX_PAX_PER_ORIGIN).
export const MAX_LINK_PAX = 9;
// El formulario solo ofrece ±1, ±2 o ±3. El backend acepta hasta 5, pero un
// enlace con otro valor no se puede enseñar en las pastillas: se descarta.
const FLEX_DAYS = new Set([1, 2, 3]);
// Mismo rango y paso que el deslizador del formulario (SearchPage).
const BUDGET_MIN = 30;
const BUDGET_MAX = 800;
const BUDGET_STEP = 10;

function validFlexDays(raw) {
  const n = Number(raw);
  return FLEX_DAYS.has(n) ? n : null;
}

function validBudget(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < BUDGET_MIN || n > BUDGET_MAX || n % BUDGET_STEP !== 0) return null;
  return n;
}

/** Añade ?flex= y ?budget= solo cuando esas opciones están activas y son válidas. */
export function appendFlexBudgetParams(params, { flexEnabled, flexDays, budgetEnabled, maxBudget } = {}) {
  const flex = flexEnabled ? validFlexDays(flexDays) : null;
  if (flex != null) params.set("flex", String(flex));
  const budget = budgetEnabled ? validBudget(maxBudget) : null;
  if (budget != null) params.set("budget", String(budget));
}

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

  // ?p= va alineado con ?o= (mismo orden); se filtran los pares juntos para
  // que un origen inválido no desplace los viajeros de los demás.
  const rawPax = params.getAll("p");
  const pairs = params.getAll("o")
    .map((s, i) => ({ code: String(s).trim().toUpperCase(), pax: rawPax[i] }))
    .filter((x) => IATA_RE.test(x.code))
    .slice(0, MAX_LINK_ORIGINS);
  if (!pairs.length) return null;
  const origins = pairs.map((x) => x.code);

  const out = { origins };
  if (rawPax.length) {
    out.passengers = pairs.map((x) => {
      const n = Math.floor(Number(x.pax));
      return Number.isFinite(n) ? Math.min(MAX_LINK_PAX, Math.max(1, n)) : 1;
    });
  }

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

  const flex = validFlexDays(params.get("flex"));
  if (flex != null) out.flexDays = flex;

  const budget = validBudget(params.get("budget"));
  if (budget != null) out.maxBudget = budget;

  return out;
}
