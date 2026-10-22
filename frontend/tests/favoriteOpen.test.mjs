// Un destino guardado abre sus vuelos si hay con qué pedirlos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { favoriteOpenPlan, normalizeFavoriteSearch } from "../src/utils/favoriteOpen.js";
import { mergeFavoriteLists } from "../src/utils/account.js";

const search = {
  origins: ["MAD", "LON"],
  passengers: [1, 2],
  tripType: "oneway",
  departureDate: "2026-12-01",
  flexDays: 0,
  maxBudget: 0,
  directOnly: false,
  cabinClass: "ECONOMY",
};

test("si el destino sigue en esta búsqueda, se muestra sin pedir otra", () => {
  const plan = favoriteOpenPlan({
    code: "bcn",
    search,
    flights: [{ destination: "BCN" }, { destination: "PAR" }],
    activeSearch: search,
  });
  assert.equal(plan.action, "select");
  assert.equal(plan.code, "BCN");
});

test("si ya no está en pantalla, se busca solo ese destino con las fechas guardadas", () => {
  const plan = favoriteOpenPlan({
    code: "BCN",
    search,
    flights: [],
    activeSearch: null,
    form: null,
  });
  assert.equal(plan.action, "search");
  assert.equal(plan.code, "BCN");
  assert.deepEqual(plan.search.origins, ["MAD", "LON"]);
  assert.equal(plan.search.passengers[1], 2);
});

test("una búsqueda distinta no reutiliza la tarjeta de otra consulta", () => {
  const plan = favoriteOpenPlan({
    code: "BCN",
    search,
    flights: [{ destination: "BCN" }],
    activeSearch: { ...search, departureDate: "2026-12-20" },
  });
  assert.equal(plan.action, "search");
  assert.equal(plan.search.departureDate, "2026-12-01");
});

test("sin ciudades ni fecha no hay detalles que enseñar", () => {
  const plan = favoriteOpenPlan({ code: "BCN", search: { origins: ["NO"] }, flights: [], form: {} });
  assert.equal(plan.action, "unavailable");
  assert.equal(normalizeFavoriteSearch({ origins: ["MAD"], departureDate: "no-es-fecha" }), null);
});

test("al unir listas se queda la búsqueda aunque el precio nuevo venga vacío", () => {
  const merged = mergeFavoriteLists(
    [{ code: "BCN", city: "Barcelona", price: 40, ts: 10, search }],
    [{ code: "BCN", city: "Barcelona", price: null, ts: 20 }],
  );
  assert.equal(merged[0].price, 40);
  assert.deepEqual(merged[0].search.origins, ["MAD", "LON"]);
});
