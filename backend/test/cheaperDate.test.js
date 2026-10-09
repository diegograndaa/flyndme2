const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findCheaperGroupDate, findCheaperGroupDates, daysBetween } = require("../services/cheaperDate");

const base = {
  originList: ["MAD", "LON"],
  originPax: [1, 1],
  currentDate: "2026-09-15",
  today: "2026-09-01",
  windowDays: 14,
  minSavingAbs: 15,
  minSavingPct: 0.05,
};

test("daysBetween computes signed day difference", () => {
  assert.equal(daysBetween("2026-09-15", "2026-09-10"), 5);
  assert.equal(daysBetween("2026-09-10", "2026-09-15"), -5);
});

test("finds a cheaper date when one beats the threshold for all origins", () => {
  const r = findCheaperGroupDate({
    ...base,
    currentTotalEUR: 400, // 200 + 200 on the current date
    perOrigin: [
      [{ date: "2026-09-15", price: 200 }, { date: "2026-09-12", price: 150 }],
      [{ date: "2026-09-15", price: 200 }, { date: "2026-09-12", price: 150 }],
    ],
  });
  assert.ok(r, "should find a cheaper date");
  assert.equal(r.date, "2026-09-12");
  assert.equal(r.totalEUR, 300);
  assert.equal(r.savingEUR, 100);
  assert.deepEqual(r.perOrigin, [
    { origin: "MAD", price: 150, passengers: 1 },
    { origin: "LON", price: 150, passengers: 1 },
  ]);
});

test("returns null when the current date is already the cheapest", () => {
  const r = findCheaperGroupDate({
    ...base,
    currentTotalEUR: 300,
    perOrigin: [
      [{ date: "2026-09-15", price: 150 }, { date: "2026-09-12", price: 200 }],
      [{ date: "2026-09-15", price: 150 }, { date: "2026-09-12", price: 200 }],
    ],
  });
  assert.equal(r, null);
});

test("returns null when the saving is below the threshold", () => {
  const r = findCheaperGroupDate({
    ...base,
    currentTotalEUR: 400,
    perOrigin: [
      [{ date: "2026-09-12", price: 195 }],
      [{ date: "2026-09-12", price: 195 }],
    ],
  });
  // saving = 400 - 390 = 10 < max(15, 20) → no nudge
  assert.equal(r, null);
});

test("ignores dates missing for any origin (group must fly the same day)", () => {
  const r = findCheaperGroupDate({
    ...base,
    currentTotalEUR: 400,
    perOrigin: [
      [{ date: "2026-09-15", price: 200 }, { date: "2026-09-10", price: 100 }],
      [{ date: "2026-09-15", price: 200 }], // LON has no 09-10 price
    ],
  });
  assert.equal(r, null);
});

test("excludes past dates and dates outside the window", () => {
  const r = findCheaperGroupDate({
    ...base,
    today: "2026-09-13",
    currentTotalEUR: 400,
    perOrigin: [
      // 09-02 is cheap but before `today`; 09-30 is cheap but >14 days away
      [{ date: "2026-09-02", price: 50 }, { date: "2026-09-30", price: 50 }],
      [{ date: "2026-09-02", price: 50 }, { date: "2026-09-30", price: 50 }],
    ],
  });
  assert.equal(r, null);
});

test("scales by passengers per origin", () => {
  const r = findCheaperGroupDate({
    ...base,
    originPax: [2, 1],
    currentTotalEUR: 600, // 200*2 + 200*1
    perOrigin: [
      [{ date: "2026-09-15", price: 200 }, { date: "2026-09-13", price: 150 }],
      [{ date: "2026-09-15", price: 200 }, { date: "2026-09-13", price: 150 }],
    ],
  });
  assert.ok(r);
  assert.equal(r.totalEUR, 450); // 150*2 + 150*1
  assert.equal(r.savingEUR, 150);
});

// ─── Ida y vuelta: misma duración, las dos fechas se mueven juntas ──────────

test("roundtrip: sugiere el par salida+vuelta con la misma duración", () => {
  const r = findCheaperGroupDate({
    ...base,
    tripNights: 7, // 15 → 22 sep
    currentTotalEUR: 600,
    perOrigin: [
      [{ date: "2026-09-15", returnDate: "2026-09-22", price: 300 },
       { date: "2026-09-12", returnDate: "2026-09-19", price: 200 }],
      [{ date: "2026-09-15", returnDate: "2026-09-22", price: 300 },
       { date: "2026-09-12", returnDate: "2026-09-19", price: 220 }],
    ],
  });
  assert.ok(r);
  assert.equal(r.date, "2026-09-12");
  assert.equal(r.returnDate, "2026-09-19");
  assert.equal(r.totalEUR, 420);
  assert.equal(r.savingEUR, 180);
});

test("roundtrip: ignora precios con otra duración aunque sean más baratos", () => {
  const r = findCheaperGroupDate({
    ...base,
    tripNights: 7,
    currentTotalEUR: 600,
    perOrigin: [
      [{ date: "2026-09-12", returnDate: "2026-09-20", price: 50 }], // 8 noches
      [{ date: "2026-09-12", returnDate: "2026-09-20", price: 50 }],
    ],
  });
  assert.equal(r, null);
});

test("roundtrip: exige el mismo par para TODOS los orígenes", () => {
  const r = findCheaperGroupDate({
    ...base,
    tripNights: 7,
    currentTotalEUR: 600,
    perOrigin: [
      [{ date: "2026-09-12", returnDate: "2026-09-19", price: 100 }],
      [{ date: "2026-09-12", returnDate: "2026-09-20", price: 100 }], // LON vuelve otro día
    ],
  });
  assert.equal(r, null);
});

test("roundtrip: entradas sin fecha de vuelta no cuentan", () => {
  const r = findCheaperGroupDate({
    ...base,
    tripNights: 7,
    currentTotalEUR: 600,
    perOrigin: [
      [{ date: "2026-09-12", price: 100 }],
      [{ date: "2026-09-12", price: 100 }],
    ],
  });
  assert.equal(r, null);
});

test("roundtrip: duración inválida → null", () => {
  const r = findCheaperGroupDate({
    ...base,
    tripNights: -1,
    currentTotalEUR: 600,
    perOrigin: [[{ date: "2026-09-12", returnDate: "2026-09-11", price: 1 }], [{ date: "2026-09-12", returnDate: "2026-09-11", price: 1 }]],
  });
  assert.equal(r, null);
});

test("lista hasta 3 fechas que abaratan el grupo, de la más barata a la más cara", () => {
  const days = [
    { date: "2026-09-15", price: 200 },
    { date: "2026-09-12", price: 100 }, // total 200, ahorro 200
    { date: "2026-09-13", price: 120 }, // 240 / 160
    { date: "2026-09-14", price: 140 }, // 280 / 120
    { date: "2026-09-16", price: 160 }, // 320 / 80 — entra, pero el tope de 3 la deja fuera
    { date: "2026-09-18", price: 195 }, // 390 / 10 — por debajo del umbral
  ];
  const perOrigin = [days, days.map((d) => ({ ...d }))];
  const list = findCheaperGroupDates({ ...base, currentTotalEUR: 400, perOrigin });
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((d) => d.date), ["2026-09-12", "2026-09-13", "2026-09-14"]);
  assert.ok(list[0].totalEUR < list[1].totalEUR && list[1].totalEUR < list[2].totalEUR);
  assert.equal(list[0].savingEUR, 200);
  const all = findCheaperGroupDates({ ...base, currentTotalEUR: 400, perOrigin, limit: 10 });
  assert.deepEqual(all.map((d) => d.date), ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-16"]);
  assert.equal(findCheaperGroupDate({ ...base, currentTotalEUR: 400, perOrigin }).date, "2026-09-12");
});

test("oneway: el resultado no lleva returnDate", () => {
  const r = findCheaperGroupDate({
    ...base,
    currentTotalEUR: 400,
    perOrigin: [
      [{ date: "2026-09-12", price: 150 }],
      [{ date: "2026-09-12", price: 150 }],
    ],
  });
  assert.ok(r);
  assert.equal("returnDate" in r, false);
});
