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

function offer({ id = "off_mad", amount = "41.00", airline = "VY", number = "1234", date = DEP, pax = 1, back = null } = {}) {
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
    origin: "MAD", destination: "LTN", departureDate: DEP, airline: "VY", flightNumber: "1234", passengers: 1,
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

test("un vuelo que Duffel no tiene no se sustituye y no bloquea al que sí está", async () => {
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
  assert.equal(quote.available, true);
  assert.equal(quote.legs.length, 1);
  assert.equal(quote.legs[0].origin, "MAD");
  assert.equal(quote.legs[0].flightNumber, "1234");
  assert.equal(quote.passengerCount, 1);
  assert.equal(quote.external.length, 1);
  assert.equal(quote.external[0].origin, "BCN");
  assert.equal(quote.external[0].reason, "FLIGHT_NOT_FOR_SALE");
  assert.equal(quote.fare, "41.00");
});

test("Ryanair no se pide a Duffel y el otro vuelo sí se puede pagar", async () => {
  const origins = [];
  sale.__test.setTransport(async (url, options) => {
    if (!url.includes("offer_requests")) throw new Error("no debería cobrar");
    origins.push(JSON.parse(options.body).data.slices[0].origin);
    return { status: 200, data: { data: { offers: [offer({})] } } };
  });
  const quote = await sale.quoteLegs([
    leg(),
    leg({ origin: "BCN", airline: "FR", flightNumber: "202" }),
  ], TODAY);
  assert.deepEqual(origins, ["MAD"]);
  assert.equal(quote.available, true);
  assert.equal(quote.legs.length, 1);
  assert.equal(quote.passengerCount, 1);
  assert.equal(quote.external[0].airline, "FR");
  assert.equal(quote.external[0].reason, "AIRLINE_SITE");
  assert.equal(quote.fare, "41.00");
  const tooMany = await sale.startPayment(quote.quoteId, [{}, {}], "ana@example.com", "+34600111222");
  assert.equal(tooMany.code, "INVALID_PASSENGERS");
});

test("si los dos son Ryanair o Wizz no hay cobro", async () => {
  sale.__test.setTransport(async () => { throw new Error("no debería llamar a Duffel"); });
  const quote = await sale.quoteLegs([
    leg({ airline: "FR" }),
    leg({ origin: "BCN", airline: "W6", flightNumber: "10" }),
  ], TODAY);
  assert.equal(quote.available, false);
  assert.equal(quote.code, "AIRLINE_SITE");
  assert.equal(quote.external.length, 2);
  assert.equal(quote.fare, undefined);
});

test("si ninguno está a la venta se nombran los dos y no hay cobro", async () => {
  sale.__test.setTransport(async () => ({ status: 200, data: { data: { offers: [] } } }));
  const quote = await sale.quoteLegs([
    leg(),
    leg({ origin: "BCN", airline: "U2", flightNumber: "1" }),
  ], TODAY);
  assert.equal(quote.available, false);
  assert.equal(quote.code, "FLIGHT_NOT_FOR_SALE");
  assert.deepEqual(quote.external.map((leg) => leg.origin), ["MAD", "BCN"]);
  assert.equal(quote.fare, undefined);
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

function peopleNamed(names) {
  return names.map((familyName) => ({
    givenName: "Ana", familyName, bornOn: "1990-04-02", gender: "f", title: "ms",
  }));
}

function transportWith({ failOrigin = null, refundStatus = 201 } = {}) {
  const calls = [];
  let charge = null;
  const send = async (url, options) => {
    calls.push(`${options.method} ${url}`);
    if (url.includes("offer_requests")) {
      const origin = JSON.parse(options.body).data.slices[0].origin;
      const row = origin === "MAD" ? offer({ id: "off_mad" }) : offer({ id: "off_bcn", airline: "U2", number: "808", amount: "20.00" });
      return { status: 200, data: { data: { offers: [row] } } };
    }
    if (options.method === "POST" && url.endsWith("/payments/payment_intents")) {
      charge = JSON.parse(options.body).data.amount;
      return { status: 201, data: { data: { id: "pit_1", client_token: "client_tok", amount: charge, currency: "EUR", status: "requires_payment" } } };
    }
    if (options.method === "GET" && url.includes("/payments/payment_intents/pit_1")) {
      return { status: 200, data: { data: { id: "pit_1", status: "succeeded", amount: charge, currency: "EUR" } } };
    }
    if (options.method === "POST" && url.endsWith("/payments/refunds")) {
      if (refundStatus >= 400) return { status: refundStatus, data: { errors: [{ message: "no" }] } };
      const body = JSON.parse(options.body).data;
      return { status: 201, data: { data: { id: "ref_1", amount: body.amount, currency: body.currency } } };
    }
    if (url.endsWith("/air/orders")) {
      const offerId = JSON.parse(options.body).data.selected_offers[0];
      const origin = offerId === "off_mad" ? "MAD" : "BCN";
      if (origin === failOrigin) return { status: 500, data: null };
      return { status: 201, data: { data: { id: `ord_${offerId}`, booking_reference: "ABC123" } } };
    }
    throw new Error(`url no prevista ${url}`);
  };
  return { calls, send };
}

test("si no se emite ningún billete se devuelve el cobro entero", async () => {
  const tp = transportWith({ failOrigin: "MAD" });
  sale.__test.setTransport(tp.send);
  const quote = await sale.quoteLegs([leg(), leg({ origin: "BCN", airline: "U2", flightNumber: "808" })], TODAY);
  await sale.startPayment(quote.quoteId, peopleNamed(["Ruiz", "Sanz"]), "ana@example.com", "+34600111222");
  sale.__test.forgetMemory();
  const done = await sale.completeSale(quote.quoteId);
  assert.equal(done.code, "SALE_REFUNDED");
  assert.equal(done.orders.length, 0);
  assert.equal(done.refund.status, "refunded");
  assert.equal(done.refund.amount, quote.charge);
  const refunds = tp.calls.filter((c) => c.includes("/payments/refunds"));
  assert.equal(refunds.length, 1);
  const again = await sale.completeSale(quote.quoteId);
  assert.equal(again.code, "SALE_REFUNDED");
  assert.equal(tp.calls.filter((c) => c.includes("/payments/refunds")).length, 1);
});

test("si falla el segundo tramo se devuelve solo ese cobro", async () => {
  const tp = transportWith({ failOrigin: "BCN" });
  sale.__test.setTransport(tp.send);
  const quote = await sale.quoteLegs([leg(), leg({ origin: "BCN", airline: "U2", flightNumber: "808" })], TODAY);
  await sale.startPayment(quote.quoteId, peopleNamed(["Ruiz", "Sanz"]), "ana@example.com", "+34600111222");
  const done = await sale.completeSale(quote.quoteId);
  assert.equal(done.code, "TICKET_PARTIAL");
  assert.equal(done.orders.length, 1);
  assert.equal(done.orders[0].bookingReference, "ABC123");
  assert.equal(done.failedOrigin, "BCN");
  assert.equal(done.refund.status, "refunded");
  assert.notEqual(done.refund.amount, quote.charge);
  const refunded = Math.round(Number(done.refund.amount) * 100);
  const kept = Math.round(Number(quote.legs[0].charge) * 100);
  const total = Math.round(Number(quote.charge) * 100);
  assert.equal(refunded + kept, total);
});

test("si la devolución falla no se dice que el dinero ha vuelto", async () => {
  const tp = transportWith({ failOrigin: "MAD", refundStatus: 500 });
  sale.__test.setTransport(tp.send);
  const quote = await sale.quoteLegs([leg(), leg({ origin: "BCN", airline: "U2", flightNumber: "808" })], TODAY);
  await sale.startPayment(quote.quoteId, peopleNamed(["Ruiz", "Sanz"]), "ana@example.com", "+34600111222");
  const done = await sale.completeSale(quote.quoteId);
  assert.equal(done.code, "REFUND_FAILED");
  assert.equal(done.refund.status, "failed");
  assert.equal(done.refund.amount, quote.charge);
  assert.equal(done.orders.length, 0);
});

test("repetir el pago no abre un segundo cobro", async () => {
  const tp = transportWith();
  sale.__test.setTransport(tp.send);
  const quote = await sale.quoteLegs([leg(), leg({ origin: "BCN", airline: "U2", flightNumber: "808" })], TODAY);
  const people = peopleNamed(["Ruiz", "Sanz"]);
  const first = await sale.startPayment(quote.quoteId, people, "ana@example.com", "+34600111222");
  const second = await sale.startPayment(quote.quoteId, people, "ana@example.com", "+34600111222");
  assert.equal(second.clientToken, first.clientToken);
  assert.equal(tp.calls.filter((c) => c.endsWith("/payments/payment_intents")).length, 1);
});

});
