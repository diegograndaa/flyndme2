import { test } from "node:test";
import assert from "node:assert/strict";
import { savedFlexDays, savedBudget, savedCabin, savedDestinations, restoreFlexBudget, restoreDirectCabin, restoreDestinations, recentSearchKey } from "../src/utils/recentSearch.js";

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

test("recentSearch: directo y cabina se guardan solo si el formulario los admite", () => {
  assert.equal(savedCabin("BUSINESS"), "BUSINESS");
  assert.equal(savedCabin("first"), "FIRST");
  assert.equal(savedCabin("FOO"), "ECONOMY");
  assert.equal(savedCabin(undefined), "ECONOMY");
  assert.deepEqual(restoreDirectCabin({ directOnly: true, cabinClass: "PREMIUM_ECONOMY" }), {
    directOnly: true, cabinClass: "PREMIUM_ECONOMY",
  });
  assert.deepEqual(restoreDirectCabin({}), { directOnly: false, cabinClass: "ECONOMY" });
  assert.deepEqual(restoreDirectCabin({ directOnly: "yes", cabinClass: "FOO" }), {
    directOnly: false, cabinClass: "ECONOMY",
  });
});

test("recentSearch: los destinos guardados son del catálogo y no son orígenes", () => {
  assert.deepEqual(savedDestinations(["rom", "MAD", "XXX", "LIS", "lis"], ["MAD", "LON"]), ["ROM", "LIS"]);
  assert.deepEqual(savedDestinations([], ["MAD"]), []);
  assert.deepEqual(savedDestinations(undefined, ["MAD"]), []);
  assert.deepEqual(restoreDestinations({}), []);
  assert.deepEqual(restoreDestinations({ origins: ["MAD"], destinations: ["ROM", "MAD", "NOPE"] }), ["ROM"]);
});

test("recentSearch: la clave distingue vuelta, viajeros, margen y tope", () => {
  const base = { origins: ["MAD", "LON"], passengers: [1, 1], departureDate: "2026-11-15", tripType: "oneway", flexDays: 0, maxBudget: 0 };
  assert.equal(recentSearchKey(base), recentSearchKey({ ...base }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, flexDays: 2 }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, maxBudget: 150 }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, passengers: [2, 1] }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, directOnly: true }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, cabinClass: "BUSINESS" }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, destinations: ["ROM", "LIS"] }));
  assert.equal(
    recentSearchKey({ ...base, destinations: ["LIS", "ROM"] }),
    recentSearchKey({ ...base, destinations: ["ROM", "LIS"] }),
  );
  assert.equal(recentSearchKey(base), recentSearchKey({ ...base, destinations: [] }));
  assert.notEqual(recentSearchKey(base), recentSearchKey({ ...base, tripType: "roundtrip", returnDate: "2026-11-22" }));
  // Una reciente vieja, sin viajeros ni extras, es la misma que 1 por ciudad en día exacto.
  assert.equal(
    recentSearchKey(base),
    recentSearchKey({ origins: base.origins, departureDate: base.departureDate, tripType: "oneway" }),
  );
});
