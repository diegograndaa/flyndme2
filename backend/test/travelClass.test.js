// Cabinas que el proveedor no tiene: 400 claro en vez de «sin resultados».
// Lógica pura (sin servidor ni red) + comprobación de que el mock, que no
// declara cabinas, sigue aceptándolas todas.
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.USE_MOCK = "true";
const { _unsupportedTravelClass: unsupported } = require("../routes/flights");

test("unsupportedTravelClass: con la lista de Travelpayouts solo vale ECONOMY", () => {
  const caps = { travelClasses: ["ECONOMY"] };
  assert.equal(unsupported("BUSINESS", caps), true);
  assert.equal(unsupported("PREMIUM_ECONOMY", caps), true);
  assert.equal(unsupported("ECONOMY", caps), false);
  assert.equal(unsupported(undefined, caps), false);
});

test("unsupportedTravelClass: un proveedor sin lista declarada (mock) las acepta todas", () => {
  assert.equal(unsupported("BUSINESS", undefined), false);
  assert.equal(unsupported("FIRST", {}), false);
  assert.equal(unsupported("BUSINESS"), false); // capacidades reales del mock
});
