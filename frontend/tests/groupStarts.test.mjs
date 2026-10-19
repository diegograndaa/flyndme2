// Un escenario de la portada rellena la búsqueda. No inventa fecha ni destino.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_STARTS, applyGroupStart } from "../src/utils/groupStarts.js";

test("group starts: cada escenario tiene al menos dos ciudades", () => {
  assert.equal(GROUP_STARTS.length, 6);
  const ids = new Set();
  for (const start of GROUP_STARTS) {
    assert.ok(!ids.has(start.id), start.id);
    ids.add(start.id);
    assert.ok(start.origins.length >= 2 && start.origins.length <= 8, start.id);
    assert.ok(start.tripType === "oneway" || start.tripType === "roundtrip");
    assert.ok(start.optimizeBy === "total" || start.optimizeBy === "fairness");
  }
  assert.equal(GROUP_STARTS.find((s) => s.id === "fair").optimizeBy, "fairness");
});

test("group starts: rellena ciudades y viajeros y no inventa la fecha", () => {
  const next = applyGroupStart({ id: "friends" }, {});
  assert.deepEqual(next.origins, ["MAD", "LON", "BER"]);
  assert.deepEqual(next.passengers, [1, 1, 1]);
  assert.equal(next.tripType, "oneway");
  assert.equal(next.optimizeBy, "total");
  assert.deepEqual(next.selectedDests, []);
  assert.equal(next.departureDate, "");
  assert.equal(next.returnDate, "");
});

test("group starts: ida y vuelta propone la vuelta a los 7 días si ya hay ida", () => {
  const kept = applyGroupStart({ id: "couple" }, { departureDate: "2026-11-18", returnDate: "2026-11-22" });
  assert.equal(kept.tripType, "roundtrip");
  assert.deepEqual(kept.origins, ["BCN", "LON"]);
  assert.equal(kept.returnDate, "2026-11-22");

  const filled = applyGroupStart({ id: "weekend" }, { departureDate: "2026-11-18", returnDate: "" });
  assert.equal(filled.returnDate, "2026-11-25");

  const fixed = applyGroupStart({ id: "sendoff" }, { departureDate: "2026-11-18", returnDate: "2026-11-18" });
  assert.equal(fixed.returnDate, "2026-11-25");
});

test("group starts: solo ida conserva la vuelta que ya hubiera y un id desconocido no hace nada", () => {
  const next = applyGroupStart({ id: "fair" }, { departureDate: "2026-12-01", returnDate: "2026-12-08" });
  assert.equal(next.optimizeBy, "fairness");
  assert.equal(next.tripType, "oneway");
  assert.equal(next.departureDate, "2026-12-01");
  assert.equal(next.returnDate, "2026-12-08");
  assert.equal(applyGroupStart({ id: "no-existe" }), null);
  assert.equal(applyGroupStart(null), null);
});
