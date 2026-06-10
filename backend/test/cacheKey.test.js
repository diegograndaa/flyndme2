// Unit tests de la clave de cache de amadeusService.
// Regresión del bug: travelClass/currencyCode no formaban parte de la clave,
// por lo que una búsqueda BUSINESS podía servir un precio ECONOMY cacheado.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../services/amadeusService");
const { makeCacheKey } = __test;

test("cache key: misma búsqueda → misma clave", () => {
  const a = makeCacheKey("MAD", "ROM", "2026-09-15", { nonStop: false, max: 5 });
  const b = makeCacheKey("MAD", "ROM", "2026-09-15", { nonStop: false, max: 5 });
  assert.equal(a, b);
});

test("cache key: travelClass distinto → clave distinta", () => {
  const eco = makeCacheKey("MAD", "ROM", "2026-09-15", { travelClass: "ECONOMY" });
  const biz = makeCacheKey("MAD", "ROM", "2026-09-15", { travelClass: "BUSINESS" });
  const none = makeCacheKey("MAD", "ROM", "2026-09-15", {});
  assert.notEqual(eco, biz);
  assert.notEqual(biz, none);
});

test("cache key: currencyCode distinto → clave distinta", () => {
  const eur = makeCacheKey("MAD", "ROM", "2026-09-15", { currencyCode: "EUR" });
  const usd = makeCacheKey("MAD", "ROM", "2026-09-15", { currencyCode: "USD" });
  assert.notEqual(eur, usd);
});

test("cache key: currencyCode ausente equivale a EUR (default real de la app)", () => {
  const def = makeCacheKey("MAD", "ROM", "2026-09-15", {});
  const eur = makeCacheKey("MAD", "ROM", "2026-09-15", { currencyCode: "EUR" });
  assert.equal(def, eur);
});

test("cache key: returnDate / nonStop / max ya diferenciaban (sin regresión)", () => {
  const ow  = makeCacheKey("MAD", "ROM", "2026-09-15", {});
  const rt  = makeCacheKey("MAD", "ROM", "2026-09-15", { returnDate: "2026-09-20" });
  const ns  = makeCacheKey("MAD", "ROM", "2026-09-15", { nonStop: true });
  const mx  = makeCacheKey("MAD", "ROM", "2026-09-15", { max: 10 });
  assert.notEqual(ow, rt);
  assert.notEqual(ow, ns);
  assert.notEqual(ow, mx);
});
