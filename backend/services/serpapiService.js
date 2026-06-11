// SerpAPI (Google Flights) — verificación de precios de la "capa 2".
//
// NO es un proveedor de vuelos (no implementa getCheapestOffer): es el
// verificador que contrasta el precio del DESTINO GANADOR contra Google
// Flights después de la búsqueda. El proveedor primario (travelpayouts)
// sirve precios de caché no confirmables; esta capa aporta el badge
// "verificado"/"cambiado" sin tocar el flujo de /multi-origin.
//
// Coste: plan gratuito de SerpAPI ≈ 250 búsquedas/mes. Por eso:
//   - Quota guard doble: contador mensual en memoria + consulta a /account
//     (gratuita, no consume cupo, cacheada 10 min) que sobrevive a los
//     reinicios de Render, donde el contador local se pierde.
//   - Margen de seguridad: no se verifica si quedan < SERPAPI_MIN_REMAINING
//     búsquedas (una verificación puede quemar hasta 8, una por tramo).
//   - Caché de resultados 60 min: repetir una verificación no quema cupo.
//   - Sin retries agresivos: 1 único retry y solo en 5xx (reintentar en
//     429/límite de cupo solo quemaría más).
//
// Honestidad de datos: respuesta sin vuelos → null (el tramo queda sin
// verificar), nunca un precio inventado. Sin SERPAPI_KEY el servicio queda
// deshabilitado y nada cambia respecto al comportamiento actual.

const axios = require("axios");
const https = require("https");
const { TtlCache } = require("../utils/ttlCache");

const httpsAgent = new https.Agent({ keepAlive: true });

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL       = process.env.SERPAPI_BASE_URL || "https://serpapi.com";
const MONTHLY_BUDGET = Number(process.env.SERPAPI_MONTHLY_BUDGET || 250);
const TIMEOUT_MS     = Number(process.env.SERPAPI_TIMEOUT_MS || 15000);
const CACHE_TTL_MS   = Number(process.env.SERPAPI_CACHE_TTL_MS || 60 * 60 * 1000);
const ACCOUNT_TTL_MS = Number(process.env.SERPAPI_ACCOUNT_TTL_MS || 10 * 60 * 1000);
const MIN_REMAINING  = Number(process.env.SERPAPI_MIN_REMAINING || 10);
const MAX_CACHE_SIZE = 200;

const http = axios.create({ httpsAgent, timeout: TIMEOUT_MS });

// Transport indirection: los tests unitarios lo sustituyen para simular la
// API sin red (mismo patrón que travelpayoutsService).
let transport = (url, config) => http.get(url, config);

// La clave se lee en cada llamada (no se captura en el require) para que los
// tests puedan activar/desactivar el servicio sin re-require del módulo.
function apiKey() {
  return String(process.env.SERPAPI_KEY || "").trim();
}

function isEnabled() {
  return apiKey().length > 0;
}

// ─── Contador mensual local ───────────────────────────────────────────────────
// Solo se incrementa en llamadas REALES a /search.json (los hits de caché no
// cuentan). También cuenta las llamadas fallidas: mejor sobrecontar que
// pasarse del plan gratuito.

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const usage = { month: currentMonth(), used: 0 };

function rollMonth() {
  const m = currentMonth();
  if (usage.month !== m) {
    usage.month = m;
    usage.used = 0;
  }
}

function budgetStatus() {
  rollMonth();
  return {
    month:     usage.month,
    used:      usage.used,
    budget:    MONTHLY_BUDGET,
    remaining: Math.max(0, MONTHLY_BUDGET - usage.used),
  };
}

// ─── Quota guard remoto (/account) ───────────────────────────────────────────
// GET /account es gratuito y devuelve las búsquedas restantes reales de la
// cuenta — la fuente de verdad que sobrevive a los reinicios de Render. Se
// cachea ACCOUNT_TTL_MS y se deduplica en vuelo (una verificación dispara
// hasta 8 tramos en paralelo y todos consultan el cupo a la vez). Si falla,
// fallback al contador local.

let accountCache    = { at: 0, remaining: null }; // remaining null = desconocido
let accountInFlight = null;

async function fetchAccountRemaining() {
  try {
    const res = await transport(`${BASE_URL}/account`, { params: { api_key: apiKey() } });
    const d = res?.data;
    const left = Number(d?.plan_searches_left ?? d?.total_searches_left);
    return Number.isFinite(left) ? left : null;
  } catch (err) {
    console.warn(`[serpapi] /account no disponible — usando contador local (${err.message})`);
    return null;
  }
}

async function accountRemaining() {
  if (Date.now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.remaining;
  if (!accountInFlight) {
    accountInFlight = fetchAccountRemaining().then((remaining) => {
      accountCache = { at: Date.now(), remaining };
      accountInFlight = null;
      return remaining;
    });
  }
  return accountInFlight;
}

// Presupuesto efectivo: el mínimo entre el contador local y el remoto (si
// respondió). Remoto desconocido → solo el local.
async function remainingBudget() {
  const local  = budgetStatus().remaining;
  const remote = await accountRemaining();
  return remote === null ? local : Math.min(local, remote);
}

async function hasBudget() {
  if (!isEnabled()) return false;
  return (await remainingBudget()) >= MIN_REMAINING;
}

// ─── Caché de verificaciones ──────────────────────────────────────────────────
// Se cachean tanto los precios como los "sin vuelos" (result: null): que
// Google no tenga vuelos para una consulta no va a cambiar en 60 min y
// repetirla solo quemaría cupo. Los FALLOS de red/HTTP no se cachean.

const verifyCache = new TtlCache({ ttlMs: CACHE_TTL_MS, maxSize: MAX_CACHE_SIZE });

function makeVerifyKey({ origin, destination, departureDate, returnDate, nonStop }) {
  return [
    origin,
    destination,
    departureDate,
    returnDate || "",
    nonStop === true ? "direct" : "",
  ].join("|");
}

// ─── Request building / response mapping ─────────────────────────────────────

function buildSearchParams({ origin, destination, departureDate, returnDate, nonStop }) {
  const params = {
    engine:        "google_flights",
    departure_id:  origin,
    arrival_id:    destination,
    outbound_date: departureDate,
    type:          returnDate ? "1" : "2", // 1 = roundtrip, 2 = oneway
    currency:      "EUR",
    api_key:       apiKey(),
  };
  if (returnDate)       params.return_date = returnDate;
  if (nonStop === true) params.stops = "1"; // 1 = solo vuelos directos
  return params;
}

// Precio verificado = mínimo de best_flights[].price y other_flights[].price.
// Sin vuelos en la respuesta → null.
function minFlightPrice(body) {
  const all = [
    ...(Array.isArray(body?.best_flights)  ? body.best_flights  : []),
    ...(Array.isArray(body?.other_flights) ? body.other_flights : []),
  ];
  let min = null;
  for (const f of all) {
    const p = Number(f?.price);
    if (!Number.isFinite(p) || p <= 0) continue;
    if (min === null || p < min) min = p;
  }
  return min;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

// Una petición real a /search.json: incrementa el contador SIEMPRE, también
// si la llamada acaba fallando (puede haber consumido cupo igualmente).
async function searchOnce(params) {
  rollMonth();
  usage.used += 1;
  const res = await transport(`${BASE_URL}/search.json`, { params });
  return res?.data;
}

// Máximo 1 retry y solo en 5xx. Devuelve undefined en fallo (≠ null, que
// significa "la API respondió pero sin vuelos").
async function searchWithRetry(params, label) {
  try {
    return await searchOnce(params);
  } catch (err) {
    const status = err?.response?.status;
    if (status >= 500 && status <= 599) {
      try {
        return await searchOnce(params);
      } catch (err2) {
        console.warn(`[serpapi] ${label} falló tras retry (${err2?.response?.status ?? "?"}): ${err2.message}`);
        return undefined;
      }
    }
    console.warn(`[serpapi] ${label} falló (${status ?? "?"}): ${err.message}`);
    return undefined;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verifica el precio de un tramo contra Google Flights.
 * @returns {{ price: number, currency: string } | null} null si el servicio
 *   está deshabilitado, no queda cupo, la llamada falla o Google no tiene
 *   vuelos para la consulta — el tramo queda sin verificar, nunca se inventa.
 */
async function verifyLeg({ origin, destination, departureDate, returnDate, nonStop } = {}) {
  if (!isEnabled()) return null;
  if (!origin || !destination || !departureDate) return null;

  const key = makeVerifyKey({ origin, destination, departureDate, returnDate, nonStop });
  const cached = verifyCache.get(key);
  if (cached) return cached.result;

  if (!(await hasBudget())) {
    console.warn(`[serpapi] ${origin}→${destination} sin verificar — cupo SerpAPI casi agotado`);
    return null;
  }

  const params = buildSearchParams({ origin, destination, departureDate, returnDate, nonStop });
  const body = await searchWithRetry(params, `${origin}→${destination} (${departureDate})`);

  // Fallo de red/HTTP → null SIN cachear (un reintento posterior puede ir bien).
  if (body === undefined) return null;

  // La API respondió: se cachea el resultado, incluido el "sin vuelos".
  const price = minFlightPrice(body);
  const result = price === null ? null : { price, currency: "EUR" };
  verifyCache.set(key, { result });
  return result;
}

module.exports = {
  isEnabled,
  verifyLeg,
  hasBudget,
  budgetStatus,
};

// Internals expuestos SOLO para tests unitarios (no usar desde la app).
module.exports.__test = {
  buildSearchParams,
  makeVerifyKey,
  minFlightPrice,
  setTransport(fn) { transport = fn; },
  reset() {
    verifyCache.map.clear();
    accountCache    = { at: 0, remaining: null };
    accountInFlight = null;
    usage.month = currentMonth();
    usage.used  = 0;
  },
};
