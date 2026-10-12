import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAirlineBookingUrl } from "../src/utils/airlineBooking.js";

const base = {
  origin: "MAD", destination: "LTN", departureDate: "2026-10-15", adults: 2, flightNumber: "1234",
};

test("easyJet, Wizz, Ryanair y Vueling abren su web con trayecto, fecha y viajeros", () => {
  const easy = buildAirlineBookingUrl({ ...base, airline: "u2" });
  assert.equal(easy.airlineName, "easyJet");
  assert.match(easy.url, /^https:\/\/www\.easyjet\.com\/en\/buy\/flights\?/);
  assert.match(easy.url, /origin=MAD/);
  assert.match(easy.url, /destination=LTN/);
  assert.match(easy.url, /departureDate=2026-10-15/);
  assert.match(easy.url, /adults=2/);
  assert.match(easy.url, /isOneWay=on/);

  const round = buildAirlineBookingUrl({ ...base, airline: "EC", returnDate: "2026-10-20" });
  assert.match(round.url, /isOneWay=off/);
  assert.match(round.url, /returnDate=2026-10-20/);

  const wizz = buildAirlineBookingUrl({ ...base, airline: "W9" });
  assert.equal(wizz.airlineName, "Wizz Air");
  assert.equal(
    wizz.url,
    "https://www.wizzair.com/en-gb/booking/select-flight/MAD/LTN/2026-10-15/null/2/0/0/null",
  );

  const ryan = buildAirlineBookingUrl({ ...base, airline: "FR", returnDate: "2026-10-20" });
  assert.equal(ryan.airlineName, "Ryanair");
  assert.match(ryan.url, /^https:\/\/www\.ryanair\.com\/es\/es\/trip\/flights\/select\?/);
  assert.match(ryan.url, /originIata=MAD/);
  assert.match(ryan.url, /destinationIata=LTN/);
  assert.match(ryan.url, /dateOut=2026-10-15/);
  assert.match(ryan.url, /dateIn=2026-10-20/);
  assert.match(ryan.url, /adults=2/);

  const vy = buildAirlineBookingUrl({ ...base, airline: "VY", flightNumber: "2115" });
  assert.equal(vy.airlineName, "Vueling");
  assert.match(vy.url, /^https:\/\/tickets\.vueling\.com\/booking\?/);
  assert.match(vy.url, /o=MAD/);
  assert.match(vy.url, /dd=2026-10-15/);
  assert.match(vy.url, /ofn=VY2115/);
});

test("sin aerolínea conocida no hay enlace: no se manda a otra web", () => {
  assert.equal(buildAirlineBookingUrl({ ...base, airline: "IB" }), null);
  assert.equal(buildAirlineBookingUrl({ ...base, airline: "W9", origin: "" }), null);
  assert.equal(buildAirlineBookingUrl({ ...base, airline: "W9", departureDate: "15-10-2026" }), null);
  const capped = buildAirlineBookingUrl({ ...base, airline: "FR", adults: 40 });
  assert.match(capped.url, /adults=9/);
});
