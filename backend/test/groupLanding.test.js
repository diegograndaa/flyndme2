// El contador group_landing mide visitas reales a un ?group=: los refrescos de
// quien ya tiene la vista abierta (?refresh=1) no deben sumar. Sin red:
// servidor en USE_MOCK con stores y contadores en memoria.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5081;
const BASE = `http://localhost:${PORT}`;
const dep = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

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

const landings = async () => (await (await fetch(`${BASE}/api/health`)).json()).metrics.group_landing || 0;

test("GET /api/groups/:id cuenta una visita; con ?refresh=1 no", async () => {
  const created = await (await fetch(`${BASE}/api/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ departureDate: dep, members: [{ origin: "MAD" }] }),
  })).json();
  assert.ok(created.id);

  const before0 = await landings();
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BASE}/api/groups/${created.id}?refresh=1`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).id, created.id);
  }
  assert.equal(await landings(), before0, "los refrescos no suman");

  const r = await fetch(`${BASE}/api/groups/${created.id}`);
  assert.equal(r.status, 200);
  assert.equal(await landings(), before0 + 1, "la visita sí suma");
});
