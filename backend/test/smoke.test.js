// End-to-end smoke tests against a backend spawned in USE_MOCK mode.
// Run with: npm test (from backend/)
//
// These tests are intentionally light: they cover the API contract and the
// invariants we care about most (pax math, verification fields, cache key,
// share/OG round-trip, validation errors). They use the mock service so they
// burn zero Amadeus quota and run in ~2s end-to-end.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5099;
const BASE = `http://localhost:${PORT}`;

let server;

async function waitForServer(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Backend did not start within ${timeoutMs}ms`);
}

async function post(p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function get(p) {
  const r = await fetch(`${BASE}${p}`);
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("application/json") ? await r.json() : await r.text() };
}

before(async () => {
  server = spawn("node", [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT: String(PORT), USE_MOCK: "true", NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  // Surface server errors to test output for easier debugging
  server.stderr?.on("data", (d) => process.stderr.write(`[server-err] ${d}`));
  await waitForServer();
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGKILL");
    await new Promise((r) => {
      server.once("exit", r);
      setTimeout(r, 1500);
    });
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────

test("health endpoint reports mock mode", async () => {
  const r = await get("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.mock, true);
  assert.equal(r.body.status, "healthy");
});

test("version endpoint exposes commit + env without secrets", async () => {
  const r = await get("/api/version");
  assert.equal(r.status, 200);
  // commit may be null in environments without git or env hints; structure is
  // what we care about
  assert.ok(["string", "object"].includes(typeof r.body.commit));
  assert.equal(typeof r.body.node, "string");
  assert.equal(r.body.mock, true);
  assert.equal(r.body.amadeus_env, process.env.AMADEUS_ENV || "test");
  assert.equal(typeof r.body.uptime_s, "number");
  // Sanity: no secret-looking fields leaked
  for (const k of Object.keys(r.body)) {
    assert.ok(!/key|secret|token|password/i.test(k),
      `unexpected secret-looking field in /api/version: ${k}`);
  }
});

test("search: multi-pax math is coherent", async () => {
  const r = await post("/api/flights/multi-origin", {
    origins: ["MAD", "LON", "BER"],
    passengers: [1, 2, 1],
    departureDate: "2026-09-15",
    tripType: "oneway",
    optimizeBy: "total",
  });
  assert.equal(r.status, 200);
  const w = r.body.bestDestination;
  assert.ok(w, "best destination present");
  assert.equal(w.totalPassengers, 4);

  // total = Σ price * pax
  const calc = w.flights.reduce((s, f) => s + f.price * f.passengers, 0);
  assert.ok(Math.abs(w.totalCostEUR - calc) < 0.5,
    `totalCostEUR ${w.totalCostEUR} should equal ${calc}`);

  // avg = total / totalPax
  const expectedAvg = w.totalCostEUR / w.totalPassengers;
  assert.ok(Math.abs(w.averageCostPerTraveler - expectedAvg) < 0.5);

  // fairness in [0, 100]
  assert.ok(w.fairnessScore >= 0 && w.fairnessScore <= 100);

  // Per-leg fields
  for (const f of w.flights) {
    assert.equal(typeof f.passengers, "number");
    assert.equal(typeof f.totalForOrigin, "number");
    assert.ok(f.offer?.itineraries?.[0]?.segments?.length > 0,
      "each flight must carry an offer with at least one segment");
  }
});

test("search: verification fields are populated on winner", async () => {
  const r = await post("/api/flights/multi-origin", {
    origins: ["MAD", "LON"],
    passengers: [1, 1],
    departureDate: "2026-09-20",
    tripType: "oneway",
  });
  assert.equal(r.status, 200);
  const w = r.body.bestDestination;
  assert.ok(["verified", "changed", "partial", "failed", "timeout"].includes(w.verificationStatus),
    `unknown verificationStatus: ${w.verificationStatus}`);
  assert.ok(w.verifiedAt, "verifiedAt present");
  assert.ok(!isNaN(new Date(w.verifiedAt).getTime()), "verifiedAt is parseable");
  assert.equal(typeof w.priceChangePct, "number");
});

test("search: validation errors return proper codes", async () => {
  const cases = [
    { body: { departureDate: "2026-09-15" },                                                    code: "MISSING_ORIGINS" },
    { body: { origins: ["WRONG"], departureDate: "2026-09-15" },                                code: "INVALID_ORIGINS" },
    { body: { origins: ["MAD","LON"], passengers: "bad", departureDate: "2026-09-15" },         code: "INVALID_PASSENGERS" },
    { body: { origins: ["MAD","LON","BER"], passengers: [9,9,9], departureDate: "2026-09-15" }, code: "TOO_MANY_PASSENGERS" },
    { body: { origins: ["MAD"], departureDate: "not-a-date" },                                  code: "INVALID_DEPARTURE_DATE" },
  ];
  for (const c of cases) {
    const r = await post("/api/flights/multi-origin", c.body);
    assert.equal(r.status, 400, `expected 400 for ${c.code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, c.code);
  }
});

test("search: missing passengers defaults to 1 per origin", async () => {
  const r = await post("/api/flights/multi-origin", {
    origins: ["MAD", "BCN"],
    departureDate: "2026-09-15",
    tripType: "oneway",
  });
  assert.equal(r.status, 200);
  const w = r.body.bestDestination;
  assert.equal(w.totalPassengers, 2);
  assert.ok(w.flights.every((f) => f.passengers === 1));
});

test("cache: identical request returns identical payload", async () => {
  const body = {
    origins: ["MAD", "LON"],
    passengers: [1, 1],
    departureDate: "2026-10-20",
    tripType: "oneway",
    optimizeBy: "total",
  };
  const r1 = await post("/api/flights/multi-origin", body);
  const r2 = await post("/api/flights/multi-origin", body);
  assert.deepEqual(r1.body, r2.body);
});

test("cache key includes pax: different pax → different totals", async () => {
  const base = {
    origins: ["MAD", "LON"],
    departureDate: "2026-10-22",
    tripType: "oneway",
    optimizeBy: "total",
  };
  const r1 = await post("/api/flights/multi-origin", { ...base, passengers: [1, 1] });
  const r2 = await post("/api/flights/multi-origin", { ...base, passengers: [2, 2] });
  assert.equal(r1.body.bestDestination.totalPassengers, 2);
  assert.equal(r2.body.bestDestination.totalPassengers, 4);
  assert.ok(r2.body.bestDestination.totalCostEUR > r1.body.bestDestination.totalCostEUR,
    "doubling pax should roughly double total");
});

test("share: roundtrip preserves pax-aware totals", async () => {
  const search = await post("/api/flights/multi-origin", {
    origins: ["MAD", "LON", "BER"],
    passengers: [1, 2, 1],
    departureDate: "2026-11-10",
    tripType: "oneway",
  });
  assert.equal(search.status, 200);

  const created = await post("/api/share", {
    results: search.body,
    searchParams: {
      origins: ["MAD","LON","BER"],
      passengers: [1,2,1],
      departureDate: "2026-11-10",
      tripType: "oneway",
    },
  });
  assert.equal(created.status, 200);
  assert.ok(created.body.id, "share id returned");

  const got = await get(`/api/share/${created.body.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.results.bestDestination.totalPassengers, 4);
  assert.deepEqual(got.body.searchParams.passengers, [1,2,1]);
});

test("OG meta tags count actual pax, not origins", async () => {
  const search = await post("/api/flights/multi-origin", {
    origins: ["MAD","LON","BER"],
    passengers: [1, 2, 1],
    departureDate: "2026-11-12",
    tripType: "oneway",
  });
  const created = await post("/api/share", {
    results: search.body,
    searchParams: {
      origins: ["MAD","LON","BER"],
      passengers: [1,2,1],
      departureDate: "2026-11-12",
      tripType: "oneway",
    },
  });
  const og = await get(`/api/share/${created.body.id}/og`);
  assert.equal(og.status, 200);
  const m = og.body.match(/og:description[^>]*content="([^"]+)"/);
  assert.ok(m, "OG description meta tag present");
  assert.ok(m[1].includes("4 travelers"),
    `expected "4 travelers" in OG description, got "${m[1]}"`);
});

// ─── Startup config validation (production mode) ─────────────────────────
// These spawn a separate backend process per test to assert exit behaviour,
// so they don't share `server` with the main suite.

function spawnBackend(env, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const proc = spawn("node", [path.join(__dirname, "..", "index.js")], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut: false });
    });
  });
}

test("prod startup: refuses to boot without AMADEUS_API_KEY", async () => {
  const r = await spawnBackend({
    NODE_ENV: "production",
    PORT: "5097",
    USE_MOCK: "false",
    AMADEUS_API_KEY: "",
    AMADEUS_API_SECRET: "",
    ALLOW_INSECURE_PROD: "",
  });
  assert.equal(r.timedOut, false, "process should have exited, not timed out");
  assert.equal(r.exitCode, 1, `expected exit 1, got ${r.exitCode}`);
  assert.ok(r.stderr.includes("AMADEUS_API_KEY"), "stderr should mention missing key");
});

test("prod startup: boots cleanly with USE_MOCK=true and explicit origins", async () => {
  const r = await spawnBackend({
    NODE_ENV: "production",
    PORT: "5098",
    USE_MOCK: "true",
    ALLOWED_ORIGINS: "https://example.com",
    FRONTEND_URL: "https://example.com",
  }, 2000);
  // Should still be running when the timeout kicks in (we wanted it to live)
  assert.equal(r.timedOut, true, "backend should keep running with valid config");
  assert.ok(r.stdout.includes("FlyndMe API"), "should have logged the ready banner");
});

test("tiering: custom destinations bypass tier fallback", async () => {
  const r = await post("/api/flights/multi-origin", {
    origins: ["MAD", "BCN"],
    passengers: [1, 1],
    destinations: ["ROM", "LIS", "ATH"],
    departureDate: "2026-09-15",
    tripType: "oneway",
  });
  assert.equal(r.status, 200);
  // Must return only destinations from the custom list (no Tier 2/3 fallback).
  const dests = new Set(r.body.flights.map((f) => f.destination));
  for (const d of dests) {
    assert.ok(["ROM","LIS","ATH"].includes(d),
      `unexpected destination ${d} in custom-list search`);
  }
});

test("robustez: JSON malformado devuelve 400 INVALID_JSON, no 500", async () => {
  const r = await fetch(`${BASE}/api/flights/multi-origin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ esto no es json",
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.code, "INVALID_JSON");
});

test("share: id con formato invalido → 404 sin tocar el store", async () => {
  const r = await get("/api/share/../../etc/passwd");
  // Puede resolver como 404 de ruta o 404 del validador; nunca 200/500.
  assert.ok([400, 404].includes(r.status), `unexpected status ${r.status}`);
  const r2 = await get("/api/share/%21%21%21%21");
  assert.equal(r2.status, 404);
  assert.equal(r2.body.code, "NOT_FOUND");
});

test("share: la creacion esta rate-limited (RATE_LIMITED tras el limite)", async () => {
  const payload = {
    results: { flights: [] },
    searchParams: { origins: ["MAD"], departureDate: "2026-12-01" },
  };
  let limited = null;
  // El limite por defecto es 20/10min/IP y los tests anteriores ya crearon
  // algunos shares, asi que 25 intentos garantizan cruzarlo.
  for (let i = 0; i < 25; i++) {
    const r = await post("/api/share", payload);
    if (r.status === 429) { limited = r; break; }
    assert.equal(r.status, 200, `create #${i} failed: ${JSON.stringify(r.body)}`);
  }
  assert.ok(limited, "expected a 429 after exceeding the create limit");
  assert.equal(limited.body.code, "RATE_LIMITED");
});
