// Contrato de saneado de origins/passengers en /multi-origin (servidor mock
// propio). El formulario ya limita a 9 por ciudad; esto fija lo que pasa si
// alguien llama a la API con valores raros. Fechas relativas a hoy.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5087;
const BASE = `http://localhost:${PORT}`;
const dep = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
let server;

before(async () => {
  server = spawn("node", [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test", MOCK_DELAY_MS: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/ping`)).ok) return; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("backend no arrancó");
});
after(() => { if (server && server.exitCode === null) server.kill("SIGKILL"); });

async function search(extra) {
  const r = await fetch(`${BASE}/api/flights/multi-origin`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ departureDate: dep, tripType: "oneway", destinations: ["PAR"], ...extra }),
  });
  return { status: r.status, body: await r.json() };
}
const paxOf = (b) => Object.fromEntries(b.bestDestination.flights.map((f) => [f.origin, f.passengers]));

test("passengers: 0, negativos o no numéricos → 1 por ciudad", async () => {
  for (const v of [0, -2, "abc", null]) {
    const r = await search({ origins: ["MAD"], passengers: [v] });
    assert.equal(r.status, 200, String(v));
    assert.deepEqual(paxOf(r.body), { MAD: 1 }, String(v));
  }
});

test("passengers: más de 9 por ciudad se recorta a 9; decimales se truncan; '3' vale 3", async () => {
  assert.deepEqual(paxOf((await search({ origins: ["MAD"], passengers: [10] })).body), { MAD: 9 });
  assert.deepEqual(paxOf((await search({ origins: ["MAD"], passengers: [2.7] })).body), { MAD: 2 });
  assert.deepEqual(paxOf((await search({ origins: ["MAD"], passengers: ["3"] })).body), { MAD: 3 });
});

test("passengers más corto que origins: las ciudades sin dato cuentan 1", async () => {
  const r = await search({ origins: ["MAD", "LON"], passengers: [2] });
  assert.deepEqual(paxOf(r.body), { MAD: 2, LON: 1 });
  assert.equal(r.body.bestDestination.totalPassengers, 3);
});

test("origins: minúsculas y espacios se normalizan; nulos se ignoran; no-array → MISSING_ORIGINS", async () => {
  assert.deepEqual(paxOf((await search({ origins: ["mad", " lon "] })).body), { MAD: 1, LON: 1 });
  assert.deepEqual(paxOf((await search({ origins: [null, "MAD"] })).body), { MAD: 1 });
  const notArray = await search({ origins: "MAD" });
  assert.equal(notArray.status, 400);
  assert.equal(notArray.body.code, "MISSING_ORIGINS");
  const paxNotArray = await search({ origins: ["MAD"], passengers: "2" });
  assert.equal(paxNotArray.body.code, "INVALID_PASSENGERS");
});

test("el total del grupo siempre es Σ precio × pasajeros con los pasajeros ya saneados", async () => {
  const r = await search({ origins: ["MAD", "LON", "BER"], passengers: [12, -1, "2"] });
  const w = r.body.bestDestination;
  const calc = w.flights.reduce((s, f) => s + f.price * f.passengers, 0);
  assert.ok(Math.abs(w.totalCostEUR - calc) < 0.5);
  assert.deepEqual(paxOf(r.body), { MAD: 9, LON: 1, BER: 2 });
});
