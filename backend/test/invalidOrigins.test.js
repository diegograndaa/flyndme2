// Un origen inválido junto a otros válidos no se puede ignorar en silencio: la
// búsqueda saldría sin ese viajero y parecería del grupo entero. Sin red.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5077;
const BASE = `http://localhost:${PORT}`;
const dep = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);

let server;

before(async () => {
  const env = { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test" };
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

const search = async (origins) => {
  const r = await fetch(`${BASE}/api/flights/multi-origin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origins, departureDate: dep, tripType: "oneway" }),
  });
  return { status: r.status, body: await r.json() };
};

test("un origen inválido junto a uno válido → 400 INVALID_ORIGINS con la lista", async () => {
  const r = await search(["MADRID", "LON"]);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_ORIGINS");
  assert.deepEqual(r.body.invalid, ["MADRID"]);
});

test("huecos vacíos se ignoran (no son orígenes)", async () => {
  const r = await search(["", "MAD", "  ", "LON"]);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.flights));
});

test("todos inválidos → 400 INVALID_ORIGINS", async () => {
  const r = await search(["WRONG", "X1Y"]);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_ORIGINS");
});
