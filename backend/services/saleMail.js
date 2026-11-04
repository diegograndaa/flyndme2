// Confirmación de la compra. Solo entra lo que Duffel ha devuelto: localizador,
// vuelo y, si viene, el número de billete. Sin eso no se inventa un billete.
// Sin BREVO_API_KEY no se envía nada: la página lo dice.

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
let transport = null;

function configured() {
  return Boolean(String(process.env.BREVO_API_KEY || "").trim());
}

function homeUrl() {
  const fallback = "https://flyndme.com";
  const raw = String(process.env.FRONTEND_URL || fallback).trim();
  if (!raw || /[\s\r\n]/.test(raw)) return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    if (url.username || url.password) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

function fromAddress() {
  const from = String(process.env.SALE_MAIL_FROM || "diego@flyndme.com").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ? from : "diego@flyndme.com";
}

function ticketNumbers(order) {
  const docs = Array.isArray(order?.documents) ? order.documents : [];
  const numbers = [];
  for (const doc of docs) {
    const type = String(doc?.type || "");
    const id = String(doc?.unique_identifier || "").trim();
    if (!id) continue;
    if (type !== "electronic_ticket" && type !== "eticket") continue;
    if (!numbers.includes(id)) numbers.push(id);
  }
  return numbers;
}

function flightLines(quote, orders, lang) {
  let cursor = 0;
  const lines = [];
  for (let i = 0; i < orders.length; i += 1) {
    const order = orders[i];
    const leg = quote.legs[i] || {};
    const count = Number(leg.passengers) || 0;
    const people = (quote.travelers || []).slice(cursor, cursor + count);
    cursor += count;
    const names = people
      .map((person) => `${person.given_name || ""} ${person.family_name || ""}`.trim())
      .filter(Boolean);
    const when = [leg.departureDate, leg.departsAt].filter(Boolean).join(" · ");
    const flight = [leg.airline, leg.flightNumber].filter(Boolean).join(" ");
    const back = [leg.returnDate, leg.returnDepartsAt].filter(Boolean).join(" · ");
    const route = `${leg.origin || order.origin || "—"} → ${leg.destination || "—"}`;
    lines.push(route);
    if (when || flight) lines.push([when, flight].filter(Boolean).join(" · "));
    if (leg.arrivesAt) lines.push(lang === "en" ? `Arrival: ${leg.arrivesAt}` : `Llegada: ${leg.arrivesAt}`);
    if (back) {
      const landed = leg.returnArrivesAt ? ` – ${leg.returnArrivesAt}` : "";
      lines.push(lang === "en" ? `Return: ${back}${landed}` : `Vuelta: ${back}${landed}`);
    }
    if (names.length) {
      lines.push(lang === "en" ? `Travellers: ${names.join(", ")}` : `Viajeros: ${names.join(", ")}`);
    }
    const ref = order.bookingReference || "";
    lines.push(ref
      ? (lang === "en" ? `Locator: ${ref}` : `Localizador: ${ref}`)
      : (lang === "en" ? "Locator: not returned" : "Localizador: no ha llegado"));
    const tickets = Array.isArray(order.tickets) ? order.tickets : [];
    if (tickets.length) {
      lines.push(lang === "en" ? `Ticket: ${tickets.join(", ")}` : `Billete: ${tickets.join(", ")}`);
    } else {
      lines.push(lang === "en"
        ? "The airline did not return a ticket number."
        : "La aerolínea no ha devuelto un número de billete.");
    }
    lines.push("");
  }
  return lines;
}

function buildConfirmation({ quote, orders, testMode, lang }) {
  const en = lang === "en";
  const amount = `${(Number(quote?.totals?.charge || 0) / 100).toFixed(2)} ${quote?.currency || "EUR"}`;
  const lines = [];
  if (testMode === true) {
    lines.push(en
      ? "This is a practice payment. No real money was charged and this is not an airline ticket."
      : "Esto es un pago de prueba. No se ha cobrado dinero real y esto no es un billete de aerolínea.");
  } else if (testMode === false) {
    lines.push(en
      ? "Your purchase is confirmed. Each locator below is the one returned for that flight."
      : "Tu compra está confirmada. Cada localizador es el que ha vuelto para ese vuelo.");
  } else {
    lines.push(en
      ? "The provider returned the locators below. This message does not say whether the charge was real."
      : "El proveedor ha devuelto los localizadores de abajo. Este mensaje no dice si el cobro ha sido real.");
  }
  lines.push(en ? `Amount: ${amount}` : `Importe: ${amount}`, "");
  lines.push(...flightLines(quote, orders, en ? "en" : "es"));
  lines.push(en ? `Back to FlyndMe: ${homeUrl()}` : `Volver a FlyndMe: ${homeUrl()}`);
  if (quote?.status === "partial") {
    const origin = quote.failedOrigin || "—";
    lines.push(quote.refund?.status === "refunded"
      ? (en ? `The flight from ${origin} was not issued. That part was refunded.` : `El vuelo desde ${origin} no se ha emitido. Esa parte se ha devuelto.`)
      : (en ? `The flight from ${origin} was not issued. That refund did not go through.` : `El vuelo desde ${origin} no se ha emitido. Esa devolución no ha salido.`));
  }
  return {
    subject: testMode === true
      ? (en ? "FlyndMe — practice confirmation" : "FlyndMe — confirmación de prueba")
      : testMode === false
        ? (en ? "FlyndMe — your purchase confirmation" : "FlyndMe — confirmación de tu compra")
        : (en ? "FlyndMe — locators" : "FlyndMe — localizadores"),
    text: lines.join("\n").trim(),
  };
}

async function defaultSend({ to, subject, text }) {
  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "api-key": String(process.env.BREVO_API_KEY || "").trim(),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "FlyndMe", email: fromAddress() },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });
  return { status: res.status };
}

async function sendConfirmation(message, to) {
  const address = String(to || "").trim();
  if (!configured()) return { sent: false, code: "MAIL_NOT_CONFIGURED" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !message?.text) {
    return { sent: false, code: "MAIL_FAILED" };
  }
  try {
    const send = transport || defaultSend;
    const res = await send({ to: address, subject: message.subject, text: message.text });
    if (!res || res.status >= 400) return { sent: false, code: "MAIL_FAILED" };
    return { sent: true, code: null };
  } catch {
    return { sent: false, code: "MAIL_FAILED" };
  }
}

module.exports = {
  configured,
  ticketNumbers,
  buildConfirmation,
  sendConfirmation,
  homeUrl,
  __test: {
    setTransport(fn) { transport = fn; },
    reset() { transport = null; },
  },
};
