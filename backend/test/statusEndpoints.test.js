// Endpoints de estado (/, /api/ping, /api/version, /api/health,
// /api/flights/budget, 404): forma de la respuesta y que NUNCA devuelvan
// secretos aunque estén en el entorno. Sin red: servidor en USE_MOCK y estos
// endpoints no llaman a ningún proveedor.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5082;
const BASE = `http://localhost:${PORT}`;
const SECRETS = {
  TRAVELPAYOUTS_TOKEN: "tp-secret-should-not-leak-123",
  TRAVELPAYOUTS_MARKER: "999999",
  SERPAPI_KEY: "serp-secret-should-not-leak-456",
};

let server;

before(async () => {
  const env = { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test", ...SECRETS };
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

async function get(p) {
  const r = await fetch(`${BASE}${p}`);
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) };
}

function assertNoSecrets(text, where) {
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!text.includes(value), `${where} filtra ${name}`);
  }
}

test("GET / → estado del servicio sin secretos", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.mock, true);
  assertNoSecrets(r.text, "/");
});

test("GET /api/ping → pong con marca de tiempo", async () => {
  const r = await get("/api/ping");
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "pong");
  assert.equal(typeof r.body.timestamp, "number");
});

test("GET /api/version → huella del despliegue sin secretos", async () => {
  const r = await get("/api/version");
  assert.equal(r.status, 200);
  for (const k of ["commit", "commitShort", "node", "node_env", "provider", "mock", "startedAt", "uptime_s"]) {
    assert.ok(k in r.body, `falta ${k}`);
  }
  assert.equal(typeof r.body.uptime_s, "number");
  assertNoSecrets(r.text, "/api/version");
});

test("GET /api/health → stores en memoria sin Upstash y métricas del loop", async () => {
  const r = await get("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "healthy");
  assert.deepEqual(r.body.stores, { share: "memory", group: "memory" });
  assert.equal(typeof r.body.metrics, "object");
  assert.equal(typeof r.body.memory.rss, "number");
  assertNoSecrets(r.text, "/api/health");
});

test("GET /api/flights/budget → cupos sin la clave de SerpAPI ni el token", async () => {
  const r = await get("/api/flights/budget");
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.serpapi, "object");
  assert.equal(r.body.serpapi.enabled, true);
  assert.equal(typeof r.body.serpapi.used, "number");
  assertNoSecrets(r.text, "/api/flights/budget");
});

test("ruta inexistente → 404 en JSON", async () => {
  const r = await get("/api/no-existe");
  assert.equal(r.status, 404);
  assert.equal(typeof r.body.message, "string");
});
