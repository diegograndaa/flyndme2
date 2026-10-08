// Fechas de un grupo nuevo: las mismas reglas que la búsqueda, para no crear
// enlaces cuya búsqueda luego fallaría. Sin red: servidor en USE_MOCK.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5079;
const BASE = `http://localhost:${PORT}`;
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let server;

before(async () => {
  const env = { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test", GROUP_CREATE_LIMIT: "100" };
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  server = spawn("node", [path.join(__dirname, "..", "index.js")], { env, stdio: ["ignore", "ignore", "pipe"] });
  server.stderr?.on("data", (d) => process.stderr.write(`[server-err] ${d}`));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/ping`)).ok) return; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("backend no arrancó");
});

after(() => { server?.kill(); });

async function create(body) {
  const r = await fetch(`${BASE}/api/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("ida válida → 200", async () => {
  const r = await create({ departureDate: day(30), tripType: "oneway" });
  assert.equal(r.status, 200);
});

test("formato inválido → INVALID_DATE (como antes)", async () => {
  const r = await create({ departureDate: "12/11/2026" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_DATE");
});

test("fecha que no existe (30 de febrero) → INVALID_DEPARTURE_DATE", async () => {
  const r = await create({ departureDate: "2027-02-30" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_DEPARTURE_DATE");
});

test("salida pasada → DEPARTURE_DATE_IN_PAST", async () => {
  const r = await create({ departureDate: day(-1) });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "DEPARTURE_DATE_IN_PAST");
});

test("salida a más de 360 días → DATE_TOO_FAR", async () => {
  const r = await create({ departureDate: day(365) });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "DATE_TOO_FAR");
});

test("ida y vuelta: sin vuelta, vuelta igual o anterior, o vuelta fuera de horizonte → 400", async () => {
  assert.equal((await create({ departureDate: day(30), tripType: "roundtrip" })).body.code, "INVALID_RETURN_DATE");
  assert.equal((await create({ departureDate: day(30), returnDate: day(30), tripType: "roundtrip" })).body.code, "INVALID_RETURN_DATE_ORDER");
  assert.equal((await create({ departureDate: day(30), returnDate: day(20), tripType: "roundtrip" })).body.code, "INVALID_RETURN_DATE_ORDER");
  assert.equal((await create({ departureDate: day(355), returnDate: day(370), tripType: "roundtrip" })).body.code, "DATE_TOO_FAR");
});

test("ida y vuelta válida → 200 y guarda la vuelta", async () => {
  const r = await create({ departureDate: day(30), returnDate: day(34), tripType: "roundtrip" });
  assert.equal(r.status, 200);
  const g = await (await fetch(`${BASE}/api/groups/${r.body.id}`)).json();
  assert.equal(g.returnDate, day(34));
});

test("returnDate en un viaje de ida se ignora", async () => {
  const r = await create({ departureDate: day(30), returnDate: "basura", tripType: "oneway" });
  assert.equal(r.status, 200);
});
