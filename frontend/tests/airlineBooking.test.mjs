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

  const abuDhabi = buildAirlineBookingUrl({ ...base, airline: "5W" });
  assert.equal(abuDhabi.airlineName, "Wizz Air");
  assert.match(abuDhabi.url, /^https:\/\/www\.wizzair\.com\/en-gb\/booking\/select-flight\/MAD\/LTN\//);
});

test("British Airways, KLM y Finnair abren su búsqueda con trayecto, fecha y viajeros", () => {
  const ba = buildAirlineBookingUrl({ ...base, airline: "BA" });
  assert.equal(ba.airlineName, "British Airways");
  const baUrl = new URL(ba.url);
  assert.equal(baUrl.origin + baUrl.pathname, "https://www.britishairways.com/travel/book/public/en_gb/flightList");
  assert.equal(baUrl.searchParams.get("onds"), "MAD-LTN_2026-10-15");
  assert.equal(baUrl.searchParams.get("ad"), "2");
  assert.equal(baUrl.searchParams.get("cabin"), "M");

  const cityflyer = buildAirlineBookingUrl({ ...base, airline: "CJ", returnDate: "2026-10-20" });
  assert.equal(
    new URL(cityflyer.url).searchParams.get("onds"),
    "MAD-LTN_2026-10-15,LTN-MAD_2026-10-20",
  );

  const kl = buildAirlineBookingUrl({ ...base, airline: "KL", returnDate: "2026-10-20" });
  assert.equal(kl.airlineName, "KLM");
  const klUrl = new URL(kl.url);
  assert.equal(klUrl.origin + klUrl.pathname, "https://www.klm.com/search/offers");
  assert.equal(klUrl.searchParams.get("pax"), "2:0:0:0");
  assert.equal(klUrl.searchParams.get("connections"), "MAD:A:20261015>LTN:A-LTN:A:20261020>MAD:A");
  assert.equal(klUrl.searchParams.get("cabinClass"), "ECONOMY");

  const hopper = buildAirlineBookingUrl({ ...base, airline: "wa" });
  assert.equal(new URL(hopper.url).searchParams.get("connections"), "MAD:A:20261015>LTN:A");

  const ay = buildAirlineBookingUrl({ ...base, airline: "AY", returnDate: "2026-10-20" });
  assert.equal(ay.airlineName, "Finnair");
  const ayUrl = new URL(ay.url);
  assert.equal(ayUrl.origin + ayUrl.pathname, "https://www.finnair.com/es-es/booking/flight-selection");
  assert.deepEqual(JSON.parse(ayUrl.searchParams.get("json")), {
    flights: [
      { origin: "MAD", destination: "LTN", departureDate: "2026-10-15" },
      { origin: "LTN", destination: "MAD", departureDate: "2026-10-20" },
    ],
    adults: 2,
    children: 0,
    infants: 0,
    cabin: "ECONOMY",
  });
});

test("sin aerolínea conocida no hay enlace: no se manda a otra web", () => {
  assert.equal(buildAirlineBookingUrl({ ...base, airline: "IB" }), null);
  assert.equal(buildAirlineBookingUrl({ ...base, airline: "W9", origin: "" }), null);
  assert.equal(buildAirlineBookingUrl({ ...base, airline: "W9", departureDate: "15-10-2026" }), null);
  const capped = buildAirlineBookingUrl({ ...base, airline: "FR", adults: 40 });
  assert.match(capped.url, /adults=9/);
});
