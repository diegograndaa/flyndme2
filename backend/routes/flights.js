const express = require("express");
const router  = express.Router();

// Proveedor de datos de vuelos. Primario: travelpayouts (Aviasales Data API,
// caché 48h gratuita + deep links de afiliado). USE_MOCK=true fuerza el mock
// determinista e ignora FLIGHT_PROVIDER (desarrollo sin red y suite de tests).
const USE_MOCK = String(process.env.USE_MOCK || "").toLowerCase() === "true";
const FLIGHT_PROVIDER = USE_MOCK
  ? "mock"
  : String(process.env.FLIGHT_PROVIDER || "travelpayouts").trim().toLowerCase();

const PROVIDER_MODULES = {
  mock:          "../services/mockFlightService",
  travelpayouts: "../services/travelpayoutsService",
};
if (!PROVIDER_MODULES[FLIGHT_PROVIDER]) {
  // index.js validateConfig() ya avisa (y aborta en prod); aquí degradamos.
  console.warn(`[flights] FLIGHT_PROVIDER="${FLIGHT_PROVIDER}" desconocido — usando travelpayouts.`);
}
const flightService = require(PROVIDER_MODULES[FLIGHT_PROVIDER] || PROVIDER_MODULES.travelpayouts);
const { getCheapestOffer, priceFlightOffer, budgetStatus } = flightService;

// Los proveedores basados en caché (travelpayouts) no pueden re-tarificar una
// oferta concreta: la verificación del ganador se omite ("skipped") y el
// frontend muestra el badge de "precios orientativos".
const CAN_VERIFY = flightService.capabilities?.verification !== false;

// Capa 2: verificación del destino ganador contra Google Flights vía SerpAPI
// (endpoint dedicado POST /verify, ver abajo). Sin SERPAPI_KEY queda
// deshabilitada y el endpoint responde "skipped" — nada cambia para el front.
const serpapi = require("../services/serpapiService");

// ─── Config ───────────────────────────────────────────────────────────────────

// Default destination set, structured as explicit tiers. The search loop
// processes tier-by-tier and stops as soon as enriched.length >= TARGET_RESULTS,
// so Tier 2/3 are only touched when Tier 1/2 don't yield enough results.
// Trimmed from 35 → 24 destinations: keeps every major hub and the most
// popular leisure spots, drops the long tail (Sofia, Tirana, Marrakech, etc.).
const DEFAULT_DESTINATION_TIERS = [
  // Tier 1: major European hubs — highest route coverage, hit first.
  ["LON", "PAR", "ROM", "AMS", "MIL", "LIS", "BER", "MAD", "BCN"],
  // Tier 2: secondary capitals — used when Tier 1 yields < TARGET_RESULTS.
  ["DUB", "VIE", "PRG", "ATH", "BUD", "OPO", "CPH", "IST"],
  // Tier 3: leisure & Mediterranean — fallback only.
  ["AGP", "PMI", "NCE", "DBV", "MLA", "NAP", "ZRH"],
];

const MAX_ORIGINS           = 8;
const MAX_PAX_PER_ORIGIN    = 9;
const TOTAL_PAX_CAP         = 16;
const MAX_COMBINATIONS      = 1200; // sanity cap; tier early-break does the real saving in practice
// 6 destinations is enough for the user to decide and saves ~33% of quota vs 9.
const TARGET_RESULTS        = Number(process.env.SEARCH_TARGET_RESULTS || 6);
// Don't spend quota on verification when the remaining budget is this low.
const VERIFY_MIN_BUDGET     = 10;
const CACHE_TTL_MS          = 10 * 60 * 1000;
const MAX_CACHE_SIZE        = 200;
const VERIFY_TIMEOUT_MS         = 8000;
const VERIFY_PRICE_DELTA_PCT    = 5; // ≥5% diff → "changed"
// Presupuesto de tiempo de la búsqueda completa. El proxy de Render corta en
// ~30s: mejor devolver lo encontrado hasta ahora (partial: true) que un 502
// tras quemar quota. 0 = sin límite.
const SEARCH_TIME_BUDGET_MS     = Number(process.env.SEARCH_TIME_BUDGET_MS || 25000);
// Timeout global del endpoint POST /verify (capa 2, SerpAPI). Generoso a
// propósito: es un endpoint dedicado con casi toda la ventana de ~30s del
// proxy de Render para él solo, y una búsqueda de Google Flights puede tardar
// 10-20s. No confundir con VERIFY_TIMEOUT_MS (verificación inline del proveedor).
const SERPAPI_VERIFY_TIMEOUT_MS = Number(process.env.SERPAPI_VERIFY_TIMEOUT_MS || 20000);
const VERIFY_MAX_LEGS           = MAX_ORIGINS; // mismo tope que la búsqueda

// ─── In-memory response cache with size guard ─────────────────────────────

const { TtlCache } = require("../utils/ttlCache");
const responseCache = new TtlCache({ ttlMs: CACHE_TTL_MS, maxSize: MAX_CACHE_SIZE });
const getCached = (key) => responseCache.get(key);
const setCached = (key, value) => responseCache.set(key, value);

// Caché de respuestas de POST /verify por payload normalizado: repetir la
// misma verificación (p.ej. recargar resultados) no quema cupo de SerpAPI.
const verifyResponseCache = new TtlCache({ ttlMs: 30 * 60 * 1000, maxSize: 100 });

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

// Pax-aware aggregates. Fairness/spread are computed on per-person prices
// (what each traveler pays out of pocket), NOT scaled by pax — otherwise an
// origin sending 2 people would unfairly drag the fairness score down even
// when everyone pays the same per-person fare.
function computeAggregates(flightsWithPax) {
  const perPerson = flightsWithPax.map((f) => f.price);
  const { spread, fairness } = computeFairness(perPerson);
  const totalCost = flightsWithPax.reduce((s, f) => s + f.price * (f.passengers || 1), 0);
  const totalPax  = flightsWithPax.reduce((s, f) => s + (f.passengers || 1), 0);
  const avgPerTraveler = totalPax > 0 ? totalCost / totalPax : 0;
  return { totalCost, totalPax, avgPerTraveler, spread, fairness };
}

/**
 * Fetch all origins for a single (destination, date) combination in parallel.
 * Returns a result object or null if any origin has no valid offer.
 * originPax[i] = number of travellers departing from originList[i].
 * Note: searches still use adults=1 at the provider; we scale per-origin in
 * code so the inner cache hits across searches with different pax configurations.
 */
async function fetchDestDate(originList, originPax, dest, dep, ret, optionsBase, safeMaxFlight) {
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
    const pax = originPax[i] || 1;
    const flight = {
      origin:         originList[i],
      price:          r.value.price,         // per-person fare
      passengers:     pax,
      totalForOrigin: Number((r.value.price * pax).toFixed(2)),
      offer:          r.value.offer ?? null,
    };
    // Precio de fecha vecina (proveedor de caché sin datos en la fecha
    // exacta): el frontend muestra SIEMPRE la fecha real, nunca la pedida.
    if (r.value.dateFallback) {
      flight.dateFallback     = true;
      flight.flightDate       = r.value.dateFallback.departureDate;
      flight.flightReturnDate = r.value.dateFallback.returnDate;
    }
    flights.push(flight);
  }

  if (flights.length !== originList.length) return null;

  const { totalCost, totalPax, avgPerTraveler, spread, fairness } = computeAggregates(flights);
  const hasDateFallback = flights.some((f) => f.dateFallback === true);

  return {
    destination:              dest,
    bestDate:                 dep,
    bestReturnDate:           ret,
    ...(hasDateFallback ? { hasDateFallback: true } : {}),
    flights,
    totalCostEUR:             Number(totalCost.toFixed(2)),
    totalPassengers:          totalPax,
    averageCostPerTraveler:   Number(avgPerTraveler.toFixed(2)),
    priceSpread:              Number(spread.toFixed(2)),
    fairnessScore:            Number(fairness.toFixed(1)),
    verifiedAt:               null,
  };
}

// ─── Verification (re-price the winning destination) ─────────────────────────
// Calls Flight Offers Price on each leg of the winning destination in parallel,
// recomputes totals from confirmed prices, and tags the result with a
// verificationStatus + priceChangePct so the UI can show a trust badge.
// Never re-ranks: changing the podium after the user sees results is worse UX
// than honestly showing "price changed since search".
async function verifyDestination(result) {
  if (!result || !Array.isArray(result.flights) || result.flights.length === 0) {
    return result;
  }

  const everyHasOffer = result.flights.every((f) => f.offer);
  if (!everyHasOffer) {
    return { ...result, verificationStatus: "failed" };
  }

  const verifyPromise = Promise.allSettled(
    result.flights.map((f) => priceFlightOffer(f.offer))
  );
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve("__timeout__"), VERIFY_TIMEOUT_MS)
  );

  const settled = await Promise.race([verifyPromise, timeoutPromise]);

  if (settled === "__timeout__") {
    console.warn(`[verify] timeout on ${result.destination}`);
    return { ...result, verificationStatus: "timeout" };
  }

  const verifiedFlights = result.flights.map((f, i) => {
    const r = settled[i];
    const v = r && r.status === "fulfilled" ? r.value : null;
    const verifiedPrice = v?.price ?? null;
    const effective = verifiedPrice ?? f.price;
    const pax = f.passengers || 1;
    return {
      ...f,
      verifiedPrice,
      totalForOrigin: Number((effective * pax).toFixed(2)),
    };
  });

  // Build pax-aware effective flights and re-aggregate using the same helper as search.
  const effective = verifiedFlights.map((f) => ({
    price: f.verifiedPrice ?? f.price,
    passengers: f.passengers || 1,
  }));
  const { totalCost: total, avgPerTraveler: avg, spread, fairness } = computeAggregates(effective);

  const verifiedCount = verifiedFlights.filter((f) => f.verifiedPrice !== null).length;
  const noneVerified = verifiedCount === 0;
  const allVerified  = verifiedCount === verifiedFlights.length;

  const priceChangePct = result.totalCostEUR > 0
    ? ((total - result.totalCostEUR) / result.totalCostEUR) * 100
    : 0;

  let verificationStatus;
  if (noneVerified) verificationStatus = "failed";
  else if (!allVerified) verificationStatus = "partial";
  else if (Math.abs(priceChangePct) >= VERIFY_PRICE_DELTA_PCT) verificationStatus = "changed";
  else verificationStatus = "verified";

  return {
    ...result,
    flights: verifiedFlights,
    verifiedAt: new Date().toISOString(),
    verifiedTotalCostEUR:        Number(total.toFixed(2)),
    verifiedAveragePerTraveler:  Number(avg.toFixed(2)),
    verifiedPriceSpread:         Number(spread.toFixed(2)),
    verifiedFairnessScore:       Number(fairness.toFixed(1)),
    priceChangePct:              Number(priceChangePct.toFixed(1)),
    verificationStatus,
  };
}

// Build the list of destination tiers to search. User-supplied destinations
// bypass the tiered fallback and are treated as a single tier — they asked
// for them explicitly, so we don't apply early-break across the list.
function buildSearchTiers(customDestinations, originList) {
  const dropOrigins = (arr) => arr.filter((d) => !originList.includes(d));

  if (Array.isArray(customDestinations) && customDestinations.length > 0) {
    const list = customDestinations
      .map((d) => String(d || "").trim().toUpperCase())
      .filter(isValidIata);
    const filtered = dropOrigins([...new Set(list)]);
    return filtered.length ? [filtered] : [];
  }

  return DEFAULT_DESTINATION_TIERS
    .map((tier) => dropOrigins(tier))
    .filter((tier) => tier.length > 0);
}

// Build an "origin → pax count" map from the raw origins + passengers arrays.
// Aggregates duplicates so that origins=[MAD,MAD,LON] passengers=[1,1,2] →
// originList=[MAD,LON] originPax=[2,2].
function buildOriginPax(rawOrigins, passengers, originList) {
  const paxByOrigin = {};
  const list = Array.isArray(rawOrigins) ? rawOrigins : [];
  for (let i = 0; i < list.length; i++) {
    const code = String(list[i] || "").trim().toUpperCase();
    if (!isValidIata(code)) continue;
    let p = passengers ? Math.floor(Number(passengers[i])) : 1;
    if (!Number.isFinite(p) || p < 1) p = 1;
    if (p > MAX_PAX_PER_ORIGIN) p = MAX_PAX_PER_ORIGIN;
    paxByOrigin[code] = (paxByOrigin[code] || 0) + p;
  }
  return originList.map((o) => paxByOrigin[o] || 1);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Monthly provider budget status — costs zero quota. Travelpayouts is free
// (unlimited:true); the gate exists for any future metered provider.
router.get("/budget", (_req, res) => {
  const b = budgetStatus();
  res.json({ ...b, remaining: b.unlimited ? null : b.remaining });
});

router.post("/multi-origin", async (req, res) => {
  const startTime = Date.now();

  try {
    let {
      origins,
      passengers,
      destinations,
      departureDate,
      returnDate,
      tripType,
      dateMode,
      flexDays,
      nonStop,
      travelClass,
      optimizeBy,
      maxBudgetPerTraveler,
      maxBudgetPerFlight,
    } = req.body;

    // Normalise enums
    tripType = tripType === "roundtrip" ? "roundtrip" : "oneway";
    dateMode = dateMode === "flex"      ? "flex"      : "exact";
    flexDays = typeof flexDays === "number" && flexDays >= 0 ? Math.min(flexDays, 5) : 0;
    // nonStop: solo true explicito (boolean o "true"); cualquier otra cosa → sin filtro
    nonStop  = nonStop === true || nonStop === "true" ? true : undefined;

    // travelClass: enum cerrado; un valor arbitrario provocaria un
    // 400 silencioso en cada llamada y una respuesta vacia confusa.
    const VALID_TRAVEL_CLASSES = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"];
    if (travelClass !== undefined && travelClass !== null && travelClass !== "") {
      travelClass = String(travelClass).trim().toUpperCase();
      if (!VALID_TRAVEL_CLASSES.includes(travelClass)) {
        return res.status(400).json({
          code: "INVALID_TRAVEL_CLASS",
          message: `travelClass debe ser una de: ${VALID_TRAVEL_CLASSES.join(", ")}.`,
        });
      }
    } else {
      travelClass = undefined;
    }

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

    // ── Passengers (aligned with raw origins array) ───────────────────────────
    if (passengers !== undefined && !Array.isArray(passengers)) {
      return res.status(400).json({
        code: "INVALID_PASSENGERS",
        message: "passengers debe ser un array alineado con origins.",
      });
    }
    const originPax = buildOriginPax(origins, passengers, originList);
    const totalPaxRequested = originPax.reduce((a, b) => a + b, 0);
    if (totalPaxRequested > TOTAL_PAX_CAP) {
      return res.status(400).json({
        code: "TOO_MANY_PASSENGERS",
        message: `Máximo ${TOTAL_PAX_CAP} pasajeros en total (recibidos ${totalPaxRequested}).`,
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
    // Fechas en el pasado: el proveedor no tiene datos y el usuario
    // recibiria un "sin resultados" confuso. Mejor un 400 claro aqui.
    const todayStr = toISODate(new Date());
    if (departureDate < todayStr) {
      return res.status(400).json({
        code: "DEPARTURE_DATE_IN_PAST",
        message: "La fecha de salida ya ha pasado.",
      });
    }
    // Más allá de ~1 año vista las aerolíneas no publican inventario y la
    // caché del proveedor está vacía: mejor un 400 claro que "sin resultados".
    const MAX_HORIZON_DAYS = 360;
    const horizonStr = toISODate(addDays(new Date(), MAX_HORIZON_DAYS));
    const lastDate = (tripType === "roundtrip" && returnDate > departureDate) ? returnDate : departureDate;
    if (lastDate > horizonStr) {
      return res.status(400).json({
        code: "DATE_TOO_FAR",
        message: `Solo se pueden buscar vuelos hasta ${MAX_HORIZON_DAYS} días vista.`,
      });
    }

    // ── Budget ────────────────────────────────────────────────────────────────
    const safeMaxAvg = Number.isFinite(Number(maxBudgetPerTraveler)) && Number(maxBudgetPerTraveler) > 0
      ? Number(maxBudgetPerTraveler) : null;
    const safeMaxFlight = Number.isFinite(Number(maxBudgetPerFlight)) && Number(maxBudgetPerFlight) > 0
      ? Number(maxBudgetPerFlight) : null;

    // ── Destination tiers ─────────────────────────────────────────────────────
    const searchTiers = buildSearchTiers(destinations, originList);
    const destinationList = searchTiers.flat(); // used only for combination guard + logging

    if (destinationList.length === 0) {
      return res.status(400).json({
        code: "NO_VALID_DESTINATIONS",
        message: "Sin destinos válidos para buscar.",
      });
    }

    // ── Cache ─────────────────────────────────────────────────────────────────
    // La clave usa las listas YA normalizadas (originList ordenable estable,
    // destinationList en mayúsculas y sin duplicados) en lugar del body crudo:
    // ["rom", "ROM "] y ["ROM"] son la misma búsqueda y deben compartir entrada.
    const cacheKey = JSON.stringify({
      originList, originPax, destinationList, departureDate, returnDate,
      tripType, dateMode, flexDays, nonStop, travelClass, optimizeBy, safeMaxAvg, safeMaxFlight,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      const duration = Date.now() - startTime;
      res.set("X-Response-Time", `${duration}ms`);
      console.log("[cache] HIT");
      return res.json(cached);
    }

    // ── Monthly budget gate (proveedores con cupo; travelpayouts es ilimitado) ─
    // Tras el chequeo de cache: un hit de cache no consume quota y debe
    // servirse aunque el presupuesto mensual este agotado.
    const budget = budgetStatus();
    if (budget.remaining <= 0) {
      console.warn(`[Budget] Búsqueda rechazada — presupuesto mensual agotado (${budget.used}/${budget.budget})`);
      return res.status(429).json({
        code: "MONTHLY_BUDGET_EXCEEDED",
        message: "Hemos alcanzado el límite mensual de búsquedas gratuitas. Vuelve a intentarlo el próximo mes.",
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

    const dateCandidates = (dateMode === "flex" && flexDays > 0
      ? Array.from({ length: 2 * flexDays + 1 }, (_, i) => toISODate(addDays(depBase, i - flexDays)))
      : [departureDate]
    ).filter((d) => d >= todayStr); // el rango flex no debe pisar fechas pasadas

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
    if (travelClass) optionsBase.travelClass = travelClass;
    const enriched    = [];
    const CHUNK_SIZE  = 3;
    let destsTouched  = 0; // for logging savings vs worst case

    console.log(`[search] ${originList.length} orígenes × ${destinationList.length} destinos × ${dateCandidates.length} fechas (worst case ${combinations} llamadas, target ${TARGET_RESULTS} resultados)`);
    const t0 = Date.now();

    // Tier-aware processing: tier N is only entered if previous tiers yielded
    // fewer than TARGET_RESULTS. Within a tier, destinations are chunked for
    // controlled parallelism while still respecting the global early-stop.
    let partial = false;

    tierLoop:
    for (let tierIdx = 0; tierIdx < searchTiers.length; tierIdx++) {
      const tier = searchTiers[tierIdx];
      console.log(`[search] tier ${tierIdx + 1}: ${tier.length} destinos`);

      for (let chunkIdx = 0; chunkIdx < tier.length && enriched.length < TARGET_RESULTS; chunkIdx += CHUNK_SIZE) {
        // Presupuesto agotado → cortar y devolver lo acumulado como parcial
        if (SEARCH_TIME_BUDGET_MS > 0 && Date.now() - t0 > SEARCH_TIME_BUDGET_MS) {
          partial = true;
          console.warn(`[search] presupuesto de ${SEARCH_TIME_BUDGET_MS}ms agotado — devolviendo ${enriched.length} resultados parciales`);
          break tierLoop;
        }
        const chunk = tier.slice(chunkIdx, chunkIdx + CHUNK_SIZE);
        destsTouched += chunk.length;

        const chunkResults = await Promise.allSettled(
          chunk.map(async (dest) => {
            let bestForDest = null;

            for (const dep of dateCandidates) {
              const ret = tripType === "roundtrip"
                ? toISODate(addDays(parseISODate(dep), tripLenDays))
                : null;

              const result = await fetchDestDate(originList, originPax, dest, dep, ret, optionsBase, safeMaxFlight);
              if (!result) continue;

              if (safeMaxAvg !== null && result.averageCostPerTraveler > safeMaxAvg) continue;

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

        for (const result of chunkResults) {
          if (result.status === "fulfilled" && result.value && enriched.length < TARGET_RESULTS) {
            enriched.push(result.value);
          }
        }
      }

      if (enriched.length >= TARGET_RESULTS) {
        const skipped = searchTiers.slice(tierIdx + 1).reduce((s, t) => s + t.length, 0);
        if (skipped > 0) {
          console.log(`[search] target ${TARGET_RESULTS} alcanzado en tier ${tierIdx + 1}, omitidos ${skipped} destinos de tiers posteriores`);
        }
        break tierLoop;
      }
    }

    console.log(`[search] completado en ${((Date.now() - t0) / 1000).toFixed(1)}s — ${enriched.length} resultados, ${destsTouched}/${destinationList.length} destinos consultados`);

    if (!enriched.length) {
      const payload = { flights: [], bestDestination: null, partial, provider: FLIGHT_PROVIDER };
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

    // Verify the winner before responding (re-prices its N legs via the provider).
    // Only the winner is verified to keep quota usage bounded. Failures degrade
    // gracefully: the original search price is shown with verificationStatus tag.
    // Skipped entirely when the remaining monthly budget is too low.
    if (partial) {
      // En respuestas parciales se omite la verificación: vamos justos de
      // tiempo y el frontend ya muestra el aviso de resultados parciales.
      enriched[0] = { ...enriched[0], verificationStatus: "skipped" };
    } else if (!CAN_VERIFY) {
      // Proveedor sin re-tarificación (precios de caché) → no fingir verificación.
      enriched[0] = { ...enriched[0], verificationStatus: "skipped" };
    } else if (budgetStatus().remaining < VERIFY_MIN_BUDGET) {
      console.warn("[verify] omitida — presupuesto mensual casi agotado");
      enriched[0] = { ...enriched[0], verificationStatus: "failed" };
    } else {
      try {
        const tVerify = Date.now();
        const verifiedWinner = await verifyDestination(enriched[0]);
        enriched[0] = verifiedWinner;
        console.log(
          `[verify] ${verifiedWinner.destination} → ${verifiedWinner.verificationStatus}` +
          (verifiedWinner.priceChangePct !== undefined ? ` (Δ ${verifiedWinner.priceChangePct}%)` : "") +
          ` in ${Date.now() - tVerify}ms`
        );
      } catch (verifyErr) {
        console.warn("[verify] error:", verifyErr.message);
        enriched[0] = { ...enriched[0], verificationStatus: "failed" };
      }
    }

    const payload = {
      flights:          enriched,
      bestDestination:  enriched[0],
      partial,
      provider:         FLIGHT_PROVIDER,
      appliedMaxBudgetPerTraveler: safeMaxAvg,
      appliedMaxBudgetPerFlight:   safeMaxFlight,
    };

    // Las respuestas parciales no se cachean: un reintento puede completarse
    if (!partial) setCached(cacheKey, payload);

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

// ─── POST /verify — capa 2: verificar el ganador contra Google Flights ───────
// El proveedor primario (travelpayouts) sirve precios de caché no confirmables
// y /multi-origin marca el ganador como "skipped". El frontend llama aquí
// DESPUÉS de renderizar los resultados, con los datos del destino ganador,
// para obtener el badge "verificado"/"cambiado" real (SerpAPI Google Flights).
//
// Endpoint separado a propósito: la búsqueda ya consume hasta
// SEARCH_TIME_BUDGET_MS (25s) y el proxy de Render corta a ~30s — verificar
// inline reventaría esa ventana (una búsqueda SerpAPI tarda 10-20s).
//
// Coste: cada llamada puede quemar hasta VERIFY_MAX_LEGS búsquedas del plan
// gratuito de SerpAPI (~250/mes). Protecciones: rate limiter global de
// /api/flights (60 req/10min/IP, montado en index.js sobre todo el router),
// caché de respuesta por payload, caché por tramo y quota guard mensual
// (contador local + /account) dentro de serpapiService.
router.post("/verify", async (req, res) => {
  try {
    const { destination, totalCostEUR, legs } = req.body || {};

    // ── Validación estricta (endpoint público y caro de procesar) ───────────
    const dest = String(destination || "").trim().toUpperCase();
    if (!isValidIata(dest)) {
      return res.status(400).json({
        code: "INVALID_DESTINATION",
        message: "destination debe ser un código IATA válido (ej: ROM).",
      });
    }
    const totalCost = Number(totalCostEUR);
    if (!Number.isFinite(totalCost) || totalCost <= 0) {
      return res.status(400).json({
        code: "INVALID_TOTAL_COST",
        message: "totalCostEUR debe ser un número mayor que 0.",
      });
    }
    if (!Array.isArray(legs) || legs.length === 0) {
      return res.status(400).json({
        code: "MISSING_LEGS",
        message: "legs debe ser un array con al menos un tramo.",
      });
    }
    if (legs.length > VERIFY_MAX_LEGS) {
      return res.status(400).json({
        code: "TOO_MANY_LEGS",
        message: `Máximo ${VERIFY_MAX_LEGS} tramos por verificación.`,
      });
    }

    const todayStr = toISODate(new Date());
    const normLegs = [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i] || {};
      const bad = (msg) =>
        res.status(400).json({ code: "INVALID_LEG", message: `legs[${i}]: ${msg}` });

      const origin = String(leg.origin || "").trim().toUpperCase();
      if (!isValidIata(origin)) return bad("origin debe ser un código IATA válido.");

      // Aeropuertos REALES del billete (opcionales). Google Flights no acepta
      // códigos de ciudad multi-aeropuerto (ROM, LON…) como departure_id /
      // arrival_id: si el frontend manda el aeropuerto concreto del billete
      // (offer.tp.originAirport/destinationAirport), se verifica contra él.
      // Sin ellos → fallback al origin del leg / destination global.
      let originAirport = null;
      if (leg.originAirport !== undefined && leg.originAirport !== null && leg.originAirport !== "") {
        originAirport = String(leg.originAirport).trim().toUpperCase();
        if (!isValidIata(originAirport)) return bad("originAirport debe ser un código IATA válido.");
      }
      let destinationAirport = null;
      if (leg.destinationAirport !== undefined && leg.destinationAirport !== null && leg.destinationAirport !== "") {
        destinationAirport = String(leg.destinationAirport).trim().toUpperCase();
        if (!isValidIata(destinationAirport)) return bad("destinationAirport debe ser un código IATA válido.");
      }

      const price = Number(leg.price);
      if (!Number.isFinite(price) || price <= 0) return bad("price debe ser un número mayor que 0.");

      const passengers = leg.passengers === undefined ? 1 : Number(leg.passengers);
      if (!Number.isInteger(passengers) || passengers < 1 || passengers > MAX_PAX_PER_ORIGIN) {
        return bad(`passengers debe ser un entero entre 1 y ${MAX_PAX_PER_ORIGIN}.`);
      }

      if (!isValidISODate(leg.departureDate)) return bad("departureDate inválida. Usa YYYY-MM-DD.");
      if (leg.departureDate < todayStr) return bad("departureDate ya ha pasado.");

      let returnDate = null;
      if (leg.returnDate !== undefined && leg.returnDate !== null && leg.returnDate !== "") {
        if (!isValidISODate(leg.returnDate)) return bad("returnDate inválida. Usa YYYY-MM-DD.");
        if (leg.returnDate < leg.departureDate) return bad("returnDate debe ser posterior a departureDate.");
        returnDate = leg.returnDate;
      }

      normLegs.push({
        origin,
        originAirport,      // null si no vino — entra en la clave de la caché
        destinationAirport, // null si no vino — entra en la clave de la caché
        price,
        passengers,
        departureDate: leg.departureDate,
        returnDate,
        nonStop:      leg.nonStop === true,
        dateFallback: leg.dateFallback === true,
      });
    }

    // ── Verificador deshabilitado (sin SERPAPI_KEY) → nada cambia ───────────
    if (!serpapi.isEnabled()) {
      return res.json({ destination: dest, verificationStatus: "skipped" });
    }

    // ── Caché de respuesta por payload normalizado ──────────────────────────
    const cacheKey = JSON.stringify({
      dest,
      totalCost,
      legs: [...normLegs].sort((a, b) => a.origin.localeCompare(b.origin)),
    });
    const cachedResponse = verifyResponseCache.get(cacheKey);
    if (cachedResponse) return res.json(cachedResponse);

    // ── Quota guard (contador local + /account de SerpAPI) ──────────────────
    if (!(await serpapi.hasBudget())) {
      console.warn("[serpapi-verify] omitida — cupo mensual de SerpAPI casi agotado");
      return res.json({ destination: dest, verificationStatus: "skipped" });
    }

    // ── Verificación por tramo en paralelo con timeout global ───────────────
    // IMPORTANTE: se verifica con las fechas que vienen en cada leg — cuando
    // hubo date-fallback el frontend ya manda la fecha REAL del vuelo.
    // Y contra el aeropuerto REAL del billete si vino (Google Flights no
    // acepta códigos de ciudad multi-aeropuerto como ROM o LON). La caché
    // por tramo de serpapiService ya distingue por estos códigos (la clave
    // es origin|destination|fechas).
    const legRoute = (leg) => ({
      origin:      leg.originAirport || leg.origin,
      destination: leg.destinationAirport || dest,
    });
    const verifyPromise = Promise.allSettled(
      normLegs.map((leg) =>
        serpapi.verifyLeg({
          ...legRoute(leg),
          departureDate: leg.departureDate,
          returnDate:    leg.returnDate || undefined,
          nonStop:       leg.nonStop || undefined,
        })
      )
    );
    const timeoutPromise = new Promise((resolve) => {
      const t = setTimeout(() => resolve("__timeout__"), SERPAPI_VERIFY_TIMEOUT_MS);
      if (typeof t.unref === "function") t.unref();
    });
    const settled = await Promise.race([verifyPromise, timeoutPromise]);

    if (settled === "__timeout__") {
      console.warn(`[serpapi-verify] timeout en ${dest}`);
      return res.json({ destination: dest, verificationStatus: "timeout" });
    }

    // ── Agregados con la misma semántica que verifyDestination ──────────────
    const verifiedFlights = normLegs.map((leg, i) => {
      const r = settled[i];
      const v = r && r.status === "fulfilled" ? r.value : null;
      const verifiedPrice = v?.price ?? null;
      if (verifiedPrice !== null) {
        // Vigilancia de desviación (sobre todo de los date-fallback):
        // grep "[serpapi-verify]" en los logs de Render. La ruta es la
        // realmente consultada en Google (p.ej. MAD→FCO aunque dest=ROM).
        const route = legRoute(leg);
        const deltaPct = ((verifiedPrice - leg.price) / leg.price) * 100;
        console.log(
          `[serpapi-verify] ${route.origin}→${route.destination} cached=${leg.price.toFixed(2)} ` +
          `google=${verifiedPrice.toFixed(2)} Δ=${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% ` +
          `dateFallback=${leg.dateFallback}`
        );
      }
      const effectivePrice = verifiedPrice ?? leg.price;
      return {
        origin:         leg.origin,
        verifiedPrice,
        totalForOrigin: Number((effectivePrice * leg.passengers).toFixed(2)),
      };
    });

    const effective = normLegs.map((leg, i) => ({
      price:      verifiedFlights[i].verifiedPrice ?? leg.price,
      passengers: leg.passengers,
    }));
    const { totalCost: total, avgPerTraveler: avg, spread, fairness } = computeAggregates(effective);

    const verifiedCount  = verifiedFlights.filter((f) => f.verifiedPrice !== null).length;
    const priceChangePct = ((total - totalCost) / totalCost) * 100;

    let verificationStatus;
    if (verifiedCount === 0) verificationStatus = "failed";
    else if (verifiedCount < verifiedFlights.length) verificationStatus = "partial";
    else if (Math.abs(priceChangePct) >= VERIFY_PRICE_DELTA_PCT) verificationStatus = "changed";
    else verificationStatus = "verified";

    const payload = {
      destination:                dest,
      verificationStatus,
      verificationSource:         "google_flights",
      verifiedAt:                 new Date().toISOString(),
      priceChangePct:             Number(priceChangePct.toFixed(1)),
      flights:                    verifiedFlights,
      verifiedTotalCostEUR:       Number(total.toFixed(2)),
      verifiedAveragePerTraveler: Number(avg.toFixed(2)),
      verifiedPriceSpread:        Number(spread.toFixed(2)),
      verifiedFairnessScore:      Number(fairness.toFixed(1)),
    };

    console.log(`[serpapi-verify] ${dest} → ${verificationStatus} (Δ ${payload.priceChangePct}%)`);
    verifyResponseCache.set(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("[verify error]", err);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Error interno al verificar el precio.",
    });
  }
});

module.exports = router;
