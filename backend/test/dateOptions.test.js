const test = require("node:test");
const assert = require("node:assert/strict");
const { combineDateOptions, summarizeSearchGap } = require("../services/dateOptions");

test("combineDateOptions: solo el par que tienen todos los orígenes, el más cercano primero", () => {
  const options = combineDateOptions({
    origins: ["MAD", "LON"],
    passengers: [2, 1],
    destination: "LIS",
    requestedDeparture: "2026-11-15",
    requestedReturn: "2026-11-22",
    perOrigin: [
      [
        { price: 40, departureDate: "2026-11-18", returnDate: "2026-11-25" },
        { price: 80, departureDate: "2026-11-16", returnDate: "2026-11-23" },
        { price: 10, departureDate: "2026-11-15", returnDate: "2026-11-22" },
      ],
      [
        { price: 90, departureDate: "2026-11-16", returnDate: "2026-11-23" },
        { price: 30, departureDate: "2026-11-19", returnDate: "2026-11-26" },
      ],
    ],
  });
  assert.equal(options.length, 1);
  assert.equal(options[0].departureDate, "2026-11-16");
  assert.equal(options[0].returnDate, "2026-11-23");
  assert.equal(options[0].totalCostEUR, 250);
  assert.equal(options[0].totalPassengers, 3);
  assert.equal(options[0].flights, undefined);
});

test("combineDateOptions: ida simple exige el mismo día en todos los orígenes", () => {
  const options = combineDateOptions({
    origins: ["MAD", "LON"],
    passengers: [1, 1],
    destination: "PAR",
    requestedDeparture: "2026-11-15",
    requestedReturn: "",
    perOrigin: [
      [
        { price: 40, departureDate: "2026-11-16", returnDate: null },
        { price: 20, departureDate: "2026-11-14", returnDate: null },
      ],
      [
        { price: 50, departureDate: "2026-11-16", returnDate: null },
      ],
    ],
  });
  assert.equal(options.length, 1);
  assert.equal(options[0].departureDate, "2026-11-16");
  assert.equal(options[0].returnDate, null);
  assert.equal(options[0].totalCostEUR, 90);
});

test("summarizeSearchGap: separa quien tiene precio de quien no", () => {
  const both = summarizeSearchGap(["MAD", "LON"], ["MAD"], ["LON"], []);
  assert.deepEqual(both.withPrice, ["MAD"]);
  assert.deepEqual(both.withoutPrice, ["LON"]);
  assert.equal(both.noCommonDestination, false);

  const all = summarizeSearchGap(["MAD", "LON"], ["MAD", "LON"], ["LON"], []);
  assert.equal(all.noCommonDestination, true);

  const failed = summarizeSearchGap(["MAD", "LON"], [], ["LON"], ["LON"]);
  assert.equal(failed, null);

  assert.equal(summarizeSearchGap(["MAD"], [], ["MAD"], []), null);
});

test("combineDateOptions: un tramo por encima del tope o una media alta no se ofrece", () => {
  const shared = {
    origins: ["MAD", "LON"],
    passengers: [1, 1],
    destination: "PAR",
    requestedDeparture: "2026-11-15",
    requestedReturn: "2026-11-22",
    perOrigin: [[
      { price: 300, departureDate: "2026-11-16", returnDate: "2026-11-23" },
    ], [
      { price: 40, departureDate: "2026-11-16", returnDate: "2026-11-23" },
    ]],
  };
  assert.equal(combineDateOptions({ ...shared, maxFlight: 200 }).length, 0);
  assert.equal(combineDateOptions({ ...shared, maxAvg: 100 }).length, 0);
});

test("combineDateOptions: no ofrece un día pasado, una vuelta el mismo día ni una vuelta fuera del horizonte", () => {
  const options = combineDateOptions({
    origins: ["MAD"],
    passengers: [1],
    destination: "LIS",
    requestedDeparture: "2026-11-15",
    requestedReturn: "2026-11-22",
    today: "2026-11-10",
    horizon: "2026-11-24",
    perOrigin: [[
      { price: 40, departureDate: "2026-11-09", returnDate: "2026-11-16" },
      { price: 50, departureDate: "2026-11-16", returnDate: "2026-11-25" },
      { price: 60, departureDate: "2026-11-16", returnDate: "2026-11-16" },
      { price: 70, departureDate: "2026-11-14", returnDate: "2026-11-21" },
    ]],
  });
  assert.equal(options.length, 1);
  assert.equal(options[0].departureDate, "2026-11-14");
  assert.equal(options[0].returnDate, "2026-11-21");
});
