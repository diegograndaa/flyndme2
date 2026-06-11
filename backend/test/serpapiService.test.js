// Unit tests de serpapiService (verificador SerpAPI Google Flights, capa 2).
// Sin red: el transporte HTTP se sustituye por un stub vía __test.setTransport.
//
//   cd backend && node --test          (o npm test)

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// Antes del require: clave de test y presupuesto pequeño para poder ejercitar
// el quota guard local sin simular 250 llamadas.
process.env.SERPAPI_KEY = "test-key";
process.env.SERPAPI_MONTHLY_BUDGET = "12";

const serpapi = require("../services/serpapiService");
const { setTransport, reset, buildSearchParams, makeVerifyKey, minFlightPrice } = serpapi.__test;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flightsBody({ best = [], other = [] } = {}) {
  return {
    best_flights:  best.map((price) => ({ price })),
    other_flights: other.map((price) => ({ price })),
  };
}

// Transport de prueba: /account responde con `left` búsquedas restantes y
// /search.json con `body`. Cuenta las llamadas por endpoint en `calls`.
function fakeTransport({ left = 200, body = flightsBody({ best: [100] }) } = {}) {
  const calls = { account: 0, search: 0 };
  const fn = async (url, _config) => {
    if (url.includes("/account")) {
      calls.account++;
      return { data: { plan_searches_left: left, total_searches_left: left } };
    }
    calls.search++;
    return { data: body };
  };
  return { fn, calls };
}

const LEG = { origin: "MAD", destination: "ROM", departureDate: "2026-08-10" };

beforeEach(() => reset());

// ─── isEnabled / deshabilitado ───────────────────────────────────────────────

test("isEnabled: depende de SERPAPI_KEY (lectura dinámica)", () => {
  assert.equal(serpapi.isEnabled(), true);
  const saved = process.env.SERPAPI_KEY;
  delete process.env.SERPAPI_KEY;
  try {
    assert.equal(serpapi.isEnabled(), false);
  } finally {
    process.env.SERPAPI_KEY = saved;
  }
});

test("verifyLeg: sin SERPAPI_KEY → null sin llamar a la red", async () => {
  setTransport(() => { throw new Error("no debería llamar a la red"); });
  const saved = process.env.SERPAPI_KEY;
  delete process.env.SERPAPI_KEY;
  try {
    assert.equal(await serpapi.verifyLeg(LEG), null);
  } finally {
    process.env.SERPAPI_KEY = saved;
  }
});

// ─── buildSearchParams / minFlightPrice ──────────────────────────────────────

test("buildSearchParams: oneway, roundtrip y nonStop", () => {
  const ow = buildSearchParams(LEG);
  assert.equal(ow.engine, "google_flights");
  assert.equal(ow.departure_id, "MAD");
  assert.equal(ow.arrival_id, "ROM");
  assert.equal(ow.outbound_date, "2026-08-10");
  assert.equal(ow.type, "2");
  assert.equal(ow.currency, "EUR");
  assert.equal(ow.api_key, "test-key");
  assert.equal(ow.return_date, undefined);
  assert.equal(ow.stops, undefined);

  const rt = buildSearchParams({ ...LEG, returnDate: "2026-08-14", nonStop: true });
  assert.equal(rt.type, "1");
  assert.equal(rt.return_date, "2026-08-14");
  assert.equal(rt.stops, "1");
});

test("minFlightPrice: mínimo entre best y other; ignora precios inválidos", () => {
  assert.equal(minFlightPrice(flightsBody({ best: [131, 150], other: [125, 140] })), 125);
  assert.equal(minFlightPrice({}), null);
  assert.equal(minFlightPrice({ best_flights: [{ price: "n/a" }], other_flights: [{ price: 0 }] }), null);
  assert.equal(minFlightPrice({ other_flights: [{ price: 99 }] }), 99);
});

test("makeVerifyKey: distingue destino, fechas, vuelta y nonStop", () => {
  const a = makeVerifyKey(LEG);
  assert.notEqual(a, makeVerifyKey({ ...LEG, destination: "PAR" }));
  assert.notEqual(a, makeVerifyKey({ ...LEG, departureDate: "2026-08-11" }));
  assert.notEqual(a, makeVerifyKey({ ...LEG, returnDate: "2026-08-14" }));
  assert.notEqual(a, makeVerifyKey({ ...LEG, nonStop: true }));
});

// ─── Mapeo de respuesta ──────────────────────────────────────────────────────

test("verifyLeg: precio verificado = mínimo de best_flights y other_flights", async () => {
  const t = fakeTransport({ body: flightsBody({ best: [131, 150], other: [125, 140] }) });
  setTransport(t.fn);
  const r = await serpapi.verifyLeg(LEG);
  assert.deepEqual(r, { price: 125, currency: "EUR" });
  assert.equal(t.calls.search, 1);
});

test("verifyLeg: respuesta sin vuelos → null, y se cachea (no re-quema cupo)", async () => {
  const t = fakeTransport({ body: { error: "Google Flights hasn't returned any results." } });
  setTransport(t.fn);
  assert.equal(await serpapi.verifyLeg(LEG), null);
  assert.equal(t.calls.search, 1);
  assert.equal(await serpapi.verifyLeg(LEG), null);
  assert.equal(t.calls.search, 1, "el 'sin vuelos' debe servirse de la caché");
  assert.equal(serpapi.budgetStatus().used, 1);
});

// ─── Caché de verificaciones ─────────────────────────────────────────────────

test("verifyLeg: la segunda verificación idéntica va a caché", async () => {
  const t = fakeTransport({ body: flightsBody({ best: [88] }) });
  setTransport(t.fn);

  const r1 = await serpapi.verifyLeg(LEG);
  assert.deepEqual(r1, { price: 88, currency: "EUR" });
  assert.equal(t.calls.search, 1);

  const r2 = await serpapi.verifyLeg(LEG);
  assert.deepEqual(r2, { price: 88, currency: "EUR" });
  assert.equal(t.calls.search, 1, "la segunda llamada idéntica no debe ir a la red");

  // Parámetros distintos → nueva llamada real
  await serpapi.verifyLeg({ ...LEG, nonStop: true });
  assert.equal(t.calls.search, 2);
});

// ─── Quota guard ─────────────────────────────────────────────────────────────

test("quota guard: /account con cupo < 10 → no se llama a search", async () => {
  const t = fakeTransport({ left: 5 });
  setTransport(t.fn);
  assert.equal(await serpapi.verifyLeg(LEG), null);
  assert.equal(t.calls.search, 0, "sin margen de cupo no debe quemar búsquedas");
  assert.equal(serpapi.budgetStatus().used, 0);
});

test("quota guard: /account se consulta UNA vez para legs en paralelo", async () => {
  const t = fakeTransport({ body: flightsBody({ best: [100] }) });
  setTransport(t.fn);
  await Promise.all([
    serpapi.verifyLeg({ ...LEG, origin: "MAD" }),
    serpapi.verifyLeg({ ...LEG, origin: "BCN" }),
    serpapi.verifyLeg({ ...LEG, origin: "LIS" }),
  ]);
  assert.equal(t.calls.account, 1, "la consulta a /account debe deduplicarse y cachearse");
  assert.equal(t.calls.search, 3);
});

test("quota guard: /account caído → fallback al contador local (verifica igual)", async () => {
  let searches = 0;
  setTransport(async (url) => {
    if (url.includes("/account")) {
      const e = new Error("account down");
      e.response = { status: 503 };
      throw e;
    }
    searches++;
    return { data: flightsBody({ best: [88] }) };
  });
  const r = await serpapi.verifyLeg(LEG);
  assert.deepEqual(r, { price: 88, currency: "EUR" });
  assert.equal(searches, 1);
});

test("contador mensual: solo cuentan llamadas reales y se respeta el margen", async () => {
  // SERPAPI_MONTHLY_BUDGET=12 (fijado arriba) y margen mínimo de 10.
  const t = fakeTransport({ body: flightsBody({ best: [100] }) });
  setTransport(t.fn);

  await serpapi.verifyLeg({ ...LEG, origin: "MAD" });
  await serpapi.verifyLeg({ ...LEG, origin: "BCN" });
  await serpapi.verifyLeg({ ...LEG, origin: "LIS" });
  assert.equal(serpapi.budgetStatus().used, 3);
  assert.equal(serpapi.budgetStatus().remaining, 9);

  // Hit de caché → no incrementa
  await serpapi.verifyLeg({ ...LEG, origin: "MAD" });
  assert.equal(serpapi.budgetStatus().used, 3);

  // remaining local (9) < margen (10) → bloqueado aunque /account tenga cupo
  assert.equal(await serpapi.verifyLeg({ ...LEG, origin: "OPO" }), null);
  assert.equal(t.calls.search, 3);
  assert.equal(serpapi.budgetStatus().used, 3);
});

test("budgetStatus: shape con mes actual", () => {
  const b = serpapi.budgetStatus();
  assert.equal(b.month, new Date().toISOString().slice(0, 7));
  assert.equal(b.used, 0);
  assert.equal(b.budget, 12);
  assert.equal(b.remaining, 12);
});

// ─── Retries ─────────────────────────────────────────────────────────────────

test("retry: 1 único reintento y solo en 5xx (cada petición real cuenta)", async () => {
  let searches = 0;
  setTransport(async (url) => {
    if (url.includes("/account")) return { data: { plan_searches_left: 200 } };
    searches++;
    if (searches === 1) {
      const e = new Error("boom");
      e.response = { status: 502 };
      throw e;
    }
    return { data: flightsBody({ best: [70] }) };
  });
  const r = await serpapi.verifyLeg(LEG);
  assert.deepEqual(r, { price: 70, currency: "EUR" });
  assert.equal(searches, 2);
  assert.equal(serpapi.budgetStatus().used, 2, "el retry también cuenta contra el cupo");
});

test("retry: en 429 NO se reintenta y el fallo NO se cachea", async () => {
  let searches = 0;
  setTransport(async (url) => {
    if (url.includes("/account")) return { data: { plan_searches_left: 200 } };
    searches++;
    const e = new Error("rate limited");
    e.response = { status: 429 };
    throw e;
  });
  assert.equal(await serpapi.verifyLeg(LEG), null);
  assert.equal(searches, 1, "sin retry en 429");
  // El fallo no se cachea → el siguiente intento vuelve a probar
  assert.equal(await serpapi.verifyLeg(LEG), null);
  assert.equal(searches, 2);
});
