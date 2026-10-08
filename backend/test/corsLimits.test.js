// CORS en producción y límites de creación de grupos/enlaces (configurables
// por entorno). Servidores mock propios; sin red.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const procs = [];
after(() => procs.forEach((p) => p.exitCode === null && p.kill("SIGKILL")));
async function boot(port, env) {
  const p = spawn("node", [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT: String(port), USE_MOCK: "true", ...env }, stdio: ["ignore", "ignore", "ignore"],
  });
  procs.push(p);
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/ping`)).ok) return base; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`backend ${port} no arrancó`);
}

test("CORS en producción: lista blanca, previews *.vercel.app y peticiones sin Origin", async () => {
  const base = await boot(5085, { NODE_ENV: "production", ALLOWED_ORIGINS: "https://flyndme2.vercel.app", FRONTEND_URL: "https://flyndme2.vercel.app" });
  const at = (origin) => fetch(`${base}/api/ping`, origin ? { headers: { Origin: origin } } : {});
  const ok = await at("https://flyndme2.vercel.app");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://flyndme2.vercel.app");
  const preview = await at("https://flyndme2-abc123-diegograndaas-projects.vercel.app");
  assert.equal(preview.status, 200, "las previews de Vercel pasan");
  for (const bad of ["https://evil.com", "https://vercel.app.evil.com", "http://localhost:5173", "null"]) {
    const r = await at(bad);
    assert.equal(r.status, 403, bad);
    assert.equal((await r.json()).code, "CORS_FORBIDDEN");
  }
  assert.equal((await at(null)).status, 200, "sin Origin (curl, pingers) pasa");
});

test("límites de creación: grupos y enlaces compartidos responden 429 RATE_LIMITED", async () => {
  const base = await boot(5084, { NODE_ENV: "test", GROUP_CREATE_LIMIT: "2", SHARE_CREATE_LIMIT: "2" });
  const post = (p, body) => fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const dep = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < 2; i++) assert.equal((await post("/api/groups", { departureDate: dep })).status, 200);
  const g = await post("/api/groups", { departureDate: dep });
  assert.equal(g.status, 429);
  assert.equal((await g.json()).code, "RATE_LIMITED");
  const share = { results: { flights: [] }, searchParams: { origins: ["MAD"] } };
  for (let i = 0; i < 2; i++) assert.equal((await post("/api/share", share)).status, 200);
  const s = await post("/api/share", share);
  assert.equal(s.status, 429);
  assert.equal((await s.json()).code, "RATE_LIMITED");
});
