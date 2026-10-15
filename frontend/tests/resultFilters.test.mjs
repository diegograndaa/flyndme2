import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyResultFilters, listResults, arrivalSpreadMs, matchesArrival,
  airlinesIn, durationSteps, DEFAULT_FILTERS, sharedCountry, domesticCodes,
  nextAirlines, countryKey, arrivalBars, arrivalGapChoices, arrivalSliderRange, ticketClock, validArrivalGap,
  nextShownDestination, filtersHoldResults,
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
  assert.equal(countryKey("LHR"), "United Kingdom");
  assert.equal(countryKey("QQQ"), null);
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

function legAt(origin, at, { transfers = 0 } = {}) {
  const segments = transfers === 0
    ? [{
      departure: { iataCode: origin, at: `2026-11-15T08:00:00` },
      arrival: { iataCode: "ROM", at: `2026-11-15T${at}:00` },
    }]
    : [];
  return {
    origin,
    offer: { transfers, itineraries: [{ duration: "PT2H", segments }] },
  };
}

test("la franja mide desde la primera llegada real y no inventa el final", () => {
  const drawn = arrivalBars([legAt("BCN", "08:00"), legAt("BER", "10:00")], 240);
  assert.equal(drawn.bars[0].pct, 0);
  assert.equal(drawn.bars[1].pct, 0.5);
  assert.equal(drawn.bars[0].clock, "08:00");
  assert.equal(drawn.bars[1].clock, "10:00");
  assert.equal(ticketClock("2026-11-15T10:00:00"), "10:00");
  const over = arrivalBars([legAt("BCN", "08:00"), legAt("BER", "14:00")], 120);
  assert.equal(over.bars[1].pct, 1);
  assert.equal(over.bars[1].clock, "14:00");
  const same = arrivalBars([legAt("BCN", "08:00"), legAt("BER", "08:00")], null);
  assert.equal(same.bars[0].pct, 0);
  assert.equal(same.bars[1].pct, 0);
  assert.ok(same.scaleMs >= 60 * 1000);
});

test("sin hora de llegada la barra no se rellena", () => {
  const miss = arrivalBars([
    legAt("BCN", "08:00"),
    legAt("BER", "12:00", { transfers: 1 }),
  ], 240);
  assert.equal(miss.min, null);
  assert.equal(miss.partial, true);
  assert.equal(miss.bars[0].pct, null);
  assert.equal(miss.bars[1].pct, null);
  const mixed = arrivalBars([
    legAt("BCN", "08:00"),
    legAt("BER", "10:00"),
    legAt("MAD", "11:00", { transfers: 1 }),
  ], 240);
  assert.equal(mixed.partial, true);
  assert.equal(mixed.bars[2].pct, null);
  assert.equal(mixed.bars[1].clock, "10:00");
});

test("una franja de 2 h deja fuera un hueco de 7 h y una escala", () => {
  const close = dest("ROM", [legAt("BCN", "08:00"), legAt("BER", "09:00")]);
  const mid = dest("PAR", [legAt("BCN", "08:00"), legAt("BER", "11:00")]);
  const far = dest("LIS", [legAt("BCN", "08:00"), legAt("BER", "15:00")]);
  const stop = dest("MIL", [legAt("BCN", "08:00"), legAt("BER", "09:00", { transfers: 1 })]);
  assert.equal(matchesArrival(close, "gap", 120), true);
  assert.equal(matchesArrival(mid, "gap", 120), false);
  assert.equal(matchesArrival(far, "gap", 120), false);
  assert.equal(matchesArrival(stop, "gap", 120), false);
  assert.equal(matchesArrival(far, "gap", null), true);
  assert.equal(matchesArrival(mid, "within4h", 120), true);
  assert.equal(matchesArrival(close, "sameDay", 120), true);
  assert.equal(matchesArrival(far, "any", 120), false);
  const out = applyResultFilters(
    [far, mid, close, stop],
    { ...DEFAULT_FILTERS, arrival: "gap", maxArrivalMin: 120 },
  );
  assert.deepEqual(out.map((d) => d.destination), ["ROM"]);
  const sorted = listResults(
    [far, mid, close],
    { ...DEFAULT_FILTERS, arrival: "closest", maxArrivalMin: 240 },
    "total",
  );
  assert.deepEqual(sorted.map((d) => d.destination), ["ROM", "PAR"]);
});

test("la barra de llegada recorre el hueco real, de 30 en 30 minutos", () => {
  const tight = dest("ROM", [leg({ at: "08:00" }), leg({ at: "09:00" })]);
  const wide = dest("PAR", [leg({ at: "08:00" }), leg({ at: "15:00" })]);
  const days = dest("LIS", [leg({ flightDate: "2026-11-15" }), leg({ flightDate: "2026-11-16", at: "12:00" })]);
  assert.deepEqual(arrivalSliderRange([tight]), { min: 30, max: 60, step: 30 });
  assert.deepEqual(arrivalSliderRange([tight, wide]), { min: 30, max: 420, step: 30 });
  assert.equal(arrivalSliderRange([days]), null);
  assert.equal(arrivalSliderRange([]), null);
});

test("las franjas ofrecidas salen de los huecos reales del mismo día", () => {
  const tight = dest("ROM", [legAt("BCN", "08:00"), legAt("BER", "09:00")]);
  const wide = dest("PAR", [legAt("BCN", "08:00"), legAt("BER", "15:00")]);
  const days = dest("LIS", [
    { ...legAt("BCN", "08:00"), flightDate: "2026-11-15" },
    { ...legAt("BER", "09:00"), flightDate: "2026-11-16" },
  ]);
  assert.deepEqual(arrivalGapChoices([tight]), [120, 240]);
  assert.deepEqual(arrivalGapChoices([tight, wide]), [120, 240, 480]);
  assert.deepEqual(arrivalGapChoices([days]), []);
});

test("el primer toque de aerolínea la oculta, no vacía el resto", () => {
  assert.deepEqual(nextAirlines(null, "IB", ["IB", "FR", "VY"]), ["FR", "VY"]);
  assert.deepEqual(nextAirlines(["FR", "VY"], "IB", ["IB", "FR", "VY"]), null);
  assert.deepEqual(nextAirlines(["VY"], "VY", ["IB", "FR", "VY"]), ["VY"]);
});

test("quitar un filtro devuelve el destino que se veía antes", () => {
  const par = dest("PAR", [leg()], 100);
  const lis = dest("LIS", [leg()], 160);
  const mil = dest("MIL", [leg()], 200);
  const all = [par, lis, mil];
  const on = nextShownDestination({ listed: [lis], current: par, anchor: null, arrival: "any" });
  assert.equal(on.dest.destination, "LIS");
  assert.equal(on.anchor, "PAR");
  const off = nextShownDestination({ listed: all, current: lis, anchor: on.anchor, arrival: "any" });
  assert.equal(off.dest.destination, "PAR");
  const closest = nextShownDestination({ listed: [lis, par, mil], current: par, anchor: null, arrival: "closest" });
  assert.equal(closest.dest.destination, "LIS");
  assert.equal(closest.anchor, "PAR");
  const closestOff = nextShownDestination({ listed: all, current: lis, anchor: closest.anchor, arrival: "any" });
  assert.equal(closestOff.dest.destination, "PAR");
  const kept = nextShownDestination({ listed: [mil], current: lis, anchor: "PAR", arrival: "any" });
  assert.equal(kept.dest.destination, "MIL");
  assert.equal(kept.anchor, "PAR");
  const chosen = nextShownDestination({ listed: all, current: mil, anchor: null, arrival: "any" });
  assert.equal(chosen.dest.destination, "MIL");
  assert.equal(chosen.anchor, null);
  assert.equal(filtersHoldResults({ ...DEFAULT_FILTERS, stops: "direct" }), true);
  assert.equal(filtersHoldResults(DEFAULT_FILTERS), false);
  assert.equal(validArrivalGap(120), 120);
  assert.equal(validArrivalGap("240"), 240);
  assert.equal(validArrivalGap(90), null);
  assert.equal(validArrivalGap(null), null);
});
