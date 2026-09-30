// Tests del almacén clave-valor con TTL (utils/kvStore.js), backend in-memory.
// Sin red: el backend upstash solo se ejercita en prod con sus variables.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMemoryStore, createUpstashStore, createStore, createCounters } = require("../utils/kvStore");

test("kvStore(memory): set/get/delete round-trip", async () => {
  const s = createMemoryStore({ namespace: "t", ttlMs: 10_000, maxSize: 100 });
  assert.equal(s.backend, "memory");
  assert.equal(await s.get("nope"), null);

  const val = { x: 1, members: [], expiresAt: Date.now() + 10_000 };
  await s.set("a", val);
  assert.deepEqual(await s.get("a"), val);
  assert.equal(await s.size(), 1);

  assert.equal(await s.delete("a"), true);
  assert.equal(await s.get("a"), null);
  assert.equal(await s.size(), 0);
});

test("kvStore(memory): read-modify-write persiste el cambio", async () => {
  const s = createMemoryStore({ namespace: "t", ttlMs: 10_000 });
  await s.set("g", { members: [], expiresAt: Date.now() + 10_000 });
  const g = await s.get("g");
  g.members.push({ origin: "MAD" });
  // ttlMs explícito = simula conservar el TTL restante (no-op en memoria).
  await s.set("g", g, { ttlMs: 5_000 });
  assert.equal((await s.get("g")).members.length, 1);
});

test("kvStore(memory): evicción del más antiguo al superar maxSize", async () => {
  const s = createMemoryStore({ namespace: "t", ttlMs: 10_000, maxSize: 2 });
  const now = Date.now();
  await s.set("a", { expiresAt: now + 1 });       // el más antiguo
  await s.set("b", { expiresAt: now + 2 });
  await s.set("c", { expiresAt: now + 10_000 });  // store lleno → dispara evicción
  assert.equal(await s.get("a"), null, "el más antiguo se expulsa");
  assert.ok(await s.get("c"), "el nuevo permanece");
  assert.ok((await s.size()) <= 2, "el tamaño queda acotado");
});

test("kvStore: createStore cae a memoria sin variables de Upstash", async () => {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const s = createStore({ namespace: "t", ttlMs: 1000 });
    assert.equal(s.backend, "memory");
  } finally {
    if (prevUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevTok !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = prevTok;
  }
});

test("createCounters(memory): incr acumula y snapshot lee solo los nombres pedidos", async () => {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const c = createCounters({ namespace: "t" });
    assert.equal(c.backend, "memory");
    await c.incr("a");
    await c.incr("a");
    await c.incr("b");
    // 'c' nunca se incrementó → 0 (snapshot rellena los ausentes con 0, no undefined).
    assert.deepEqual(await c.snapshot(["a", "b", "c"]), { a: 2, b: 1, c: 0 });
  } finally {
    if (prevUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevTok !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = prevTok;
  }
});

// Cliente Redis falso (sin red) para ejercitar el backend upstash.
function fakeRedis({ failSet = false, failGet = false } = {}) {
  const data = new Map();
  return {
    data,
    async get(k) { if (failGet) throw new Error("down"); return data.has(k) ? data.get(k) : null; },
    async set(k, v) { if (failSet) throw new Error("archived"); data.set(k, v); return "OK"; },
    async del(k) { return data.delete(k) ? 1 : 0; },
  };
}

test("kvStore(upstash): set/get normales van a Redis con prefijo de namespace", async () => {
  const redis = fakeRedis();
  const s = createUpstashStore({ namespace: "group", ttlMs: 10_000, redis });
  assert.equal(s.backend, "upstash");
  await s.set("abc", { members: [] });
  assert.ok(redis.data.has("group:abc"));
  assert.deepEqual(await s.get("abc"), { members: [] });
  assert.equal(await s.delete("abc"), true);
  assert.equal(await s.get("abc"), null);
});

test("kvStore(upstash): si Redis falla al escribir, guarda en memoria en vez de romper", async () => {
  const s = createUpstashStore({ namespace: "group", ttlMs: 10_000, redis: fakeRedis({ failSet: true }) });
  const v = { members: [{ origin: "MAD" }] };
  await assert.doesNotReject(() => s.set("g1", v));
  assert.deepEqual(await s.get("g1"), v, "se lee desde el respaldo");
});

test("kvStore(upstash): si Redis falla al leer, consulta el respaldo y si no, null", async () => {
  const s = createUpstashStore({ namespace: "share", ttlMs: 10_000, redis: fakeRedis({ failSet: true, failGet: true }) });
  assert.equal(await s.get("nope"), null);
  await s.set("x", { a: 1 });
  assert.deepEqual(await s.get("x"), { a: 1 });
});
