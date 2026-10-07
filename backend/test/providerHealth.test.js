const { test } = require("node:test");
const assert = require("node:assert/strict");
const { providerHealth } = require("../utils/providerHealth");

test("providerHealth: sin consultas o sin errores → ok", () => {
  assert.equal(providerHealth(undefined), "ok");
  assert.equal(providerHealth({ calls: 0, errors: 0 }), "ok");
  assert.equal(providerHealth({ calls: 40, errors: 0 }), "ok");
});

test("providerHealth: la mitad o más falla → down", () => {
  assert.equal(providerHealth({ calls: 10, errors: 5 }), "down");
  assert.equal(providerHealth({ calls: 2, errors: 2 }), "down");
});

test("providerHealth: una parte apreciable falla → degraded", () => {
  assert.equal(providerHealth({ calls: 10, errors: 2 }), "degraded");
  assert.equal(providerHealth({ calls: 10, errors: 4 }), "degraded");
});

test("providerHealth: un fallo aislado no cuenta como degradado", () => {
  assert.equal(providerHealth({ calls: 4, errors: 1 }), "ok");
  assert.equal(providerHealth({ calls: 30, errors: 3 }), "ok");
});
