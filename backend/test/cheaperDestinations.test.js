const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rowsFromCheapPayload, pickCheaperDestinations } = require("../services/cheaperDestinations");
const EUROPE = require("../data/europeCodes.json");

test("rowsFromCheapPayload: mínimo positivo por ciudad", () => {
  const rows = rowsFromCheapPayload({
    success: true,
    data: {
      BCN: { "0": { price: 40 }, "1": { price: 28 } },
      PAR: { "0": { price: "19" } },
      LIS: { "0": { price: 0 } },
      nope: { "0": { price: 10 } },
      JFK: { "0": { price: 80 } },
    },
  });
  const byCode = Object.fromEntries(rows.map((r) => [r.destination, r.price]));
  assert.equal(byCode.BCN, 28);
  assert.equal(byCode.PAR, 19);
  assert.equal(byCode.JFK, 80);
  assert.equal(byCode.LIS, undefined);
  assert.equal(byCode.NOPE, undefined);
});

test("rowsFromCheapPayload: cuerpo vacío o raro", () => {
  assert.deepEqual(rowsFromCheapPayload(null), []);
  assert.deepEqual(rowsFromCheapPayload({ success: true, data: null }), []);
  assert.deepEqual(rowsFromCheapPayload({ data: [] }), []);
});

test("pickCheaperDestinations: solo ciudades con tarifa en todos los orígenes, más baratas primero", () => {
  const picked = pickCheaperDestinations({
    origins: ["MAD", "LON"],
    allow: ["PAR", "KRK", "BCN", "MAD"],
    byOrigin: {
      MAD: [
        { destination: "PAR", price: 120 },
        { destination: "KRK", price: 40 },
        { destination: "BCN", price: 50 },
        { destination: "JFK", price: 30 },
        { destination: "OPO", price: 10 },
      ],
      LON: [
        { destination: "PAR", price: 90 },
        { destination: "KRK", price: 35 },
        { destination: "BCN", price: 70 },
        { destination: "JFK", price: 40 },
      ],
    },
    limit: 2,
    minCommon: 2,
  });
  // KRK 75, BCN 120, PAR 210. JFK no está en la lista permitida. OPO no sale de LON.
  assert.deepEqual(picked, ["KRK", "BCN"]);
});

test("pickCheaperDestinations: menos de 6 en común no personaliza", () => {
  const rows = ["PAR", "ROM", "AMS", "MIL", "LIS"].map((destination, i) => ({ destination, price: 40 + i }));
  assert.equal(pickCheaperDestinations({
    origins: ["MAD", "LON"],
    allow: rows.map((r) => r.destination),
    byOrigin: { MAD: rows, LON: rows.slice(0, 4) },
  }), null);
});

test("pickCheaperDestinations: un solo origen también ordena y descarta su propia ciudad", () => {
  const picked = pickCheaperDestinations({
    origins: ["mad"],
    allow: ["MAD", "LIS", "OPO"],
    byOrigin: {
      MAD: [
        { destination: "MAD", price: 10 },
        { destination: "LIS", price: 80 },
        { destination: "OPO", price: 40 },
      ],
    },
    minCommon: 2,
    limit: 12,
  });
  assert.deepEqual(picked, ["OPO", "LIS"]);
});

test("europeCodes: aeropuertos de Europa del catálogo, sin Marruecos ni Israel", () => {
  assert.ok(EUROPE.includes("MAD"));
  assert.ok(EUROPE.includes("OVD"));
  assert.ok(EUROPE.includes("IST"));
  assert.ok(!EUROPE.includes("RAK"));
  assert.ok(!EUROPE.includes("CMN"));
  assert.ok(!EUROPE.includes("TLV"));
  assert.equal(new Set(EUROPE).size, EUROPE.length);
  assert.ok(EUROPE.every((c) => /^[A-Z]{3}$/.test(c)));
  assert.ok(EUROPE.length > 700);
});
