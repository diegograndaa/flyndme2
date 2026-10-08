// Quitar un viajero del grupo por índice es frágil si la lista ha cambiado
// entretanto: con ?origin=/?name= el servidor comprueba que el índice sigue
// siendo esa persona. Sin red: servidor en USE_MOCK con store en memoria.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5080;
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

async function newGroup() {
  const r = await fetch(`${BASE}/api/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ departureDate: dep, members: [{ origin: "MAD", name: "Ana" }, { origin: "BCN", name: "Luis" }] }),
  });
  return (await r.json()).id;
}
const del = (id, i, q = "") => fetch(`${BASE}/api/groups/${id}/members/${i}${q}`, { method: "DELETE" });
const roster = async (id) => (await (await fetch(`${BASE}/api/groups/${id}?refresh=1`)).json()).members.map((m) => m.origin);

test("DELETE con origin que ya no coincide → 409 MEMBER_CHANGED y no borra a nadie", async () => {
  const id = await newGroup();
  const r = await del(id, 0, "?origin=BCN&name=Luis");
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.code, "MEMBER_CHANGED");
  assert.deepEqual(body.group.members.map((m) => m.origin), ["MAD", "BCN"]);
  assert.deepEqual(await roster(id), ["MAD", "BCN"]);
});

test("DELETE con nombre distinto → 409", async () => {
  const id = await newGroup();
  const r = await del(id, 0, "?origin=MAD&name=Otra");
  assert.equal(r.status, 409);
  assert.deepEqual(await roster(id), ["MAD", "BCN"]);
});

test("DELETE con origin y nombre que coinciden → quita a esa persona", async () => {
  const id = await newGroup();
  const r = await del(id, 1, "?origin=BCN&name=Luis");
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).members.map((m) => m.origin), ["MAD"]);
});

test("DELETE sin comprobación (clientes antiguos) sigue funcionando", async () => {
  const id = await newGroup();
  const r = await del(id, 0);
  assert.equal(r.status, 200);
  assert.deepEqual(await roster(id), ["BCN"]);
});

test("DELETE con índice fuera de rango → 400", async () => {
  const id = await newGroup();
  const r = await del(id, 5, "?origin=MAD");
  assert.equal(r.status, 400);
});
