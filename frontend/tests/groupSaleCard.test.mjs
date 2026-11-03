// Reservar abre Aviasales (afiliado) y la aerolínea queda como acceso
// secundario. La compra del grupo dentro de FlyndMe solo se enseña con
// saleEnabled (VITE_GROUP_SALE=on). Sin tarifa emitible no se pinta un cobro.
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
// La compra del grupo va apagada por defecto; estos tests la encienden.
const saleBase = { ...base, saleEnabled: true };

test("Reservar abre Aviasales (afiliado) y la web de la aerolínea queda como acceso secundario", () => {
  const html = render(React.createElement(WinnerCard, { ...base, dest: LONDON }));
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const book = anchors.filter((a) => a.includes("wc-cta--book"));
  assert.equal(book.length, 2);
  assert.ok(book[0].includes("https://www.aviasales.com/search/MAD1510LTN1"), book[0]);
  assert.ok(book[1].includes("https://www.aviasales.com/search/BCN1510LTN1"), book[1]);
  const airline = anchors.filter((a) => a.includes("wc-cta--airline"));
  assert.equal(airline.length, 2, "cada vuelo enlaza también a su aerolínea");
  assert.ok(airline[0].includes("https://www.wizzair.com/en-gb/booking/select-flight/MAD/LTN/2026-10-15/null/1/0/0/null"), airline[0]);
  assert.ok(airline[1].includes("https://www.easyjet.com/en/buy/flights?") && airline[1].includes("origin=BCN"), airline[1]);
  assert.match(html, /wc-total-meta/);
  assert.match(html, /Solo ida|One way/);
  assert.match(html, /2 viajeros|2 travelers/);
});

test("sin VITE_GROUP_SALE no se ofrece comprar el grupo dentro de FlyndMe", () => {
  const html = render(React.createElement(WinnerCard, { ...base, dest: LONDON }));
  assert.ok(!html.includes('class="wc-sale"'), "la compra del grupo está apagada por defecto");
  assert.ok(!/>Comprar<|>Buy</.test(html));
  // Aunque llegue un presupuesto, con la venta apagada no se pinta un cobro.
  const withQuote = render(React.createElement(WinnerCard, {
    ...base,
    dest: LONDON,
    sale: { phase: "quote", quote: { quoteId: "q9", currency: "EUR", passengerCount: 1, fare: "20.00", commission: "1.00", cardFee: "0.63", charge: "21.63", legs: [{ origin: "BCN", destination: "LTN", passengers: 1, fare: "20.00", commission: "1.00", cardFee: "0.63", charge: "21.63" }] } },
  }));
  assert.ok(!withQuote.includes("/?caja="), withQuote);
  assert.ok(!withQuote.includes("21.63"), "sin venta no hay importe de cobro");
});

test("con la venta encendida, el total ofrece pagar el grupo antes de la lista de vuelos", () => {
  const html = render(React.createElement(WinnerCard, { ...saleBase, dest: LONDON }));
  assert.match(html, />Comprar<|>Buy</);
  assert.ok(!/No se puede identificar el vuelo exacto|The exact flight cannot be identified/.test(html));
  const saleAt = html.indexOf('class="wc-sale"');
  const titleAt = html.indexOf("wc-buy-title");
  assert.ok(saleAt >= 0 && titleAt > saleAt, "la compra está en el total, antes de la lista de vuelos");
  const sale = html.slice(saleAt, titleAt);
  assert.ok(!sale.includes("wizzair.com") && !sale.includes("easyjet.com"), sale);
});

test("Reservar en Aviasales busca para todos los viajeros de esa ciudad", () => {
  const three = {
    ...LONDON,
    totalPassengers: 4,
    flights: [
      { ...LONDON.flights[0], passengers: 3, totalForOrigin: 123 },
      LONDON.flights[1],
    ],
  };
  const html = render(React.createElement(WinnerCard, { ...base, dest: three }));
  const book = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((a) => a.includes("wc-cta--book"));
  assert.ok(book[0].includes("aviasales.com/search/MAD1510LTN3"), book[0]);
  assert.ok(book[1].includes("aviasales.com/search/BCN1510LTN1"), book[1]);
});

test("sin enlace de Aviasales ni web de la aerolínea, Reservar abre Skyscanner y no se duplica", () => {
  const iberia = {
    ...LONDON,
    flights: [
      {
        ...LONDON.flights[0],
        offer: {
          ...LONDON.flights[0].offer,
          link: undefined,
          validatingAirlineCodes: ["IB"],
          itineraries: [{ segments: [{ carrierCode: "IB", number: "3001", departure: { iataCode: "MAD", at: "2026-10-15T08:00:00" }, arrival: { iataCode: "LTN" } }] }],
        },
      },
      { ...LONDON.flights[1], offer: { ...LONDON.flights[1].offer, link: undefined } },
    ],
  };
  const html = render(React.createElement(WinnerCard, { ...base, dest: iberia }));
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const bookToSky = anchors.filter((a) => a.includes("wc-cta--book") && a.includes("skyscanner.es/transport/flights/mad/ltn/261015/"));
  const bookToEasy = anchors.filter((a) => a.includes("wc-cta--book") && a.includes("easyjet.com"));
  const compareSky = anchors.filter((a) => a.includes("wc-cta--icon") && a.includes("skyscanner.es"));
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

test("con tarifa emitible el titular es el precio final, gastos incluidos", () => {
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
        { origin: "MAD", destination: "LTN", passengers: 1, fare: "41.00", commission: "2.05", cardFee: "1.28", charge: "44.33" },
        { origin: "BCN", destination: "LTN", passengers: 1, fare: "20.00", commission: "1.00", cardFee: "0.63", charge: "21.63" },
      ],
    },
  };
  const html = render(React.createElement(WinnerCard, { ...saleBase, dest: LONDON, sale }));
  assert.ok(html.includes("65.96") || html.includes("€65.96"), html);
  assert.ok(html.includes("44.33") && html.includes("21.63"), "cada viajero tiene su pago");
  assert.match(html, /wc-sale-codes">MAD[^<]*LTN/);
  assert.match(html, /wc-sale-codes">BCN[^<]*LTN/);
  assert.ok(/Precio final, gastos incluidos|Final price, fees included/.test(html), html);
  assert.ok(!/Comisión 5%|Fee 5%/.test(html), "la comisión va dentro del precio");
  assert.ok(!/Estimación €|Estimate €/.test(html));
  assert.ok(html.includes('href="/?caja=q1"') && html.includes('target="_blank"'), "el pago abre en otra pestaña");
  assert.ok(!html.includes("sale-MAD-0-given") && !html.includes('type="date"'), "el formulario no está en la ficha");
  assert.ok(!html.includes("aviasales.com"));
  assert.ok(!html.includes("wizzair.com") && !html.includes("easyjet.com"), "el vuelo que se paga no se repite con el precio de la búsqueda");
});

test("sin venta conectada el total no inventa un cobro ni manda a la aerolínea", () => {
  const html = render(React.createElement(WinnerCard, {
    ...saleBase, dest: LONDON, sale: { phase: "error", code: "BOOKING_NOT_CONFIGURED" },
  }));
  assert.match(html, /El pago dentro de FlyndMe aún no está conectado|Payment inside FlyndMe is not connected yet/);
  assert.ok(!/Cada billete se reserva|Each ticket is booked|Comprar MAD en|Buy MAD on/.test(html));
  const sale = html.slice(html.indexOf('class="wc-sale"'), html.indexOf("wc-buy-title"));
  assert.ok(sale.length > 0 && !sale.includes("wizzair.com") && !sale.includes("easyjet.com"), sale);
  assert.ok(!html.includes("wc-sale-lines"), "sin tarifa no hay desglose de cobro");
  assert.ok(!/Volver a pedir la tarifa|Ask for the fare again/.test(html));
});

test("si no se emite el billete se dice si el cobro volvió", () => {
  const refunded = render(React.createElement(WinnerCard, {
    ...saleBase,
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
    ...saleBase,
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
    ...saleBase,
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

test("si Duffel no tiene un vuelo, el otro se paga aquí y ese se reserva en su web", () => {
  const paris = {
    ...LONDON,
    destination: "PAR",
    verificationStatus: "verified",
    flights: [
      {
        origin: "OVD", price: 52, passengers: 1, totalForOrigin: 52,
        offer: {
          validatingAirlineCodes: ["V7"],
          tp: { originAirport: "OVD", destinationAirport: "ORY" },
          itineraries: [{ segments: [{ carrierCode: "V7", number: "1201", departure: { iataCode: "OVD", at: "2026-10-18T11:25:00" }, arrival: { iataCode: "ORY" } }] }],
        },
      },
      {
        origin: "MAD", price: 64, passengers: 1, totalForOrigin: 64,
        offer: {
          validatingAirlineCodes: ["VY"],
          tp: { originAirport: "MAD", destinationAirport: "CDG" },
          itineraries: [{ segments: [{ carrierCode: "VY", number: "8024", departure: { iataCode: "MAD", at: "2026-10-18T21:45:00" }, arrival: { iataCode: "CDG" } }] }],
        },
      },
    ],
  };
  const html = render(React.createElement(WinnerCard, {
    ...saleBase,
    origins: ["OVD", "MAD"],
    departureDate: "2026-10-18",
    dest: paris,
    sale: {
      phase: "quote",
      quote: {
        quoteId: "q2",
        currency: "EUR",
        markupPercent: 5,
        passengerCount: 1,
        fare: "52.00",
        commission: "2.60",
        cardFee: "1.63",
        charge: "56.23",
        legs: [{ origin: "OVD", destination: "ORY", airline: "V7", airlineName: "Volotea", flightNumber: "1201", departsAt: "11:25", sameFlight: false, departureDate: "2026-10-18", passengers: 1, fare: "52.00", commission: "2.60", cardFee: "1.63", charge: "56.23" }],
        external: [{ origin: "MAD", destination: "CDG", airline: "VY", flightNumber: "8024", departureDate: "2026-10-18", passengers: 1, reason: "FLIGHT_NOT_FOR_SALE" }],
      },
    },
  }));
  const finalAt = Math.max(
    html.indexOf("Precio final, gastos incluidos"),
    html.indexOf("Final price, fees included"),
  );
  const saleAt = html.indexOf('class="wc-sale"');
  assert.ok(finalAt >= 0 && saleAt > finalAt, "el titular es el precio a pagar, antes de la compra");
  assert.ok(!html.includes("Comprobada") && !/\bChecked\b/.test(html), "el cobro no se etiqueta como la estimación comprobada");
  assert.ok(html.includes('href="/?caja=q2"'), "el vuelo que sí está se paga en la otra pestaña");
  assert.ok(!html.includes("sale-MAD-") && !html.includes("sale-OVD-"), "el formulario no está en la ficha");
  assert.match(html, /wc-sale-codes">OVD[^<]*ORY/);
  assert.ok(html.includes("Volotea 1201"));
  assert.ok(html.includes("11:25"));
  assert.ok(/Otro vuelo de este día|A different flight that day/.test(html), "un vuelo distinto al de la búsqueda se dice");
  assert.ok(!/No se puede identificar el vuelo exacto|The exact flight cannot be identified/.test(html));
  const sale = html.slice(saleAt, html.indexOf("wc-buy-title"));
  assert.ok(!sale.includes("tickets.vueling.com"), "en la ficha, Vueling no tiene otro botón: está en la página de pago");
  assert.ok(html.includes("56.23") || html.includes("€56.23"));
  assert.ok(!/El vuelo de MAD no está a la venta ahora|The flight from MAD is not for sale right now/.test(html));
});

test("Ryanair en el presupuesto se reserva en su web y no suma al cobro", () => {
  const html = render(React.createElement(WinnerCard, {
    ...saleBase,
    dest: LONDON,
    sale: {
      phase: "quote",
      quote: {
        quoteId: "q3",
        currency: "EUR",
        markupPercent: 5,
        passengerCount: 1,
        fare: "20.00",
        commission: "1.00",
        cardFee: "0.63",
        charge: "21.63",
        legs: [{ origin: "BCN", destination: "LTN", airline: "U2", flightNumber: "5678", departureDate: "2026-10-15", passengers: 1, fare: "20.00", commission: "1.00", cardFee: "0.63", charge: "21.63" }],
        external: [{ origin: "MAD", destination: "LTN", airline: "FR", flightNumber: "1234", departureDate: "2026-10-15", passengers: 1, reason: "AIRLINE_SITE" }],
      },
    },
  }));
  assert.ok(/Pagar aquí|Pay here/.test(html));
  assert.ok(/se reserva en la web de Ryanair|booked on Ryanair/.test(html));
  assert.ok(/no entra en este pago|not part of this payment/.test(html));
  assert.match(html, /wc-sale-out/);
  assert.ok(!html.includes("ryanair.com"), "Ryanair se reserva en la página de pago");
  assert.ok(!html.includes("wizzair.com"), "la ficha de la búsqueda no repite otro precio");
  assert.ok(!html.includes("€41"), "la estimación no se suma debajo del cobro");
  assert.ok(html.includes('href="/?caja=q3"'));
  assert.ok(!html.includes("sale-BCN-") && !html.includes("sale-MAD-"));
  assert.ok(!html.includes('type="date"'));
  assert.ok(!/no está a la venta aquí|is not for sale here/.test(html));
});

test("sin página de pago, Ryanair sigue en la ficha", () => {
  const html = render(React.createElement(WinnerCard, {
    ...saleBase,
    dest: LONDON,
    sale: {
      phase: "error",
      code: "AIRLINE_SITE",
      external: [{ origin: "MAD", destination: "LTN", airline: "FR", flightNumber: "1234", departureDate: "2026-10-15", passengers: 1, reason: "AIRLINE_SITE" }],
    },
  }));
  assert.ok(html.includes("ryanair.com"));
  assert.ok(!html.includes("/?caja="));
  assert.ok(!html.includes('type="date"'));
});

test("la página de pago lleva el botón de Ryanair y no pide sus datos", async () => {
  const { default: SaleElsewhere } = await import("../src/components/SaleElsewhere.jsx");
  const { useI18n } = await import("../src/i18n/useI18n.jsx");
  function Probe() {
    const { t } = useI18n();
    return React.createElement(SaleElsewhere, {
      t,
      legs: [
        { origin: "MAD", destination: "LTN", airline: "FR", flightNumber: "1234", departureDate: "2026-10-15", passengers: 1, reason: "AIRLINE_SITE" },
        { origin: "BCN", destination: "LTN", airline: "W6", flightNumber: "10", departureDate: "2026-10-15", passengers: 1, reason: "AIRLINE_SITE" },
      ],
    });
  }
  const html = render(React.createElement(Probe));
  assert.ok(html.includes("ryanair.com"));
  assert.ok(html.includes("wizzair.com"));
  assert.equal([...html.matchAll(/<a\b/g)].length, 2);
  assert.ok(!html.includes('type="date"') && !html.includes("<input"));
});

test("la pestaña de pago no pinta un importe antes de leer la caja", async () => {
  const { default: CheckoutPage } = await import("../src/components/CheckoutPage.jsx");
  const html = render(React.createElement(CheckoutPage, { quoteId: "abcdefghijklmnop" }));
  assert.ok(/Pago del grupo|Group payment/.test(html));
  assert.ok(!html.includes("caja-amount"), "sin respuesta no hay cifra");
  assert.ok(!html.includes("64.60"));
  assert.ok(!html.includes('type="date"'), "el formulario espera a la caja");
});
