// Equidad y punto de encuentro, sin red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { _computeFairness, _exceedsGroupDateSpread } = require("../routes/flights");

test("la equidad es el mínimo entre el máximo y no se queda en cero", () => {
  assert.equal(_computeFairness([40, 40, 40]).fairness, 100);
  const low = _computeFairness([15, 19, 56]);
  assert.equal(low.spread, 41);
  assert.equal(Number(low.fairness.toFixed(1)), Number(((15 / 56) * 100).toFixed(1)));
  assert.ok(low.fairness > 0);
  assert.equal(_computeFairness([10]).fairness, 100);
  assert.equal(_computeFairness([0, 10]).fairness, 0);
});

test("un destino se descarta si el grupo no sale el mismo día o el siguiente", () => {
  const apart = [{ flightDate: "2026-12-16" }, { flightDate: "2026-12-19" }];
  assert.equal(_exceedsGroupDateSpread(apart, "2026-12-16", "", 1), true);
  assert.equal(_exceedsGroupDateSpread([
    { flightDate: "2026-12-16" },
    {},
  ], "2026-12-16", "", 1), false);
  assert.equal(_exceedsGroupDateSpread([
    { flightDate: "2026-12-16" },
    { flightDate: "2026-12-17" },
  ], "2026-12-16", "", 1), false);
  assert.equal(_exceedsGroupDateSpread(apart, "2026-12-16", "", -1), false);
  assert.equal(_exceedsGroupDateSpread([
    { flightReturnDate: "2026-12-20" },
    { flightReturnDate: "2026-12-23" },
  ], "2026-12-16", "2026-12-20", 1), true);
});
