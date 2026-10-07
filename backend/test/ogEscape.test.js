// Regresión de seguridad: las páginas OG del backend (share y groups) escapan
// los datos que el propio cliente guardó (destinos, orígenes, nombres).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5086;
const BASE = `http://localhost:${PORT}`;
const EVIL = '"><script>alert(1)</script>';
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

const post = async (p, body) => (await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

test("share /og: destino, orígenes y totales guardados por el cliente salen escapados", async () => {
  const { id } = await post("/api/share", {
    results: { flights: [{ destination: EVIL, totalCostEUR: EVIL, averageCostPerTraveler: 1, flights: [{ origin: EVIL, price: 1, passengers: 1 }] }] },
    searchParams: { origins: [EVIL] },
  });
  const html = await (await fetch(`${BASE}/api/share/${id}/og`)).text();
  assert.ok(!/<script>alert/i.test(html), "sin <script> inyectado");
  assert.ok(!/content="[^"]*"><script/i.test(html), "sin romper atributos");
});

test("groups /og: orígenes y nombres de los miembros salen escapados", async () => {
  const d = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const { id } = await post("/api/groups", { departureDate: d, members: [{ origin: EVIL, name: EVIL }] });
  const html = await (await fetch(`${BASE}/api/groups/${id}/og`)).text();
  assert.ok(!/<script>alert/i.test(html));
  assert.ok(!/content="[^"]*"><script/i.test(html));
});
