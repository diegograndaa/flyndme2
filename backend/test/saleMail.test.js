const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const saleMail = require("../services/saleMail");

afterEach(() => {
  delete process.env.BREVO_API_KEY;
  saleMail.__test.reset();
});

function quote() {
  return {
    status: "issued",
    currency: "EUR",
    totals: { charge: 8618 },
    travelers: [
      { given_name: "Ana", family_name: "Ruiz", email: "ana@example.com" },
      { given_name: "Luis", family_name: "Sanz", email: "ana@example.com" },
    ],
    legs: [
      { origin: "MAD", destination: "OSL", departureDate: "2026-12-15", departsAt: "08:30", arrivesAt: "11:40", returnDate: "2026-12-20", returnDepartsAt: "18:40", returnArrivesAt: "21:05", airline: "VY", flightNumber: "1234", passengers: 1 },
      { origin: "BCN", destination: "OSL", departureDate: "2026-12-15", departsAt: "09:10", airline: "U2", flightNumber: "808", passengers: 1 },
    ],
  };
}

test("el correo de prueba no llama billete a un localizador y no cobra de verdad", () => {
  const message = saleMail.buildConfirmation({
    quote: quote(),
    orders: [
      { origin: "MAD", bookingReference: "ABC123", tickets: [] },
      { origin: "BCN", bookingReference: "DEF456", tickets: [] },
    ],
    testMode: true,
    lang: "es",
  });
  assert.match(message.subject, /prueba/);
  assert.match(message.text, /No se ha cobrado dinero real/);
  assert.match(message.text, /no es un billete de aerolínea/);
  assert.match(message.text, /MAD → OSL/);
  assert.match(message.text, /Llegada: 11:40/);
  assert.match(message.text, /Vuelta: 2026-12-20 · 18:40 – 21:05/);
  assert.match(message.text, /Ana Ruiz/);
  assert.match(message.text, /Localizador: ABC123/);
  assert.match(message.text, /BCN → OSL/);
  assert.match(message.text, /Luis Sanz/);
  assert.match(message.text, /Localizador: DEF456/);
  assert.match(message.text, /no ha devuelto un número de billete/);
  assert.equal(message.text.includes("4242"), false);
});

test("el número de billete solo entra si Duffel lo ha devuelto", () => {
  const numbers = saleMail.ticketNumbers({
    documents: [
      { type: "electronic_ticket", unique_identifier: "1255900000001" },
      { type: "eticket_associated_file", unique_identifier: "no-cuenta" },
      { type: "electronic_ticket", unique_identifier: "" },
    ],
  });
  assert.deepEqual(numbers, ["1255900000001"]);
  const message = saleMail.buildConfirmation({
    quote: quote(),
    orders: [
      { origin: "MAD", bookingReference: "ABC123", tickets: numbers },
      { origin: "BCN", bookingReference: "DEF456", tickets: [] },
    ],
    testMode: false,
    lang: "en",
  });
  assert.match(message.text, /Ticket: 1255900000001/);
  assert.match(message.text, /The airline did not return a ticket number/);
  assert.equal(message.text.includes("practice payment"), false);
  assert.equal(message.text.includes("4242"), false);
  const unknown = saleMail.buildConfirmation({
    quote: quote(),
    orders: [{ origin: "MAD", bookingReference: "ABC123", tickets: [] }],
    testMode: null,
    lang: "es",
  });
  assert.match(unknown.subject, /localizadores/);
  assert.match(unknown.text, /no dice si el cobro ha sido real/);
  assert.equal(unknown.text.includes("dinero real"), false);
  assert.equal(unknown.text.includes("está confirmada"), false);
});

test("sin clave de correo no se envía nada", async () => {
  let called = false;
  saleMail.__test.setTransport(() => { called = true; return { status: 201 }; });
  const message = saleMail.buildConfirmation({ quote: quote(), orders: [], testMode: true, lang: "es" });
  const sent = await saleMail.sendConfirmation(message, "ana@example.com");
  assert.equal(sent.sent, false);
  assert.equal(sent.code, "MAIL_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("con clave, el correo sale al contacto y no a otra dirección", async () => {
  process.env.BREVO_API_KEY = "brevo-test-key";
  const seen = [];
  saleMail.__test.setTransport(async (payload) => {
    seen.push(payload);
    return { status: 201 };
  });
  const message = saleMail.buildConfirmation({
    quote: quote(),
    orders: [{ origin: "MAD", bookingReference: "ABC123", tickets: ["1255900000001"] }],
    testMode: true,
    lang: "es",
  });
  const sent = await saleMail.sendConfirmation(message, "ana@example.com");
  assert.equal(sent.sent, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].to, "ana@example.com");
  assert.match(seen[0].text, /ABC123/);
  assert.match(seen[0].text, /1255900000001/);
  const bad = await saleMail.sendConfirmation(message, "no-es-un-correo");
  assert.equal(bad.sent, false);
  assert.equal(bad.code, "MAIL_FAILED");
  assert.equal(seen.length, 1);
});
