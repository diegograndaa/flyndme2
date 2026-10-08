import { test } from "node:test";
import assert from "node:assert/strict";
import { readStoredList, isFavoriteEntry, isRecentSearchEntry } from "../src/utils/storage.js";

const mem = (v) => ({ getItem: () => v });

test("readStoredList: JSON roto, null, objeto o número → lista vacía", () => {
  for (const v of ["{no json", "null", '{"a":1}', "42", '"texto"']) assert.deepEqual(readStoredList("k", undefined, mem(v)), [], v);
  assert.deepEqual(readStoredList("k", undefined, mem(null)), []);
  assert.deepEqual(readStoredList("k", undefined, null), []);
});

test("readStoredList: si leer localStorage lanza, lista vacía", () => {
  assert.deepEqual(readStoredList("k", undefined, { getItem() { throw new Error("SecurityError"); } }), []);
});

test("favoritos: se quedan solo las entradas con código IATA", () => {
  const raw = JSON.stringify([{ code: "PAR", city: "París" }, { code: 5 }, null, "x", { code: "par" }, { city: "Roma" }]);
  assert.deepEqual(readStoredList("k", isFavoriteEntry, mem(raw)).map((f) => f.code), ["PAR"]);
});

test("búsquedas recientes: origins tiene que ser un array de textos y haber fecha", () => {
  const raw = JSON.stringify([
    { origins: ["MAD", "LON"], departureDate: "2026-12-01", tripType: "oneway" },
    { origins: "MAD", departureDate: "2026-12-01" },
    { origins: [], departureDate: "2026-12-01" },
    { origins: ["MAD"] },
    { origins: ["MAD", 7], departureDate: "2026-12-01" },
  ]);
  const ok = readStoredList("k", isRecentSearchEntry, mem(raw));
  assert.equal(ok.length, 1);
  assert.deepEqual(ok[0].origins, ["MAD", "LON"]);
});
