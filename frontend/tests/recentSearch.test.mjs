import { test } from "node:test";
import assert from "node:assert/strict";
import { savedFlexDays, savedBudget, restoreFlexBudget, recentSearchKey } from "../src/utils/recentSearch.js";

test("recentSearch: solo se guarda un margen que el formulario enseña", () => {
  assert.equal(savedFlexDays(true, 2), 2);
  assert.equal(savedFlexDays(false, 2), 0);
  assert.equal(savedFlexDays(true, 4), 0);
  assert.equal(savedFlexDays(true, 0), 0);
});

test("recentSearch: el tope guardado sigue el deslizador", () => {
  assert.equal(savedBudget(true, 150), 150);
  assert.equal(savedBudget(true, 30), 30);
  assert.equal(savedBudget(true, 800), 800);
  assert.equal(savedBudget(false, 150), 0);
  assert.equal(savedBudget(true, 155), 0);
  assert.equal(savedBudget(true, 20), 0);
});

test("recentSearch: al abrir, 0 o un valor raro es «apagado»", () => {
  assert.deepEqual(restoreFlexBudget({ flexDays: 2, maxBudget: 150 }), { flexDays: 2, maxBudget: 150 });
  assert.deepEqual(restoreFlexBudget({}), { flexDays: null, maxBudget: null });
  assert.deepEqual(restoreFlexBudget({ flexDays: 0, maxBudget: 0 }), { flexDays: null, maxBudget: null });
  assert.deepEqual(restoreFlexBudget({ flexDays: 5, maxBudget: 155 }), { flexDays: null, maxBudget: null });
});

test("recentSearch: la clave distingue vuelta, viajeros, margen y tope", () => {
  const base = { origins: ["MAD", "LON"], passengers: [1, 1], departureDate: "2026-11-15", tripType: "oneway", flexDays: 0, maxBudget: 0 };
  assert.equal(recentSearchKey(base), recentSearchKey({ ...base }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, flexDays: 2 }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, maxBudget: 150 }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, passengers: [2, 1] }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, tripType: "roundtrip", returnDate: "2026-11-22" }));
  // Una reciente vieja, sin viajeros ni extras, es la misma que 1 por ciudad en día exacto.
  assert.equal(
    recentSearchKey(base),
    recentSearchKey({ origins: base.origins, departureDate: base.departureDate, tripType: "oneway" }),
  );
});
