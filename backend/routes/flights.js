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

// =========================
// Cache en memoria
// =========================
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
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
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// =========================
// Utilidades de fechas
// =========================
function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseISODate(s) {
  const [y, m, d] = String(s).split("-").map(Number);
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

// =========================
// ROUTE PRINCIPAL
// =========================
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
      maxBudgetPerTraveler,
      maxBudgetPerFlight,
    } = req.body;

    // Defaults
    tripType = tripType === "roundtrip" ? "roundtrip" : "oneway";
    dateMode = dateMode === "flex" ? "flex" : "exact";
    flexDays =
      typeof flexDays === "number" && flexDays >= 0 ? Math.min(flexDays, 7) : 3;

    const safeMaxAvg =
      Number.isFinite(Number(maxBudgetPerTraveler)) &&
      Number(maxBudgetPerTraveler) > 0
        ? Number(maxBudgetPerTraveler)
        : null;

    const safeMaxFlight =
      Number.isFinite(Number(maxBudgetPerFlight)) &&
      Number(maxBudgetPerFlight) > 0
        ? Number(maxBudgetPerFlight)
        : null;

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
      safeMaxAvg,
      safeMaxFlight,
    });

    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // =========================
    // Validaciones
    // =========================
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
        ? destinations.map((d) => String(d).trim().toUpperCase()).filter(Boolean)
        : DEFAULT_DESTINATIONS;

    const optionsBase = { nonStop, max: 5 };

    // =========================
    // Fechas candidatas
    // =========================
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
        dateCandidates.push(toISODate(addDays(depBase, d)));
      }
    } else {
      dateCandidates.push(departureDate);
    }

    // =========================
    // Protección combinatoria
    // =========================
    const combinations =
      originList.length * destinationList.length * dateCandidates.length;

    const MAX_COMBINATIONS = 180;
    if (combinations > MAX_COMBINATIONS) {
      return res.status(400).json({
        message: `Demasiadas combinaciones (${combinations}). Reduce orígenes, destinos o flexibilidad.`,
      });
    }

    // =========================
    // BÚSQUEDA REAL (SECUENCIAL)
    // =========================
    const enriched = [];

    for (const dest of destinationList) {
      for (const dep of dateCandidates) {
        const ret =
          tripType === "roundtrip"
            ? toISODate(addDays(parseISODate(dep), tripLenDays))
            : null;

        const flights = [];
        let valid = true;

        for (const origin of originList) {
          const options = { ...optionsBase };
          if (tripType === "roundtrip" && ret) {
            options.returnDate = ret;
          }

          const price = await getCheapestPrice(origin, dest, dep, options);

          // Corte temprano: si un origen falla, descartamos todo
          if (typeof price !== "number") {
            valid = false;
            break;
          }

          // Filtro: presupuesto máximo por vuelo individual
          if (safeMaxFlight !== null && price > safeMaxFlight) {
            valid = false;
            break;
          }

          flights.push({ origin, price });
        }

        if (!valid) continue;
        if (flights.length !== originList.length) continue;

        const prices = flights.map((f) => f.price);
        const total = prices.reduce((a, b) => a + b, 0);
        const avg = total / originList.length;

        // Filtro: presupuesto medio por persona
        if (safeMaxAvg !== null && avg > safeMaxAvg) continue;

        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const spread = max - min;

        const fairness =
          avg > 0
            ? Math.max(0, Math.min(100, 100 - (spread / avg) * 100))
            : 0;

        enriched.push({
          destination: dest,
          bestDate: dep,
          bestReturnDate: ret,
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

    // =========================
    // Orden final
    // =========================
    enriched.sort((a, b) => {
      if (optimizeBy === "fairness") {
        if (b.fairnessScore !== a.fairnessScore) {
          return b.fairnessScore - a.fairnessScore;
        }
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
    console.error("💥 Error en multi-origin:", err);
    return res
      .status(500)
      .json({ message: "Error interno al buscar vuelos" });
  }
});

module.exports = router;
