// El límite de búsquedas (60 / 10 min por IP en /api/flights) responde con un
// code traducible. Servidor mock propio para no gastar el cupo de otros tests.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5088;
const BASE = `http://localhost:${PORT}`;
let server;

before(async () => {
  server = spawn("node", [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test" },
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

test("rate limit de /api/flights: 60 pasan y la 61 da 429 con code RATE_LIMITED", async () => {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${BASE}/api/flights/budget`);
    assert.equal(r.status, 200, `petición ${i + 1}`);
  }
  const over = await fetch(`${BASE}/api/flights/budget`);
  assert.equal(over.status, 429);
  const body = await over.json();
  assert.equal(body.code, "RATE_LIMITED");
  assert.ok(body.message);
});

test("el límite de búsquedas no afecta a /api/ping ni a /api/health", async () => {
  assert.equal((await fetch(`${BASE}/api/ping`)).status, 200);
  assert.equal((await fetch(`${BASE}/api/health`)).status, 200);
});
