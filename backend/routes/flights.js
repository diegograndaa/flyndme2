const express = require("express");
const router = express.Router();
const { getCheapestPrice } = require("../services/amadeusService");

const DEFAULT_DESTINATIONS = ["LON", "PAR", "AMS", "ROM", "BCN", "BER", "LIS", "DUB", "MIL", "VIE"];

router.post("/multi-origin", async (req, res) => {
  try {
    let { origins, destinations, departureDate, nonStop, optimizeBy } = req.body;

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

    const options = { nonStop };
    const destinationResults = [];

    for (const dest of destinationList) {
      const flightsForDestination = [];

      for (const origin of originList) {
        try {
          const price = await getCheapestPrice(origin, dest, departureDate, options);

          if (price === null || Number.isNaN(price)) {
            flightsForDestination.push({
              origin,
              price: null,
              error: "No hay vuelos disponibles",
            });
          } else {
            flightsForDestination.push({
              origin,
              price,
            });
          }
        } catch (error) {
          console.error(
            `❌ Error buscando vuelos ${origin} -> ${dest}:`,
            error.response?.data || error.message
          );
          flightsForDestination.push({
            origin,
            price: null,
            error: "Error al consultar Amadeus",
          });
        }
      }

      destinationResults.push({
        destination: dest,
        flights: flightsForDestination,
      });
    }

    // Solo consideramos destinos con precio válido para todos los orígenes
    const validDestinations = destinationResults.filter((dest) =>
      dest.flights.every((f) => typeof f.price === "number")
    );

    if (!validDestinations.length) {
      return res.json({ flights: [] });
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

    res.json({ flights: sorted });
  } catch (err) {
    console.error("💥 Error en /api/flights/multi-origin:", err.response?.data || err.message);
    res.status(500).json({ message: "Error interno al buscar vuelos" });
  }
});

module.exports = router;
