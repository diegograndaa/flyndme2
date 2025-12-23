const axios = require("axios");
const https = require("https");

// Reutiliza conexiones (reduce latencia cuando hay muchas llamadas seguidas)
const httpsAgent = new https.Agent({ keepAlive: true });

// Instancia HTTP dedicada para Amadeus (keep-alive + timeout coherente)
const http = axios.create({
  httpsAgent,
  timeout: 15000,
});

// Variables de entorno
const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY;
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;
// test | production
const AMADEUS_ENV = process.env.AMADEUS_ENV || "test";

const BASE_URL =
  AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

/**
 * Ajustes anti-429 (se pueden tunear por ENV)
 */
const RATE_MIN_INTERVAL_MS = Number(
  process.env.AMADEUS_RATE_MIN_INTERVAL_MS || 350
); // 250-800 recomendado
const MAX_CONCURRENCY = Number(process.env.AMADEUS_MAX_CONCURRENCY || 1); // 1-2 máximo
const MAX_RETRIES = Number(process.env.AMADEUS_MAX_RETRIES || 4);
const BASE_BACKOFF_MS = Number(process.env.AMADEUS_BASE_BACKOFF_MS || 500);

/**
 * Cache TTL para búsquedas (reduce llamadas repetidas)
 */
const SEARCH_CACHE_TTL_MS = Number(
  process.env.AMADEUS_SEARCH_CACHE_TTL_MS || 15 * 60 * 1000
);

let cachedToken = null;
let tokenExpiresAt = null;

/** util */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function jitter(ms) {
  const extra = Math.floor(ms * (Math.random() * 0.25)); // 0% a 25%
  return ms + extra;
}
function isRetryableStatus(status) {
  if (!status) return false;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

/**
 * Limitador simple: cola + concurrencia + intervalo mínimo
 */
let active = 0;
const queue = [];
let lastRequestAt = 0;

async function runWithLimiter(taskFn) {
  return new Promise((resolve, reject) => {
    queue.push({ taskFn, resolve, reject });
    drainQueue().catch(() => {});
  });
}

async function drainQueue() {
  if (active >= MAX_CONCURRENCY) return;
  const next = queue.shift();
  if (!next) return;

  active += 1;

  try {
    const now = Date.now();
    const wait = Math.max(0, RATE_MIN_INTERVAL_MS - (now - lastRequestAt));
    if (wait > 0) await sleep(wait);

    lastRequestAt = Date.now();
    const result = await next.taskFn();
    next.resolve(result);
  } catch (err) {
    next.reject(err);
  } finally {
    active -= 1;
    if (queue.length) drainQueue().catch(() => {});
  }
}

/**
 * Wrapper con reintentos y backoff (429 / 5xx)
 */
async function requestWithRetry(requestFn, contextLabel = "Amadeus request") {
  let attempt = 0;

  while (true) {
    try {
      return await runWithLimiter(requestFn);
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      if (!isRetryableStatus(status) || attempt >= MAX_RETRIES) {
        console.error(
          `💥 ${contextLabel} falló (status ${status || "?"})`,
          data || err.message
        );
        throw err;
      }

      const retryAfterHeader = err?.response?.headers?.["retry-after"];
      let backoffMs;

      if (retryAfterHeader) {
        const sec = Number(retryAfterHeader);
        backoffMs = Number.isFinite(sec)
          ? sec * 1000
          : jitter(BASE_BACKOFF_MS * 2 ** attempt);
      } else {
        backoffMs = jitter(BASE_BACKOFF_MS * 2 ** attempt);
      }

      attempt += 1;
      console.warn(
        `⚠️ ${contextLabel} -> retry ${attempt}/${MAX_RETRIES} (status ${status}), esperando ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }
}

/**
 * Cache en memoria para búsquedas
 */
const searchCache = new Map();

function makeSearchCacheKey(origin, destination, departureDate, options) {
  const o = options || {};
  return [
    origin,
    destination,
    departureDate,
    o.returnDate || "",
    o.adults || 1,
    o.currencyCode || "EUR",
    o.nonStop === undefined ? "" : String(o.nonStop),
    o.max || 5,
  ].join("|");
}

function getFromCache(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.value;
}

function setToCache(key, value) {
  searchCache.set(key, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
}

/**
 * Obtiene y cachea el token de acceso de Amadeus.
 */
async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && tokenExpiresAt && now < tokenExpiresAt) {
    return cachedToken;
  }

  if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
    const msg =
      "❌ Faltan AMADEUS_API_KEY o AMADEUS_API_SECRET en las variables de entorno";
    console.error(msg);
    throw new Error(msg);
  }

  try {
    const response = await requestWithRetry(
      () =>
        http.post(
          `${BASE_URL}/v1/security/oauth2/token`,
          new URLSearchParams({
            grant_type: "client_credentials",
            client_id: AMADEUS_API_KEY,
            client_secret: AMADEUS_API_SECRET,
          }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        ),
      "Token Amadeus"
    );

    const { access_token, expires_in } = response.data;

    cachedToken = access_token;
    tokenExpiresAt = now + (expires_in - 60) * 1000;

    console.log(
      `✅ [Amadeus] Token actualizado (${AMADEUS_ENV}) – válido ~${expires_in}s`
    );

    return cachedToken;
  } catch (err) {
    console.error(
      "💥 Error obteniendo token de Amadeus:",
      err.response?.data || err.message
    );
    throw new Error("No se pudo obtener el token de Amadeus");
  }
}

/**
 * Busca ofertas de vuelo para un origen-destino-fecha.
 */
async function searchFlightOffer(origin, destination, departureDate, options = {}) {
  if (!origin || !destination || !departureDate) {
    throw new Error(
      "origin, destination y departureDate son obligatorios en searchFlightOffer"
    );
  }

  const params = {
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate,
    adults:
      typeof options.adults === "number" && options.adults > 0
        ? options.adults
        : 1,
    currencyCode: options.currencyCode || "EUR",
    max: typeof options.max === "number" && options.max > 0 ? options.max : 5,
  };

  if (options.nonStop !== undefined) params.nonStop = options.nonStop;
  if (options.returnDate) params.returnDate = options.returnDate;

  Object.keys(params).forEach((key) => {
    if (params[key] === undefined || params[key] === null) delete params[key];
  });

  const cacheKey = makeSearchCacheKey(origin, destination, departureDate, options);
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const token = await getAccessToken();

  try {
    const response = await requestWithRetry(
      () =>
        http.get(`${BASE_URL}/v2/shopping/flight-offers`, {
          headers: { Authorization: `Bearer ${token}` },
          params,
        }),
      `Buscar vuelos ${origin}->${destination} (${departureDate})`
    );

    setToCache(cacheKey, response.data);
    return response.data;
  } catch (err) {
    console.error(
      `💥 Error buscando vuelos ${origin} -> ${destination} (${departureDate}):`,
      err.response?.data || err.message
    );
    throw new Error("Error al buscar vuelos en Amadeus");
  }
}

/**
 * Devuelve el precio mínimo (en EUR) para un origen-destino-fecha.
 * Si no hay vuelos o hay error, devuelve null.
 */
async function getCheapestPrice(origin, destination, departureDate, options = {}) {
  if (origin === destination) {
    console.log(
      `⏭️ Saltando búsqueda porque origen y destino son iguales (${origin})`
    );
    return null;
  }

  try {
    const data = await searchFlightOffer(origin, destination, departureDate, options);

    const offers = data?.data || [];
    if (!offers.length) return null;

    let cheapestValue = null;
    for (const offer of offers) {
      const value = Number.parseFloat(offer?.price?.grandTotal);
      if (Number.isFinite(value)) {
        if (cheapestValue === null || value < cheapestValue) cheapestValue = value;
      }
    }

    return cheapestValue;
  } catch (err) {
    return null;
  }
}

/**
 * Devuelve la oferta más barata + precio (fiable según Amadeus).
 * Si no hay vuelos o hay error, devuelve null.
 */
async function getCheapestOffer(origin, destination, departureDate, options = {}) {
  if (origin === destination) return null;

  try {
    const data = await searchFlightOffer(origin, destination, departureDate, {
      ...options,
      max: typeof options.max === "number" && options.max > 0 ? options.max : 10,
    });

    const offers = data?.data || [];
    if (!offers.length) return null;

    let cheapest = null;
    let cheapestValue = null;

    for (const offer of offers) {
      const value = Number.parseFloat(offer?.price?.grandTotal);
      if (!Number.isFinite(value)) continue;

      if (cheapestValue === null || value < cheapestValue) {
        cheapestValue = value;
        cheapest = offer;
      }
    }

    if (cheapestValue === null || !cheapest) return null;

    // Resumen útil para “trazar” qué oferta fue la usada (fiabilidad)
    return {
      price: cheapestValue,
      offer: {
        id: cheapest?.id,
        price: cheapest?.price,
        itineraries: cheapest?.itineraries,
        validatingAirlineCodes: cheapest?.validatingAirlineCodes,
        numberOfBookableSeats: cheapest?.numberOfBookableSeats,
        lastTicketingDate: cheapest?.lastTicketingDate,
        travelerPricings: cheapest?.travelerPricings,
      },
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  getAccessToken,
  searchFlightOffer,
  getCheapestPrice,
  getCheapestOffer,
};
