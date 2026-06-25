// Tests del almacén clave-valor con TTL (utils/kvStore.js), backend in-memory.
// Sin red: el backend upstash solo se ejercita en prod con sus variables.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMemoryStore, createStore } = require("../utils/kvStore");

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
