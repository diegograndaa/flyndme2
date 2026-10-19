// Venta del grupo en FlyndMe. La tarifa sale de una oferta emitible (Duffel),
// no de la caché. La comisión y el coste del cobro se calculan aparte y se
// enseñan. Sin token no se cobra ni se finge un billete.
//
// El presupuesto se guarda (memoria o Upstash). Si el billete no se emite
// después de un cobro confirmado, se pide la devolución de esos tramos.

const crypto = require("crypto");
const { createStore } = require("../utils/kvStore");

const DUFFEL_URL = "https://api.duffel.com";
const QUOTE_TTL_MS = 15 * 60 * 1000;
const SALE_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_LEGS = 8;
const MAX_PAX_PER_LEG = 9;
const TOTAL_PAX_CAP = 16;
const PAID_STATUSES = new Set(["succeeded", "captured", "confirmed", "paid"]);
// Ryanair y Wizz no se emiten por Duffel. No se les pide tarifa ni se cobran aquí.
const AIRLINE_SITE = new Set(["FR", "RK", "AL", "RR", "W6", "W9", "W4", "5W"]);

const quotes = new Map();
const saleStore = createStore({
  namespace: "sale",
  ttlMs: SALE_KEEP_MS,
  maxSize: 500,
  sweepEveryMs: 60 * 60 * 1000,
});
let transport = null;

function token() {
  return String(process.env.DUFFEL_ACCESS_TOKEN || "").trim();
}

function markupRate() {
  const n = Number(process.env.BOOKING_MARKUP_PERCENT);
  const pct = Number.isFinite(n) ? n : 5;
  return Math.min(30, Math.max(0, pct)) / 100;
}

function feeRate() {
  const n = Number(process.env.DUFFEL_PAYMENTS_FEE);
  const fee = Number.isFinite(n) ? n : 0.029;
  return Math.min(0.2, Math.max(0, fee));
}

function cents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function euros(c) {
  return (c / 100).toFixed(2);
}

// Tarifa en céntimos → comisión, coste del cobro y total a pagar.
// El cobro de Duffel se descuenta del importe cargado, así que el total
// tiene que cubrir tarifa + comisión después de esa comisión del cobro.
function priceLeg(fareCents, rate = markupRate(), fee = feeRate()) {
  const fare = Math.round(fareCents);
  const commission = Math.round(fare * rate);
  const charge = Math.round((fare + commission) / (1 - fee));
  const cardFee = charge - fare - commission;
  return { fare, commission, cardFee, charge };
}

function isIata(code) {
  return /^[A-Z]{3}$/.test(String(code || "").trim().toUpperCase());
}

function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function cleanLeg(raw) {
  const origin = String(raw?.origin || "").trim().toUpperCase();
  const destination = String(raw?.destination || "").trim().toUpperCase();
  const departureDate = String(raw?.departureDate || "");
  const returnDate = raw?.returnDate ? String(raw.returnDate) : "";
  const airline = String(raw?.airline || "").trim().toUpperCase();
  const flightNumber = String(raw?.flightNumber || "").replace(/\s+/g, "").replace(new RegExp(`^${airline}`), "");
  const passengers = Math.floor(Number(raw?.passengers));
  return { origin, destination, departureDate, returnDate, airline, flightNumber, passengers };
}

function validateLegs(legs, today) {
  if (!Array.isArray(legs) || legs.length < 2 || legs.length > MAX_LEGS) {
    return { code: "INVALID_LEGS" };
  }
  const clean = legs.map(cleanLeg);
  let totalPax = 0;
  for (const leg of clean) {
    if (!isIata(leg.origin) || !isIata(leg.destination) || leg.origin === leg.destination) {
      return { code: "INVALID_ROUTE" };
    }
    if (!isISODate(leg.departureDate)) return { code: "INVALID_DEPARTURE_DATE" };
    if (leg.departureDate < today) return { code: "DEPARTURE_DATE_IN_PAST" };
    if (leg.returnDate && (!isISODate(leg.returnDate) || leg.returnDate <= leg.departureDate)) {
      return { code: "INVALID_RETURN_DATE" };
    }
    // La caché a menudo no trae número, y a veces el código de aerolínea no
    // es IATA. Eso no corta la compra: se busca la tarifa emitible del trayecto.
    if (!/^[A-Z0-9]{2}$/.test(leg.airline)) {
      leg.airline = "";
      leg.flightNumber = "";
    }
    if (!Number.isInteger(leg.passengers) || leg.passengers < 1 || leg.passengers > MAX_PAX_PER_LEG) {
      return { code: "INVALID_PASSENGERS" };
    }
    totalPax += leg.passengers;
  }
  if (totalPax > TOTAL_PAX_CAP) return { code: "TOO_MANY_PASSENGERS" };
  return { legs: clean, totalPax };
}

function segmentFlight(segment) {
  const airline = String(segment?.marketing_carrier?.iata_code || "").toUpperCase();
  const number = String(segment?.marketing_carrier_flight_number || "").replace(/\s+/g, "").toUpperCase();
  const date = String(segment?.departing_at || "").slice(0, 10);
  return { airline, number, date };
}

function offerMatches(offer, leg) {
  const out = segmentFlight(offer?.slices?.[0]?.segments?.[0]);
  if (out.airline !== leg.airline || out.number !== leg.flightNumber.toUpperCase() || out.date !== leg.departureDate) {
    return false;
  }
  const slices = offer.slices || [];
  if (leg.returnDate) {
    const back = segmentFlight(slices[1]?.segments?.[0]);
    if (!back.date || back.date !== leg.returnDate) return false;
  } else if (slices.length > 1) {
    return false;
  }
  const pax = Array.isArray(offer.passengers) ? offer.passengers.length : 0;
  return pax === leg.passengers;
}

function pickOffer(offers, leg) {
  const hits = (offers || []).filter((o) => offerMatches(o, leg));
  hits.sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
  return hits[0] || null;
}

function fallbackMatches(offer, leg) {
  const slices = offer?.slices || [];
  const out = segmentFlight(slices[0]?.segments?.[0]);
  if (!out.date || out.date !== leg.departureDate) return false;
  if (airlineSite(out.airline)) return false;
  if (leg.returnDate) {
    const back = segmentFlight(slices[1]?.segments?.[0]);
    if (back.date !== leg.returnDate) return false;
  } else if (slices.length !== 1) {
    return false;
  }
  const pax = Array.isArray(offer.passengers) ? offer.passengers.length : 0;
  return pax === leg.passengers;
}

// El mismo vuelo si Duffel lo tiene. Si no, la tarifa emitible más barata de
// ese trayecto y ese día. El precio que se cobra es el de esa oferta.
function chooseOffer(offers, leg) {
  if (leg.airline && leg.flightNumber && !airlineSite(leg.airline)) {
    const exact = pickOffer(offers, leg);
    if (exact) return { offer: exact, sameFlight: true };
  }
  const hits = (offers || []).filter((o) => fallbackMatches(o, leg));
  hits.sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
  return hits[0] ? { offer: hits[0], sameFlight: false } : null;
}

function describeOffer(offer) {
  const seg = offer?.slices?.[0]?.segments?.[0] || {};
  const airline = String(seg.marketing_carrier?.iata_code || "").toUpperCase();
  const airlineName = String(seg.marketing_carrier?.name || "").trim();
  const flightNumber = String(seg.marketing_carrier_flight_number || "").replace(/\s+/g, "");
  const departingAt = String(seg.departing_at || "");
  return {
    airline,
    airlineName,
    flightNumber,
    departsAt: departingAt.length >= 16 ? departingAt.slice(11, 16) : "",
  };
}

function airlineSite(code) {
  return AIRLINE_SITE.has(String(code || "").toUpperCase());
}

function publicExternal(leg, reason) {
  return {
    origin: leg.origin,
    destination: leg.destination,
    airline: leg.airline,
    flightNumber: leg.flightNumber,
    departureDate: leg.departureDate,
    returnDate: leg.returnDate || null,
    passengers: leg.passengers,
    reason,
  };
}

async function defaultTransport(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data };
}

async function duffel(method, path, body) {
  const send = transport || defaultTransport;
  const res = await send(`${DUFFEL_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Duffel-Version": "v2",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify({ data: body }),
  });
  if (!res || res.status >= 400) {
    const err = new Error("duffel");
    err.code = "SALE_FAILED";
    throw err;
  }
  return res.data?.data ?? res.data;
}

function purgeQuotes() {
  const now = Date.now();
  for (const [id, quote] of quotes) {
    if (quote.expires <= now) quotes.delete(id);
  }
}

async function saveQuote(quote, ttlMs) {
  quotes.set(quote.quoteId, quote);
  await saleStore.set(quote.quoteId, quote, { ttlMs });
  return quote;
}

async function readQuote(quoteId) {
  const id = String(quoteId || "");
  if (!id) return null;
  const now = Date.now();
  const hot = quotes.get(id);
  if (hot) {
    if (hot.expires > now) return hot;
    quotes.delete(id);
  }
  const stored = await saleStore.get(id);
  if (!stored || typeof stored !== "object") return null;
  if (typeof stored.expires === "number" && stored.expires <= now) return null;
  quotes.set(id, stored);
  return stored;
}

function unissuedCents(quote, issuedCount) {
  return quote.legs.slice(issuedCount).reduce((sum, leg) => sum + (Number(leg.charge) || 0), 0);
}

async function refundUnissued(quote, issuedCount) {
  if (quote.refund) return quote.refund;
  const due = unissuedCents(quote, issuedCount);
  if (due <= 0 || !quote.intentId) return null;
  const amount = euros(due);
  try {
    const refund = await duffel("POST", "/payments/refunds", {
      payment_intent_id: quote.intentId,
      amount,
      currency: quote.currency,
    });
    quote.refund = { status: "refunded", id: refund?.id || null, amount, currency: quote.currency };
  } catch {
    quote.refund = { status: "failed", id: null, amount, currency: quote.currency };
  }
  return quote.refund;
}

function resultFrom(quote) {
  const refund = quote.refund || null;
  const orders = quote.orders || [];
  const failedOrigin = quote.failedOrigin || null;
  if (quote.status === "issued") return { ok: true, status: "issued", orders, refund };
  if (quote.status === "refunded") return { ok: false, code: "SALE_REFUNDED", orders, failedOrigin, refund };
  if (quote.status === "refund_failed") return { ok: false, code: "REFUND_FAILED", orders, failedOrigin, refund };
  if (quote.status === "partial") return { ok: false, code: "TICKET_PARTIAL", orders, failedOrigin, refund };
  return null;
}

async function searchLeg(leg) {
  const slices = [{ origin: leg.origin, destination: leg.destination, departure_date: leg.departureDate }];
  if (leg.returnDate) {
    slices.push({ origin: leg.destination, destination: leg.origin, departure_date: leg.returnDate });
  }
  const data = await duffel("POST", "/air/offer_requests?return_offers=true", {
    slices,
    passengers: Array.from({ length: leg.passengers }, () => ({ type: "adult" })),
    cabin_class: "economy",
    // 15 s por aerolínea. Las ciudades se piden a la vez, así el grupo cabe
    // en el corte del proxy (~30 s) y el botón no se queda colgado.
    supplier_timeout: 15000,
  });
  return data?.offers || [];
}

function sumParts(parts) {
  return parts.reduce((s, p) => ({
    fare: s.fare + p.fare,
    commission: s.commission + p.commission,
    cardFee: s.cardFee + p.cardFee,
    charge: s.charge + p.charge,
  }), { fare: 0, commission: 0, cardFee: 0, charge: 0 });
}

async function quoteLegs(rawLegs, today) {
  if (!token()) return { available: false, code: "BOOKING_NOT_CONFIGURED" };
  const checked = validateLegs(rawLegs, today);
  if (checked.code) return { available: false, code: checked.code };
  const rate = markupRate();
  const fee = feeRate();
  const priced = [];
  const external = [];
  const searched = await Promise.all(checked.legs.map(async (leg) => {
    try {
      return { leg, offers: await searchLeg(leg) };
    } catch {
      return { leg, offers: [] };
    }
  }));
  for (const { leg, offers } of searched) {
    const chosen = chooseOffer(offers, leg);
    // Sin oferta emitible no se inventa un billete. Ryanair y Wizz, si Duffel
    // no trae otro vuelo de ese trayecto, se reservan en su web.
    if (!chosen) {
      external.push(publicExternal(leg, airlineSite(leg.airline) ? "AIRLINE_SITE" : "FLIGHT_NOT_FOR_SALE"));
      continue;
    }
    const offer = chosen.offer;
    const described = describeOffer(offer);
    const fareCents = cents(offer.total_amount);
    if (fareCents == null) return { available: false, code: "SALE_FAILED" };
    const currency = String(offer.total_currency || "").toUpperCase();
    if (priced.length && priced[0].currency !== currency) return { available: false, code: "MIXED_CURRENCY" };
    const money = priceLeg(fareCents, rate, fee);
    priced.push({
      origin: leg.origin,
      destination: leg.destination,
      airline: described.airline || leg.airline,
      airlineName: described.airlineName,
      flightNumber: described.flightNumber || leg.flightNumber,
      departsAt: described.departsAt,
      sameFlight: chosen.sameFlight,
      departureDate: leg.departureDate,
      returnDate: leg.returnDate || null,
      passengers: leg.passengers,
      currency,
      offerId: offer.id,
      passengerIds: (offer.passengers || []).map((p) => p.id),
      ...money,
    });
  }
  if (!priced.length) {
    const code = external.every((leg) => leg.reason === "AIRLINE_SITE") ? "AIRLINE_SITE" : "FLIGHT_NOT_FOR_SALE";
    return { available: false, code, external };
  }
  const totals = sumParts(priced);
  const quoteId = crypto.randomBytes(12).toString("base64url");
  const stored = {
    quoteId,
    legs: priced,
    totals,
    currency: priced[0].currency,
    rate,
    expires: Date.now() + QUOTE_TTL_MS,
    status: "quoted",
    external,
  };
  await saveQuote(stored, QUOTE_TTL_MS);
  return publicView(stored, { available: true });
}

// Lo que ve el cliente. Sin oferta, sin token de la tarjeta y sin datos del viajero.
function publicView(quote, extra = {}) {
  return {
    ...extra,
    quoteId: quote.quoteId,
    currency: quote.currency,
    markupPercent: Math.round(Number(quote.rate) * 1000) / 10,
    passengerCount: quote.legs.reduce((sum, leg) => sum + leg.passengers, 0),
    status: quote.status,
    legs: quote.legs.map((leg) => ({
      origin: leg.origin,
      destination: leg.destination,
      airline: leg.airline,
      airlineName: leg.airlineName || "",
      flightNumber: leg.flightNumber,
      departsAt: leg.departsAt || "",
      sameFlight: leg.sameFlight === true,
      departureDate: leg.departureDate,
      passengers: leg.passengers,
      fare: euros(leg.fare),
      commission: euros(leg.commission),
      cardFee: euros(leg.cardFee),
      charge: euros(leg.charge),
    })),
    orders: (quote.orders || []).map((order) => ({
      origin: order.origin,
      bookingReference: order.bookingReference || null,
    })),
    fare: euros(quote.totals.fare),
    commission: euros(quote.totals.commission),
    cardFee: euros(quote.totals.cardFee),
    charge: euros(quote.totals.charge),
    external: (Array.isArray(quote.external) ? quote.external : []).map((leg) => ({
      origin: leg.origin,
      destination: leg.destination,
      airline: leg.airline,
      flightNumber: leg.flightNumber,
      departureDate: leg.departureDate,
      returnDate: leg.returnDate || null,
      passengers: leg.passengers,
      reason: leg.reason === "AIRLINE_SITE" ? "AIRLINE_SITE" : "FLIGHT_NOT_FOR_SALE",
    })),
  };
}

async function publicQuote(quoteId) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(String(quoteId || ""))) return null;
  const quote = await readQuote(quoteId);
  if (!quote?.totals || !Array.isArray(quote.legs) || !quote.legs.length) return null;
  const view = publicView(quote);
  const raw = JSON.stringify(view);
  if (raw.includes("offerId") || raw.includes("clientToken") || raw.includes("passengerIds")) return null;
  return view;
}

function validName(s) {
  const name = String(s || "").trim();
  return name.length >= 1 && name.length <= 40 && /^[\p{L} .'-]+$/u.test(name);
}

function normalizeTraveler(raw, email, phone) {
  const given_name = String(raw?.givenName || "").trim();
  const family_name = String(raw?.familyName || "").trim();
  const born_on = String(raw?.bornOn || "");
  const gender = String(raw?.gender || "").toLowerCase();
  const title = String(raw?.title || "").toLowerCase();
  if (!validName(given_name) || !validName(family_name)) return { code: "INVALID_NAME" };
  if (!isISODate(born_on)) return { code: "INVALID_BIRTH_DATE" };
  const adultBefore = new Date();
  adultBefore.setUTCFullYear(adultBefore.getUTCFullYear() - 12);
  if (born_on > adultBefore.toISOString().slice(0, 10)) return { code: "ADULT_REQUIRED" };
  if (gender !== "m" && gender !== "f") return { code: "INVALID_GENDER" };
  if (!["mr", "mrs", "ms", "miss", "dr"].includes(title)) return { code: "INVALID_TITLE" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { code: "INVALID_EMAIL" };
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { code: "INVALID_PHONE" };
  return { traveler: { given_name, family_name, born_on, gender, title, email, phone_number: phone } };
}

async function startPayment(quoteId, people, email, phone) {
  if (!token()) return { ok: false, code: "BOOKING_NOT_CONFIGURED" };
  const quote = await readQuote(quoteId);
  if (!quote) return { ok: false, code: "QUOTE_EXPIRED" };
  const done = resultFrom(quote);
  if (done) return done;
  if (quote.intentId && quote.clientToken) {
    return { ok: true, clientToken: quote.clientToken, charge: euros(quote.totals.charge), currency: quote.currency };
  }
  const expected = quote.legs.reduce((s, leg) => s + leg.passengers, 0);
  if (!Array.isArray(people) || people.length !== expected) return { ok: false, code: "INVALID_PASSENGERS" };
  const travelers = [];
  for (const person of people) {
    const checked = normalizeTraveler(person, email, phone);
    if (checked.code) return { ok: false, code: checked.code };
    travelers.push(checked.traveler);
  }
  const intent = await duffel("POST", "/payments/payment_intents", {
    amount: euros(quote.totals.charge),
    currency: quote.currency,
  });
  if (!intent?.id || !intent?.client_token) return { ok: false, code: "SALE_FAILED" };
  quote.travelers = travelers;
  quote.intentId = intent.id;
  quote.clientToken = intent.client_token;
  quote.status = "paying";
  quote.expires = Date.now() + SALE_KEEP_MS;
  await saveQuote(quote, SALE_KEEP_MS);
  return { ok: true, clientToken: intent.client_token, charge: euros(quote.totals.charge), currency: quote.currency };
}

async function completeSale(quoteId) {
  if (!token()) return { ok: false, code: "BOOKING_NOT_CONFIGURED" };
  const quote = await readQuote(quoteId);
  if (!quote) return { ok: false, code: "QUOTE_EXPIRED" };
  const done = resultFrom(quote);
  if (done) return done;
  if (!quote.intentId || !quote.travelers) return { ok: false, code: "PAYMENT_NOT_CONFIRMED" };
  const intent = await duffel("GET", `/payments/payment_intents/${quote.intentId}`);
  const status = String(intent?.status || "").toLowerCase();
  if (!PAID_STATUSES.has(status)) return { ok: false, code: "PAYMENT_NOT_CONFIRMED" };
  if (cents(intent.amount) !== quote.totals.charge || String(intent.currency || "").toUpperCase() !== quote.currency) {
    return { ok: false, code: "PAYMENT_MISMATCH" };
  }
  const orders = [];
  let cursor = 0;
  for (const leg of quote.legs) {
    const slice = quote.travelers.slice(cursor, cursor + leg.passengers);
    cursor += leg.passengers;
    const passengers = slice.map((traveler, i) => ({ ...traveler, id: leg.passengerIds[i] }));
    if (passengers.some((p) => !p.id)) return { ok: false, code: "SALE_FAILED", orders };
    try {
      const order = await duffel("POST", "/air/orders", {
        selected_offers: [leg.offerId],
        payments: [{ type: "balance", amount: euros(leg.fare), currency: quote.currency }],
        passengers,
      });
      if (!order?.id) throw new Error("no order");
      orders.push({ origin: leg.origin, orderId: order.id, bookingReference: order.booking_reference || null });
    } catch {
      quote.orders = orders;
      quote.failedOrigin = leg.origin;
      await refundUnissued(quote, orders.length);
      quote.status = orders.length === 0
        ? (quote.refund?.status === "refunded" ? "refunded" : "refund_failed")
        : "partial";
      quote.expires = Date.now() + SALE_KEEP_MS;
      await saveQuote(quote, SALE_KEEP_MS);
      return resultFrom(quote);
    }
  }
  quote.orders = orders;
  quote.status = "issued";
  quote.expires = Date.now() + SALE_KEEP_MS;
  await saveQuote(quote, SALE_KEEP_MS);
  return resultFrom(quote);
}

module.exports = {
  quoteLegs,
  publicQuote,
  startPayment,
  completeSale,
  priceLeg,
  offerMatches,
  pickOffer,
  chooseOffer,
  validateLegs,
  __test: {
    setTransport(fn) { transport = fn; },
    reset() {
      transport = null;
      quotes.clear();
      if (saleStore._map) saleStore._map.clear();
    },
    forgetMemory() { quotes.clear(); },
  },
};
