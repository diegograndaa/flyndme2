// Topes de los endpoints de segundo plano (/cheaper-date y /trip-length-hint):
// cada origen/destino es una consulta al proveedor, así que deben rechazar
// peticiones que /multi-origin ya rechazaría. Sin red: servidor en USE_MOCK.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5083;
const BASE = `http://localhost:${PORT}`;
const DAY_MS = 86_400_000;
const futureDate = (d) => new Date(Date.now() + d * DAY_MS).toISOString().slice(0, 10);

let server;

before(async () => {
  server = spawn("node", [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr?.on("data", (d) => process.stderr.write(`[server-err] ${d}`));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/ping`)).ok) return; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("backend no arrancó");
});

after(() => { server?.kill(); });

async function post(p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const NINE = ["MAD", "BCN", "LON", "BER", "PAR", "ROM", "LIS", "AMS", "DUB"];

const cheaper = (over = {}) => ({
  origins: ["MAD", "BCN"],
  passengers: [1, 1],
  destination: "ROM",
  departureDate: futureDate(40),
  tripType: "oneway",
  currentTotalEUR: 300,
  ...over,
});

test("cheaper-date: más de 8 orígenes → 400 INVALID_ORIGINS", async () => {
  const r = await post("/api/flights/cheaper-date", cheaper({ origins: NINE, passengers: NINE.map(() => 1), destination: "VIE" }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_ORIGINS");
});

test("cheaper-date: un origen repetido es un solo origen con sus pasajeros sumados", async () => {
  const five = Array.from({ length: 5 }, () => "MAD");
  const ok = await post("/api/flights/cheaper-date", cheaper({ origins: five, passengers: five.map(() => 1) }));
  assert.equal(ok.status, 200);
  const twenty = Array.from({ length: 20 }, () => "MAD");
  const tooMany = await post("/api/flights/cheaper-date", cheaper({ origins: twenty, passengers: twenty.map(() => 1) }));
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.code, "TOO_MANY_PASSENGERS");
});

test("cheaper-date: destino igual a un origen → 400", async () => {
  const r = await post("/api/flights/cheaper-date", cheaper({ destination: "MAD" }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_ORIGINS");
});

test("cheaper-date: más de 16 pasajeros en total → 400 TOO_MANY_PASSENGERS", async () => {
  const r = await post("/api/flights/cheaper-date", cheaper({ passengers: [9, 9] }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "TOO_MANY_PASSENGERS");
});

test("cheaper-date: passengers que no es array → 400 INVALID_PASSENGERS", async () => {
  const r = await post("/api/flights/cheaper-date", cheaper({ passengers: "9" }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_PASSENGERS");
});

test("cheaper-date: petición válida sigue respondiendo 200", async () => {
  const r = await post("/api/flights/cheaper-date", cheaper());
  assert.equal(r.status, 200);
  assert.ok("betterDate" in r.body);
});

const hint = (over = {}) => ({
  origins: ["MAD", "BCN"],
  passengers: [1, 1],
  departureDate: futureDate(40),
  returnDate: futureDate(47),
  ...over,
});

test("trip-length-hint: orígenes × destinos por encima del tope → 400 TOO_MANY_COMBINATIONS", async () => {
  // 8 orígenes × 151 destinos distintos = 1208 > 1200
  const codes = [];
  for (let a = 0; a < 26 && codes.length < 151; a++) {
    for (let b = 0; b < 26 && codes.length < 151; b++) {
      codes.push(`Q${String.fromCharCode(65 + a)}${String.fromCharCode(65 + b)}`);
    }
  }
  const origins = NINE.slice(0, 8);
  const r = await post("/api/flights/trip-length-hint", hint({ origins, passengers: origins.map(() => 1), destinations: codes }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "TOO_MANY_COMBINATIONS");
});

test("trip-length-hint: destinos repetidos no cuentan para el tope", async () => {
  const dests = Array.from({ length: 300 }, () => "ROM");
  const r = await post("/api/flights/trip-length-hint", hint({ destinations: dests }));
  assert.equal(r.status, 200);
  assert.ok("suggestion" in r.body);
});
