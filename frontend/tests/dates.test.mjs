// Límites de fecha del formulario: mismos que valida el backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO, horizonISO, MAX_HORIZON_DAYS, departureIsPast, suggestedReturnDate, shiftedTripDates } from "../src/utils/helpers.js";

test("addDaysISO: suma días en UTC cruzando meses, años y bisiestos", () => {
  assert.equal(addDaysISO("2026-10-08", 1), "2026-10-09");
  assert.equal(addDaysISO("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysISO("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysISO("2026-03-01", -1), "2026-02-28");
});

test("addDaysISO: entrada inválida → cadena vacía", () => {
  assert.equal(addDaysISO("", 1), "");
  assert.equal(addDaysISO(undefined, 1), "");
  assert.equal(addDaysISO("08/10/2026", 1), "");
});

test("horizonISO: hoy + 360 días, como el DATE_TOO_FAR del backend", () => {
  assert.equal(MAX_HORIZON_DAYS, 360);
  assert.equal(horizonISO("2026-10-08"), "2027-10-03");
  assert.match(horizonISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test("departureIsPast: compara con el hoy de la búsqueda, no con la medianoche local", () => {
  assert.equal(departureIsPast("2026-11-05", "2026-11-06"), true);
  assert.equal(departureIsPast("2026-11-06", "2026-11-06"), false);
  assert.equal(departureIsPast("2026-11-07", "2026-11-06"), false);
  assert.equal(departureIsPast("", "2026-11-06"), false);
});

test("suggestedReturnDate: una semana después, o el último día que cabe", () => {
  assert.equal(suggestedReturnDate("2026-11-06", "2027-11-01"), "2026-11-13");
  assert.equal(suggestedReturnDate("2027-10-30", "2027-11-01"), "2027-11-01");
  assert.equal(suggestedReturnDate("2027-11-01", "2027-11-01"), "");
});

test("shiftedTripDates: ida y vuelta se mueven juntas y no salen del horizonte", () => {
  assert.deepEqual(shiftedTripDates({
    departureDate: "2026-11-06", returnDate: "2026-11-13", tripType: "roundtrip",
    offset: 1, today: "2026-11-06", horizon: "2027-11-01",
  }), { departureDate: "2026-11-07", returnDate: "2026-11-14" });
  assert.equal(shiftedTripDates({
    departureDate: "2027-10-28", returnDate: "2027-11-01", tripType: "roundtrip",
    offset: 1, today: "2026-11-06", horizon: "2027-11-01",
  }), null);
  assert.equal(shiftedTripDates({
    departureDate: "2026-11-06", returnDate: "2026-11-13", tripType: "roundtrip",
    offset: -1, today: "2026-11-06", horizon: "2027-11-01",
  }), null);
  assert.equal(shiftedTripDates({
    departureDate: "2027-11-01", tripType: "oneway",
    offset: 1, today: "2026-11-06", horizon: "2027-11-01",
  }), null);
});
