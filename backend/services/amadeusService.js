const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({ keepAlive: true });

const http = axios.create({
  httpsAgent,
  timeout: 15000,
});

// ─── Config ───────────────────────────────────────────────────────────────────

const AMADEUS_API_KEY    = process.env.AMADEUS_API_KEY;
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;
const AMADEUS_ENV        = process.env.AMADEUS_ENV || "test";

const BASE_URL =
  AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

// Increased concurrency & reduced interval → ~5× faster parallel searches
// Amadeus test API allows 10 req/s; 3 concurrent at 100 ms is well within limits.
const RATE_MIN_INTERVAL_MS = Number(process.env.AMADEUS_RATE_MIN_INTERVAL_MS || 100);
const MAX_CONCURRENCY      = Number(process.env.AMADEUS_MAX_CONCURRENCY      || 3);
const MAX_RETRIES          = Number(process.env.AMADEUS_MAX_RETRIES          || 3);
const BASE_BACKOFF_MS      = Number(process.env.AMADEUS_BASE_BACKOFF_MS      || 600);
const SEARCH_CACHE_TTL_MS  = Number(process.env.AMADEUS_SEARCH_CACHE_TTL_MS  || 15 * 60 * 1000);
const MAX_CACHE_SIZE       = 500;

// ─── Token cache ──────────────────────────────────────────────────────────────

let cachedToken    = null;
let tokenExpiresAt = null;

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

// ─── Rate limiter  ────────────────────────────────────────────────────────────
// Allows up to MAX_CONCURRENCY requests to run simultaneously.
// Enforces a minimum interval between consecutive request *starts*.

let active       = 0;
const queue      = [];
let lastStartAt  = 0;

async function drainQueue() {
  if (active >= MAX_CONCURRENCY || queue.length === 0) return;

  const next = queue.shift();
  active += 1;

  // Ensure minimum interval between starts (but don't block other slots)
  const wait = Math.max(0, RATE_MIN_INTERVAL_MS - (Date.now() - lastStartAt));
  if (wait > 0) await sleep(wait);
  lastStartAt = Date.now();

  // Kick off the next waiter without blocking this slot
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

async function requestWithRetry(requestFn, label = "Amadeus request") {
  let attempt = 0;

  while (true) {
    try {
      return await runWithLimiter(requestFn);
    } catch (err) {
      const status = err?.response?.status;

      if (!isRetryable(status) || attempt >= MAX_RETRIES) {
        console.error(`[Amadeus] ${label} falló (${status ?? "?"})`, err?.response?.data ?? err.message);
        throw err;
      }

      const retryAfter = err?.response?.headers?.["retry-after"];
      const backoff = retryAfter
        ? Number(retryAfter) * 1000
        : jitter(BASE_BACKOFF_MS * 2 ** attempt);

      attempt++;
      console.warn(`[Amadeus] ${label} → retry ${attempt}/${MAX_RETRIES} (${status}), wait ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

// ─── Search cache with size guard and cache hit tracking ─────────────────

const searchCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;
let cacheRequests = 0;

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
  cacheRequests++;
  if (!entry) {
    cacheMisses++;
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    cacheMisses++;
    return null;
  }
  cacheHits++;
  return entry.value;
}

function toCache(key, value) {
  searchCache.set(key, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });

  // Guard: prevent memory leak by evicting oldest entries if cache exceeds MAX_CACHE_SIZE
  if (searchCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(searchCache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    for (const [k] of toDelete) {
      searchCache.delete(k);
    }
  }
}

// Periodically evict stale entries and log cache hit rate
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of searchCache.entries()) {
    if (now > v.expiresAt) searchCache.delete(k);
  }

  // Log cache hit rate every 50 requests
  if (cacheRequests >= 50) {
    const hitRate = ((cacheHits / cacheRequests) * 100).toFixed(1);
    console.log(`[Amadeus Cache] Hits: ${cacheHits}/${cacheRequests} (${hitRate}%) | Size: ${searchCache.size}/${MAX_CACHE_SIZE}`);
    cacheHits = 0;
    cacheMisses = 0;
    cacheRequests = 0;
  }
}, SEARCH_CACHE_TTL_MS);

// ─── Token ────────────────────────────────────────────────────────────────────

async function getAccessToken() {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
    throw new Error("Faltan AMADEUS_API_KEY / AMADEUS_API_SECRET en las variables de entorno.");
  }

  const response = await requestWithRetry(
    () =>
      http.post(
        `${BASE_URL}/v1/security/oauth2/token`,
        new URLSearchParams({
          grant_type:    "client_credentials",
          client_id:     AMADEUS_API_KEY,
          client_secret: AMADEUS_API_SECRET,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      ),
    "Token"
  );

  const { access_token, expires_in } = response.data;
  cachedToken    = access_token;
  tokenExpiresAt = Date.now() + (expires_in - 60) * 1000;

  console.log(`[Amadeus] Token renovado (${AMADEUS_ENV}) — válido ~${expires_in}s`);
  return cachedToken;
}

// ─── Flight search ────────────────────────────────────────────────────────────

async function searchFlightOffer(origin, destination, departureDate, options = {}) {
  if (!origin || !destination || !departureDate) {
    throw new Error("origin, destination y departureDate son obligatorios.");
  }

  const params = {
    originLocationCode:      origin,
    destinationLocationCode: destination,
    departureDate,
    adults:       options.adults > 0 ? options.adults : 1,
    currencyCode: options.currencyCode || "EUR",
    max:          options.max > 0     ? options.max    : 5,
  };
  if (options.nonStop !== undefined) params.nonStop     = options.nonStop;
  if (options.returnDate)            params.returnDate  = options.returnDate;

  const cacheKey = makeCacheKey(origin, destination, departureDate, options);
  const cached   = fromCache(cacheKey);
  if (cached) return cached;

  const token = await getAccessToken();

  const response = await requestWithRetry(
    () =>
      http.get(`${BASE_URL}/v2/shopping/flight-offers`, {
        headers: { Authorization: `Bearer ${token}` },
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
      const v = Number.parseFloat(o?.price?.grandTotal);
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
      const v = Number.parseFloat(o?.price?.grandTotal);
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
        id:                     cheapest.id,
        price:                  cheapest.price,
        itineraries:            cheapest.itineraries,
        validatingAirlineCodes: cheapest.validatingAirlineCodes,
        numberOfBookableSeats:  cheapest.numberOfBookableSeats,
        lastTicketingDate:      cheapest.lastTicketingDate,
        travelerPricings:       cheapest.travelerPricings,
      },
    };
  } catch {
    return null;
  }
}

// ─── Health check ─────────────────────────────────────────────────────────

async function healthCheck() {
  try {
    const token = await getAccessToken();
    return {
      status: "healthy",
      credentials_valid: !!token,
      env: AMADEUS_ENV,
      cache_size: searchCache.size,
      cache_max: MAX_CACHE_SIZE,
    };
  } catch (err) {
    return {
      status: "unhealthy",
      credentials_valid: false,
      env: AMADEUS_ENV,
      error: err.message,
      cache_size: searchCache.size,
      cache_max: MAX_CACHE_SIZE,
    };
  }
}

module.exports = { getAccessToken, searchFlightOffer, getCheapestPrice, getCheapestOffer, healthCheck };
