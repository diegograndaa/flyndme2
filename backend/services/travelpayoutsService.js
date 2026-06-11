// Travelpayouts (Aviasales Data API) — proveedor primario de datos de vuelos.
// Interfaz pública compartida con mockFlightService:
// (getCheapestOffer / priceFlightOffer / budgetStatus / healthCheck).
//
// Naturaleza de los datos: precios CACHEADOS de búsquedas reales de usuarios
// de Aviasales en las últimas 48h (retención hasta 7 días). Sirven para
// COMPARAR destinos — no son ofertas reservables confirmadas. Por eso:
//   - capabilities.verification = false → routes/flights.js marca el ganador
//     como "skipped" y el frontend muestra el badge "precios orientativos".
//   - priceFlightOffer() re-consulta la caché del proveedor (gratis) y trae
//     el precio más reciente, pero NO confirma disponibilidad real.
//   - Solo clase ECONOMY: la caché no distingue cabinas. Una búsqueda con
//     travelClass != ECONOMY devuelve null en vez de un precio engañoso.
//
// Coste: API gratuita (límite 600 req/min). Sin presupuesto mensual.
// El campo `link` de cada ticket es un deep link de Aviasales (programa de
// afiliados ~1,1-1,3% por reserva) — primera vía de monetización real.
//
// Nota: el rate limiter y el retry viven aquí (no en un util compartido)
// porque este es el único proveedor real; extraerlos sería sobreingeniería.

const axios = require("axios");
const https = require("https");
const { TtlCache } = require("../utils/ttlCache");

const httpsAgent = new https.Agent({ keepAlive: true });
const http = axios.create({ httpsAgent, timeout: 15000 });

// ─── Config ───────────────────────────────────────────────────────────────────

const TOKEN    = process.env.TRAVELPAYOUTS_TOKEN;
const BASE_URL = process.env.TRAVELPAYOUTS_BASE_URL || "https://api.travelpayouts.com";

// Marker de afiliado de Travelpayouts (Partner ID, ej. "738121"). Si está
// definido se añade a cada deep link de Aviasales — sin él, las reservas no
// se atribuyen y la comisión (~1,1-1,3%) se pierde. Admite sufijo SubID con
// punto ("738121.app") para segmentar en los informes de Travelpayouts.
const MARKER_AFF = (process.env.TRAVELPAYOUTS_MARKER || "").trim();

// Market de la caché. Vacío (default) → Aviasales lo deduce del origen de
// cada petición, lo natural para búsquedas multi-origen europeas. Fijarlo
// (p.ej. "es") solo si el sondeo de densidad lo justifica:
//   node scripts/probe-travelpayouts.js
const MARKET = (process.env.TRAVELPAYOUTS_MARKET || "").trim();

// Límite documentado: 600 req/min. Margen amplio con estos defaults.
const RATE_MIN_INTERVAL_MS = Number(process.env.TP_RATE_MIN_INTERVAL_MS || 110);
const MAX_CONCURRENCY      = Number(process.env.TP_MAX_CONCURRENCY      || 5);
const MAX_RETRIES          = Number(process.env.TP_MAX_RETRIES          || 3);
const BASE_BACKOFF_MS      = Number(process.env.TP_BASE_BACKOFF_MS      || 500);
// La caché del proveedor se renueva con búsquedas de usuarios (ventana 48h);
// 60 min de caché local es seguro y recorta latencia y peticiones.
const SEARCH_CACHE_TTL_MS  = Number(process.env.TP_SEARCH_CACHE_TTL_MS  || 60 * 60 * 1000);
const MAX_CACHE_SIZE       = 500;
// Fallback de fechas vecinas: la caché de Aviasales solo tiene precio en la
// fecha exacta para ~73% de las rutas (sondeo jun-2026). Si no hay billete en
// la fecha pedida, se busca la fecha con datos más cercana dentro de ±N días
// y se devuelve ETIQUETADA con su fecha real (offer.dateFallback). 0 = off.
const DATE_FLEX_DAYS       = Number(process.env.TP_DATE_FLEX_DAYS ?? 2);

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  return ms + Math.floor(ms * Math.random() * 0.3);
}

function isRetryable(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

const warnedOnce = new Set();
function warnOnce(key, msg) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(msg);
}

// ─── Date helpers (fallback de fechas vecinas) ───────────────────────────────

function dayDiff(isoA, isoB) {
  return Math.round((Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`)) / 86_400_000);
}

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Meses (YYYY-MM) que cubre la ventana [date-flex, date+flex].
function monthsInWindow(isoDate, flexDays) {
  return [...new Set([
    shiftDays(isoDate, -flexDays).slice(0, 7),
    isoDate.slice(0, 7),
    shiftDays(isoDate, flexDays).slice(0, 7),
  ])];
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

let active      = 0;
const queue     = [];
let lastStartAt = 0;

async function drainQueue() {
  if (active >= MAX_CONCURRENCY || queue.length === 0) return;

  const next = queue.shift();
  active += 1;

  const wait = Math.max(0, RATE_MIN_INTERVAL_MS - (Date.now() - lastStartAt));
  if (wait > 0) await sleep(wait);
  lastStartAt = Date.now();

  drainQueue().catch(() => {});

  try {
    const result = await next.taskFn();
    next.resolve(result);
  } catch (err) {
    next.reject(err);
  } finally {
    active -= 1;
    drainQueue().catch(() => {});
  }
}

function runWithLimiter(taskFn) {
  return new Promise((resolve, reject) => {
    queue.push({ taskFn, resolve, reject });
    drainQueue().catch(() => {});
  });
}

async function requestWithRetry(requestFn, label = "Travelpayouts request") {
  let attempt = 0;

  while (true) {
    try {
      return await runWithLimiter(requestFn);
    } catch (err) {
      const status = err?.response?.status;

      if (!isRetryable(status) || attempt >= MAX_RETRIES) {
        console.error(`[Travelpayouts] ${label} falló (${status ?? "?"})`, err?.response?.data ?? err.message);
        throw err;
      }

      const retryAfter = err?.response?.headers?.["retry-after"];
      const backoff = retryAfter
        ? Number(retryAfter) * 1000
        : jitter(BASE_BACKOFF_MS * 2 ** attempt);

      attempt++;
      console.warn(`[Travelpayouts] ${label} → retry ${attempt}/${MAX_RETRIES} (${status}), wait ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

// Transport indirection: los tests unitarios lo sustituyen para simular la
// API sin red. En producción siempre es el axios real.
let transport = (url, config) => http.get(url, config);

// ─── Local search cache ───────────────────────────────────────────────────────

const searchCache = new TtlCache({ ttlMs: SEARCH_CACHE_TTL_MS, maxSize: MAX_CACHE_SIZE });

function makeCacheKey(origin, destination, departureDate, options) {
  const o = options || {};
  return [
    origin, destination, departureDate,
    o.returnDate || "",
    o.nonStop === true ? "direct" : "",
    (o.currencyCode || "EUR").toUpperCase(),
    MARKET,
  ].join("|");
}

// ─── Request building / response mapping ─────────────────────────────────────

function buildParams(origin, destination, departureDate, options = {}) {
  const params = {
    origin,
    destination,
    departure_at: departureDate,
    currency: (options.currencyCode || "EUR").toLowerCase(),
    sorting:  "price",
    // one_way=true agrupa por fecha y devuelve 1 solo billete; para ida y
    // vuelta hay que pedir one_way=false para recibir varias combinaciones.
    one_way:  options.returnDate ? "false" : "true",
    limit:    options.limit || 30,
  };
  if (options.returnDate)      params.return_at = options.returnDate;
  if (options.nonStop === true) params.direct   = "true";
  if (MARKET)                  params.market    = MARKET;
  return params;
}

// La API puede devolver billetes de fechas vecinas cuando se consulta con
// one_way=false; nunca mostrar un precio de una fecha distinta a la pedida.
function matchesDates(ticket, departureDate, returnDate) {
  if (String(ticket?.departure_at || "").slice(0, 10) !== departureDate) return false;
  if (returnDate && String(ticket?.return_at || "").slice(0, 10) !== returnDate) return false;
  return true;
}

function isoDuration(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  const h  = Math.floor(m / 60);
  const mm = m % 60;
  return `PT${h > 0 ? `${h}H` : ""}${mm > 0 ? `${mm}M` : ""}`;
}

function addMinutes(isoAt, minutes) {
  const d = new Date(isoAt);
  if (Number.isNaN(d.getTime()) || !Number.isFinite(Number(minutes))) return null;
  d.setMinutes(d.getMinutes() + Number(minutes));
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Solo emitimos segmentos cuando el vuelo es directo: para vuelos con
// escalas la API no informa de los aeropuertos intermedios y inventarlos
// sería mentir. El frontend degrada con elegancia si segments está vacío.
function buildSegments(fromAirport, toAirport, departAt, airline, flightNumber, durationMin, transfers) {
  if (transfers !== 0) return [];
  return [{
    departure: { iataCode: fromAirport, at: departAt },
    arrival:   { iataCode: toAirport,   at: addMinutes(departAt, durationMin) },
    carrierCode: airline || "",
    number:      flightNumber != null ? String(flightNumber) : "",
    duration:    isoDuration(durationMin),
    numberOfStops: 0,
  }];
}

// Deep link de Aviasales con el marker de afiliado. ticket.link viene
// relativo y normalmente ya trae query string → respetar ? / & existentes.
function buildAffiliateLink(relativeLink) {
  if (!relativeLink) return null;
  let link = `https://www.aviasales.com${relativeLink}`;
  if (MARKER_AFF && !/[?&]marker=/.test(link)) {
    link += `${link.includes("?") ? "&" : "?"}marker=${encodeURIComponent(MARKER_AFF)}`;
  }
  return link;
}

function mapTicketToOffer(ticket, { departureDate, returnDate, nonStop, currencyCode } = {}) {
  const price = Number(ticket.price);
  if (!Number.isFinite(price)) return null;

  const cur      = (ticket.currency || currencyCode || "EUR").toUpperCase();
  const priceStr = price.toFixed(2);
  const isRoundtrip = !!returnDate;

  const originAirport = ticket.origin_airport || ticket.origin;
  const destAirport   = ticket.destination_airport || ticket.destination;
  const durTo   = ticket.duration_to   ?? (isRoundtrip ? null : ticket.duration);
  const durBack = ticket.duration_back ?? null;

  const itineraries = [{
    duration: isoDuration(durTo),
    segments: buildSegments(originAirport, destAirport, ticket.departure_at, ticket.airline, ticket.flight_number, durTo, ticket.transfers ?? 0),
  }];
  if (isRoundtrip) {
    itineraries.push({
      duration: isoDuration(durBack),
      // La aerolínea de vuelta puede diferir; la API no la detalla. Solo
      // sabemos transfers de vuelta y duración.
      segments: buildSegments(destAirport, originAirport, ticket.return_at, ticket.airline, null, durBack, ticket.return_transfers ?? 0),
    });
  }

  return {
    id:     `tp-${ticket.origin}-${ticket.destination}-${departureDate}-${returnDate || "ow"}`,
    source: "AVIASALES_CACHE",
    provider: "travelpayouts",
    oneWay: !isRoundtrip,
    itineraries,
    price: { currency: cur, total: priceStr, grandTotal: priceStr },
    validatingAirlineCodes: ticket.airline ? [ticket.airline] : [],
    transfers:       ticket.transfers ?? null,
    returnTransfers: ticket.return_transfers ?? null,
    // Deep link de Aviasales con marker de afiliado (TRAVELPAYOUTS_MARKER).
    link: buildAffiliateLink(ticket.link),
    // Datos para re-consultar esta misma búsqueda (priceFlightOffer).
    // originAirport/destinationAirport: aeropuertos REALES del billete (con
    // fallback al código de ciudad). La capa 2 (SerpAPI Google Flights) los
    // necesita porque Google no acepta códigos de ciudad multi-aeropuerto
    // (ROM, LON…) como departure_id/arrival_id.
    tp: {
      origin:             ticket.origin,
      destination:        ticket.destination,
      originAirport:      originAirport,
      destinationAirport: destAirport,
      departureDate,
      returnDate:         returnDate || null,
      nonStop:            nonStop === true,
      currencyCode:       cur,
    },
  };
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchTickets(origin, destination, departureDate, options = {}, { bypassCache = false } = {}) {
  if (!origin || !destination || !departureDate) {
    throw new Error("origin, destination y departureDate son obligatorios.");
  }
  if (!TOKEN) {
    throw new Error("Falta TRAVELPAYOUTS_TOKEN en las variables de entorno.");
  }

  const cacheKey = makeCacheKey(origin, destination, departureDate, options);
  if (!bypassCache) {
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;
  }

  const params = buildParams(origin, destination, departureDate, options);
  const response = await requestWithRetry(
    () =>
      transport(`${BASE_URL}/aviasales/v3/prices_for_dates`, {
        params,
        headers: {
          "X-Access-Token":  TOKEN,
          "Accept-Encoding": "gzip, deflate",
        },
      }),
    `${origin}→${destination} (${departureDate})`
  );

  const body = response?.data;
  if (!body || body.success !== true) {
    throw new Error(`Travelpayouts: ${body?.error || "respuesta inválida"}`);
  }

  const tickets = Array.isArray(body.data) ? body.data : [];
  searchCache.set(cacheKey, tickets);
  return tickets;
}

function pickCheapest(tickets, departureDate, returnDate) {
  let cheapest = null;
  for (const t of tickets) {
    const v = Number(t?.price);
    if (!Number.isFinite(v)) continue;
    if (!matchesDates(t, departureDate, returnDate)) continue;
    if (cheapest === null || v < Number(cheapest.price)) cheapest = t;
  }
  return cheapest;
}

// ─── Fallback de fechas vecinas ──────────────────────────────────────────────
// Elige el billete con la fecha más cercana a la pedida dentro de ±flexDays
// (ida y, si aplica, vuelta). Empate de distancia → el más barato. Fechas ya
// pasadas (caché obsoleta) se descartan.

function pickNeighbor(tickets, departureDate, returnDate, flexDays) {
  const today = new Date().toISOString().slice(0, 10);
  let best = null;
  let bestScore = Infinity;

  for (const t of tickets) {
    const v = Number(t?.price);
    if (!Number.isFinite(v)) continue;

    const dep = String(t?.departure_at || "").slice(0, 10);
    if (!dep || dep < today) continue;
    const depDiff = Math.abs(dayDiff(departureDate, dep));
    if (depDiff > flexDays) continue;

    let retDiff = 0;
    if (returnDate) {
      const ret = String(t?.return_at || "").slice(0, 10);
      if (!ret) continue;
      retDiff = Math.abs(dayDiff(returnDate, ret));
      if (retDiff > flexDays) continue;
    }

    const score = depDiff + retDiff;
    if (score < bestScore || (score === bestScore && v < Number(best.price))) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// Consulta el mes a granularidad de día (la API agrupa por fecha) y devuelve
// el billete vecino más cercano, o null. Las consultas de mes pasan por la
// misma caché local que las de fecha exacta (clave = mes), así que el coste
// extra por destino sin datos exactos es ~1 petición por origen.
async function findNeighborTicket(origin, destination, departureDate, options) {
  const depMonths = monthsInWindow(departureDate, DATE_FLEX_DAYS);
  const retMonths = options.returnDate ? monthsInWindow(options.returnDate, DATE_FLEX_DAYS) : [null];

  const tickets = [];
  for (const dm of depMonths) {
    for (const rm of retMonths) {
      const opts = { ...options, limit: 100 };
      if (rm) opts.returnDate = rm;
      try {
        tickets.push(...await fetchTickets(origin, destination, dm, opts));
      } catch {
        // un mes sin datos o con error no impide probar el resto
      }
    }
  }
  return pickNeighbor(tickets, departureDate, options.returnDate, DATE_FLEX_DAYS);
}

// ─── Public API (interfaz compartida con mockFlightService) ──────────────────

async function getAccessToken() {
  if (!TOKEN) throw new Error("Falta TRAVELPAYOUTS_TOKEN en las variables de entorno.");
  return TOKEN;
}

async function searchFlightOffer(origin, destination, departureDate, options = {}) {
  const tickets = await fetchTickets(origin, destination, departureDate, options);
  const offers = tickets
    .filter((t) => matchesDates(t, departureDate, options.returnDate))
    .map((t) => mapTicketToOffer(t, { departureDate, returnDate: options.returnDate, nonStop: options.nonStop, currencyCode: options.currencyCode }))
    .filter(Boolean);
  return { data: offers, meta: { count: offers.length, source: "AVIASALES_CACHE" } };
}

async function getCheapestPrice(origin, destination, departureDate, options = {}) {
  const r = await getCheapestOffer(origin, destination, departureDate, options);
  return r ? r.price : null;
}

async function getCheapestOffer(origin, destination, departureDate, options = {}) {
  if (origin === destination) return null;

  // La caché de Aviasales no distingue cabinas (solo economy). Devolver un
  // precio economy para una búsqueda business sería engañar al usuario.
  if (options.travelClass && options.travelClass !== "ECONOMY") {
    warnOnce("travelClass", "[Travelpayouts] travelClass != ECONOMY no soportado por la caché de Aviasales — sin resultados para esas búsquedas.");
    return null;
  }

  try {
    const tickets  = await fetchTickets(origin, destination, departureDate, options);
    const cheapest = pickCheapest(tickets, departureDate, options.returnDate);
    if (cheapest) {
      const offer = mapTicketToOffer(cheapest, {
        departureDate,
        returnDate:   options.returnDate,
        nonStop:      options.nonStop,
        currencyCode: options.currencyCode,
      });
      if (!offer) return null;

      return { price: Number(cheapest.price), offer };
    }

    // Sin precio en la fecha exacta → fecha vecina más cercana, SIEMPRE
    // etiquetada con su fecha real. Convierte en resultado útil el ~27% de
    // rutas que la caché no cubre en fecha exacta.
    if (DATE_FLEX_DAYS <= 0) return null;
    const neighbor = await findNeighborTicket(origin, destination, departureDate, options);
    if (!neighbor) return null;

    const actualDep = String(neighbor.departure_at).slice(0, 10);
    const actualRet = options.returnDate ? String(neighbor.return_at).slice(0, 10) : undefined;
    const offer = mapTicketToOffer(neighbor, {
      departureDate: actualDep,
      returnDate:    actualRet,
      nonStop:       options.nonStop,
      currencyCode:  options.currencyCode,
    });
    if (!offer) return null;

    offer.dateFallback = {
      requestedDepartureDate: departureDate,
      requestedReturnDate:    options.returnDate || null,
      departureDate:          actualDep,
      returnDate:             actualRet || null,
      offsetDays:             dayDiff(departureDate, actualDep),
    };
    return { price: Number(neighbor.price), offer, dateFallback: offer.dateFallback };
  } catch {
    // Contrato del proveedor: un fallo puntual en una ruta no
    // tumba la búsqueda multi-origen; el destino simplemente se descarta.
    return null;
  }
}

// Re-consulta la caché del proveedor (sin coste, saltando la caché local) y
// devuelve el precio más reciente para la misma búsqueda. OJO: no confirma
// disponibilidad real — por eso capabilities.verification = false y el
// backend no lo usa como "verificación" de cara al usuario.
async function priceFlightOffer(offer) {
  if (!offer || !offer.tp) return null;
  try {
    const { origin, destination, departureDate, returnDate, nonStop, currencyCode } = offer.tp;
    const options = { returnDate: returnDate || undefined, nonStop: nonStop || undefined, currencyCode };
    const tickets  = await fetchTickets(origin, destination, departureDate, options, { bypassCache: true });
    const cheapest = pickCheapest(tickets, departureDate, returnDate);
    if (!cheapest) return null;

    const refreshed = mapTicketToOffer(cheapest, { departureDate, returnDate, nonStop, currencyCode });
    if (!refreshed) return null;
    refreshed.refreshedAt = new Date().toISOString();

    return { price: Number(cheapest.price), offer: refreshed };
  } catch {
    return null;
  }
}

async function healthCheck() {
  const base = {
    env:        MARKET ? `market:${MARKET}` : "market:auto",
    provider:   "travelpayouts",
    cache_size: searchCache.size,
    cache_max:  MAX_CACHE_SIZE,
  };
  if (!TOKEN) {
    return { ...base, status: "unhealthy", credentials_valid: false, error: "Falta TRAVELPAYOUTS_TOKEN." };
  }
  try {
    // Consulta mínima (mes en curso, 1 resultado). No pasa por la caché local.
    const month = new Date().toISOString().slice(0, 7);
    const response = await requestWithRetry(
      () =>
        transport(`${BASE_URL}/aviasales/v3/prices_for_dates`, {
          params:  { origin: "MAD", destination: "BCN", departure_at: month, one_way: "true", limit: 1, currency: "eur" },
          headers: { "X-Access-Token": TOKEN, "Accept-Encoding": "gzip, deflate" },
        }),
      "healthCheck"
    );
    const ok = response?.data?.success === true;
    return { ...base, status: ok ? "healthy" : "unhealthy", credentials_valid: ok };
  } catch (err) {
    return { ...base, status: "unhealthy", credentials_valid: false, error: err.message };
  }
}

// API gratuita sin cupo mensual → presupuesto ilimitado (mismo contrato que
// el mock). El gate de presupuesto de routes/flights.js nunca se dispara.
function budgetStatus() {
  return {
    month:     new Date().toISOString().slice(0, 7),
    used:      0,
    budget:    0,
    remaining: Infinity,
    unlimited: true,
  };
}

const capabilities = {
  verification:  false,            // sin re-tarificación real de ofertas
  travelClasses: ["ECONOMY"],      // la caché no distingue cabinas
  dataSource:    "cache",          // precios cacheados 48h-7d, no tiempo real
};

module.exports = {
  getAccessToken,
  searchFlightOffer,
  getCheapestPrice,
  getCheapestOffer,
  priceFlightOffer,
  healthCheck,
  budgetStatus,
  capabilities,
};

// Internals expuestos SOLO para tests unitarios (no usar desde la app).
module.exports.__test = {
  buildParams,
  buildAffiliateLink,
  matchesDates,
  isoDuration,
  mapTicketToOffer,
  makeCacheKey,
  pickCheapest,
  pickNeighbor,
  dayDiff,
  shiftDays,
  monthsInWindow,
  setTransport(fn) { transport = fn; },
};
