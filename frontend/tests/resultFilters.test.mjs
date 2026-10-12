import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyResultFilters, listResults, arrivalSpreadMs, matchesArrival,
  airlinesIn, durationSteps, DEFAULT_FILTERS, sharedCountry, domesticCodes,
  nextAirlines, countryKey,
} from "../src/utils/resultFilters.js";

function leg({ date = "2026-11-15", at = "08:30", dur = "PT2H", transfers = 0, airline = "IB", flightDate = null } = {}) {
  const segments = transfers === 0
    ? [{
      departure: { iataCode: "MAD", at: `${date}T${at}:00` },
      arrival: { iataCode: "ROM", at: `${date}T${at}:00` },
    }]
    : [];
  return {
    ...(flightDate ? { flightDate } : {}),
    offer: {
      transfers,
      validatingAirlineCodes: airline ? [airline] : [],
      itineraries: [{ duration: dur, segments }],
    },
  };
}

function dest(code, legs, total = 100) {
  return { destination: code, totalCostEUR: total, fairnessScore: 80, flights: legs };
}

test("menos de 4 h exige hora real en todos y el mismo día", () => {
  const close = dest("ROM", [leg({ at: "08:00" }), leg({ at: "10:00" })]);
  const far = dest("PAR", [leg({ at: "08:00" }), leg({ at: "15:00" })]);
  const stop = dest("LIS", [leg({ transfers: 1 }), leg()]);
  const otherDay = dest("BCN", [leg({ flightDate: "2026-11-15" }), leg({ flightDate: "2026-11-16" })]);
  assert.equal(matchesArrival(close, "within4h"), true);
  assert.equal(matchesArrival(far, "within4h"), false);
  assert.equal(matchesArrival(stop, "within4h"), false);
  assert.equal(matchesArrival(otherDay, "within4h"), false);
  assert.equal(matchesArrival(otherDay, "sameDay"), false);
  assert.equal(matchesArrival(close, "sameDay"), true);
  const out = applyResultFilters([far, close, stop], { ...DEFAULT_FILTERS, arrival: "within4h" });
  assert.deepEqual(out.map((d) => d.destination), ["ROM"]);
});

test("lo más cerca ordena por la diferencia y deja al final los que no tienen hora", () => {
  const a = dest("AAA", [leg({ at: "08:00" }), leg({ at: "12:00" })], 50);
  const b = dest("BBB", [leg({ at: "08:00" }), leg({ at: "09:00" })], 80);
  const c = dest("CCC", [leg({ transfers: 1 }), leg()], 40);
  assert.ok(arrivalSpreadMs(b) < arrivalSpreadMs(a));
  assert.equal(arrivalSpreadMs(c), null);
  const out = listResults([a, c, b], { ...DEFAULT_FILTERS, arrival: "closest" }, "total");
  assert.deepEqual(out.map((d) => d.destination), ["BBB", "AAA", "CCC"]);
});

test("escalas: directo y hasta una, sin contar lo que no se sabe", () => {
  const direct = dest("ROM", [leg({ transfers: 0 }), leg({ transfers: 0 })]);
  const one = dest("PAR", [leg({ transfers: 1 }), leg({ transfers: 0 })]);
  const two = dest("LIS", [leg({ transfers: 2 }), leg({ transfers: 0 })]);
  const unknown = dest("BCN", [{ offer: { itineraries: [{ segments: [] }] } }, leg()]);
  assert.deepEqual(
    applyResultFilters([direct, one, two, unknown], { ...DEFAULT_FILTERS, stops: "direct" }).map((d) => d.destination),
    ["ROM"],
  );
  assert.deepEqual(
    applyResultFilters([direct, one, two, unknown], { ...DEFAULT_FILTERS, stops: "max1" }).map((d) => d.destination),
    ["ROM", "PAR"],
  );
});

test("duración y aerolínea solo dejan pasar lo que el billete declara", () => {
  const short = dest("ROM", [leg({ dur: "PT2H", airline: "IB" }), leg({ dur: "PT3H", airline: "FR" })], 90);
  const long = dest("PAR", [leg({ dur: "PT6H", airline: "IB" }), leg({ dur: "PT2H", airline: "IB" })], 70);
  assert.ok(durationSteps([short, long]).length >= 1);
  const cap = durationSteps([short, long])[0];
  const byDur = applyResultFilters([short, long], { ...DEFAULT_FILTERS, maxDurationMin: cap });
  assert.deepEqual(byDur.map((d) => d.destination), ["ROM"]);
  const onlyIb = applyResultFilters([short, long], { ...DEFAULT_FILTERS, airlines: ["IB"] });
  assert.deepEqual(onlyIb.map((d) => d.destination), ["PAR"]);
  assert.deepEqual(airlinesIn([short, long]), ["FR", "IB"]);
});

test("solo nacional: mismo país, y un código desconocido no cuenta", () => {
  assert.equal(sharedCountry(["MAD", "BCN"]), "Spain");
  assert.equal(sharedCountry(["MAD", "LON"]), null);
  assert.equal(sharedCountry(["ZZZ"]), null);
  assert.equal(countryKey("AGP"), "Spain");
  assert.equal(countryKey("LHR"), null);
  const spain = domesticCodes("Spain", ["MAD", "BCN"]);
  assert.ok(spain.includes("AGP") && spain.includes("PMI") && spain.includes("VLC"));
  assert.ok(!spain.includes("MAD") && !spain.includes("PAR"));
  const agp = dest("AGP", [leg(), leg()]);
  const par = dest("PAR", [leg(), leg()]);
  const lhr = dest("LHR", [leg(), leg()]);
  const out = applyResultFilters([par, agp, lhr], { ...DEFAULT_FILTERS, domestic: true }, { country: "Spain" });
  assert.deepEqual(out.map((d) => d.destination), ["AGP"]);
  assert.equal(applyResultFilters([agp], { ...DEFAULT_FILTERS, domestic: true }, { country: null }).length, 0);
});

test("el primer toque de aerolínea la oculta, no vacía el resto", () => {
  assert.deepEqual(nextAirlines(null, "IB", ["IB", "FR", "VY"]), ["FR", "VY"]);
  assert.deepEqual(nextAirlines(["FR", "VY"], "IB", ["IB", "FR", "VY"]), null);
  assert.deepEqual(nextAirlines(["VY"], "VY", ["IB", "FR", "VY"]), ["VY"]);
});
