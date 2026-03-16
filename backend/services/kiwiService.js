const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({ keepAlive: true });

const http = axios.create({
  httpsAgent,
  timeout: 20000,
});

// ─── Config ───────────────────────────────────────────────────────────────────

const KIWI_API_KEY = process.env.KIWI_API_KEY;
const BASE_URL = "https://tequila-api.kiwi.com";

// Rate-limiting config (Kiwi is more generous than Amadeus test)
const RATE_MIN_INTERVAL_MS = Number(process.env.KIWI_RATE_MIN_INTERVAL_MS || 80);
const MAX_CONCURRENCY      = Number(process.env.KIWI_MAX_CONCURRENCY      || 5);
const MAX_RETRIES          = Number(process.env.KIWI_MAX_RETRIES          || 3);
const BASE_BACKOFF_MS      = Number(process.env.KIWI_BASE_BACKOFF_MS      || 500);
const SEARCH_CACHE_TTL_MS  = Number(process.env.KIWI_SEARCH_CACHE_TTL_MS  || 15 * 60 * 1000);

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

/**
 * Convert ISO date "YYYY-MM-DD" to Kiwi format "DD/MM/YYYY"
 */
function toKiwiDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
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

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function requestWithRetry(requestFn, label = "Kiwi request") {
  let attempt = 0;

  while (true) {
    try {
      return await runWithLimiter(requestFn);
    } catch (err) {
      const status = err?.response?.status;

      if (!isRetryable(status) || attempt >= MAX_RETRIES) {
        console.error(`[Kiwi] ${label} failed (${status ?? "?"})`, err?.response?.data ?? err.message);
        throw err;
      }

      const retryAfter = err?.response?.headers?.["retry-after"];
      const backoff = retryAfter
        ? Number(retryAfter) * 1000
        : jitter(BASE_BACKOFF_MS * 2 ** attempt);

      attempt++;
      console.warn(`[Kiwi] ${label} → retry ${attempt}/${MAX_RETRIES} (${status}), wait ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

// ─── Search cache ─────────────────────────────────────────────────────────────

const searchCache = new Map();

function makeCacheKey(origin, destination, departureDate, options) {
  const o = options || {};
  return [
    origin, destination, departureDate,
    o.returnDate || "",
    o.adults     || 1,
    o.nonStop !== undefined ? String(o.nonStop) : "",
    o.max        || 5,
  ].join("|");
}

function fromCache(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { searchCache.delete(key); return null; }
  return entry.value;
}

function toCache(key, value) {
  searchCache.set(key, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of searchCache.entries()) {
    if (now > v.expiresAt) searchCache.delete(k);
  }
}, SEARCH_CACHE_TTL_MS);

// ─── Flight search ────────────────────────────────────────────────────────────

async function searchFlightOffer(origin, destination, departureDate, options = {}) {
  if (!origin || !destination || !departureDate) {
    throw new Error("origin, destination y departureDate son obligatorios.");
  }

  if (!KIWI_API_KEY) {
    throw new Error("Falta KIWI_API_KEY en las variables de entorno.");
  }

  const cacheKey = makeCacheKey(origin, destination, departureDate, options);
  const cached   = fromCache(cacheKey);
  if (cached) return cached;

  const params = {
    fly_from:   origin,
    fly_to:     destination,
    date_from:  toKiwiDate(departureDate),
    date_to:    toKiwiDate(departureDate), // exact date (same from/to)
    adults:     options.adults > 0 ? options.adults : 1,
    curr:       options.currencyCode || "EUR",
    limit:      options.max > 0 ? options.max : 5,
    sort:       "price",
    locale:     "en",
    vehicle_type: "aircraft",
  };

  // One-way or round trip
  if (options.returnDate) {
    params.flight_type  = "round";
    params.return_from  = toKiwiDate(options.returnDate);
    params.return_to    = toKiwiDate(options.returnDate);
    // Use nights_in_dst_from / nights_in_dst_to as alternative
  } else {
    params.flight_type = "oneway";
  }

  // Non-stop filter
  if (options.nonStop) {
    params.max_stopovers = 0;
  }

  const response = await requestWithRetry(
    () =>
      http.get(`${BASE_URL}/v2/search`, {
        headers: { apikey: KIWI_API_KEY },
        params,
      }),
    `${origin}→${destination} (${departureDate})`
  );

  toCache(cacheKey, response.data);
  return response.data;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

async function getCheapestPrice(origin, destination, departureDate, options = {}) {
  if (origin === destination) return null;
  try {
    const data   = await searchFlightOffer(origin, destination, departureDate, options);
    const offers = data?.data ?? [];
    let cheapest = null;
    for (const o of offers) {
      const v = Number(o?.price);
      if (Number.isFinite(v) && (cheapest === null || v < cheapest)) cheapest = v;
    }
    return cheapest;
  } catch {
    return null;
  }
}

async function getCheapestOffer(origin, destination, departureDate, options = {}) {
  if (origin === destination) return null;
  try {
    const data   = await searchFlightOffer(origin, destination, departureDate, {
      ...options,
      max: options.max > 0 ? options.max : 10,
    });
    const offers = data?.data ?? [];
    let cheapest      = null;
    let cheapestValue = null;

    for (const o of offers) {
      const v = Number(o?.price);
      if (!Number.isFinite(v)) continue;
      if (cheapestValue === null || v < cheapestValue) {
        cheapestValue = v;
        cheapest      = o;
      }
    }

    if (cheapestValue === null || !cheapest) return null;

    return {
      price: cheapestValue,
      offer: {
        id:            cheapest.id,
        price:         cheapestValue,
        airlines:      cheapest.airlines || [],
        route:         cheapest.route || [],
        flyFrom:       cheapest.flyFrom,
        flyTo:         cheapest.flyTo,
        cityFrom:      cheapest.cityFrom,
        cityTo:        cheapest.cityTo,
        cityCodeFrom:  cheapest.cityCodeFrom,
        cityCodeTo:    cheapest.cityCodeTo,
        countryFrom:   cheapest.countryFrom,
        countryTo:     cheapest.countryTo,
        duration:      cheapest.duration,
        deep_link:     cheapest.deep_link,
        booking_token: cheapest.booking_token,
        bags_price:    cheapest.bags_price,
        local_departure: cheapest.local_departure,
        local_arrival:   cheapest.local_arrival,
        utc_departure:   cheapest.utc_departure,
        utc_arrival:     cheapest.utc_arrival,
      },
    };
  } catch {
    return null;
  }
}

module.exports = { searchFlightOffer, getCheapestPrice, getCheapestOffer };
