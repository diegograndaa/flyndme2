// Reservar abre la web de la aerolínea. El total del grupo ofrece comprar aquí.
// Sin tarifa emitible no se pinta un importe de cobro.
import "./_domStubs.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { renderToString } = await import("react-dom/server");
const React = (await import("react")).default;
const { I18nProvider } = await import("../src/i18n/useI18n.jsx");
const { default: WinnerCard } = await import("../src/components/WinnerCard.jsx");

function render(element) {
  return renderToString(React.createElement(I18nProvider, null, element));
}

const LONDON = {
  destination: "LON",
  bestDate: "2026-10-15",
  totalCostEUR: 61,
  averageCostPerTraveler: 30.5,
  totalPassengers: 2,
  verificationStatus: "skipped",
  flights: [
    {
      origin: "MAD", price: 41, passengers: 1, totalForOrigin: 41,
      offer: {
        link: "https://www.aviasales.com/search/MAD1510LTN1",
        validatingAirlineCodes: ["W9"],
        tp: { originAirport: "MAD", destinationAirport: "LTN" },
        itineraries: [{ segments: [{ carrierCode: "W9", number: "1234", departure: { iataCode: "MAD", at: "2026-10-15T08:00:00" }, arrival: { iataCode: "LTN" } }] }],
      },
    },
    {
      origin: "BCN", price: 20, passengers: 1, totalForOrigin: 20,
      offer: {
        link: "https://www.aviasales.com/search/BCN1510LTN1",
        validatingAirlineCodes: ["U2"],
        tp: { originAirport: "BCN", destinationAirport: "LTN" },
        itineraries: [{ segments: [{ carrierCode: "U2", number: "5678", departure: { iataCode: "BCN", at: "2026-10-15T09:00:00" }, arrival: { iataCode: "LTN" } }] }],
      },
    },
  ],
};

const base = {
  origins: ["MAD", "BCN"],
  departureDate: "2026-10-15",
  tripType: "oneway",
  currency: "EUR",
  uiCriterion: "total",
};

test("Reservar abre Wizz y easyJet, no Aviasales, y el total ofrece comprar el grupo", () => {
  const html = render(React.createElement(WinnerCard, { ...base, dest: LONDON }));
  assert.ok(html.includes("https://www.wizzair.com/en-gb/booking/select-flight/MAD/LTN/2026-10-15/null/1/0/0/null"), html);
  assert.ok(html.includes("https://www.easyjet.com/en/buy/flights?"), html);
  assert.ok(html.includes("origin=BCN"), html);
  assert.ok(html.includes("departureDate=2026-10-15"), html);
  assert.ok(!html.includes("aviasales.com"), "Reservar no manda a Aviasales");
  assert.match(html, /Comprar MAD en Wizz Air|Buy MAD on Wizz Air/);
  assert.match(html, /Comprar los vuelos del grupo|Buy the group/);
  const saleAt = html.indexOf('class="wc-sale"');
  const titleAt = html.indexOf("wc-buy-title");
  assert.ok(saleAt >= 0 && titleAt > saleAt, "la compra está en el total, antes de la lista de vuelos");
});

test("sin web de la aerolínea, Reservar abre Skyscanner y no se duplica", () => {
  const iberia = {
    ...LONDON,
    flights: [
      {
        ...LONDON.flights[0],
        offer: {
          ...LONDON.flights[0].offer,
          validatingAirlineCodes: ["IB"],
          itineraries: [{ segments: [{ carrierCode: "IB", number: "3001", departure: { iataCode: "MAD", at: "2026-10-15T08:00:00" }, arrival: { iataCode: "LTN" } }] }],
        },
      },
      LONDON.flights[1],
    ],
  };
  const html = render(React.createElement(WinnerCard, { ...base, dest: iberia }));
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const bookToSky = anchors.filter((a) => a.includes("wc-cta--book") && a.includes("skyscanner.es/transport/flights/mad/ltn/261015/"));
  const bookToEasy = anchors.filter((a) => a.includes("wc-cta--book") && a.includes("easyjet.com"));
  const compareSky = anchors.filter((a) => a.includes('class="wc-cta"') && a.includes("skyscanner.es"));
  assert.equal(bookToSky.length, 1);
  assert.equal(bookToEasy.length, 1);
  assert.equal(compareSky.length, 1, "Skyscanner aparte solo en el vuelo que ya abre su aerolínea");
  assert.ok(!html.includes("aviasales.com"));
});

test("con un solo origen no hay compra de grupo", () => {
  const one = {
    ...LONDON,
    totalPassengers: 1,
    flights: [LONDON.flights[0]],
  };
  const html = render(React.createElement(WinnerCard, { ...base, origins: ["MAD"], dest: one }));
  assert.ok(!html.includes("wc-sale"), "un origen no compra el grupo");
  assert.ok(html.includes("wizzair.com"), "el Reservar de ese vuelo sigue");
});

test("la tarifa emitible se enseña aparte de la estimación, con comisión", () => {
  const sale = {
    phase: "quote",
    quote: {
      quoteId: "q1",
      currency: "EUR",
      markupPercent: 5,
      passengerCount: 2,
      fare: "61.00",
      commission: "3.05",
      cardFee: "1.91",
      charge: "65.96",
      legs: [
        { origin: "MAD", destination: "LTN", passengers: 1 },
        { origin: "BCN", destination: "LTN", passengers: 1 },
      ],
    },
  };
  const html = render(React.createElement(WinnerCard, { ...base, dest: LONDON, sale }));
  assert.ok(html.includes("65.96") || html.includes("€65.96"), html);
  assert.ok(/Comisión FlyndMe \(5%\)|FlyndMe commission \(5%\)/.test(html), html);
  assert.ok(html.includes("sale-MAD-0-given"), "un viajero por tramo");
  assert.ok(html.includes("sale-BCN-1-given"));
  assert.ok(!html.includes("aviasales.com"));
});

test("sin venta conectada el total abre la aerolínea y no inventa un cobro", () => {
  const html = render(React.createElement(WinnerCard, {
    ...base, dest: LONDON, sale: { phase: "error", code: "BOOKING_NOT_CONFIGURED" },
  }));
  assert.ok(!/no está conectada|not connected yet/i.test(html), html);
  assert.match(html, /Cada billete se reserva|Each ticket is booked/);
  assert.ok(html.includes("https://www.wizzair.com/en-gb/booking/select-flight/MAD/LTN/2026-10-15/null/1/0/0/null"), html);
  assert.ok(html.includes("https://www.easyjet.com/en/buy/flights?"), html);
  const saleAt = html.indexOf('class="wc-sale"');
  const titleAt = html.indexOf("wc-buy-title");
  assert.ok(saleAt >= 0 && titleAt > saleAt, "la compra está en el total, antes de la lista de vuelos");
  assert.ok(!html.includes("wc-sale-lines"), "sin tarifa no hay desglose de cobro");
  assert.ok(!html.includes("saleRetry") && !/Volver a pedir la tarifa|Ask for the fare again/.test(html));
});

test("si no se emite el billete se dice si el cobro volvió", () => {
  const refunded = render(React.createElement(WinnerCard, {
    ...base,
    dest: LONDON,
    sale: {
      phase: "error",
      code: "SALE_REFUNDED",
      refund: { status: "refunded", amount: "65.96", currency: "EUR" },
    },
  }));
  assert.ok(/Se ha devuelto el cobro de|has been refunded/.test(refunded), refunded);
  assert.ok(refunded.includes("65.96") || refunded.includes("€65.96"), refunded);
  assert.ok(!/no se ha podido devolver|could not be refunded/i.test(refunded));

  const failed = render(React.createElement(WinnerCard, {
    ...base,
    dest: LONDON,
    sale: {
      phase: "error",
      code: "REFUND_FAILED",
      refund: { status: "failed", amount: "65.96", currency: "EUR" },
    },
  }));
  assert.ok(/no se ha podido devolver|could not be refunded/i.test(failed), failed);
  assert.ok(!/Volver a pedir la tarifa|Ask for the fare again/.test(failed));
});

test("un tramo emitido enseña su localizador y la devolución del otro", () => {
  const html = render(React.createElement(WinnerCard, {
    ...base,
    dest: LONDON,
    sale: {
      phase: "partial",
      code: "TICKET_PARTIAL",
      failedOrigin: "BCN",
      orders: [{ origin: "MAD", bookingReference: "ABC123" }],
      refund: { status: "refunded", amount: "21.63", currency: "EUR" },
    },
  }));
  assert.ok(html.includes("ABC123"), html);
  assert.ok(/Se ha devuelto|has been refunded/.test(html), html);
  assert.ok(html.includes("BCN"), html);
});
