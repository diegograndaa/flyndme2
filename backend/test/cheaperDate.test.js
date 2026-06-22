const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findCheaperGroupDate, daysBetween } = require("../services/cheaperDate");

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
