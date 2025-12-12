const express = require("express");
const router = express.Router();
const { getCheapestPrice } = require("../services/amadeusService");

const DEFAULT_DESTINATIONS = ["LON", "PAR", "AMS", "ROM", "BCN", "BER", "LIS", "DUB", "MIL", "VIE"];

// --- Rendimiento ------------------------------------------------------------
// Cache en memoria (útil para búsquedas repetidas durante unos minutos)
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

// Ejecuta mapeos en paralelo con límite de concurrencia (evita rate limits)
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

router.post("/multi-origin", async (req, res) => {
  try {
    let { origins, destinations, departureDate, nonStop, optimizeBy } = req.body;

    // Cache por payload (incluye nonStop/optimizeBy/destinations si se envían)
    const cacheKey = JSON.stringify({ origins, destinations, departureDate, nonStop, optimizeBy });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (!Array.isArray(origins) || origins.length === 0) {
      return res.status(400).json({ message: "Debes indicar al menos un origen" });
    }

    if (!departureDate) {
      return res.status(400).json({ message: "Debes indicar departureDate (YYYY-MM-DD)" });
    }

    const originList = origins
      .map((o) => String(o).trim().toUpperCase())
      .filter(Boolean);

    const destinationList =
      Array.isArray(destinations) && destinations.length > 0
        ? destinations.map((d) => String(d).trim().toUpperCase()).filter(Boolean)
        : DEFAULT_DESTINATIONS;

    const options = { nonStop, max: 5 };

    // 1) Creamos todas las combinaciones origen-destino
    const tasks = [];
    for (const dest of destinationList) {
      for (const origin of originList) {
        tasks.push({ origin, dest });
      }
    }

    // 2) Consultamos en paralelo con límite (ajusta si ves rate limiting)
    const CONCURRENCY = 6;
    const taskResults = await mapWithConcurrency(tasks, CONCURRENCY, async ({ origin, dest }) => {
      const price = await getCheapestPrice(origin, dest, departureDate, options);
      return { origin, dest, price: typeof price === "number" && !Number.isNaN(price) ? price : null };
    });

    // 3) Reagrupamos por destino
    const destMap = new Map();
    for (const dest of destinationList) {
      destMap.set(dest, []);
    }
    for (const r of taskResults) {
      const flightsForDestination = destMap.get(r.dest) || [];
      flightsForDestination.push(
        r.price === null
          ? { origin: r.origin, price: null, error: "No hay vuelos disponibles" }
          : { origin: r.origin, price: r.price }
      );
      destMap.set(r.dest, flightsForDestination);
    }

    const destinationResults = destinationList.map((dest) => ({
      destination: dest,
      flights: destMap.get(dest) || [],
    }));

    // Solo consideramos destinos con precio válido para todos los orígenes
    const validDestinations = destinationResults.filter((dest) =>
      dest.flights.every((f) => typeof f.price === "number")
    );

    if (!validDestinations.length) {
      const payload = { flights: [] };
      setCached(cacheKey, payload);
      return res.json(payload);
    }

    const enriched = validDestinations.map((dest) => {
      const prices = dest.flights.map((f) => f.price);
      const totalCostEUR = prices.reduce((sum, p) => sum + p, 0);
      const averageCostPerTraveler = totalCostEUR / originList.length;

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceSpread = maxPrice - minPrice;

      let fairnessScore;
      if (averageCostPerTraveler <= 0) {
        fairnessScore = 0;
      } else {
        const ratio = priceSpread / averageCostPerTraveler;
        const raw = 100 - ratio * 100;
        fairnessScore = Math.max(0, Math.min(100, raw));
      }

      // 🔋 Proxy MUY simple de CO₂:
      // De momento usamos el coste medio como aproximación.
      // En una versión real se usaría distancia + nº de escalas.
      const approxCo2Score = Number(averageCostPerTraveler.toFixed(2));

      return {
        ...dest,
        totalCostEUR,
        averageCostPerTraveler: Number(averageCostPerTraveler.toFixed(2)),
        minPrice,
        maxPrice,
        priceSpread: Number(priceSpread.toFixed(2)),
        fairnessScore: Number(fairnessScore.toFixed(1)),
        approxCo2Score,
      };
    });

    const criterion =
      optimizeBy === "fairness"
        ? "fairness"
        : optimizeBy === "co2"
        ? "co2"
        : "total";

    const sorted = enriched.sort((a, b) => {
      if (criterion === "fairness") {
        if (b.fairnessScore !== a.fairnessScore) {
          return b.fairnessScore - a.fairnessScore; // más justo primero
        }
        return a.totalCostEUR - b.totalCostEUR; // desempate por precio total
      }

      if (criterion === "co2") {
        // Menor "approxCo2Score" = menos CO₂ aproximado
        if (a.approxCo2Score !== b.approxCo2Score) {
          return a.approxCo2Score - b.approxCo2Score;
        }
        // si empatan, el más barato
        if (a.totalCostEUR !== b.totalCostEUR) {
          return a.totalCostEUR - b.totalCostEUR;
        }
        // y luego el más equitativo
        return b.fairnessScore - a.fairnessScore;
      }

      // criterio por defecto: precio total
      if (a.totalCostEUR !== b.totalCostEUR) {
        return a.totalCostEUR - b.totalCostEUR; // más barato primero
      }
      return b.fairnessScore - a.fairnessScore; // desempate por equidad
    });

    const payload = { flights: sorted };
    setCached(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error("💥 Error en /api/flights/multi-origin:", err.response?.data || err.message);
    res.status(500).json({ message: "Error interno al buscar vuelos" });
  }
});

module.exports = router;
