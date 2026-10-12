// Venta del grupo, sin red: el transporte de Duffel se inyecta.
const { test, beforeEach, describe } = require("node:test");
const assert = require("node:assert/strict");

process.env.DUFFEL_ACCESS_TOKEN = "duffel_test_token";
process.env.BOOKING_MARKUP_PERCENT = "5";
process.env.DUFFEL_PAYMENTS_FEE = "0.029";

const sale = require("../services/groupSale");

function futureDate(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
const DEP = futureDate(40);
const TODAY = new Date().toISOString().slice(0, 10);

function offer({ id = "off_mad", amount = "41.00", airline = "W9", number = "1234", date = DEP, pax = 1, back = null } = {}) {
  const slices = [{
    segments: [{
      marketing_carrier: { iata_code: airline },
      marketing_carrier_flight_number: number,
      departing_at: `${date}T08:30:00`,
    }],
  }];
  if (back) {
    slices.push({
      segments: [{
        marketing_carrier: { iata_code: airline },
        marketing_carrier_flight_number: "99",
        departing_at: `${back}T18:00:00`,
      }],
    });
  }
  return {
    id,
    total_amount: amount,
    total_currency: "EUR",
    slices,
    passengers: Array.from({ length: pax }, (_, i) => ({ id: `pas_${id}_${i}` })),
  };
}

function leg(overrides = {}) {
  return {
    origin: "MAD", destination: "LTN", departureDate: DEP, airline: "W9", flightNumber: "1234", passengers: 1,
    ...overrides,
  };
}

describe("venta del grupo", { concurrency: 1 }, () => {
beforeEach(() => sale.__test.reset());

test("el total a pagar cuadra: tarifa + comisión + coste del cobro", () => {
  const priced = sale.priceLeg(4100, 0.05, 0.029);
  assert.equal(priced.fare + priced.commission + priced.cardFee, priced.charge);
  assert.equal(priced.commission, 205);
  // (€41 + 5%) / (1 - 2,9%) redondeado al céntimo.
  assert.equal(priced.charge, 4434);
});

test("la fórmula del cobro cubre tarifa y comisión después de la tasa", () => {
  // (€120 + €1) / (1 - 0,029) = €124,61, el ejemplo de Duffel sin cambio de divisa.
  const fare = 12000;
  const commission = 100;
  const charge = Math.round((fare + commission) / (1 - 0.029));
  assert.equal(charge, 12461);
});

test("solo casa el mismo vuelo, el mismo día y los mismos viajeros", () => {
  const same = offer({});
  const otherFlight = offer({ number: "999" });
  const otherDay = offer({ date: futureDate(41) });
  assert.equal(sale.offerMatches(same, leg()), true);
  assert.equal(sale.offerMatches(otherFlight, leg()), false);
  assert.equal(sale.offerMatches(otherDay, leg()), false);
  assert.equal(sale.offerMatches(offer({ pax: 2 }), leg()), false);
  const picked = sale.pickOffer([offer({ amount: "80.00", id: "off_hi" }), offer({ amount: "41.00", id: "off_lo" })], leg());
  assert.equal(picked.id, "off_lo");
});

test("sin token no hay presupuesto ni cobro", async () => {
  const previous = process.env.DUFFEL_ACCESS_TOKEN;
  delete process.env.DUFFEL_ACCESS_TOKEN;
  try {
    const quote = await sale.quoteLegs([leg(), leg({ origin: "BCN", flightNumber: "50" })], TODAY);
    assert.equal(quote.code, "BOOKING_NOT_CONFIGURED");
    const pay = await sale.startPayment("x", [], "a@b.co", "+34123456789");
    assert.equal(pay.code, "BOOKING_NOT_CONFIGURED");
  } finally {
    process.env.DUFFEL_ACCESS_TOKEN = previous;
  }
});

test("un vuelo que no está a la venta no se sustituye por otro", async () => {
  sale.__test.setTransport(async (url, options) => {
    assert.equal(url.includes("duffel_test_token"), false);
    if (url.includes("offer_requests")) {
      const body = JSON.parse(options.body).data;
      const origin = body.slices[0].origin;
      const offers = origin === "MAD" ? [offer({})] : [offer({ airline: "U2", number: "1", id: "off_other" })];
      return { status: 200, data: { data: { offers } } };
    }
    throw new Error("no debería cobrar");
  });
  const quote = await sale.quoteLegs([
    leg(),
    leg({ origin: "BCN", airline: "U2", flightNumber: "999", destination: "LTN" }),
  ], TODAY);
  assert.equal(quote.available, false);
  assert.equal(quote.code, "FLIGHT_NOT_FOR_SALE");
  assert.equal(quote.origin, "BCN");
});

test("el presupuesto usa la oferta emitible y separa la comisión", async () => {
  sale.__test.setTransport(async (url, options) => {
    const body = JSON.parse(options.body).data;
    const origin = body.slices[0].origin;
    const row = origin === "MAD"
      ? offer({ amount: "41.00", id: "off_mad" })
      : offer({ amount: "20.00", airline: "U2", number: "808", id: "off_bcn" });
    return { status: 200, data: { data: { offers: [row] } } };
  });
  const quote = await sale.quoteLegs([
    leg(),
    leg({ origin: "BCN", airline: "U2", flightNumber: "808" }),
  ], TODAY);
  assert.equal(quote.available, true);
  assert.equal(quote.currency, "EUR");
  assert.equal(quote.legs[0].fare, "41.00");
  assert.equal(quote.legs[1].fare, "20.00");
  const fare = Math.round(Number(quote.fare) * 100);
  const commission = Math.round(Number(quote.commission) * 100);
  const cardFee = Math.round(Number(quote.cardFee) * 100);
  const charge = Math.round(Number(quote.charge) * 100);
  assert.equal(fare, 6100);
  assert.equal(fare + commission + cardFee, charge);
});

test("no emite el billete si el cobro no está confirmado, y sí cuando cuadra", async () => {
  const calls = [];
  sale.__test.setTransport(async (url, options) => {
    calls.push(`${options.method} ${url}`);
    if (url.includes("offer_requests")) {
      const origin = JSON.parse(options.body).data.slices[0].origin;
      const row = origin === "MAD" ? offer({ id: "off_mad" }) : offer({ id: "off_bcn", airline: "U2", number: "808", amount: "20.00" });
      return { status: 200, data: { data: { offers: [row] } } };
    }
    if (options.method === "POST" && url.endsWith("/payments/payment_intents")) {
      const amount = JSON.parse(options.body).data.amount;
      return { status: 201, data: { data: { id: "pit_1", client_token: "client_tok", amount, currency: "EUR", status: "requires_payment" } } };
    }
    if (options.method === "GET" && url.includes("/payments/payment_intents/pit_1")) {
      return { status: 200, data: { data: { id: "pit_1", status: "succeeded", amount: calls.amount, currency: "EUR" } } };
    }
    if (url.endsWith("/air/orders")) {
      const offerId = JSON.parse(options.body).data.selected_offers[0];
      return { status: 201, data: { data: { id: `ord_${offerId}`, booking_reference: "ABC123" } } };
    }
    throw new Error(`url no prevista ${url}`);
  });
  const quote = await sale.quoteLegs([leg(), leg({ origin: "BCN", airline: "U2", flightNumber: "808" })], TODAY);
  calls.amount = quote.charge;
  const people = ["Ruiz", "Sanz"].map((familyName) => ({
    givenName: "Ana", familyName, bornOn: "1990-04-02", gender: "f", title: "ms",
  }));
  const early = await sale.completeSale(quote.quoteId);
  assert.equal(early.code, "PAYMENT_NOT_CONFIRMED");
  const pay = await sale.startPayment(quote.quoteId, people, "ana@example.com", "+34600111222");
  assert.equal(pay.ok, true);
  assert.equal(pay.clientToken, "client_tok");
  const done = await sale.completeSale(quote.quoteId);
  assert.equal(done.status, "issued");
  assert.equal(done.orders.length, 2);
  assert.equal(done.orders[0].bookingReference, "ABC123");
  const again = await sale.completeSale(quote.quoteId);
  assert.equal(again.orders.length, 2);
  assert.equal(calls.filter((c) => c.includes("/air/orders")).length, 2);
});

});
