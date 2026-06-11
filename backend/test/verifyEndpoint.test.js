// Tests del endpoint POST /api/flights/verify (capa 2, SerpAPI Google Flights).
// Sin red: app Express en proceso + transporte SerpAPI inyectado vía
// serpapiService.__test.setTransport (mismo módulo que usa el router).
//
//   cd backend && node --test          (o npm test)

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

// Antes de los require: proveedor mock (el router lo carga aunque /verify no
// lo use), clave SerpAPI de test y timeout corto para el test de timeout.
process.env.USE_MOCK = "true";
process.env.SERPAPI_KEY = "test-key";
process.env.SERPAPI_VERIFY_TIMEOUT_MS = "300";

const serpapi = require("../services/serpapiService");
const flightsRouter = require("../routes/flights");

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/flights", flightsRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => serpapi.__test.reset());

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function postVerify(body) {
  const r = await fetch(`${base}/api/flights/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

function futureDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}
const DEP = futureDate(60);
const RET = futureDate(67);

// Transport SerpAPI: precio por origen (departure_id). Origen sin entrada en
// `prices` → respuesta sin vuelos (tramo no verificable).
function setSerpTransport({ left = 200, prices = {} } = {}) {
  const calls = { account: 0, search: 0 };
  serpapi.__test.setTransport(async (url, config) => {
    if (url.includes("/account")) {
      calls.account++;
      return { data: { plan_searches_left: left } };
    }
    calls.search++;
    const p = prices[config.params.departure_id];
    if (p === undefined) return { data: {} }; // sin vuelos
    return { data: { best_flights: [{ price: p }], other_flights: [] } };
  });
  return calls;
}

// ─── Validación ──────────────────────────────────────────────────────────────
// Nota: cada test que llega a verificar usa un destino DISTINTO para no
// chocar con la caché de respuesta del endpoint (TTL 30 min, no se resetea).

test("validación: payloads inválidos → 400 con código, sin tocar la red", async () => {
  serpapi.__test.setTransport(() => { throw new Error("la validación no debe llegar a la red"); });
  const leg = { origin: "MAD", price: 100, passengers: 1, departureDate: DEP };
  const cases = [
    [{ totalCostEUR: 100, legs: [leg] },                                          "INVALID_DESTINATION"],
    [{ destination: "ROMA", totalCostEUR: 100, legs: [leg] },                     "INVALID_DESTINATION"],
    [{ destination: "ROM", legs: [leg] },                                         "INVALID_TOTAL_COST"],
    [{ destination: "ROM", totalCostEUR: -5, legs: [leg] },                       "INVALID_TOTAL_COST"],
    [{ destination: "ROM", totalCostEUR: 100 },                                   "MISSING_LEGS"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [] },                         "MISSING_LEGS"],
    [{ destination: "ROM", totalCostEUR: 100, legs: Array(9).fill(leg) },         "TOO_MANY_LEGS"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, origin: "M" }] },  "INVALID_LEG"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, price: 0 }] },     "INVALID_LEG"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, price: "x" }] },   "INVALID_LEG"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, passengers: 0 }] }, "INVALID_LEG"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, passengers: 10 }] }, "INVALID_LEG"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, departureDate: "2020-01-01" }] }, "INVALID_LEG"],
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, departureDate: "no" }] },         "INVALID_LEG"],
    // vuelta anterior a la ida
    [{ destination: "ROM", totalCostEUR: 100, legs: [{ ...leg, returnDate: futureDate(50) }] },  "INVALID_LEG"],
  ];
  for (const [payload, code] of cases) {
    const r = await postVerify(payload);
    assert.equal(r.status, 400, `${code}: esperaba 400, llegó ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, code);
  }
});

// ─── Skipped (deshabilitado / sin presupuesto) ───────────────────────────────

test("sin SERPAPI_KEY → 200 skipped sin tocar la red", async () => {
  serpapi.__test.setTransport(() => { throw new Error("no debe llamar a la red"); });
  const saved = process.env.SERPAPI_KEY;
  delete process.env.SERPAPI_KEY;
  try {
    const r = await postVerify({
      destination: "ROM",
      totalCostEUR: 100,
      legs: [{ origin: "MAD", price: 100, passengers: 1, departureDate: DEP }],
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.verificationStatus, "skipped");
    assert.equal(r.body.destination, "ROM");
  } finally {
    process.env.SERPAPI_KEY = saved;
  }
});

test("sin presupuesto SerpAPI → 200 skipped sin quemar cupo", async () => {
  const calls = setSerpTransport({ left: 3, prices: { MAD: 100 } });
  const r = await postVerify({
    destination: "PAR",
    totalCostEUR: 100,
    legs: [{ origin: "MAD", price: 100, passengers: 1, departureDate: DEP }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.verificationStatus, "skipped");
  assert.equal(calls.search, 0);
});

// ─── Flujos verified / changed / partial / failed ────────────────────────────

test("flujo verified: agregados y priceChangePct correctos", async () => {
  // cached: MAD 120.5×2 + BCN 80×1 = 321 — google: 122×2 + 81×1 = 325 → +1.2% < 5% → verified
  setSerpTransport({ prices: { MAD: 122, BCN: 81 } });
  const r = await postVerify({
    destination: "ROM",
    totalCostEUR: 321,
    legs: [
      { origin: "MAD", price: 120.5, passengers: 2, departureDate: DEP, returnDate: RET, nonStop: false, dateFallback: false },
      { origin: "BCN", price: 80,    passengers: 1, departureDate: DEP, returnDate: RET, nonStop: false, dateFallback: true },
    ],
  });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.destination, "ROM");
  assert.equal(b.verificationStatus, "verified");
  assert.equal(b.verificationSource, "google_flights");
  assert.ok(!isNaN(new Date(b.verifiedAt).getTime()), "verifiedAt parseable");
  assert.deepEqual(b.flights, [
    { origin: "MAD", verifiedPrice: 122, totalForOrigin: 244 },
    { origin: "BCN", verifiedPrice: 81,  totalForOrigin: 81 },
  ]);
  assert.equal(b.verifiedTotalCostEUR, 325);
  assert.equal(b.verifiedAveragePerTraveler, Number((325 / 3).toFixed(2)));
  assert.equal(b.verifiedPriceSpread, 41); // per-persona: 122 - 81
  assert.equal(b.priceChangePct, 1.2);     // (325-321)/321 → 1.246 → 1.2
  // fairness per-persona: avg (122+81)/2 = 101.5 → 100 - 41/101.5*100
  assert.equal(b.verifiedFairnessScore, Number((100 - (41 / 101.5) * 100).toFixed(1)));
});

test("flujo changed: desviación ≥ 5%", async () => {
  setSerpTransport({ prices: { MAD: 150 } });
  const r = await postVerify({
    destination: "LIS",
    totalCostEUR: 100,
    legs: [{ origin: "MAD", price: 100, passengers: 1, departureDate: DEP }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.verificationStatus, "changed");
  assert.equal(r.body.priceChangePct, 50);
  assert.equal(r.body.verifiedTotalCostEUR, 150);
});

test("flujo partial: tramo sin datos mantiene el precio cacheado, nunca inventa", async () => {
  setSerpTransport({ prices: { MAD: 110 } }); // BER sin datos → null
  const r = await postVerify({
    destination: "AMS",
    totalCostEUR: 200,
    legs: [
      { origin: "MAD", price: 100, passengers: 1, departureDate: DEP },
      { origin: "BER", price: 100, passengers: 1, departureDate: DEP },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.verificationStatus, "partial");
  assert.deepEqual(r.body.flights[0], { origin: "MAD", verifiedPrice: 110, totalForOrigin: 110 });
  assert.deepEqual(r.body.flights[1], { origin: "BER", verifiedPrice: null, totalForOrigin: 100 });
  assert.equal(r.body.verifiedTotalCostEUR, 210);
});

test("flujo failed: ningún tramo verificable", async () => {
  setSerpTransport({ prices: {} });
  const r = await postVerify({
    destination: "VIE",
    totalCostEUR: 100,
    legs: [{ origin: "MAD", price: 100, passengers: 1, departureDate: DEP }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.verificationStatus, "failed");
  assert.equal(r.body.priceChangePct, 0);
  assert.equal(r.body.verifiedTotalCostEUR, 100);
});

// ─── Timeout global ──────────────────────────────────────────────────────────

test("timeout global → verificationStatus timeout (SERPAPI_VERIFY_TIMEOUT_MS=300)", async () => {
  serpapi.__test.setTransport(async (url) => {
    if (url.includes("/account")) return { data: { plan_searches_left: 200 } };
    await new Promise((r) => setTimeout(r, 2000)); // más que el timeout del endpoint
    return { data: {} };
  });
  const r = await postVerify({
    destination: "BUD",
    totalCostEUR: 100,
    legs: [{ origin: "MAD", price: 100, passengers: 1, departureDate: DEP }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.verificationStatus, "timeout");
});

// ─── Caché de respuesta del endpoint ─────────────────────────────────────────

test("caché del endpoint: repetir el mismo payload no quema cupo", async () => {
  const calls = setSerpTransport({ prices: { MAD: 100 } });
  const payload = {
    destination: "PRG",
    totalCostEUR: 100,
    legs: [{ origin: "MAD", price: 100, passengers: 1, departureDate: DEP }],
  };
  const r1 = await postVerify(payload);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.verificationStatus, "verified");
  const searchesAfterFirst = calls.search;

  const r2 = await postVerify(payload);
  assert.equal(calls.search, searchesAfterFirst, "la repetición debe servirse de la caché de respuesta");
  assert.deepEqual(r2.body, r1.body);
});
