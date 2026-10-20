// Cuentas: hash, unión de favoritos y sesión real. Sin red (servidor mock).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const {
  normalizeEmail, passwordOk, mergeFavorites, hashPassword, verifyPassword,
} = require("../routes/auth");

test("correo y contraseña: se normalizan y la corta se rechaza", () => {
  assert.equal(normalizeEmail("  Ana@Flynd.Me "), "ana@flynd.me");
  assert.equal(normalizeEmail("sin-arroba"), "");
  assert.equal(normalizeEmail(""), "");
  assert.equal(passwordOk("1234567"), false);
  assert.equal(passwordOk("12345678"), true);
  assert.equal(passwordOk("x".repeat(73)), false);
  assert.equal(passwordOk(12345678), false);
});

test("favoritos: gana el más reciente y un precio ausente no borra el anterior", () => {
  const merged = mergeFavorites(
    [{ code: "mad", city: "Madrid", price: 40, ts: 10 }, { code: "lon", city: "London", price: 80, ts: 5 }],
    [{ code: "MAD", city: "", price: null, ts: 20 }, { code: "bcn", city: "Barcelona", price: 15, ts: 30 }, { code: "no" }],
  );
  assert.deepEqual(merged.map((f) => f.code), ["BCN", "MAD", "LON"]);
  assert.equal(merged.find((f) => f.code === "MAD").price, 40);
  assert.equal(merged.find((f) => f.code === "MAD").ts, 20);
});

test("la contraseña no se guarda en claro", async () => {
  const salt = "ab".repeat(16);
  const hash = await hashPassword("correct-horse", salt);
  assert.notEqual(hash, "correct-horse");
  assert.equal(hash.length, 64);
  assert.equal(await verifyPassword("correct-horse", salt, hash), true);
  assert.equal(await verifyPassword("wrong-horsexx", salt, hash), false);
});

const procs = [];
after(() => procs.forEach((p) => p.exitCode === null && p.kill("SIGKILL")));

function boot(port, extra = {}) {
  const env = { ...process.env, PORT: String(port), USE_MOCK: "true", NODE_ENV: "test", ...extra };
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  const p = spawn("node", [path.join(__dirname, "..", "index.js")], {
    env, stdio: ["ignore", "ignore", "pipe"],
  });
  procs.push(p);
  p.stderr?.on("data", (d) => process.stderr.write(`[auth-server] ${d}`));
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 5000;
  const wait = async () => {
    while (Date.now() < deadline) {
      try { if ((await fetch(`${base}/api/ping`)).ok) return base; } catch { /* arrancando */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`backend ${port} no arrancó`);
  };
  return wait();
}

async function post(base, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body || {}) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json, text };
}

test("registrar, entrar, favoritos y salir", async () => {
  const base = await boot(5076);
  const fav = (code, ts, price) => ({ code, city: code, price, ts });

  const weak = await post(base, "/api/auth/register", { email: "a@b.co", password: "short" });
  assert.equal(weak.status, 400);
  assert.equal(weak.json.code, "AUTH_WEAK_PASSWORD");

  const bad = await post(base, "/api/auth/register", { email: "no-es-correo", password: "correct-horse" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "AUTH_BAD_EMAIL");

  const created = await post(base, "/api/auth/register", {
    email: "Ana@Flynd.Me",
    password: "correct-horse",
    name: "Ana",
    remember: true,
    favorites: [fav("lon", 5, 80)],
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.user.email, "ana@flynd.me");
  assert.equal(created.json.user.name, "Ana");
  assert.equal(typeof created.json.token, "string");
  assert.ok(!created.text.includes("correct-horse"));
  assert.equal(created.json.hash, undefined);
  assert.equal(created.json.salt, undefined);
  assert.deepEqual(created.json.favorites.map((f) => f.code), ["LON"]);

  const dup = await post(base, "/api/auth/register", { email: "ana@flynd.me", password: "correct-horse" });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, "AUTH_EXISTS");

  const wrong = await post(base, "/api/auth/login", { email: "ana@flynd.me", password: "incorrecto" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.code, "AUTH_INVALID");
  const missing = await post(base, "/api/auth/login", { email: "nadie@flynd.me", password: "correct-horse" });
  assert.equal(missing.status, 401);
  assert.equal(missing.json.code, "AUTH_INVALID");

  const login = await post(base, "/api/auth/login", {
    email: "ana@flynd.me",
    password: "correct-horse",
    remember: false,
    favorites: [fav("mad", 10, 40), fav("lon", 1, null)],
  });
  assert.equal(login.status, 200);
  assert.deepEqual(login.json.favorites.map((f) => f.code), ["MAD", "LON"]);
  assert.equal(login.json.favorites.find((f) => f.code === "LON").price, 80);
  const token = login.json.token;

  const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.email, "ana@flynd.me");
  assert.equal(meBody.hash, undefined);

  const anon = await fetch(`${base}/api/auth/me`);
  assert.equal(anon.status, 401);

  const replaced = await post(base, "/api/auth/favorites", { favorites: [fav("bcn", 3, 15)] }, token);
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.json.favorites.map((f) => f.code), ["BCN"]);

  const other = await post(base, "/api/auth/register", {
    email: "otro@flynd.me", password: "correct-horse", favorites: [fav("par", 1, 9)],
  });
  assert.equal(other.status, 201);
  assert.deepEqual(other.json.favorites.map((f) => f.code), ["PAR"]);

  const out = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(out.status, 204);
  const afterOut = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(afterOut.status, 401);
});

test("demasiados intentos de entrada responden 429", async () => {
  const base = await boot(5075, { AUTH_ATTEMPT_LIMIT: "2" });
  const body = { email: "a@b.co", password: "incorrecto" };
  assert.equal((await post(base, "/api/auth/login", body)).status, 401);
  assert.equal((await post(base, "/api/auth/login", body)).status, 401);
  const limited = await post(base, "/api/auth/login", body);
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, "RATE_LIMITED");
});

test("el preflight de producción deja pasar Authorization", async () => {
  const base = await boot(5074, {
    NODE_ENV: "production",
    ALLOWED_ORIGINS: "https://flyndme2.vercel.app",
    FRONTEND_URL: "https://flyndme2.vercel.app",
  });
  const opt = await fetch(`${base}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://flyndme2.vercel.app",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,authorization",
    },
  });
  assert.ok(opt.status === 204 || opt.status === 200, `preflight ${opt.status}`);
  assert.match(opt.headers.get("access-control-allow-headers") || "", /authorization/i);
});
