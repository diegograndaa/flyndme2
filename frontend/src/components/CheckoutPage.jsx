// Pestaña de pago. Una sola cifra, la que se carga, con el desglose de cada
// viajero. La tarjeta es la de Duffel; el número no pasa por FlyndMe.
import React, { Suspense, useEffect, useState } from "react";
import { Check, CreditCard, Lock } from "lucide-react";
import "../styles/bootstrap-custom.scss";
import "../App.css";
import "../styles/theme-stitch.css";
import "../styles/board.css";
import "../styles/revision.css";
import { useI18n } from "../i18n/useI18n";
import { resolveApiBase } from "../utils/apiBase";
import { cityOf, formatDate, getBaseUrl } from "../utils/helpers";
import { centsOf, quoteAddsUp, SALE_CHANNEL } from "../utils/saleCheckout";
import SaleBreakdown, { flightBits, saleMoney } from "./SaleBreakdown";
import SaleElsewhere from "./SaleElsewhere";

const DuffelPay = React.lazy(() => import("./DuffelPay"));
const API_BASE = resolveApiBase(import.meta.env);
const TITLES = ["mr", "mrs", "ms", "miss", "dr"];

function blankPerson() {
  return { givenName: "", familyName: "", bornOn: "", gender: "m", title: "mr" };
}

function peopleFor(quote) {
  const n = Number(quote?.passengerCount) || 0;
  return Array.from({ length: n }, () => blankPerson());
}

export function PaymentDesk({ t, testMode, busy = false, children }) {
  return (
    <section className="caja-pay" aria-labelledby="caja-pay-title">
      <div className="caja-pay-head">
        <h1 id="caja-pay-title" className="caja-pay-title">{t("results.salePayTitle")}</h1>
        <p className="caja-secure">
          <Lock size={16} aria-hidden="true" />
          <span>{t("results.salePaySecure")}</span>
        </p>
      </div>
      {busy ? (
        <p className="caja-note caja-pay-status" role="status">{children}</p>
      ) : (
        <>
          {testMode === true && <p className="caja-banner caja-banner--test">{t("results.saleTestCard")}</p>}
          {testMode === false && <p className="caja-banner">{t("results.saleLiveCard")}</p>}
          <div className="caja-method">
            <CreditCard size={22} aria-hidden="true" />
            <div>
              <p className="caja-method-kicker">{t("results.salePayHow")}</p>
              <p className="caja-method-name">{t("results.salePayMethod")}</p>
            </div>
          </div>
          <p className="caja-trust">{t("results.salePayTrust")}</p>
          <div className="caja-pay-body">
            <p className="caja-field-label">{t("results.saleCardHint")}</p>
            {children}
          </div>
        </>
      )}
    </section>
  );
}

function namesFor(leg, people, cursor) {
  const fromQuote = Array.isArray(leg?.names) ? leg.names.filter(Boolean) : [];
  if (fromQuote.length) return { names: fromQuote, next: cursor + (Number(leg?.passengers) || fromQuote.length) };
  const count = Number(leg?.passengers) || 0;
  const names = (people || []).slice(cursor, cursor + count)
    .map((person) => `${person.givenName || ""} ${person.familyName || ""}`.trim())
    .filter(Boolean);
  return { names, next: cursor + count };
}

export function SaleConfirmation({ quote, orders, people, testMode, emailSent, emailCode, t }) {
  const money = (amount) => saleMoney(amount, quote?.currency || "EUR");
  const list = Array.isArray(orders) ? orders : [];
  let cursor = 0;
  const rows = (quote?.legs || []).map((leg, index) => {
    const named = namesFor(leg, people, cursor);
    cursor = named.next;
    const order = list[index] && list[index].origin === leg.origin
      ? list[index]
      : list.find((item) => item.origin === leg.origin) || null;
    return { leg, names: named.names, order };
  });
  const amountLabel = testMode === true
    ? t("results.saleTestAmount")
    : testMode === false
      ? t("results.salePaid")
      : t("results.saleAmount");
  const headline = testMode === true
    ? t("results.saleTestDone")
    : testMode === false
      ? t("results.saleConfirmed")
      : t("results.saleRecorded");
  return (
    <section className="caja-done">
      <p className="caja-kicker">{t("results.saleDoneKicker")}</p>
      <h1 className="caja-done-title" role="status">{headline}</h1>
      <div className="caja-confirm">
        {rows.map(({ leg, names, order }) => {
          const bits = flightBits(leg);
          const fromCity = cityOf(leg.origin);
          const toCity = cityOf(leg.destination);
          const ref = order?.bookingReference || "";
          const tickets = Array.isArray(order?.tickets) ? order.tickets.filter(Boolean) : [];
          const back = [formatDate(leg.returnDate), leg.returnDepartsAt].filter(Boolean).join(" · ");
          return (
            <article key={`${leg.origin}-${leg.flightNumber || ""}-${leg.departureDate || ""}`} className="caja-confirm-flight">
              <div className="caja-itin-ends">
                <div className="caja-itin-end">
                  <span className="caja-itin-code">{leg.origin}</span>
                  {fromCity && <span className="caja-itin-city">{fromCity}</span>}
                </div>
                <div className="caja-itin-mid" aria-hidden="true">
                  <span className="caja-itin-rule" />
                  {bits.time && <span className="caja-itin-time">{bits.time}</span>}
                  <span className="caja-itin-rule" />
                </div>
                <div className="caja-itin-end caja-itin-end--arr">
                  <span className="caja-itin-code">{leg.destination}</span>
                  {toCity && <span className="caja-itin-city">{toCity}</span>}
                </div>
              </div>
              <dl className="caja-confirm-grid">
                {leg.departureDate && (
                  <div><dt>{t("results.saleWhen")}</dt><dd>{formatDate(leg.departureDate)}</dd></div>
                )}
                {bits.time && (
                  <div><dt>{t("results.saleDepart")}</dt><dd>{bits.time}</dd></div>
                )}
                {bits.line && (
                  <div><dt>{t("results.saleFlight")}</dt><dd>{bits.line}</dd></div>
                )}
                {back && (
                  <div><dt>{t("results.saleReturn")}</dt><dd>{back}</dd></div>
                )}
                {names.length > 0 && (
                  <div className="caja-confirm-wide"><dt>{t("results.saleStepPeople")}</dt><dd>{names.join(", ")}</dd></div>
                )}
                <div className="caja-confirm-wide">
                  <dt>{t("results.saleLocatorLabel")}</dt>
                  <dd className="caja-confirm-ref">{ref || "—"}</dd>
                </div>
                {tickets.map((ticket) => (
                  <div key={ticket} className="caja-confirm-wide">
                    <dt>{t("results.saleTicketWord")}</dt>
                    <dd className="caja-confirm-ref">{ticket}</dd>
                  </div>
                ))}
                <div><dt>{t("results.saleAmount")}</dt><dd>{money(leg.charge)}</dd></div>
              </dl>
              {leg.sameFlight === false && <p className="caja-note">{t("results.saleOtherFlight")}</p>}
            </article>
          );
        })}
      </div>
      <div className="caja-paid">
        <p className="caja-amount-label">{amountLabel}</p>
        <p className="caja-amount">{money(quote.charge)}</p>
      </div>
      {quote.contactEmail && <p className="caja-note">{t("results.salePayMail", { email: quote.contactEmail })}</p>}
      {emailSent && <p className="caja-note" role="status">{t("results.saleEmailSent")}</p>}
      {emailCode === "MAIL_NOT_CONFIGURED" && <p className="caja-note" role="status">{t("results.saleEmailOff")}</p>}
      {emailCode === "MAIL_FAILED" && <p className="caja-note" role="alert">{t("results.saleEmailFailed")}</p>}
    </section>
  );
}

function tellOpener(quoteId, payload) {
  try {
    const channel = new BroadcastChannel(SALE_CHANNEL);
    channel.postMessage({ quoteId, ...payload });
    channel.close();
  } catch { /* sin canal: la pestaña de resultados se entera al volver a pedir */ }
}

export default function CheckoutPage({ quoteId }) {
  const { t, lang } = useI18n();
  const [quote, setQuote] = useState(null);
  const [missing, setMissing] = useState(false);
  const [people, setPeople] = useState([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState("loading");
  const [step, setStep] = useState("trip");
  const [code, setCode] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [issued, setIssued] = useState([]);
  const [external, setExternal] = useState([]);
  const [refundText, setRefundText] = useState("");
  const [testMode, setTestMode] = useState(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailCode, setEmailCode] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/api/flights/group-sale/desk/${encodeURIComponent(quoteId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!live) return;
        setExternal(Array.isArray(data?.external) ? data.external : []);
        if (!data?.quoteId || !quoteAddsUp(data)) {
          setMissing(true);
          setPhase("error");
          setCode(data?.quoteId ? "MISMATCH" : "QUOTE_EXPIRED");
          return;
        }
        setQuote(data);
        setPeople(peopleFor(data));
        if (data.status === "issued") {
          setPhase("issued");
          setIssued(Array.isArray(data.orders) ? data.orders : []);
          setTestMode(data.testMode === true ? true : data.testMode === false ? false : null);
          setEmailSent(data.emailSent === true);
          setEmailCode(data.emailCode || "");
          return;
        }
        setPhase("ready");
      })
      .catch(() => { if (live) { setMissing(true); setPhase("error"); setCode("SALE_FAILED"); } });
    return () => { live = false; };
  }, [quoteId]);

  const money = (amount) => saleMoney(amount, quote?.currency || "EUR");
  const setPerson = (i, patch) => {
    setPeople((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const pay = async (event) => {
    event.preventDefault();
    if (!quote || !quoteAddsUp(quote)) return;
    setPhase("paying");
    setCode("");
    try {
      const res = await fetch(`${API_BASE}/api/flights/group-sale/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId, passengers: people, email: email.trim(), phone: phone.trim(), lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok || !data.clientToken || centsOf(data.charge) !== centsOf(quote.charge)) {
        setPhase("ready");
        setCode(data?.charge && centsOf(data.charge) !== centsOf(quote.charge) ? "MISMATCH" : (data?.code || "SALE_FAILED"));
        return;
      }
      setClientToken(data.clientToken);
      setTestMode(data.testMode === true ? true : data.testMode === false ? false : null);
      setPhase("card");
    } catch {
      setPhase("ready");
      setCode("SALE_FAILED");
    }
  };

  const finish = async () => {
    setPhase("completing");
    try {
      const res = await fetch(`${API_BASE}/api/flights/group-sale/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const data = await res.json().catch(() => ({}));
      const orders = data?.orders || [];
      setRefundText(data?.refund?.amount ? money(data.refund.amount) : "");
      setIssued(orders);
      setEmailSent(data?.emailSent === true);
      setEmailCode(data?.emailCode || "");
      setTestMode(data?.testMode === true ? true : data?.testMode === false ? false : testMode);
      if (data?.ok && data.status === "issued") {
        setPhase("issued");
        tellOpener(quote.quoteId, { phase: "issued", orders });
        return;
      }
      setPhase("error");
      setCode(data?.code || "SALE_FAILED");
      tellOpener(quote.quoteId, {
        phase: "error",
        code: data?.code || "SALE_FAILED",
        orders,
        failedOrigin: data?.failedOrigin || null,
        refund: data?.refund || null,
      });
    } catch {
      setPhase("error");
      setCode("SALE_FAILED");
    }
  };

  let cursor = 0;
  const groups = (quote?.legs || []).map((leg) => {
    const start = cursor;
    cursor += Number(leg.passengers) || 0;
    return { leg, start };
  });
  const known = {
    MISMATCH: "results.saleMismatch",
    QUOTE_EXPIRED: "results.saleDeskMissing",
    INVALID_NAME: "results.saleInvalidName",
    INVALID_BIRTH_DATE: "results.saleInvalidBirth",
    ADULT_REQUIRED: "results.saleAdult",
    INVALID_GENDER: "results.saleInvalidGender",
    INVALID_TITLE: "results.saleInvalidTitle",
    INVALID_EMAIL: "results.saleInvalidEmail",
    INVALID_PHONE: "results.saleInvalidPhone",
    PAYMENT_NOT_CONFIRMED: "results.saleNotPaid",
    PAYMENT_MISMATCH: "results.saleMismatch",
    SALE_REFUNDED: "results.saleRefunded",
    REFUND_FAILED: "results.saleRefundFailed",
  };
  const note = code ? t(known[code] || "results.saleFailed", { amount: refundText || "—" }) : "";
  const ready = quote && quoteAddsUp(quote);
  const showPeople = phase === "ready" || phase === "paying";
  const showPay = phase === "card" || phase === "completing";

  const steps = [
    ["trip", t("results.saleStepTrip")],
    ["people", t("results.saleStepPeople")],
    ["pay", t("results.saleStepPay")],
  ];
  const onStep = phase === "issued" ? "pay" : (showPay ? "pay" : step);

  const paying = onStep === "pay";
  const travellers = people
    .map((person) => `${person.givenName || ""} ${person.familyName || ""}`.trim())
    .filter(Boolean);
  const side = ready ? (
    <aside className={paying ? "caja-side caja-side--pay" : "caja-side"}>
      {paying && (
        <div className="caja-receipt">
          <p className="caja-amount-label">{t("results.salePayTrip")}</p>
          <ul>
            {quote.legs.map((leg) => {
              const bits = flightBits(leg);
              const meta = [formatDate(leg.departureDate), bits.time, bits.line].filter(Boolean).join(" · ");
              return (
                <li key={`${leg.origin}-${leg.flightNumber || ""}-${leg.departureDate || ""}`}>
                  <span className="caja-receipt-route">{`${leg.origin} → ${leg.destination}`}</span>
                  {meta && <span className="caja-receipt-meta">{meta}</span>}
                  <strong>{money(leg.charge)}</strong>
                </li>
              );
            })}
          </ul>
          {travellers.length > 0 && (
            <p className="caja-receipt-pax"><span>{t("results.saleStepPeople")}</span>{travellers.join(", ")}</p>
          )}
          {email.trim() && (
            <p className="caja-receipt-pax">{t("results.salePayMail", { email: email.trim() })}</p>
          )}
          <dl className="caja-lines">
            <div><dt>{t("results.saleFare")}</dt><dd>{money(quote.fare)}</dd></div>
            <div><dt>{t("results.saleFee", { pct: quote.markupPercent })}</dt><dd>{money(quote.commission)}</dd></div>
            <div><dt>{t("results.salePayCardCost")}</dt><dd>{money(quote.cardFee)}</dd></div>
          </dl>
        </div>
      )}
      <div className={paying ? "caja-amount-plaque" : undefined}>
      <p className="caja-amount-label">{paying ? t("results.saleTotal") : t("results.saleFinal")}</p>
      <p className="caja-amount">{money(quote.charge)}</p>
      </div>
      {onStep === "trip" && (
        <button type="button" className="wc-sale-btn" onClick={() => setStep("people")}>
          {t("results.saleNext")}
        </button>
      )}
      {onStep === "people" && (
        <div className="caja-side-actions">
          <button type="button" className="wc-sale-btn wc-sale-btn--ghost" onClick={() => setStep("trip")}>
            {t("results.saleBack")}
          </button>
          <button type="submit" className="wc-sale-btn" disabled={phase === "paying"}>
            {phase === "paying" ? t("results.salePaying") : t("results.saleOpen", { amount: money(quote.charge) })}
          </button>
        </div>
      )}
    </aside>
  ) : null;

  return (
    <main className="caja-page">
      <header className="caja-bar">
        <img src={`${getBaseUrl()}logo-flyndme.svg?v=6`} alt="" width={28} height={28} />
        <span>FlyndMe</span>
      </header>
      <p className="caja-kicker">{t("results.saleDeskTitle")}</p>
      {phase === "loading" && <p className="caja-note" role="status">{t("results.salePaying")}</p>}
      {(missing || note) && phase !== "loading" && <p className="caja-note" role="alert">{note || t("results.saleDeskMissing")}</p>}
      {ready && phase !== "issued" && (
        <nav className="caja-steps" aria-label={t("results.saleDeskTitle")}>
          {steps.map(([id, label], i) => {
            const current = onStep === id;
            const locked = id === "pay" || (id === "people" && showPay);
            const stepIndex = steps.findIndex(([stepId]) => stepId === onStep);
            return (
              <button key={id} type="button" aria-current={current ? "step" : undefined}
                className={i < stepIndex ? "caja-step--done" : undefined}
                disabled={locked || showPay}
                onClick={() => { if (id === "trip" || id === "people") setStep(id); }}>
                <span className="caja-step-n" aria-hidden="true">{i < stepIndex ? <Check size={14} strokeWidth={2.5} /> : i + 1}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      )}
      {ready && phase === "issued" && (
        <SaleConfirmation
          quote={quote}
          orders={issued}
          people={people}
          testMode={testMode}
          emailSent={emailSent}
          emailCode={emailCode}
          t={t}
        />
      )}
      {ready && onStep === "trip" && phase !== "issued" && (
        <div className="caja-layout">
          <div className="caja-main">
            <SaleBreakdown quote={quote} t={t} part="flights" variant="itinerary" />
            {external.length > 0 && <div className="caja-out"><SaleElsewhere legs={external} t={t} /></div>}
          </div>
          {side}
        </div>
      )}
      {ready && showPeople && onStep === "people" && (
        <form className="caja-layout" onSubmit={pay}>
          <div className="caja-main wc-sale-form">
            {groups.map(({ leg, start }) => (
              <fieldset key={`${leg.origin}-${start}`} className="wc-sale-person">
                <legend className="wc-sale-codes">{`${leg.origin} → ${leg.destination}`}</legend>
                {Array.from({ length: Number(leg.passengers) || 0 }, (_, j) => {
                  const i = start + j;
                  const person = people[i] || blankPerson();
                  const id = `caja-${leg.origin}-${i}`;
                  return (
                    <div key={id} className="wc-sale-person-fields">
                      <div className="wc-sale-pair">
                        <label className="wc-sale-field" htmlFor={`${id}-given`}>{t("results.saleGiven")}
                          <input id={`${id}-given`} name="given-name" autoComplete="given-name" required maxLength={40}
                            value={person.givenName} onChange={(e) => setPerson(i, { givenName: e.target.value })} />
                        </label>
                        <label className="wc-sale-field" htmlFor={`${id}-family`}>{t("results.saleFamily")}
                          <input id={`${id}-family`} name="family-name" autoComplete="family-name" required maxLength={40}
                            value={person.familyName} onChange={(e) => setPerson(i, { familyName: e.target.value })} />
                        </label>
                      </div>
                      <div className="wc-sale-pair">
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
                      </div>
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
            <fieldset className="wc-sale-person">
              <legend className="wc-sale-codes">{t("results.saleContact")}</legend>
              <label className="wc-sale-field" htmlFor="caja-email">{t("results.saleEmail")}
                <input id="caja-email" type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="wc-sale-field" htmlFor="caja-phone">{t("results.salePhone")}
                <input id="caja-phone" type="tel" inputMode="tel" autoComplete="tel" required
                  placeholder="+34600000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
            </fieldset>
          </div>
          {side}
        </form>
      )}
      {ready && showPay && (
        <div className="caja-layout caja-layout--pay">
          <PaymentDesk t={t} testMode={testMode} busy={phase === "completing"}>
            {phase === "completing" ? t("results.saleCompleting") : (
              <Suspense fallback={<p className="caja-note">{t("results.salePaying")}</p>}>
                <DuffelPay clientToken={clientToken} onSuccess={finish} onFail={() => { setPhase("ready"); setStep("people"); setClientToken(""); setCode("PAYMENT_NOT_CONFIRMED"); }} />
              </Suspense>
            )}
          </PaymentDesk>
          {side}
        </div>
      )}
    </main>
  );
}
