// Mock flight provider — drop-in replacement when USE_MOCK=true.
// Produces deterministic, realistic-looking flight offers without hitting
// any external API. Used for local development and the test suite.

const MOCK_DELAY_MS           = Number(process.env.MOCK_DELAY_MS           || 60);
const MOCK_VERIFY_SUCCESS_RATE = Number(process.env.MOCK_VERIFY_SUCCESS_RATE || 0.95);
const MOCK_VERIFY_CHANGE_RATE  = Number(process.env.MOCK_VERIFY_CHANGE_RATE  || 0.15);

const AIRLINES = ["IB", "BA", "AF", "LH", "KL", "FR", "U2", "VY", "TP", "LX", "AY", "SK"];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Simple deterministic hash → non-negative integer
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Deterministic pseudo-random in [0, 1) from a string seed
function rand(seed) {
  return (hash(seed) % 10000) / 10000;
}

function mockPrice(origin, dest, date) {
  const routeBase  = 80 + (hash(`${origin}-${dest}`) % 250);  // 80-330€
  const dateNoise  = ((hash(date) % 100) - 50) * 0.6;          // ±30€
  let day = 3;
  try { day = new Date(`${date}T00:00:00`).getDay(); } catch { /* keep default */ }
  const weekendMul = (day === 0 || day === 6) ? 1.15 : 1.0;
  const raw = (routeBase + dateNoise) * weekendMul;
  return Math.max(35, Math.round(raw));
}

function mockSegment(origin, dest, dateAt, carrierCode, flightNumber, durationISO, terminalA, terminalB) {
  return {
    departure: { iataCode: origin, terminal: terminalA, at: dateAt },
    arrival:   { iataCode: dest,   terminal: terminalB, at: addDuration(dateAt, durationISO) },
    carrierCode,
    number:    String(flightNumber),
    aircraft:  { code: "320" },
    operating: { carrierCode },
    duration:  durationISO,
    numberOfStops: 0,
    blacklistedInEU: false,
  };
}

// Add ISO 8601 duration (PT3H15M) to an ISO date-time and return the new ISO string.
function addDuration(isoAt, durationISO) {
  const m = durationISO.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  const hours = m ? Number(m[1] || 0) : 3;
  const mins  = m ? Number(m[2] || 0) : 0;
  const d = new Date(isoAt);
  d.setHours(d.getHours() + hours, d.getMinutes() + mins);
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

function mockOffer(origin, dest, date, returnDate, price) {
  const seed         = `${origin}-${dest}-${date}`;
  const carrierCode  = AIRLINES[hash(seed) % AIRLINES.length];
  const flightNumber = 1000 + (hash(seed + "fn") % 8999);
  // Duration scales loosely with route hash → 1h30 – 5h00
  const totalMinutes = 90 + (hash(`${origin}${dest}`) % 210);
  const h = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const durationISO = `PT${h}H${mm > 0 ? mm + "M" : ""}`;

  const outbound = mockSegment(origin, dest, `${date}T08:30:00`, carrierCode, flightNumber, durationISO, "1", "2");
  const itineraries = [{ duration: durationISO, segments: [outbound] }];

  if (returnDate) {
    const ret = mockSegment(dest, origin, `${returnDate}T19:00:00`, carrierCode, flightNumber + 1, durationISO, "2", "1");
    itineraries.push({ duration: durationISO, segments: [ret] });
  }

  const priceStr = price.toFixed(2);
  return {
    id: `mock-${seed}-${returnDate || "ow"}`,
    source: "MOCK",
    instantTicketingRequired: false,
    nonHomogeneous: false,
    oneWay: !returnDate,
    lastTicketingDate: "2026-12-31",
    numberOfBookableSeats: 3 + (hash(seed) % 7),
    itineraries,
    price: {
      currency: "EUR",
      total: priceStr,
      base: (price * 0.7).toFixed(2),
      fees: [{ amount: "0.00", type: "SUPPLIER" }],
      grandTotal: priceStr,
    },
    validatingAirlineCodes: [carrierCode],
    travelerPricings: [{
      travelerId: "1",
      fareOption: "STANDARD",
      travelerType: "ADULT",
      price: { currency: "EUR", total: priceStr, base: (price * 0.7).toFixed(2) },
      fareDetailsBySegment: itineraries.flatMap((it, idx) =>
        it.segments.map((_, sIdx) => ({
          segmentId: String(idx * 10 + sIdx + 1),
          cabin: "ECONOMY",
          fareBasis: "MOCKFARE",
          class: "Y",
          includedCheckedBags: { quantity: 0 },
        }))
      ),
    }],
  };
}

// ─── Public API (mirrors travelpayoutsService) ────────────────────────────

async function getAccessToken() {
  return "MOCK_TOKEN";
}

async function searchFlightOffer(origin, destination, departureDate, options = {}) {
  await sleep(MOCK_DELAY_MS);
  if (!origin || !destination || !departureDate) {
    throw new Error("origin, destination y departureDate son obligatorios.");
  }
  const price = mockPrice(origin, destination, departureDate);
  const offer = mockOffer(origin, destination, departureDate, options.returnDate, price);
  return { data: [offer], meta: { count: 1, source: "MOCK" } };
}

async function getCheapestPrice(origin, destination, departureDate, options = {}) {
  if (origin === destination) return null;
  await sleep(MOCK_DELAY_MS);
  return mockPrice(origin, destination, departureDate);
}

async function getCheapestOffer(origin, destination, departureDate, options = {}) {
  if (origin === destination) return null;
  await sleep(MOCK_DELAY_MS);
  const price = mockPrice(origin, destination, departureDate);
  const offer = mockOffer(origin, destination, departureDate, options.returnDate, price);
  return { price, offer };
}

async function priceFlightOffer(offer) {
  if (!offer) return null;
  await sleep(MOCK_DELAY_MS);

  // Deterministic outcome per offer id so behaviour is reproducible.
  const r = rand(offer.id || "");
  if (r > MOCK_VERIFY_SUCCESS_RATE) return null; // simulate pricing failure

  const original = Number.parseFloat(offer.price?.grandTotal);
  if (!Number.isFinite(original)) return null;

  // Re-price: sometimes slightly different to exercise the "changed" badge.
  const changeR = rand((offer.id || "") + "delta");
  let newPrice = original;
  if (changeR < MOCK_VERIFY_CHANGE_RATE) {
    const sign  = changeR < MOCK_VERIFY_CHANGE_RATE / 2 ? -1 : 1;
    const delta = 0.03 + rand((offer.id || "") + "amt") * 0.05; // 3-8%
    newPrice = Math.max(35, Math.round(original * (1 + sign * delta)));
  }

  const updated = {
    ...offer,
    price: { ...offer.price, total: newPrice.toFixed(2), grandTotal: newPrice.toFixed(2) },
  };
  return { price: newPrice, offer: updated };
}

async function healthCheck() {
  return {
    status: "healthy",
    credentials_valid: true,
    env: "mock",
    cache_size: 0,
    cache_max: 0,
    mock: true,
  };
}

// Mock has no real quota — report unlimited budget so the route gate never trips.
function budgetStatus() {
  return { month: new Date().toISOString().slice(0, 7), used: 0, budget: 0, remaining: Infinity, unlimited: true };
}

module.exports = {
  getAccessToken,
  searchFlightOffer,
  getCheapestPrice,
  getCheapestOffer,
  priceFlightOffer,
  healthCheck,
  budgetStatus,
};
