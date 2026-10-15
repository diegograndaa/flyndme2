// Compra de los vuelos del grupo en FlyndMe. El importe sale de la tarifa
// emitible que devuelve el servidor (más comisión y coste del cobro). Sin esa
// tarifa no se pinta un precio de cobro. Ryanair y Wizz, y cualquier vuelo
// que Duffel no tenga, se reservan en su web y no entran en este pago.
import React, { Suspense, useState } from "react";
import { Ticket } from "lucide-react";
import { useI18n } from "../i18n/useI18n";
import { formatEur, buildSkyscannerUrl } from "../utils/helpers";
import { buildAirlineBookingUrl } from "../utils/airlineBooking";
import { airlineName } from "../utils/flightTime";

const AIRLINE_SITE = new Set(["FR", "RK", "AL", "RR", "W6", "W9", "W4", "5W"]);

const DuffelPay = React.lazy(() => import("./DuffelPay"));

const TITLES = ["mr", "mrs", "ms", "miss", "dr"];

function blankPerson() {
  return { givenName: "", familyName: "", bornOn: "", gender: "m", title: "mr" };
}

function peopleFor(quote, prev = []) {
  const n = Number(quote?.passengerCount) || 0;
  return Array.from({ length: n }, (_, i) => prev[i] || blankPerson());
}

function moneyOf(sale) {
  const refund = sale?.refund;
  if (!refund?.amount) return "";
  return saleMoney(refund.amount, refund.currency || "EUR");
}

function saleMoney(amount, currency) {
  const cur = String(currency || "").toUpperCase();
  if (cur === "EUR") return formatEur(Number(amount), 2);
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} ${cur}`;
}

function isSiteAirline(code) {
  return AIRLINE_SITE.has(String(code || "").trim().toUpperCase());
}

function bookTarget(leg) {
  const booking = buildAirlineBookingUrl({
    airline: leg.airline,
    origin: leg.origin,
    destination: leg.destination,
    departureDate: leg.departureDate,
    returnDate: leg.returnDate || "",
    adults: leg.passengers,
    flightNumber: leg.flightNumber,
  });
  if (booking?.url) return { url: booking.url, airline: booking.airlineName };
  const url = buildSkyscannerUrl({
    origin: leg.origin,
    destination: leg.destination,
    departureDate: leg.departureDate,
    returnDate: leg.returnDate || "",
    tripType: leg.returnDate ? "roundtrip" : "oneway",
    adults: leg.passengers,
  });
  const name = airlineName(leg.airline) || leg.airline || "";
  return url ? { url, airline: name, sky: true } : { url: "", airline: name };
}

function saleMessage(t, sale) {
  const code = sale?.code;
  if (!code) return "";
  if (code === "BOOKING_NOT_CONFIGURED") return t("results.saleNotConfigured");
  if ((code === "FLIGHT_NOT_FOR_SALE" || code === "AIRLINE_SITE") && sale?.external?.length) return "";
  if (code === "FLIGHT_NOT_FOR_SALE") return t("results.saleNotForSale", { origin: sale.origin || "" });
  if (code === "AIRLINE_SITE") return t("results.saleAirlineOnly");
  if (code === "FLIGHT_NOT_IDENTIFIED") return t("results.saleNotIdentified");
  if (code === "QUOTE_EXPIRED") return t("results.saleExpired");
  if (code === "PAYMENT_NOT_CONFIRMED" || code === "PAYMENT_MISMATCH") return t("results.saleNotPaid");
  if (code === "SALE_REFUNDED") return t("results.saleRefunded", { amount: moneyOf(sale) });
  if (code === "REFUND_FAILED") return t("results.saleRefundFailed", { amount: moneyOf(sale) });
  if (code === "TICKET_PARTIAL" && sale?.refund?.status === "refunded") {
    return t("results.salePartialRefunded", { origin: sale.failedOrigin || sale.origin || "", amount: moneyOf(sale) });
  }
  if (code === "TICKET_PARTIAL" && sale?.refund?.status === "failed") {
    return t("results.salePartialRefundFailed", { origin: sale.failedOrigin || sale.origin || "", amount: moneyOf(sale) });
  }
  if (code === "TICKET_PARTIAL") return t("results.salePartial", { origin: sale.failedOrigin || sale.origin || "" });
  if (code === "INVALID_NAME") return t("results.saleInvalidName");
  if (code === "INVALID_BIRTH_DATE") return t("results.saleInvalidBirth");
  if (code === "ADULT_REQUIRED") return t("results.saleAdult");
  if (code === "INVALID_GENDER") return t("results.saleInvalidGender");
  if (code === "INVALID_TITLE") return t("results.saleInvalidTitle");
  if (code === "INVALID_EMAIL") return t("results.saleInvalidEmail");
  if (code === "INVALID_PHONE") return t("results.saleInvalidPhone");
  return t("results.saleFailed");
}

export default function GroupSalePanel({ legs = [], sale = null, onRequest, onSubmit, onPaid, onFail }) {
  const { t } = useI18n();
  const quote = sale?.quote || null;
  const quoteId = quote?.quoteId || "";
  const [people, setPeople] = useState(() => peopleFor(quote));
  const [seenQuote, setSeenQuote] = useState(quoteId);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  if (quoteId !== seenQuote) {
    setSeenQuote(quoteId);
    setPeople(peopleFor(quote, people));
  }

  const phase = sale?.phase || "idle";
  const busy = phase === "quoting" || phase === "paying" || phase === "completing";
  const sitePreview = legs.filter((leg) => isSiteAirline(leg.airline));
  const canPayHere = legs.some((leg) => !isSiteAirline(leg.airline));
  const quoted = quote && phase !== "error";
  const external = quoted ? (quote.external || []) : (phase === "error" ? (sale?.external || []) : sitePreview);
  // El botón del total cobra aquí: tarifa emitible, comisión y coste del cobro.
  // Ryanair, Wizz y el vuelo que no está a la venta se reservan aparte.
  const showBuy = canPayHere && (phase === "idle" || phase === "quoting");
  const retryable = phase === "error" && !["BOOKING_NOT_CONFIGURED", "FLIGHT_NOT_IDENTIFIED", "REFUND_FAILED", "AIRLINE_SITE"].includes(sale?.code);
  const showForm = quote && (phase === "quote" || phase === "paying");
  const showPay = phase === "card" && sale?.clientToken;
  const cur = quote?.currency || "EUR";
  const money = (amount) => saleMoney(amount, cur);
  const note = saleMessage(t, sale);
  const refs = (sale?.orders || []).map((o) => o.bookingReference || o.orderId).filter(Boolean);

  let cursor = 0;
  const groups = (quote?.legs || []).map((leg) => {
    const start = cursor;
    cursor += Number(leg.passengers) || 0;
    return { leg, start };
  });

  const setPerson = (i, patch) => {
    setPeople((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  return (
    <div className="wc-sale">
      {showBuy && (
        <button type="button" className="wc-sale-btn" disabled={busy}
          onClick={() => onRequest?.(legs)}>
          <Ticket size={16} aria-hidden="true" />
          {phase === "quoting"
            ? t("results.saleQuoting")
            : (sitePreview.length ? t("results.buyGroupRest") : t("results.buyGroup"))}
        </button>
      )}
      {phase === "idle" && canPayHere && sitePreview.length > 0 && (
        <p className="wc-sale-hint">{t("results.buyGroupHintSplit")}</p>
      )}
      {phase === "idle" && canPayHere && sitePreview.length === 0 && (
        <p className="wc-sale-hint">{t("results.buyGroupHint")}</p>
      )}
      {phase === "idle" && !canPayHere && (
        <p className="wc-sale-hint">{t("results.saleAirlineOnly")}</p>
      )}
      {phase === "quoting" && (
        <p className="wc-sale-note" role="status">{t("results.saleQuoting")}</p>
      )}
      {note && <p className="wc-sale-note" role="alert">{note}</p>}
      {quoted && external.length > 0 && (
        <p className="wc-sale-kicker">{t("results.saleHere")}</p>
      )}
      {quoted && (
        <div className="wc-sale-lines">
          <div><span>{t("results.saleFare")}</span><span>{money(quote.fare)}</span></div>
          <div><span>{t("results.saleFee", { pct: quote.markupPercent })}</span><span>{money(quote.commission)}</span></div>
          <div><span>{t("results.saleCardFee")}</span><span>{money(quote.cardFee)}</span></div>
          <div><strong>{t("results.saleTotal")}</strong><strong>{money(quote.charge)}</strong></div>
        </div>
      )}
      {showForm && (
        <form className="wc-sale-form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(people, email.trim(), phone.trim()); }}>
          <p className="wc-sale-kicker">{t("results.salePassengers")}</p>
          {groups.map(({ leg, start }) => (
            <fieldset key={`${leg.origin}-${start}`} className="wc-sale-person">
              <legend>{leg.origin} → {leg.destination}</legend>
              {Array.from({ length: Number(leg.passengers) || 0 }, (_, j) => {
                const i = start + j;
                const person = people[i] || blankPerson();
                const id = `sale-${leg.origin}-${i}`;
                return (
                  <div key={id} className="wc-sale-person-fields">
                    <label className="wc-sale-field" htmlFor={`${id}-given`}>{t("results.saleGiven")}
                      <input id={`${id}-given`} name="given-name" autoComplete="given-name" required maxLength={40}
                        value={person.givenName} onChange={(e) => setPerson(i, { givenName: e.target.value })} />
                    </label>
                    <label className="wc-sale-field" htmlFor={`${id}-family`}>{t("results.saleFamily")}
                      <input id={`${id}-family`} name="family-name" autoComplete="family-name" required maxLength={40}
                        value={person.familyName} onChange={(e) => setPerson(i, { familyName: e.target.value })} />
                    </label>
                    <label className="wc-sale-field" htmlFor={`${id}-born`}>{t("results.saleBorn")}
                      <input id={`${id}-born`} type="date" required value={person.bornOn}
                        onChange={(e) => setPerson(i, { bornOn: e.target.value })} />
                    </label>
                    <label className="wc-sale-field" htmlFor={`${id}-gender`}>{t("results.saleGender")}
                      <select id={`${id}-gender`} value={person.gender} onChange={(e) => setPerson(i, { gender: e.target.value })}>
                        <option value="m">{t("results.saleGenderM")}</option>
                        <option value="f">{t("results.saleGenderF")}</option>
                      </select>
                    </label>
                    <label className="wc-sale-field" htmlFor={`${id}-title`}>{t("results.saleTitle")}
                      <select id={`${id}-title`} value={person.title} onChange={(e) => setPerson(i, { title: e.target.value })}>
                        {TITLES.map((title) => <option key={title} value={title}>{t(`results.saleTitle_${title}`)}</option>)}
                      </select>
                    </label>
                  </div>
                );
              })}
            </fieldset>
          ))}
          <label className="wc-sale-field" htmlFor="sale-email">{t("results.saleEmail")}
            <input id="sale-email" type="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="wc-sale-field" htmlFor="sale-phone">{t("results.salePhone")}
            <input id="sale-phone" type="tel" inputMode="tel" autoComplete="tel" required
              placeholder="+34600000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <span className="wc-sale-field-hint">{t("results.salePhoneHint")}</span>
          </label>
          <button type="submit" className="wc-sale-btn" disabled={phase === "paying"}>
            {phase === "paying" ? t("results.salePaying") : t("results.salePay")}
          </button>
        </form>
      )}
      {showPay && (
        <Suspense fallback={<p className="wc-sale-note">{t("results.salePaying")}</p>}>
          <DuffelPay clientToken={sale.clientToken} onSuccess={() => onPaid?.()} onFail={() => onFail?.()} />
        </Suspense>
      )}
      {phase === "completing" && <p className="wc-sale-note" role="status">{t("results.saleCompleting")}</p>}
      {(phase === "issued" || (phase === "partial" && refs.length > 0)) && (
        <p className="wc-sale-note" role="status">{t("results.saleIssued", { ref: refs.join(", ") || "—" })}</p>
      )}
      {external.length > 0 && (
        <div className="wc-sale-else">
          <p className="wc-sale-kicker">{t("results.saleElsewhere")}</p>
          {external.map((leg) => {
            const target = bookTarget(leg);
            const name = target.airline || leg.origin;
            return (
              <div key={`${leg.origin}-${leg.flightNumber || ""}`} className="wc-sale-else-row">
                <p>
                  {leg.reason === "FLIGHT_NOT_FOR_SALE"
                    ? t("results.saleNotHere", { origin: leg.origin })
                    : t("results.saleOnAirline", { airline: name })}
                </p>
                {target.url && (
                  <a className="wc-sale-btn wc-sale-btn--ghost" href={target.url} target="_blank" rel="noopener noreferrer">
                    {target.sky ? t("results.saleBookSky") : t("results.bookOnAirline", { airline: name })}
                  </a>
                )}
              </div>
            );
          })}
          <p className="wc-sale-hint">{t("results.saleElsewhereHint")}</p>
        </div>
      )}
      {retryable && (
        <button type="button" className="wc-sale-btn wc-sale-btn--ghost" onClick={() => onRequest?.(legs)}>
          {t("results.saleRetry")}
        </button>
      )}
    </div>
  );
}
