// La caja no acepta un id raro, no cobra un importe que mande el cliente y no
// devuelve la oferta, el token, el teléfono ni la fecha de nacimiento.
// Sin red: el transporte de Duffel se inyecta.

const { test, beforeEach, describe } = require("node:test");
const assert = require("node:assert/strict");

process.env.DUFFEL_ACCESS_TOKEN = "duffel_test_token";
process.env.BOOKING_MARKUP_PERCENT = "5";
process.env.DUFFEL_PAYMENTS_FEE = "0.029";

const sale = require("../services/groupSale");
const saleMail = require("../services/saleMail");

const DEP = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

function offer(origin) {
  const mad = origin !== "BCN";
  return {
    id: mad ? "off_secret" : "off_other",
    total_amount: mad ? "41.00" : "20.00",
    total_currency: "EUR",
    slices: [{
      segments: [{
        marketing_carrier: { iata_code: mad ? "VY" : "U2", name: mad ? "Vueling" : "easyJet" },
        marketing_carrier_flight_number: mad ? "1234" : "808",
        departing_at: `${DEP}T08:30:00`,
        arriving_at: `${DEP}T10:55:00`,
      }],
    }],
    passengers: [{ id: mad ? "pas_secret" : "pas_other" }],
  };
}

function legs() {
  return [
    { origin: "MAD", destination: "LTN", departureDate: DEP, airline: "VY", flightNumber: "1234", passengers: 1 },
    { origin: "BCN", destination: "LTN", departureDate: DEP, airline: "U2", flightNumber: "808", passengers: 1 },
  ];
}

function person(overrides = {}) {
  return { givenName: "Ana", familyName: "Ruiz", bornOn: "1990-04-02", gender: "f", title: "ms", ...overrides };
}

describe("seguridad de la caja", { concurrency: 1 }, () => {
  beforeEach(() => {
    sale.__test.reset();
    saleMail.__test.reset();
  });

  test("un id que no es el de la caja no llama a Duffel", async () => {
    let calls = 0;
    sale.__test.setTransport(async () => { calls += 1; throw new Error("no debería salir"); });
    for (const id of ["x", "../etc/passwd", "abcdefghijklmno", "abcdefghijklmnop!", "abc\ndefghijklmno", "__proto__", "a".repeat(200)]) {
      const pay = await sale.startPayment(id, [person()], "ana@example.com", "+34600111222");
      const done = await sale.completeSale(id);
      const desk = await sale.publicQuote(id);
      assert.equal(pay.code, "QUOTE_EXPIRED", id);
      assert.equal(done.code, "QUOTE_EXPIRED", id);
      assert.equal(desk, null, id);
    }
    assert.equal(calls, 0);
  });

  test("un nombre, un correo o un teléfono con otra cabecera no abre el cobro", async () => {
    let intents = 0;
    sale.__test.setTransport(async (url, options) => {
      if (url.includes("offer_requests")) {
        const origin = JSON.parse(options.body).data.slices[0].origin;
        return { status: 200, data: { data: { offers: [offer(origin)] } } };
      }
      intents += 1;
      return { status: 500, data: {} };
    });
    const quote = await sale.quoteLegs(legs(), TODAY);
    assert.equal(quote.available, true);
    const cases = [
      person({ givenName: "<script>alert(1)</script>" }),
      person({ familyName: "Ruiz\nBcc: evil@example.com" }),
      person({ givenName: "Ana\nRuiz" }),
    ];
    for (const row of cases) {
      const pay = await sale.startPayment(quote.quoteId, [row, person({ familyName: "Sanz" })], "ana@example.com", "+34600111222");
      assert.equal(pay.code, "INVALID_NAME");
    }
    const mail = await sale.startPayment(quote.quoteId, [person(), person({ familyName: "Sanz" })], "ana@example.com\nBcc: evil@example.com", "+34600111222");
    assert.equal(mail.code, "INVALID_EMAIL");
    const phone = await sale.startPayment(quote.quoteId, [person(), person({ familyName: "Sanz" })], "ana@example.com", "+34600<script>");
    assert.equal(phone.code, "INVALID_PHONE");
    assert.equal(intents, 0);
    const desk = JSON.stringify(await sale.publicQuote(quote.quoteId));
    assert.equal(desk.includes("script"), false);
    assert.equal(desk.includes("Bcc"), false);
    assert.equal(desk.includes("evil@example.com"), false);
  });

  test("Duffel cobra la cifra de la caja y la respuesta no lleva secretos", async () => {
    let charged = null;
    sale.__test.setTransport(async (url, options) => {
      if (url.includes("offer_requests")) {
        const origin = JSON.parse(options.body).data.slices[0].origin;
        return { status: 200, data: { data: { offers: [offer(origin)] } } };
      }
      if (options.method === "POST" && url.endsWith("/payments/payment_intents")) {
        charged = JSON.parse(options.body).data.amount;
        assert.equal(options.headers.Authorization, "Bearer duffel_test_token");
        return { status: 201, data: { data: { id: "pit_secret", client_token: "client_tok", amount: charged, currency: "EUR", live_mode: false } } };
      }
      if (options.method === "POST" && url.endsWith("/payments/refunds")) {
        return { status: 201, data: { data: { id: "rfnd_secret" } } };
      }
      if (url.includes("/payments/payment_intents/")) {
        return { status: 200, data: { data: { id: "pit_secret", status: "succeeded", amount: "1.00", currency: "EUR", net_amount: "0.01", net_currency: "EUR" } } };
      }
      throw new Error(`url no prevista ${url}`);
    });
    const quote = await sale.quoteLegs(legs(), TODAY);
    const pay = await sale.startPayment(quote.quoteId, [person(), person({ familyName: "Sanz" })], "ana@example.com", "+34600111222");
    assert.equal(pay.ok, true);
    assert.equal(charged, quote.charge);
    assert.notEqual(charged, "0.01");
    const payText = JSON.stringify(pay);
    for (const secret of ["off_secret", "pas_secret", "pit_secret", "duffel_test_token", "1990-04-02", "+34600111222", "client_tok"]) {
      if (secret === "client_tok") continue;
      assert.equal(payText.includes(secret), false, secret);
    }
    assert.equal(pay.clientToken, "client_tok");
    const desk = JSON.stringify(await sale.publicQuote(quote.quoteId));
    for (const secret of ["off_secret", "pas_secret", "pit_secret", "client_tok", "duffel_test_token", "1990-04-02", "+34600111222"]) {
      assert.equal(desk.includes(secret), false, secret);
    }
    const done = await sale.completeSale(quote.quoteId);
    assert.equal(done.code, "SALE_REFUNDED");
    const doneText = JSON.stringify(done);
    assert.equal(done.refund.status, "refunded");
    assert.equal(done.refund.amount, quote.charge);
    assert.equal(Object.hasOwn(done.refund, "id"), false);
    for (const secret of ["rfnd_secret", "pit_secret", "off_secret", "client_tok", "duffel_test_token", "1990-04-02"]) {
      assert.equal(doneText.includes(secret), false, secret);
    }
  });

  test("el correo de la compra solo va al contacto guardado y el enlace es el de FlyndMe", async () => {
    const sent = [];
    saleMail.__test.setTransport(async (message) => { sent.push(message); return { status: 201 }; });
    process.env.BREVO_API_KEY = "brevo-test-key";
    const previous = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "javascript:alert(1)//https://flyndme.com";
    try {
      let amount = null;
      sale.__test.setTransport(async (url, options) => {
        if (url.includes("offer_requests")) {
          const origin = JSON.parse(options.body).data.slices[0].origin;
          return { status: 200, data: { data: { offers: [offer(origin)] } } };
        }
        if (options.method === "POST" && url.endsWith("/payments/payment_intents")) {
          amount = JSON.parse(options.body).data.amount;
          return { status: 201, data: { data: { id: "pit_1", client_token: "client_tok", amount, currency: "EUR", live_mode: false, status: "succeeded" } } };
        }
        if (url.includes("/payments/payment_intents/pit_1")) {
          return { status: 200, data: { data: { id: "pit_1", status: "succeeded", amount, currency: "EUR" } } };
        }
        if (url.endsWith("/air/orders")) {
          return { status: 201, data: { data: { id: "ord_1", booking_reference: "ABC123" } } };
        }
        throw new Error(`url no prevista ${url}`);
      });
      const quote = await sale.quoteLegs(legs(), TODAY);
      await sale.startPayment(quote.quoteId, [person(), person({ familyName: "Sanz" })], "ana@example.com", "+34600111222");
      const done = await sale.completeSale(quote.quoteId);
      assert.equal(done.status, "issued");
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, "ana@example.com");
      assert.equal(sent[0].text.includes("javascript:"), false);
      assert.match(sent[0].text, /Volver a FlyndMe: https:\/\/flyndme.com/);
      assert.equal(sent[0].text.includes("brevo-test-key"), false);
    } finally {
      delete process.env.BREVO_API_KEY;
      if (previous === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previous;
    }
  });
});
