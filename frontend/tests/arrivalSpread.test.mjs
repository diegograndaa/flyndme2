// Tests de la lógica pura de coordinación de llegadas (utils/arrivalSpread.js).
// Datos REALES de la forma de la respuesta: cada tramo es
// { origin, flightDate, offer: { itineraries: [{ segments: [{ arrival: { at } }] }] } }.
// Los tramos con escalas NO traen segments → sin hora (honesto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeArrivalSpread, splitSpread } from "../src/utils/arrivalSpread.js";

// Helper: construye un tramo directo con hora de llegada (y, si se pasa,
// salida real). `flightDate` puede ser null (vuelo en la fecha exacta pedida:
// el backend NO lo rellena → el día se deriva de departure.at).
function directLeg(origin, flightDate, arrivalAt, departureAt) {
  const segment = { arrival: { at: arrivalAt } };
  if (departureAt) segment.departure = { at: departureAt };
  const leg = { origin, offer: { itineraries: [{ segments: [segment] }] } };
  if (flightDate) leg.flightDate = flightDate;
  return leg;
}
// Helper: tramo con escalas → segments vacío → sin hora.
function stopoverLeg(origin, flightDate) {
  const leg = { origin, offer: { itineraries: [{ segments: [] }] } };
  if (flightDate) leg.flightDate = flightDate;
  return leg;
}

const H = 3_600_000;

test("(a) 3 directos el mismo día, poca diferencia → spread pequeño, mismo día, completo", () => {
  const legs = [
    directLeg("MAD", "2026-08-27", "2026-08-27T20:10:00Z"),
    directLeg("BCN", "2026-08-27", "2026-08-27T21:10:00Z"),
    directLeg("LON", "2026-08-27", "2026-08-27T22:00:00+00:00"),
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.legsTotal, 3);
  assert.equal(r.legsWithTime, 3);
  assert.equal(r.spreadMs, 110 * 60 * 1000); // 22:00 − 20:10 = 1h50m
  assert.equal(r.differentDays, false);
  assert.equal(r.partial, false);
});

test("(b) tramos en días distintos → spread grande y differentDays", () => {
  const legs = [
    directLeg("MAD", "2026-08-27", "2026-08-27T21:00:00Z"),
    directLeg("BCN", "2026-08-26", "2026-08-26T18:00:00Z"),
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.legsTotal, 2);
  assert.equal(r.legsWithTime, 2);
  assert.equal(r.spreadMs, 27 * H); // 27-ago 21:00 − 26-ago 18:00 = 27h
  assert.equal(r.differentDays, true);
  assert.equal(r.partial, false);
});

test("(c) un tramo con escalas → partial, spread solo con los que tienen hora", () => {
  const legs = [
    directLeg("MAD", "2026-08-27", "2026-08-27T19:00:00Z"),
    directLeg("BCN", "2026-08-27", "2026-08-27T22:00:00Z"),
    stopoverLeg("LON", "2026-08-27"), // con escalas → sin hora
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.legsTotal, 3);
  assert.equal(r.legsWithTime, 2);
  assert.equal(r.spreadMs, 3 * H); // 22:00 − 19:00, ignorando el de escalas
  assert.equal(r.differentDays, false);
  assert.equal(r.partial, true);
});

test("(d) un solo tramo con hora → spread null (no se puede comparar)", () => {
  const legs = [
    directLeg("MAD", "2026-08-27", "2026-08-27T19:00:00Z"),
    stopoverLeg("BCN", "2026-08-27"),
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.legsTotal, 2);
  assert.equal(r.legsWithTime, 1);
  assert.equal(r.spreadMs, null);
  assert.equal(r.partial, true);
});

test("(e) single-origin → un tramo → no aplica (spread null)", () => {
  const legs = [directLeg("MAD", "2026-08-27", "2026-08-27T19:00:00Z")];
  const r = computeArrivalSpread(legs);
  assert.equal(r.legsTotal, 1);
  assert.equal(r.legsWithTime, 1);
  assert.equal(r.spreadMs, null);
  assert.equal(r.differentDays, false);
  assert.equal(r.partial, false);
});

test("differentDays usa flightDate aunque la diferencia horaria sea pequeña", () => {
  // Vuelo nocturno: sale el 27 y llega ya el 28; el otro sale/llega el 28.
  const legs = [
    directLeg("MAD", "2026-08-27", "2026-08-28T01:00:00Z"),
    directLeg("BCN", "2026-08-28", "2026-08-28T03:00:00Z"),
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.spreadMs, 2 * H);
  assert.equal(r.differentDays, true); // fechas de salida distintas
});

test("differentDays se deriva de departure.at cuando solo UN tramo trae fallback", () => {
  // Caso real: MAD cae al 27 (fallback → flightDate), BCN se queda el 26 (en la
  // fecha exacta → SIN flightDate, su día sale de departure.at). Antes esto daba
  // falso negativo si solo se miraba flightDate (Set de tamaño 1).
  const legs = [
    directLeg("MAD", "2026-08-27", "2026-08-27T22:00:00Z", "2026-08-27T20:10:00+02:00"),
    directLeg("BCN", null, "2026-08-26T20:00:00Z", "2026-08-26T18:00:00+02:00"),
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.differentDays, true);
});

test("differentDays falso: sin flightDate pero misma fecha de salida (mock típico)", () => {
  const legs = [
    directLeg("MAD", null, "2026-08-27T11:00:00Z", "2026-08-27T08:30:00"),
    directLeg("BCN", null, "2026-08-27T12:30:00Z", "2026-08-27T08:30:00"),
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.differentDays, false);
  assert.equal(r.legsWithTime, 2);
});

test("robustez: null / undefined / [] no lanzan y devuelven ceros", () => {
  for (const input of [null, undefined, []]) {
    const r = computeArrivalSpread(input);
    assert.deepEqual(r, {
      legsTotal: input && input.length ? input.length : 0,
      legsWithTime: 0,
      spreadMs: null,
      differentDays: false,
      partial: false,
    });
  }
});

test("robustez: tramos malformados (sin offer / arrival inválida) no lanzan", () => {
  const legs = [
    {}, // sin offer
    { origin: "BCN", offer: {} },
    { origin: "LON", offer: { itineraries: [{ segments: [{ arrival: { at: "no-es-fecha" } }] }] } },
    directLeg("MAD", "2026-08-27", "2026-08-27T19:00:00Z"),
  ];
  const r = computeArrivalSpread(legs);
  assert.equal(r.legsTotal, 4);
  assert.equal(r.legsWithTime, 1); // solo el directo válido
  assert.equal(r.spreadMs, null);
  assert.equal(r.partial, true);
});

test("splitSpread: reparte ms en días/horas y marca <1h", () => {
  assert.deepEqual(splitSpread(2 * H), { days: 0, hours: 2, totalHours: 2 });
  assert.deepEqual(splitSpread(27 * H), { days: 1, hours: 3, totalHours: 27 });
  assert.deepEqual(splitSpread(48 * H), { days: 2, hours: 0, totalHours: 48 });
  assert.equal(splitSpread(20 * 60 * 1000).totalHours, 0); // 20 min → <1h
  assert.equal(splitSpread(0).totalHours, 0);
  assert.equal(splitSpread(null), null);
  assert.equal(splitSpread(-5), null);
});
