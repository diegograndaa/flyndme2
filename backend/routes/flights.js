const express = require("express");
const router = express.Router();
const { getCheapestPrice } = require("../services/amadeusService");

const DEFAULT_DESTINATIONS = [
  "LON",
  "PAR",
  "AMS",
  "ROM",
  "BCN",
  "BER",
  "LIS",
  "DUB",
  "MIL",
  "VIE",
];

// Cache en memoria
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const responseCache = new Map();

function getCached(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  responseCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = await mapper(items[i], i);
      } catch (e) {
        results[i] = { __error: e };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseISODate(s) {
  const [y, m, d] = String(s)
    .split("-")
    .map((x) => parseInt(x, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

router.post("/multi-origin", async (req, res) => {
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
      maxBudgetPerTraveler,   // media por persona
      maxBudgetPerFlight,     // NUEVO: presupuesto máximo por vuelo individual
    } = req.body;

    // defaults
    tripType = tripType === "roundtrip" ? "roundtrip" : "oneway";
    dateMode = dateMode === "flex" ? "flex" : "exact";
    flexDays =
      typeof flexDays === "number" && flexDays >= 0 ? Math.min(flexDays, 7) : 3;

    const parsedAvg = Number(maxBudgetPerTraveler);
    const parsedFlight = Number(maxBudgetPerFlight);

    const safeMaxAvg =
      Number.isFinite(parsedAvg) && parsedAvg > 0 ? parsedAvg : null;

    const safeMaxFlight =
      Number.isFinite(parsedFlight) && parsedFlight > 0 ? parsedFlight : null;

    const cacheKey = JSON.stringify({
      origins,
      destinations,
      departureDate,
      returnDate,
      tripType,
      dateMode,
      flexDays,
      nonStop,
      optimizeBy,
      maxBudgetPerTraveler: safeMaxAvg,
      maxBudgetPerFlight: safeMaxFlight,
    });

    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    if (!Array.isArray(origins) || origins.length === 0) {
      return res.status(400).json({ message: "Debes indicar al menos un origen" });
    }

    if (!departureDate) {
      return res.status(400).json({ message: "Debes indicar departureDate" });
    }

    if (tripType === "roundtrip" && !returnDate) {
      return res.status(400).json({
        message: "Debes indicar returnDate para ida y vuelta",
      });
    }

    const originList = origins
      .map((o) => String(o).trim().toUpperCase())
      .filter(Boolean);

    const destinationList =
      Array.isArray(destinations) && destinations.length > 0
        ? destinations.map((d) => String(d).trim().toUpperCase())
        : DEFAULT_DESTINATIONS;

    const optionsBase = { nonStop, max: 5 };

    const depBase = parseISODate(departureDate);
    let tripLenDays = 0;

    if (tripType === "roundtrip") {
      const retBase = parseISODate(returnDate);
      tripLenDays = diffDays(depBase, retBase);
      if (tripLenDays <= 0) {
        return res.status(400).json({
          message: "returnDate debe ser posterior a departureDate",
        });
      }
    }

    const dateCandidates = [];
    if (dateMode === "flex") {
      for (let d = -flexDays; d <= flexDays; d++) {
        dateCandidates.push({ dep: toISODate(addDays(depBase, d)) });
      }
    } else {
      dateCandidates.push({ dep: departureDate });
    }

    const tasks = [];
    for (const dest of destinationList) {
      for (const dc of dateCandidates) {
        for (const origin of originList) {
          const dep = dc.dep;
          const ret =
            tripType === "roundtrip"
              ? toISODate(addDays(parseISODate(dep), tripLenDays))
              : null;

          tasks.push({ origin, dest, dep, ret });
        }
      }
    }

    const results = await mapWithConcurrency(tasks, 6, async (t) => {
      const options = { ...optionsBase };
      if (tripType === "roundtrip" && t.ret) options.returnDate = t.ret;
      const price = await getCheapestPrice(t.origin, t.dest, t.dep, options);
      return {
        origin: t.origin,
        dest: t.dest,
        dep: t.dep,
        ret: t.ret,
        price: typeof price === "number" ? price : null,
      };
    });

    const byDestDate = new Map();
    destinationList.forEach((d) => byDestDate.set(d, new Map()));

    for (const r of results) {
      const map = byDestDate.get(r.dest);
      const current = map.get(r.dep) || { flights: [], ret: r.ret };
      current.flights.push(
        r.price === null
          ? { origin: r.origin, price: null, error: "No hay vuelos" }
          : { origin: r.origin, price: r.price }
      );
      map.set(r.dep, current);
    }

    const enriched = [];

    for (const dest of destinationList) {
      const dates = byDestDate.get(dest);

      for (const [dep, payload] of dates.entries()) {
        const flights = payload.flights;
        if (flights.length !== originList.length) continue;
        if (!flights.every((f) => typeof f.price === "number")) continue;

        // FILTRO: presupuesto máximo por vuelo individual
        if (
          safeMaxFlight !== null &&
          flights.some((f) => f.price > safeMaxFlight)
        ) {
          continue;
        }

        const prices = flights.map((f) => f.price);
        const total = prices.reduce((a, b) => a + b, 0);
        const avg = total / originList.length;

        // FILTRO: presupuesto medio por persona
        if (safeMaxAvg !== null && avg > safeMaxAvg) continue;

        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const spread = max - min;

        const fairness =
          avg > 0 ? Math.max(0, Math.min(100, 100 - (spread / avg) * 100)) : 0;

        enriched.push({
          destination: dest,
          bestDate: dep,
          bestReturnDate: payload.ret,
          flights,
          totalCostEUR: total,
          averageCostPerTraveler: Number(avg.toFixed(2)),
          priceSpread: Number(spread.toFixed(2)),
          fairnessScore: Number(fairness.toFixed(1)),
        });
      }
    }

    if (!enriched.length) {
      const payload = { flights: [], bestDestination: null };
      setCached(cacheKey, payload);
      return res.json(payload);
    }

    enriched.sort((a, b) => {
      if (optimizeBy === "fairness") {
        if (b.fairnessScore !== a.fairnessScore)
          return b.fairnessScore - a.fairnessScore;
        return a.totalCostEUR - b.totalCostEUR;
      }
      return a.totalCostEUR - b.totalCostEUR;
    });

    const payload = {
      flights: enriched,
      bestDestination: enriched[0],
      appliedMaxBudgetPerTraveler: safeMaxAvg,
      appliedMaxBudgetPerFlight: safeMaxFlight,
    };

    setCached(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("💥 Error en multi-origin:", err.message);
    res.status(500).json({ message: "Error interno al buscar vuelos" });
  }
});

module.exports = router;
