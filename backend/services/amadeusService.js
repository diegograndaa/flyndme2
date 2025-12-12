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

let cachedToken = null;
let tokenExpiresAt = null;

/**
 * Obtiene y cachea el token de acceso de Amadeus.
 * Si el token sigue siendo válido, reutiliza el existente.
 */
async function getAccessToken() {
  const now = Date.now();

  // Si ya tenemos token válido en memoria, lo reutilizamos
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
    const response = await http.post(
      `${BASE_URL}/v1/security/oauth2/token`,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: AMADEUS_API_KEY,
        client_secret: AMADEUS_API_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, expires_in } = response.data;

    cachedToken = access_token;
    // restamos 60s para evitar quedarnos al límite
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
 *
 * origin: string (ej. "MAD")
 * destination: string (ej. "LON")
 * departureDate: string "YYYY-MM-DD"
 * options:
 *   - adults: número de adultos (por defecto 1)
 *   - nonStop: boolean
 *   - currencyCode: código de moneda (por defecto "EUR")
 *   - returnDate: "YYYY-MM-DD" (opcional)
 *   - max: número máximo de resultados (opcional)
 */
async function searchFlightOffer(
  origin,
  destination,
  departureDate,
  options = {}
) {
  if (!origin || !destination || !departureDate) {
    throw new Error(
      "origin, destination y departureDate son obligatorios en searchFlightOffer"
    );
  }

  const token = await getAccessToken();

  const params = {
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate,
    adults:
      typeof options.adults === "number" && options.adults > 0
        ? options.adults
        : 1,
    currencyCode: options.currencyCode || "EUR",
  };

  if (options.nonStop !== undefined) {
    params.nonStop = options.nonStop;
  }

  if (options.returnDate) {
    params.returnDate = options.returnDate;
  }

  // Reducimos payload por defecto (mejora latencia): pedimos pocos resultados.
  // Si el caller especifica max, lo respetamos.
  params.max =
    typeof options.max === "number" && options.max > 0 ? options.max : 5;

  // Limpieza por si acaso
  Object.keys(params).forEach((key) => {
    if (params[key] === undefined || params[key] === null) {
      delete params[key];
    }
  });

  try {
    const response = await http.get(
      `${BASE_URL}/v2/shopping/flight-offers`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params,
      }
    );

    return response.data;
  } catch (err) {
    console.error(
      `💥 Error buscando vuelos ${origin} -> ${destination} (${departureDate}):`,
      err.response?.data || err.message
    );
    // Re-lanzamos un error genérico para que el router lo gestione
    throw new Error("Error al buscar vuelos en Amadeus");
  }
}

/**
 * Devuelve el precio mínimo (en EUR) para un origen-destino-fecha.
 * Si no hay vuelos, devuelve null.
 */
async function getCheapestPrice(
  origin,
  destination,
  departureDate,
  options = {}
) {
  // Evitamos llamadas inválidas cuando origen y destino son iguales
  if (origin === destination) {
    console.log(
      `⏭️ Saltando búsqueda porque origen y destino son iguales (${origin})`
    );
    return null;
  }

  try {
    const data = await searchFlightOffer(
      origin,
      destination,
      departureDate,
      options
    );


    const offers = data?.data || [];
    if (!offers.length) {
      console.log(
        `ℹ️ No se encontraron vuelos para ${origin} -> ${destination} (${departureDate})`
      );
      return null;
    }

    const cheapest = offers.reduce((min, offer) => {
      const price = parseFloat(offer.price.grandTotal);
      const minPrice = parseFloat(min.price.grandTotal);
      return price < minPrice ? offer : min;
    }, offers[0]);

    const value = parseFloat(cheapest.price.grandTotal);
    if (Number.isNaN(value)) return null;

    return value;
  } catch (err) {
    console.error(
      `❌ Error en getCheapestPrice para ${origin} -> ${destination}:`,
      err.message
    );
    // devolvemos null para que el router pueda decidir qué hacer
    return null;
  }
}

module.exports = {
  getAccessToken,
  searchFlightOffer,
  getCheapestPrice,
};
