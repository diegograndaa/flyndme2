const express = require("express");
const router  = express.Router();
const { getCheapestOffer } = require("../services/amadeusService");

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_DESTINATIONS = [
  "LON", "PAR", "ROM", "AMS", "MIL", "LIS", "BER", "DUB", "VIE",
  "BRU", "PRG", "WAW", "ATH", "CPH", "HEL", "ZRH", "OSL", "BUD", "IST"
];
const MAX_ORIGINS           = 8;
const MAX_COMBINATIONS      = 120;
const CACHE_TTL_MS          = 10 * 60 * 1000;
const MAX_CACHE_SIZE        = 200;

// ─── In-memory response cache with size guard ─────────────────────────────

const responseCache = new Map();

function getCached(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { responseCache.delete(key); return null; }
  return hit.value;
}

function setCached(key, value) {
  responseCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });

  // Guard: prevent memory leak by evicting oldest entries if cache exceeds MAX_CACHE_SIZE
  if (responseCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(responseCache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    for (const [k] of toDelete) {
      responseCache.delete(k);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of responseCache.entries()) {
    if (now > e.expiresAt) responseCache.delete(k);
  }
}, CACHE_TTL_MS);

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidIata(code) {
  return /^[A-Z]{3}$/.test(String(code || "").trim().toUpperCase());
}

function isValidISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  return !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
}

// ─── Date utilities ───────────────────────────────────────────────────────────

function toISODate(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseISODate(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ─── Business logic ───────────────────────────────────────────────────────────

function computeFairness(prices) {
  const total   = prices.reduce((a, b) => a + b, 0);
  const avg     = total / prices.length;
  const spread  = Math.max(...prices) - Math.min(...prices);
  const fairness = avg > 0 ? Math.max(0, Math.min(100, 100 - (spread / avg) * 100)) : 0;
  return { total, avg, spread, fairness };
}

/**
 * Fetch all origins for a single (destination, date) combination in parallel.
 * Returns a result object or null if any origin has no valid offer.
 */
async function fetchDestDate(originList, dest, dep, ret, optionsBase, safeMaxFlight) {
  const options = { ...optionsBase };
  if (ret) options.returnDate = ret;

  // ← KEY CHANGE: all origin calls fire simultaneously
  const settled = await Promise.allSettled(
    originList.map((origin) => getCheapestOffer(origin, dest, dep, options))
  );

  const flights = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status !== "fulfilled" || !r.value || typeof r.value.price !== "number") {
      return null; // any origin without a price → discard destination
    }
    if (safeMaxFlight !== null && r.value.price > safeMaxFlight) {
      return null; // any leg exceeds per-flight budget → discard
    }
    flights.push({ origin: originList[i], price: r.value.price, offer: r.value.offer ?? null });
  }

  if (flights.length !== originList.length) return null;

  const prices = flights.map((f) => f.price);
  const { total, avg, spread, fairness } = computeFairness(prices);

  return {
    destination:              dest,
    bestDate:                 dep,
    bestReturnDate:           ret,
    flights,
    totalCostEUR:             total,
    averageCostPerTraveler:   Number(avg.toFixed(2)),
    priceSpread:              Number(spread.toFixed(2)),
    fairnessScore:            Number(fairness.toFixed(1)),
    verifiedAt:               null,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/multi-origin", async (req, res) => {
  const startTime = Date.now();

  try {
    let {
      origins,
      destinations,
      departureDate,
      returnDate,
      tripType,
      dateMode,
      flexDays,
      nonStop,
      optimizeBy,
      maxBudgetPerTraveler,
      maxBudgetPerFlight,
    } = req.body;

    // Normalise enums
    tripType = tripType === "roundtrip" ? "roundtrip" : "oneway";
    dateMode = dateMode === "flex"      ? "flex"      : "exact";
    flexDays = typeof flexDays === "number" && flexDays >= 0 ? Math.min(flexDays, 5) : 0;

    // ── Validate origins ──────────────────────────────────────────────────────
    if (!Array.isArray(origins) || origins.length === 0) {
      return res.status(400).json({
        code: "MISSING_ORIGINS",
        message: "Indica al menos un aeropuerto de origen.",
      });
    }

    const originList = [...new Set(
      origins.map((o) => String(o || "").trim().toUpperCase()).filter(isValidIata)
    )];

    if (originList.length === 0) {
      return res.status(400).json({
        code: "INVALID_ORIGINS",
        message: "Los orígenes deben ser códigos IATA válidos (ej: MAD, BCN).",
      });
    }
    if (originList.length > MAX_ORIGINS) {
      return res.status(400).json({
        code: "TOO_MANY_ORIGINS",
        message: `Máximo ${MAX_ORIGINS} orígenes permitidos.`,
      });
    }

    // ── Validate dates ────────────────────────────────────────────────────────
    if (!departureDate || !isValidISODate(departureDate)) {
      return res.status(400).json({
        code: "INVALID_DEPARTURE_DATE",
        message: "Fecha de salida inválida. Usa YYYY-MM-DD.",
      });
    }
    if (tripType === "roundtrip" && (!returnDate || !isValidISODate(returnDate))) {
      return res.status(400).json({
        code: "INVALID_RETURN_DATE",
        message: "Fecha de vuelta inválida. Usa YYYY-MM-DD.",
      });
    }

    // ── Budget ────────────────────────────────────────────────────────────────
    const safeMaxAvg = Number.isFinite(Number(maxBudgetPerTraveler)) && Number(maxBudgetPerTraveler) > 0
      ? Number(maxBudgetPerTraveler) : null;
    const safeMaxFlight = Number.isFinite(Number(maxBudgetPerFlight)) && Number(maxBudgetPerFlight) > 0
      ? Number(maxBudgetPerFlight) : null;

    // ── Cache ─────────────────────────────────────────────────────────────────
    const cacheKey = JSON.stringify({
      originList, destinations, departureDate, returnDate,
      tripType, dateMode, flexDays, nonStop, optimizeBy, safeMaxAvg, safeMaxFlight,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      const duration = Date.now() - startTime;
      res.set("X-Response-Time", `${duration}ms`);
      console.log("[cache] HIT");
      return res.json(cached);
    }

    // ── Destination list ──────────────────────────────────────────────────────
    const destinationList =
      Array.isArray(destinations) && destinations.length > 0
        ? destinations.map((d) => String(d || "").trim().toUpperCase()).filter(isValidIata)
        : DEFAULT_DESTINATIONS.filter((d) => !originList.includes(d)); // skip origins that match

    if (destinationList.length === 0) {
      return res.status(400).json({
        code: "NO_VALID_DESTINATIONS",
        message: "Sin destinos válidos para buscar.",
      });
    }

    // ── Date candidates ───────────────────────────────────────────────────────
    const depBase = parseISODate(departureDate);
    let tripLenDays = 0;

    if (tripType === "roundtrip") {
      tripLenDays = diffDays(depBase, parseISODate(returnDate));
      if (tripLenDays <= 0) {
        return res.status(400).json({
          code: "INVALID_RETURN_DATE_ORDER",
          message: "La fecha de vuelta debe ser posterior a la de salida.",
        });
      }
    }

    const dateCandidates = dateMode === "flex" && flexDays > 0
      ? Array.from({ length: 2 * flexDays + 1 }, (_, i) => toISODate(addDays(depBase, i - flexDays)))
      : [departureDate];

    // ── Combination guard ─────────────────────────────────────────────────────
    const combinations = originList.length * destinationList.length * dateCandidates.length;
    if (combinations > MAX_COMBINATIONS) {
      return res.status(400).json({
        code: "TOO_MANY_COMBINATIONS",
        message: `Demasiadas combinaciones (${combinations}). Reduce orígenes, destinos o flexibilidad.`,
      });
    }

    // ── Search: process destinations in parallel chunks (respect rate limits) ──────
    const optionsBase = { nonStop, max: 5 };
    const enriched    = [];

    console.log(`[search] ${originList.length} orígenes × ${destinationList.length} destinos × ${dateCandidates.length} fechas = ${combinations} llamadas`);
    const t0 = Date.now();

    // Process destinations in parallel chunks of 3 to respect rate limits
    const CHUNK_SIZE = 3;
    const validDestinations = destinationList.filter(d => !originList.includes(d));

    for (let chunkIdx = 0; chunkIdx < validDestinations.length && enriched.length < 9; chunkIdx += CHUNK_SIZE) {
      const chunk = validDestinations.slice(chunkIdx, chunkIdx + CHUNK_SIZE);

      // Search all destinations in this chunk in parallel
      const chunkResults = await Promise.allSettled(
        chunk.map(async (dest) => {
          let bestForDest = null;

          for (const dep of dateCandidates) {
            const ret = tripType === "roundtrip"
              ? toISODate(addDays(parseISODate(dep), tripLenDays))
              : null;

            const result = await fetchDestDate(originList, dest, dep, ret, optionsBase, safeMaxFlight);
            if (!result) continue;

            // Apply per-traveler budget filter
            if (safeMaxAvg !== null && result.averageCostPerTraveler > safeMaxAvg) continue;

            // Keep the best date variant for this destination
            if (
              !bestForDest ||
              (optimizeBy === "fairness"
                ? result.fairnessScore > bestForDest.fairnessScore ||
                  (result.fairnessScore === bestForDest.fairnessScore &&
                   result.totalCostEUR < bestForDest.totalCostEUR)
                : result.totalCostEUR < bestForDest.totalCostEUR)
            ) {
              bestForDest = result;
            }
          }

          return bestForDest;
        })
      );

      // Collect results from this chunk
      for (const result of chunkResults) {
        if (result.status === "fulfilled" && result.value && enriched.length < 9) {
          enriched.push(result.value);
        }
      }
    }

    console.log(`[search] completado en ${((Date.now() - t0) / 1000).toFixed(1)}s — ${enriched.length} resultados`);

    if (!enriched.length) {
      const payload = { flights: [], bestDestination: null };
      setCached(cacheKey, payload);
      const duration = Date.now() - startTime;
      res.set("X-Response-Time", `${duration}ms`);
      return res.json(payload);
    }

    // ── Sort ──────────────────────────────────────────────────────────────────
    enriched.sort((a, b) => {
      if (optimizeBy === "fairness") {
        if (b.fairnessScore !== a.fairnessScore) return b.fairnessScore - a.fairnessScore;
      }
      return a.totalCostEUR - b.totalCostEUR;
    });

    const payload = {
      flights:          enriched,
      bestDestination:  enriched[0],
      appliedMaxBudgetPerTraveler: safeMaxAvg,
      appliedMaxBudgetPerFlight:   safeMaxFlight,
    };

    setCached(cacheKey, payload);

    const duration = Date.now() - startTime;
    res.set("X-Response-Time", `${duration}ms`);
    return res.json(payload);

  } catch (err) {
    console.error("[multi-origin error]", err);
    const duration = Date.now() - startTime;
    res.set("X-Response-Time", `${duration}ms`);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Error interno al buscar vuelos.",
    });
  }
});

module.exports = router;
