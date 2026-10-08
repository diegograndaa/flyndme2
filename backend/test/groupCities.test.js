// Un grupo no puede salir desde más ciudades distintas de las que acepta la
// búsqueda (8), aunque admita 9 entradas (dos amigos de la misma ciudad son
// dos entradas). Sin red: servidor en USE_MOCK.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5078;
const BASE = `http://localhost:${PORT}`;
const dep = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
const EIGHT = ["MAD", "BCN", "LON", "BER", "PAR", "ROM", "LIS", "AMS"];

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

const post = async (p, body) => {
  const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test("crear con 9 ciudades distintas → 400 GROUP_TOO_MANY_CITIES", async () => {
  const r = await post("/api/groups", { departureDate: dep, members: [...EIGHT, "DUB"].map((origin) => ({ origin })) });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "GROUP_TOO_MANY_CITIES");
});

test("con 8 ciudades: otra ciudad nueva → 409; alguien de una ciudad ya presente → 200", async () => {
  const created = await post("/api/groups", { departureDate: dep, members: EIGHT.map((origin) => ({ origin })) });
  assert.equal(created.status, 200);
  const id = created.body.id;

  const nueva = await post(`/api/groups/${id}/members`, { origin: "DUB" });
  assert.equal(nueva.status, 409);
  assert.equal(nueva.body.code, "GROUP_TOO_MANY_CITIES");

  const repetida = await post(`/api/groups/${id}/members`, { origin: " mad " });
  assert.equal(repetida.status, 200);
  assert.equal(repetida.body.members.length, 9);

  const llena = await post(`/api/groups/${id}/members`, { origin: "MAD" });
  assert.equal(llena.status, 409);
  assert.equal(llena.body.code, "GROUP_FULL");
});
