// Unit tests de utils/ttlCache.js (Mejora 7: dedup de caches en memoria).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TtlCache } = require("../utils/ttlCache");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("ttlCache: get/set basico y stats", () => {
  const c = new TtlCache({ ttlMs: 1000 });
  assert.equal(c.get("x"), null);
  c.set("x", 42);
  assert.equal(c.get("x"), 42);
  assert.equal(c.size, 1);
  assert.deepEqual(c.stats, { hits: 1, misses: 1, requests: 2 });
  c.dispose();
});

test("ttlCache: las entradas expiran tras ttlMs", async () => {
  const c = new TtlCache({ ttlMs: 40 });
  c.set("x", "v");
  assert.equal(c.get("x"), "v");
  await sleep(60);
  assert.equal(c.get("x"), null);
  assert.equal(c.size, 0); // el get expirado tambien limpia la entrada
  c.dispose();
});

test("ttlCache: maxSize expulsa las entradas mas antiguas", () => {
  const c = new TtlCache({ ttlMs: 60000, maxSize: 3 });
  c.set("a", 1); c.set("b", 2); c.set("c", 3); c.set("d", 4);
  assert.equal(c.size, 3);
  assert.equal(c.get("a"), null);  // la primera fue expulsada
  assert.equal(c.get("d"), 4);
  c.dispose();
});

test("ttlCache: sweep elimina caducadas sin tocar vigentes", async () => {
  const c = new TtlCache({ ttlMs: 30, sweepEveryMs: 600000 }); // sweep manual
  c.set("a", 1);
  await sleep(50);
  c.set("b", 2);
  c.sweep();
  assert.equal(c.size, 1);
  assert.equal(c.get("b"), 2);
  c.dispose();
});

test("ttlCache: ttlMs invalido lanza error", () => {
  assert.throws(() => new TtlCache({}), /ttlMs/);
  assert.throws(() => new TtlCache({ ttlMs: -5 }), /ttlMs/);
});
