import { test } from "node:test";
import assert from "node:assert/strict";
import {
  airlineName, airportTimeZone, arrivalClock, clockHHMM, durationParts, legSchedule, legStopCount,
} from "../src/utils/flightTime.js";

// 15:10 en Madrid (CEST, +02) + 85 min = 14:35Z.
const ARR = "2026-08-10T14:35:00Z";

test("la llegada en Madrid es 16:35 y en Londres 15:35", () => {
  assert.equal(clockHHMM("2026-08-10T15:10:00+02:00"), "15:10");
  assert.equal(arrivalClock(ARR, "MAD"), "16:35");
  assert.equal(arrivalClock(ARR, "BCN"), "16:35");
  assert.equal(arrivalClock(ARR, "LHR"), "15:35");
  assert.equal(arrivalClock(ARR, "LON"), "15:35");
});

test("un instante UTC sin zona conocida no pinta hora", () => {
  assert.equal(arrivalClock(ARR, "ZZZ"), "");
  assert.equal(arrivalClock(ARR, "UFA"), "");
  assert.equal(airportTimeZone("UFA"), null);
});

test("el mock sin zona enseña los dígitos del texto", () => {
  assert.equal(arrivalClock("2026-09-15T11:00:00", "FCO"), "11:00");
  assert.equal(clockHHMM("2026-09-15T08:30:00"), "08:30");
});

test("Canarias, Azores y Madeira no usan la hora de la península", () => {
  assert.equal(airportTimeZone("MAD"), "Europe/Madrid");
  assert.equal(airportTimeZone("TFS"), "Atlantic/Canary");
  assert.equal(airportTimeZone("LPA"), "Atlantic/Canary");
  assert.equal(airportTimeZone("LHR"), "Europe/London");
  assert.equal(airportTimeZone("PDL"), "Atlantic/Azores");
  assert.equal(airportTimeZone("FNC"), "Atlantic/Madeira");
  assert.equal(airportTimeZone("ZZZ"), null);
  assert.equal(arrivalClock(ARR, "TFS"), "15:35");
  assert.equal(arrivalClock("2026-01-10T14:35:00Z", "MAD"), "15:35");
  assert.equal(arrivalClock("2026-01-10T14:35:00Z", "LPA"), "14:35");
  assert.equal(arrivalClock("2026-01-10T14:35:00Z", "PDL"), "13:35");
});

test("Rusia: Kaliningrado y Moscú sí; más al este, no", () => {
  assert.equal(airportTimeZone("KGD"), "Europe/Kaliningrad");
  assert.equal(airportTimeZone("LED"), "Europe/Moscow");
  assert.equal(airportTimeZone("SVO"), "Europe/Moscow");
  assert.equal(airportTimeZone("UFA"), null);
});

test("duración y escalas", () => {
  assert.deepEqual(durationParts("PT1H25M"), { h: 1, m: 25 });
  assert.deepEqual(durationParts("PT2H"), { h: 2, m: 0 });
  assert.deepEqual(durationParts("PT45M"), { h: 0, m: 45 });
  assert.equal(durationParts(""), null);
  assert.equal(durationParts("PT0H"), null);
  assert.equal(legStopCount([], 2), 2);
  assert.equal(legStopCount([{}], 0), 0);
  assert.equal(legStopCount([{}], 1), 1);
  assert.equal(legStopCount([{}, {}], null), 1);
  assert.equal(legStopCount([], null), null);
  assert.equal(legStopCount([], undefined), null);
});

test("el tramo de Air Europa cuadra con 15:10 MAD y 16:35 BCN", () => {
  const leg = legSchedule({
    itinerary: {
      duration: "PT1H25M",
      segments: [{
        departure: { iataCode: "MAD", at: "2026-08-10T15:10:00+02:00" },
        arrival: { iataCode: "BCN", at: ARR },
        carrierCode: "UX",
      }],
    },
    transfers: 0,
  });
  assert.deepEqual(leg, {
    from: "MAD", to: "BCN", dep: "15:10", arr: "16:35", stops: 0,
    carrier: "UX", duration: { h: 1, m: 25 },
  });
  assert.equal(airlineName("UX"), "Air Europa");
  assert.equal(airlineName("qq"), "");
});

test("una escala sin segmentos no inventa relojes", () => {
  const leg = legSchedule({
    itinerary: { duration: "PT5H", segments: [] },
    transfers: 1,
    from: "MAD",
    to: "ATH",
    airline: "IB",
  });
  assert.equal(leg.dep, "");
  assert.equal(leg.arr, "");
  assert.equal(leg.stops, 1);
  assert.equal(leg.from, "MAD");
  assert.equal(leg.to, "ATH");
  assert.equal(leg.carrier, "IB");
});

test("sin datos de vuelo no hay franja", () => {
  assert.equal(legSchedule({}), null);
  assert.equal(legSchedule({ from: "MAD", to: "BCN" }), null);
});
