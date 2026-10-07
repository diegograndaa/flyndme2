import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSharedFlights, normalizeDestination } from "../src/utils/sharedResults.js";

test("sharedResults: números como texto pasan a número", () => {
  const [d] = normalizeSharedFlights([{ destination: "ROM", totalCostEUR: "120", averageCostPerTraveler: "60", fairnessScore: "80",
    flights: [{ origin: "mad", price: "50", passengers: "2" }] }]);
  assert.equal(d.totalCostEUR, 120);
  assert.equal(d.averageCostPerTraveler, 60);
  assert.equal(d.fairnessScore, 80);
  assert.deepEqual(d.flights[0], { origin: "MAD", price: 50, passengers: 2, totalForOrigin: 100 });
});

test("sharedResults: nunca se inventa un total — sin total válido el destino se descarta", () => {
  assert.deepEqual(normalizeSharedFlights([{ destination: "ROM" }, { destination: "PAR", totalCostEUR: "abc" }, { destination: "LIS", totalCostEUR: -5 }, null, "x", { totalCostEUR: 10 }]), []);
});

test("sharedResults: campos opcionales no numéricos se quitan (no se rellenan)", () => {
  const d = normalizeDestination({ destination: "PAR", totalCostEUR: 100, averageCostPerTraveler: "n/a", fairnessScore: null });
  assert.equal("averageCostPerTraveler" in d, false);
  assert.equal("fairnessScore" in d, false);
});

test("sharedResults: tramos sin precio válido se descartan; pasajeros mínimo 1", () => {
  const d = normalizeDestination({ destination: "PAR", totalCostEUR: 100, flights: [{ origin: "MAD", price: 0 }, { origin: "LON", price: "x" }, { price: 5 }, { origin: "BER", price: 30, passengers: 0 }] });
  assert.deepEqual(d.flights.map((f) => [f.origin, f.passengers]), [["BER", 1]]);
});

test("sharedResults: datos correctos no cambian", () => {
  const ok = { destination: "PAR", totalCostEUR: 200, averageCostPerTraveler: 100, fairnessScore: 90, flights: [{ origin: "MAD", price: 100, passengers: 1, totalForOrigin: 100, offer: { id: "x" } }] };
  assert.deepEqual(normalizeDestination(ok), ok);
  assert.deepEqual(normalizeSharedFlights("no-array"), []);
});
