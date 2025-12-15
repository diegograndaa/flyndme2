const express = require("express");
const router = express.Router();
const { getCheapestPrice } = require("../services/amadeusService");

const DEFAULT_DESTINATIONS = ["LON", "PAR", "AMS", "ROM", "BCN", "BER", "LIS", "DUB", "MIL", "VIE"];

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

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
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
  // s: YYYY-MM-DD
  const [y, m, d] = String(s).split("-").map((x) => parseInt(x, 10));
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
      tripType,   // "oneway" | "roundtrip"
      dateMode,   // "exact" | "flex"
      flexDays,   // number
      nonStop,
      optimizeBy
    } = req.body;

    // defaults seguros
    tripType = tripType === "roundtrip" ? "roundtrip" : "oneway";
    dateMode = dateMode === "flex" ? "flex" : "exact";
    flexDays = typeof flexDays === "number" && flexDays >= 0 ? Math.min(flexDays, 7) : 3;

    const cacheKey = JSON.stringify({
      origins, destinations, departureDate, returnDate, tripType, dateMode, flexDays, nonStop, optimizeBy
    });

    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    if (!Array.isArray(origins) || origins.length === 0) {
      return res.status(400).json({ message: "Debes indicar al menos un origen" });
    }

    if (!departureDate) {
      return res.status(400).json({ message: "Debes indicar departureDate (YYYY-MM-DD)" });
    }

    if (tripType === "roundtrip" && !returnDate) {
      return res.status(400).json({ message: "Debes indicar returnDate (YYYY-MM-DD) para ida y vuelta" });
    }

    const originList = origins
      .map((o) => String(o).trim().toUpperCase())
      .filter(Boolean);

    const destinationList =
      Array.isArray(destinations) && destinations.length > 0
        ? destinations.map((d) => String(d).trim().toUpperCase()).filter(Boolean)
        : DEFAULT_DESTINATIONS;

    const optionsBase = { nonStop, max: 5 };

    // 1) Generar fechas candidatas
    const depBase = parseISODate(departureDate);
    let tripLenDays = 0;

    if (tripType === "roundtrip") {
      const retBase = parseISODate(returnDate);
      tripLenDays = diffDays(depBase, retBase);
      if (tripLenDays <= 0) {
        return res.status(400).json({ message: "returnDate debe ser posterior a departureDate" });
      }
    }

    const dateCandidates = [];
    if (dateMode === "flex") {
      for (let delta = -flexDays; delta <= flexDays; delta++) {
        dateCandidates.push({ delta, dep: toISODate(addDays(depBase, delta)) });
      }
    } else {
      dateCandidates.push({ delta: 0, dep: departureDate });
    }

    // 2) Construir tasks: destino x fecha x origen
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

    // 3) Consultas en paralelo con límite
    const CONCURRENCY = 6;

    const taskResults = await mapWithConcurrency(tasks, CONCURRENCY, async (t) => {
      const options = { ...optionsBase };
      if (tripType === "roundtrip" && t.ret) options.returnDate = t.ret;

      const price = await getCheapestPrice(t.origin, t.dest, t.dep, options);

      return {
        origin: t.origin,
        dest: t.dest,
        dep: t.dep,
        ret: t.ret,
        price: typeof price === "number" && !Number.isNaN(price) ? price : null
      };
    });

    // 4) Agrupar por destino y fecha (dep)
    // structure: dest -> dep -> { flights: [...], ret }
    const byDestDate = new Map();

    for (const dest of destinationList) {
      byDestDate.set(dest, new Map());
    }

    for (const r of taskResults) {
      const mapForDest = byDestDate.get(r.dest) || new Map();
      const current = mapForDest.get(r.dep) || { flights: [], ret: r.ret || null };

      current.flights.push(
        r.price === null
          ? { origin: r.origin, price: null, error: "No hay vuelos disponibles" }
          : { origin: r.origin, price: r.price }
      );

      // conservar returnDate asociado a esa dep (roundtrip)
      current.ret = r.ret || current.ret;

      mapForDest.set(r.dep, current);
      byDestDate.set(r.dest, mapForDest);
    }

    // 5) Para cada destino, elegir la mejor fecha (si flex) donde haya precio válido para TODOS los orígenes
    const enrichedDestinations = [];

    for (const dest of destinationList) {
      const datesMap = byDestDate.get(dest) || new Map();
      const options = [];

      for (const [dep, payload] of datesMap.entries()) {
        const flightsForDate = Array.isArray(payload.flights) ? payload.flights : [];
        // Asegurar 1 vuelo por origen. Si faltan, no sirve.
        if (flightsForDate.length !== originList.length) continue;

        const allHavePrice = flightsForDate.every((f) => typeof f.price === "number");
        if (!allHavePrice) continue;

        const prices = flightsForDate.map((f) => f.price);
        const totalCostEUR = prices.reduce((sum, p) => sum + p, 0);
        const averageCostPerTraveler = totalCostEUR / originList.length;

        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceSpread = maxPrice - minPrice;

        let fairnessScore;
        if (averageCostPerTraveler <= 0) fairnessScore = 0;
        else {
          const ratio = priceSpread / averageCostPerTraveler;
          const raw = 100 - ratio * 100;
          fairnessScore = Math.max(0, Math.min(100, raw));
        }

        // Proxy CO2
        const approxCo2Score = Number(averageCostPerTraveler.toFixed(2));

        options.push({
          destination: dest,
          bestDate: dep,
          bestReturnDate: payload.ret || null,
          flights: flightsForDate,
          totalCostEUR,
          averageCostPerTraveler: Number(averageCostPerTraveler.toFixed(2)),
          minPrice,
          maxPrice,
          priceSpread: Number(priceSpread.toFixed(2)),
          fairnessScore: Number(fairnessScore.toFixed(1)),
          approxCo2Score
        });
      }

      if (!options.length) continue;

      const criterion =
        optimizeBy === "fairness" ? "fairness" : optimizeBy === "co2" ? "co2" : "total";

      // elegir mejor opción de fecha
      options.sort((a, b) => {
        if (criterion === "fairness") {
          if (b.fairnessScore !== a.fairnessScore) return b.fairnessScore - a.fairnessScore;
          return a.totalCostEUR - b.totalCostEUR;
        }
        if (criterion === "co2") {
          if (a.approxCo2Score !== b.approxCo2Score) return a.approxCo2Score - b.approxCo2Score;
          if (a.totalCostEUR !== b.totalCostEUR) return a.totalCostEUR - b.totalCostEUR;
          return b.fairnessScore - a.fairnessScore;
        }
        if (a.totalCostEUR !== b.totalCostEUR) return a.totalCostEUR - b.totalCostEUR;
        return b.fairnessScore - a.fairnessScore;
      });

      enrichedDestinations.push(options[0]);
    }

    if (!enrichedDestinations.length) {
      const payload = { flights: [], bestDestination: null };
      setCached(cacheKey, payload);
      return res.json(payload);
    }

    // 6) Orden final de destinos
    const criterion =
      optimizeBy === "fairness" ? "fairness" : optimizeBy === "co2" ? "co2" : "total";

    const sorted = enrichedDestinations.sort((a, b) => {
      if (criterion === "fairness") {
        if (b.fairnessScore !== a.fairnessScore) return b.fairnessScore - a.fairnessScore;
        return a.totalCostEUR - b.totalCostEUR;
      }
      if (criterion === "co2") {
        if (a.approxCo2Score !== b.approxCo2Score) return a.approxCo2Score - b.approxCo2Score;
        if (a.totalCostEUR !== b.totalCostEUR) return a.totalCostEUR - b.totalCostEUR;
        return b.fairnessScore - a.fairnessScore;
      }
      if (a.totalCostEUR !== b.totalCostEUR) return a.totalCostEUR - b.totalCostEUR;
      return b.fairnessScore - a.fairnessScore;
    });

    const bestDestination = sorted[0];

    const payload = { flights: sorted, bestDestination };
    setCached(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("💥 Error en /api/flights/multi-origin:", err.response?.data || err.message);
    res.status(500).json({ message: "Error interno al buscar vuelos" });
  }
});

module.exports = router;
