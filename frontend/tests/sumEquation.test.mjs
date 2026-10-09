import { test } from "node:test";
import assert from "node:assert/strict";
import { displayedInteger, visibleSumParts } from "../src/utils/sumEquation.js";

test("displayedInteger: mismo entero que el precio pintado", () => {
  assert.equal(displayedInteger(10.4, "EUR"), 10);
  assert.equal(displayedInteger(10.5, "EUR"), 11);
  assert.equal(displayedInteger(20.8, "EUR"), 21);
  assert.equal(displayedInteger(100, "GBP"), 86);
  assert.equal(displayedInteger(10, "GBP"), 9);
  assert.equal(displayedInteger(100, "USD"), 109);
});

test("visibleSumParts: enseña la suma cuando los enteros cuadran", () => {
  assert.deepEqual(visibleSumParts([67, 37], 104, "EUR"), [67, 37]);
  assert.deepEqual(visibleSumParts([130, 170], 300, "EUR"), [130, 170]);
  // 50+50+100 se ve distinto en cada tramo: la suma sí informa.
  assert.deepEqual(visibleSumParts([50, 50, 100], 200, "EUR"), [50, 50, 100]);
});

test("visibleSumParts: oculta la suma si todos pagan lo mismo a la vista", () => {
  assert.equal(visibleSumParts([73, 73], 146, "EUR"), null);
  // 50.4+49.6=100 se pintaría «€50 + €50 = €100»: el mismo número dos veces.
  assert.equal(visibleSumParts([50.4, 49.6], 100, "EUR"), null);
});

test("visibleSumParts: oculta la ecuación si el redondeo no suma", () => {
  // 10.6+10.6=21.2 se vería «€11 + €11 = €21»
  assert.equal(visibleSumParts([10.6, 10.6], 21.2, "EUR"), null);
  // 10.4+10.4=20.8 se vería «€10 + €10 = €21»
  assert.equal(visibleSumParts([10.4, 10.4], 20.8, "EUR"), null);
});

test("visibleSumParts: en libras, enteros en euros pueden no cuadrar al redondear", () => {
  // £9 + £9 = £17
  assert.equal(visibleSumParts([10, 10], 20, "GBP"), null);
  // 100*0.86=86, 200*0.86=172, 300*0.86=258 → 86+172=258
  assert.deepEqual(visibleSumParts([100, 200], 300, "GBP"), [100, 200]);
});

test("legEquation: el producto solo si cuadra, también al redondear", async () => {
  const { legEquation } = await import("../src/utils/sumEquation.js");
  assert.deepEqual(legEquation(128, 1, 128, "EUR"), { pax: 1, total: 128, showProduct: true });
  // totalForOrigin verificado distinto del precio mostrado → no «1 × €128 = €134»
  const mixed = legEquation(128, 1, 134, "EUR");
  assert.equal(mixed.showProduct, true);
  assert.equal(mixed.total, 128);
  // 2 × €10.4 se vería «2 × €10 = €21»
  assert.equal(legEquation(10.4, 2, 20.8, "EUR").showProduct, false);
  assert.equal(legEquation(10, 2, 20, "GBP").showProduct, false);
  assert.equal(legEquation("no", 1, 10, "EUR"), null);
});

test("visibleSumParts: no enseña un total que no es el del backend", () => {
  assert.equal(visibleSumParts([67, 37], 200, "EUR"), null);
  assert.equal(visibleSumParts([67], 67, "EUR"), null);
  assert.equal(visibleSumParts([1, 1, 1, 1, 1, 1, 1], 7, "EUR"), null);
  assert.equal(visibleSumParts([10, NaN], 10, "EUR"), null);
  assert.equal(visibleSumParts(null, 10, "EUR"), null);
});
