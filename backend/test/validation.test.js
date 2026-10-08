// Validaciones y límites de las rutas (flights, groups, share) contra un backend
// propio en modo mock. Va en un fichero aparte de smoke.test.js (su servidor y
// sus rate limits empiezan de cero) y sin red: el mock no llama a nadie.
// Fechas SIEMPRE relativas a hoy.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5089;
const BASE = `http://localhost:${PORT}`;
const DAY_MS = 86_400_000;
const futureDate = (d) => new Date(Date.now() + d * DAY_MS).toISOString().slice(0, 10);
let server;

before(async () => {
  server = spawn("node", [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test", MOCK_DELAY_MS: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr?.on("data", (d) => process.stderr.write(`[validation-server] ${d}`));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/ping`)).ok) return; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("backend de validación no arrancó");
});
after(() => { if (server && server.exitCode === null) server.kill("SIGKILL"); });

async function post(p, body, raw) {
  const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ?? JSON.stringify(body) });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text(), headers: r.headers };
}
const del = async (p) => { const r = await fetch(`${BASE}${p}`, { method: "DELETE" }); return { status: r.status, body: await r.json() }; };

// ─── /multi-origin: límites ───────────────────────────────────────────────────

test("multi-origin: 8 orígenes es el máximo; 9 → TOO_MANY_ORIGINS", async () => {
  const nine = ["MAD", "BCN", "LON", "PAR", "ROM", "AMS", "MIL", "LIS", "BER"];
  const r = await post("/api/flights/multi-origin", { origins: nine, departureDate: futureDate(40), tripType: "oneway", destinations: ["DUB"] });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "TOO_MANY_ORIGINS");
  const ok = await post("/api/flights/multi-origin", { origins: nine.slice(0, 8), departureDate: futureDate(40), tripType: "oneway", destinations: ["DUB"] });
  assert.equal(ok.status, 200);
});

test("multi-origin: 16 pasajeros en total es el tope exacto", async () => {
  const at = await post("/api/flights/multi-origin", { origins: ["MAD", "LON"], passengers: [9, 7], departureDate: futureDate(41), tripType: "oneway", destinations: ["PAR"] });
  assert.equal(at.status, 200);
  assert.equal(at.body.bestDestination.totalPassengers, 16);
  const over = await post("/api/flights/multi-origin", { origins: ["MAD", "LON"], passengers: [9, 8], departureDate: futureDate(41), tripType: "oneway", destinations: ["PAR"] });
  assert.equal(over.status, 400);
  assert.equal(over.body.code, "TOO_MANY_PASSENGERS");
});

test("multi-origin: orígenes repetidos se agregan (MAD×1 + MAD×2 = un tramo de 3)", async () => {
  const r = await post("/api/flights/multi-origin", { origins: ["MAD", "MAD"], passengers: [1, 2], departureDate: futureDate(42), tripType: "oneway", destinations: ["PAR"] });
  assert.equal(r.status, 200);
  const w = r.body.bestDestination;
  assert.equal(w.flights.length, 1);
  assert.equal(w.flights[0].passengers, 3);
  assert.equal(w.totalPassengers, 3);
});

test("multi-origin: si los únicos destinos son los propios orígenes → NO_VALID_DESTINATIONS", async () => {
  const r = await post("/api/flights/multi-origin", { origins: ["MAD", "LON"], departureDate: futureDate(43), tripType: "oneway", destinations: ["MAD", "LON"] });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "NO_VALID_DESTINATIONS");
});

test("multi-origin: demasiadas combinaciones (8 orígenes × destinos × fechas flexibles) → 400", async () => {
  const eight = ["MAD", "BCN", "LON", "PAR", "ROM", "AMS", "MIL", "LIS"];
  const r = await post("/api/flights/multi-origin", { origins: eight, departureDate: futureDate(44), tripType: "oneway", dateMode: "flex", flexDays: 5 });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "TOO_MANY_COMBINATIONS");
});

test("multi-origin: fecha a más de 360 días → DATE_TOO_FAR; vuelta ≤ ida → INVALID_RETURN_DATE_ORDER", async () => {
  const far = await post("/api/flights/multi-origin", { origins: ["MAD"], departureDate: futureDate(400), tripType: "oneway" });
  assert.equal(far.body.code, "DATE_TOO_FAR");
  const order = await post("/api/flights/multi-origin", { origins: ["MAD"], departureDate: futureDate(50), returnDate: futureDate(50), tripType: "roundtrip" });
  assert.equal(order.body.code, "INVALID_RETURN_DATE_ORDER");
});

test("cuerpo > 128 KB → 413 PAYLOAD_TOO_LARGE; JSON roto → 400 INVALID_JSON", async () => {
  const big = await post("/api/flights/multi-origin", null, JSON.stringify({ origins: ["MAD"], pad: "x".repeat(140 * 1024) }));
  assert.equal(big.status, 413);
  assert.equal(big.body.code, "PAYLOAD_TOO_LARGE");
  const broken = await post("/api/flights/multi-origin", null, "{no json");
  assert.equal(broken.status, 400);
  assert.equal(broken.body.code, "INVALID_JSON");
});

// ─── /cheaper-date, /price-check, /trip-length-hint ───────────────────────────

test("cheaper-date: total actual ausente o ≤ 0 → INVALID_TOTAL", async () => {
  for (const currentTotalEUR of [undefined, 0, -5, "abc"]) {
    const r = await post("/api/flights/cheaper-date", { origins: ["MAD"], destination: "PAR", departureDate: futureDate(45), tripType: "oneway", currentTotalEUR });
    assert.equal(r.status, 400, `currentTotalEUR=${currentTotalEUR}`);
    assert.equal(r.body.code, "INVALID_TOTAL");
  }
});

test("price-check: más de 16 pasajeros o más de 8 orígenes → 400", async () => {
  const pax = await post("/api/flights/price-check", { origins: ["MAD", "LON"], passengers: [9, 8], destination: "PAR", departureDate: futureDate(46) });
  assert.equal(pax.body.code, "TOO_MANY_PASSENGERS");
  const nine = ["MAD", "BCN", "LON", "ROM", "AMS", "MIL", "LIS", "BER", "DUB"];
  const orig = await post("/api/flights/price-check", { origins: nine, destination: "PAR", departureDate: futureDate(46) });
  assert.equal(orig.body.code, "INVALID_ORIGINS");
});

test("trip-length-hint: respeta los destinos elegidos por el usuario", async () => {
  const r = await post("/api/flights/trip-length-hint", { origins: ["MAD"], departureDate: futureDate(47), returnDate: futureDate(52), destinations: ["LIS"] });
  assert.equal(r.status, 200);
  assert.equal(r.body.suggestion.cheapest.destination, "LIS");
  assert.equal(r.body.suggestion.destinationsCount, 1);
});

// ─── /groups ──────────────────────────────────────────────────────────────────

test("groups: ids malformados → 404 en lectura/alta y redirección en /og", async () => {
  for (const id of ["a", "abc", "x".repeat(30), "bad$id!"]) {
    const r = await fetch(`${BASE}/api/groups/${encodeURIComponent(id)}`);
    assert.equal(r.status, 404, `GET ${id}`);
  }
  const og = await fetch(`${BASE}/api/groups/bad$id!/og`, { redirect: "manual" });
  assert.equal(og.status, 302);
});

test("groups: quitar un índice inexistente o no numérico → INVALID_INDEX", async () => {
  const g = await post("/api/groups", { departureDate: futureDate(60), members: [{ origin: "MAD" }] });
  const id = g.body.id;
  for (const idx of ["5", "-1", "abc", "1.5"]) {
    const r = await del(`/api/groups/${id}/members/${idx}`);
    assert.equal(r.status, 400, `índice ${idx}`);
    assert.equal(r.body.code, "INVALID_INDEX");
  }
  const ok = await del(`/api/groups/${id}/members/0`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.members.length, 0);
});

test("groups: el TTL es de 14 días y añadir un miembro no lo reinicia", async () => {
  const g = await post("/api/groups", { departureDate: futureDate(60) });
  assert.equal(g.body.expiresIn, 14 * DAY_MS);
  const first = await (await fetch(`${BASE}/api/groups/${g.body.id}`)).json();
  await new Promise((r) => setTimeout(r, 20));
  const after = await post(`/api/groups/${g.body.id}/members`, { origin: "LON" });
  assert.equal(after.body.expiresAt, first.expiresAt);
});

test("groups: nombre y origen se recortan a su longitud máxima", async () => {
  const g = await post("/api/groups", { departureDate: futureDate(60) });
  const r = await post(`/api/groups/${g.body.id}/members`, { origin: "M".repeat(200), name: "N".repeat(200), passengers: 99 });
  const m = r.body.members[0];
  assert.equal(m.origin.length, 60);
  assert.equal(m.name.length, 40);
  assert.equal(m.passengers, 9);
});

// ─── /share ───────────────────────────────────────────────────────────────────

test("share: sin results o sin searchParams → INVALID_PAYLOAD", async () => {
  const a = await post("/api/share", { results: { flights: [] } });
  assert.equal(a.status, 400);
  assert.equal(a.body.code, "INVALID_PAYLOAD");
  const b = await post("/api/share", { searchParams: {} });
  assert.equal(b.body.code, "INVALID_PAYLOAD");
});

test("share: más de 64 KB → 413 PAYLOAD_TOO_LARGE", async () => {
  const r = await post("/api/share", { results: { pad: "x".repeat(70 * 1024) }, searchParams: {} });
  assert.equal(r.status, 413);
  assert.equal(r.body.code, "PAYLOAD_TOO_LARGE");
});

test("share: ids malformados → 404 y /og redirige a la portada", async () => {
  for (const id of ["a", "x".repeat(30), "bad$id!"]) {
    const r = await fetch(`${BASE}/api/share/${encodeURIComponent(id)}`);
    assert.equal(r.status, 404, `GET ${id}`);
  }
  const og = await fetch(`${BASE}/api/share/bad$id!/og`, { redirect: "manual" });
  assert.equal(og.status, 302);
});

test("share: el enlace caduca a las 48 h", async () => {
  const r = await post("/api/share", { results: { flights: [] }, searchParams: { origins: ["MAD"] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.expiresIn, 48 * 60 * 60 * 1000);
  const back = await fetch(`${BASE}/api/share/${r.body.id}`);
  assert.equal(back.status, 200);
});
