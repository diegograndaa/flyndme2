// Corrección de la búsqueda (oct-2026): equidad que no satura a 0 con
// tarifas low-cost, y un destino no gana con ciudades volando en días
// demasiado separados por el fallback de fechas vecinas. Lógica pura.
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.USE_MOCK = "true";
const {
  _computeFairness: computeFairness,
  _exceedsGroupDateSpread: exceedsSpread,
} = require("../routes/flights");

test("equidad = quien menos paga / quien más paga, en %", () => {
  assert.equal(computeFairness([50, 50, 50]).fairness, 100);
  assert.equal(computeFairness([40, 80]).fairness, 50);
  assert.equal(computeFairness([100]).fairness, 100); // un solo origen
  assert.equal(computeFairness([0, 0]).fairness, 0);
});

test("equidad: con tarifas low-cost ya no empata a 0 y ordena los destinos", () => {
  // Caso real de producción (MAD+LON+BER, nov-2026): con la fórmula vieja
  // MIL, LIS y PAR salían a 0 los tres.
  const mil = computeFairness([15, 19, 56]).fairness;
  const lis = computeFairness([27, 39, 74]).fairness;
  const par = computeFairness([33, 50, 98]).fairness;
  for (const f of [mil, lis, par]) assert.ok(f > 0 && f < 100);
  assert.ok(lis > par && par > mil, `orden esperado LIS > PAR > MIL: ${lis} ${par} ${mil}`);
});

test("equidad: spread y media siguen saliendo como antes", () => {
  const r = computeFairness([122, 81]);
  assert.equal(r.spread, 41);
  assert.equal(r.avg, 101.5);
  assert.equal(Number(r.fairness.toFixed(1)), 66.4);
});

const DEP = "2026-11-18";
const RET = "2026-11-22";

test("fechas del grupo: todos el mismo día o día siguiente → vale", () => {
  const flights = [
    { origin: "MAD" },
    { origin: "LON", dateFallback: true, flightDate: "2026-11-19" },
    { origin: "BER" },
  ];
  assert.equal(exceedsSpread(flights, DEP, null, 1), false);
});

test("fechas del grupo: ciudades a 3 días de distancia → se descarta", () => {
  // Caso real (VCE): MAD el 16, LON y BER el 19.
  const flights = [
    { origin: "MAD", dateFallback: true, flightDate: "2026-11-16" },
    { origin: "LON", dateFallback: true, flightDate: "2026-11-19" },
    { origin: "BER", dateFallback: true, flightDate: "2026-11-19" },
  ];
  assert.equal(exceedsSpread(flights, DEP, null, 1), true);
});

test("fechas del grupo: un día antes y otro después (2 días) → se descarta con tope 1", () => {
  const flights = [
    { origin: "MAD", dateFallback: true, flightDate: "2026-11-17" },
    { origin: "BCN", dateFallback: true, flightDate: "2026-11-19" },
  ];
  assert.equal(exceedsSpread(flights, DEP, null, 1), true);
  assert.equal(exceedsSpread(flights, DEP, null, 2), false);
});

test("fechas del grupo: también se mira la vuelta en ida y vuelta", () => {
  const flights = [
    { origin: "MAD" },
    { origin: "BCN", dateFallback: true, flightDate: DEP, flightReturnDate: "2026-11-25" },
  ];
  assert.equal(exceedsSpread(flights, DEP, RET, 1), true);
  assert.equal(exceedsSpread(flights, DEP, RET, 3), false);
});

test("fechas del grupo: tope negativo = sin tope", () => {
  const flights = [
    { origin: "MAD", dateFallback: true, flightDate: "2026-11-10" },
    { origin: "BCN", dateFallback: true, flightDate: "2026-11-25" },
  ];
  assert.equal(exceedsSpread(flights, DEP, null, -1), false);
});
