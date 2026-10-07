import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeWatch, watchId, addWatch, removeWatch, activeWatches, priceDrop,
  readWatches, writeWatches, MAX_WATCHES, WATCH_KEY,
} from "../src/utils/priceWatch.js";

const params = { origins: ["mad", "LON"], passengers: [2, 1], departureDate: "2026-12-06", tripType: "oneway", destination: "par" };

test("makeWatch: normaliza la búsqueda y guarda el total redondeado", () => {
  const w = makeWatch(params, 569.4, 1000);
  assert.deepEqual(w.origins, ["MAD", "LON"]);
  assert.deepEqual(w.passengers, [2, 1]);
  assert.equal(w.destination, "PAR");
  assert.equal(w.returnDate, "");
  assert.equal(w.savedTotalEUR, 569);
  assert.equal(w.id, "PAR|MADx2,LONx1|2026-12-06|");
});

test("watchId: distingue pasajeros y fecha de vuelta (ida y vuelta)", () => {
  const a = watchId({ ...params, tripType: "roundtrip", returnDate: "2026-12-10" });
  const b = watchId({ ...params, tripType: "roundtrip", returnDate: "2026-12-11" });
  const c = watchId({ ...params, passengers: [1, 1] });
  assert.notEqual(watchId(params), watchId({ ...params, nonStop: true }), "solo directos es otra vigilancia");
  assert.notEqual(a, b);
  assert.notEqual(watchId(params), c);
});

test("addWatch: sustituye la misma vigilancia y limita a las más recientes", () => {
  let list = [];
  for (let i = 0; i < MAX_WATCHES + 2; i++) list = addWatch(list, makeWatch({ ...params, destination: `D${i}X` }, 100 + i, i));
  assert.equal(list.length, MAX_WATCHES);
  assert.equal(list[0].destination, `D${MAX_WATCHES + 1}X`);
  const again = addWatch(list, makeWatch({ ...params, destination: list[1].destination }, 50, 99));
  assert.equal(again.length, MAX_WATCHES);
  assert.equal(again[0].savedTotalEUR, 50);
  assert.equal(removeWatch(again, again[0].id).length, MAX_WATCHES - 1);
});

test("activeWatches: descarta viajes pasados y vigilancias de hace más de 30 días", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const ok = makeWatch(params, 100, now - 86_400_000);
  const past = makeWatch({ ...params, departureDate: "2026-10-01" }, 100, now);
  const old = makeWatch({ ...params, destination: "ROM" }, 100, now - 31 * 86_400_000);
  assert.deepEqual(activeWatches([ok, past, old], "2026-10-07", now).map((w) => w.id), [ok.id]);
});

test("priceDrop: solo avisa con una bajada apreciable", () => {
  assert.equal(priceDrop(569, 560), null, "9 € no llega a 15 €");
  assert.equal(priceDrop(1000, 960), null, "40 € no llega al 5 % de 1000");
  assert.deepEqual(priceDrop(569, 480), { savingEUR: 89, currentTotalEUR: 480 });
  assert.equal(priceDrop(569, 600), null, "subida → nada");
  assert.equal(priceDrop(0, 100), null);
  assert.equal(priceDrop(569, NaN), null);
});

test("readWatches/writeWatches: sobrevive a datos corruptos", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(readWatches(storage), []);
  store.set(WATCH_KEY, "{no es json");
  assert.deepEqual(readWatches(storage), []);
  const w = makeWatch(params, 200);
  writeWatches(storage, [w, { basura: true }]);
  assert.deepEqual(readWatches(storage).map((x) => x.id), [w.id]);
});

test("safeStorage: si leer localStorage lanza (cookies bloqueadas) devuelve null y nada rompe", async () => {
  const { safeStorage, readWatches, writeWatches } = await import("../src/utils/priceWatch.js");
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("SecurityError"); } });
  assert.equal(safeStorage(blocked), null);
  assert.deepEqual(readWatches(safeStorage(blocked)), []);
  assert.doesNotThrow(() => writeWatches(safeStorage(blocked), []));
  const store = new Map();
  const ok = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  assert.equal(safeStorage(ok), ok.localStorage);
  assert.equal(safeStorage(undefined), null);
});
