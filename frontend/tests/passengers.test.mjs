import { test } from "node:test";
import assert from "node:assert/strict";
import { paxByOrigin } from "../src/utils/passengers.js";

test("paxByOrigin: alinea con las ciudades sin repetir y en su orden", () => {
  assert.deepEqual(paxByOrigin(["MAD", "LON"], [2, 3]), [{ origin: "MAD", passengers: 2 }, { origin: "LON", passengers: 3 }]);
});

test("paxByOrigin: una fila vacía no desplaza los viajeros de las demás", () => {
  assert.deepEqual(paxByOrigin(["", "MAD", "LON"], [1, 3, 2]), [{ origin: "MAD", passengers: 3 }, { origin: "LON", passengers: 2 }]);
});

test("paxByOrigin: una ciudad repetida suma sus filas (grupo con dos viajeros de MAD)", () => {
  assert.deepEqual(paxByOrigin(["MAD", "MAD", "BCN"], [1, 2, 1]), [{ origin: "MAD", passengers: 3 }, { origin: "BCN", passengers: 1 }]);
  assert.deepEqual(paxByOrigin([" mad ", "MAD"], [1, 1]), [{ origin: "MAD", passengers: 2 }]);
});

test("paxByOrigin: valores ausentes o raros cuentan como 1; nada si no hay ciudades", () => {
  assert.deepEqual(paxByOrigin(["MAD", "LON"], []), [{ origin: "MAD", passengers: 1 }, { origin: "LON", passengers: 1 }]);
  assert.deepEqual(paxByOrigin(["MAD"], ["abc"]), [{ origin: "MAD", passengers: 1 }]);
  assert.deepEqual(paxByOrigin(["MAD"], [0]), [{ origin: "MAD", passengers: 1 }]);
  assert.deepEqual(paxByOrigin([], []), []);
  assert.deepEqual(paxByOrigin(undefined, undefined), []);
});

test("paxByOrigin: acepta el mismo criterio de código que la lista de ciudades", () => {
  const toCode = (o) => ({ madrid: "MAD", mad: "MAD" }[String(o).trim().toLowerCase()] || String(o).trim().toUpperCase());
  assert.deepEqual(paxByOrigin(["Madrid", "MAD", "LON"], [2, 1, 1], toCode), [{ origin: "MAD", passengers: 3 }, { origin: "LON", passengers: 1 }]);
});
