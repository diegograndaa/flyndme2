// Pestaña de pago. Una sola cifra, la que se carga, con el desglose de cada
// viajero. La tarjeta es la de Duffel; el número no pasa por FlyndMe.
import React, { Suspense, useEffect, useState } from "react";
import "../styles/bootstrap-custom.scss";
import "../App.css";
import "../styles/theme-stitch.css";
import "../styles/board.css";
import "../styles/revision.css";
import { useI18n } from "../i18n/useI18n";
import { resolveApiBase } from "../utils/apiBase";
import { getBaseUrl } from "../utils/helpers";
import { centsOf, quoteAddsUp, SALE_CHANNEL } from "../utils/saleCheckout";
import SaleBreakdown, { saleMoney } from "./SaleBreakdown";
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

function tellOpener(quoteId, payload) {
  try {
    const channel = new BroadcastChannel(SALE_CHANNEL);
    channel.postMessage({ quoteId, ...payload });
    channel.close();
  } catch { /* sin canal: la pestaña de resultados se entera al volver a pedir */ }
}

export default function CheckoutPage({ quoteId }) {
  const { t } = useI18n();
  const [quote, setQuote] = useState(null);
  const [missing, setMissing] = useState(false);
  const [people, setPeople] = useState([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState("loading");
  const [code, setCode] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [refs, setRefs] = useState([]);
  const [external, setExternal] = useState([]);

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
          setRefs((data.orders || []).map((o) => o.bookingReference).filter(Boolean));
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
        body: JSON.stringify({ quoteId: quote.quoteId, passengers: people, email: email.trim(), phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok || !data.clientToken || centsOf(data.charge) !== centsOf(quote.charge)) {
        setPhase("ready");
        setCode(data?.charge && centsOf(data.charge) !== centsOf(quote.charge) ? "MISMATCH" : (data?.code || "SALE_FAILED"));
        return;
      }
      setClientToken(data.clientToken);
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
      const references = orders.map((o) => o.bookingReference).filter(Boolean);
      if (data?.ok && data.status === "issued") {
        setRefs(references);
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
  };
  const note = code ? t(known[code] || "results.saleFailed") : "";

  return (
    <main className="caja-page">
      <header className="caja-bar">
        <img src={`${getBaseUrl()}logo-flyndme.svg?v=6`} alt="" width={28} height={28} />
        <span>FlyndMe</span>
      </header>
      <section className="caja-card" aria-busy={phase === "loading" ? "true" : undefined}>
        <p className="caja-kicker">{t("results.saleDeskTitle")}</p>
        {quote && quoteAddsUp(quote) && (
          <p className="caja-amount">{money(quote.charge)}</p>
        )}
        <p className="caja-lead">{t("results.saleDeskLead")}</p>
        {quote && quote.legs.length > 1 && <p className="caja-note">{t("results.saleTogether")}</p>}
        {quote && quoteAddsUp(quote) && <SaleBreakdown quote={quote} t={t} />}
        {(missing || note) && <p className="caja-note" role="alert">{note || t("results.saleDeskMissing")}</p>}
        {phase === "loading" && <p className="caja-note" role="status">{t("results.salePaying")}</p>}
        {phase === "ready" || phase === "paying" ? (
          <form className="wc-sale-form" onSubmit={pay}>
            <p className="wc-sale-kicker">{t("results.salePassengers")}</p>
            {groups.map(({ leg, start }) => (
              <fieldset key={`${leg.origin}-${start}`} className="wc-sale-person">
                <legend>{leg.origin} → {leg.destination}</legend>
                {Array.from({ length: Number(leg.passengers) || 0 }, (_, j) => {
                  const i = start + j;
                  const person = people[i] || blankPerson();
                  const id = `caja-${leg.origin}-${i}`;
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
            <label className="wc-sale-field" htmlFor="caja-email">{t("results.saleEmail")}
              <input id="caja-email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="wc-sale-field" htmlFor="caja-phone">{t("results.salePhone")}
              <input id="caja-phone" type="tel" inputMode="tel" autoComplete="tel" required
                placeholder="+34600000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <span className="wc-sale-field-hint">{t("results.salePhoneHint")}</span>
            </label>
            <button type="submit" className="wc-sale-btn" disabled={phase === "paying"}>
              {phase === "paying" ? t("results.salePaying") : t("results.saleOpen", { amount: money(quote.charge) })}
            </button>
          </form>
        ) : null}
        {phase === "card" && clientToken && (
          <div className="caja-pay">
            <Suspense fallback={<p className="caja-note">{t("results.salePaying")}</p>}>
              <DuffelPay clientToken={clientToken} onSuccess={finish} onFail={() => { setPhase("ready"); setClientToken(""); setCode("PAYMENT_NOT_CONFIRMED"); }} />
            </Suspense>
          </div>
        )}
        {phase === "completing" && <p className="caja-note" role="status">{t("results.saleCompleting")}</p>}
        {phase === "issued" && (
          <p className="caja-note" role="status">{t("results.saleIssued", { ref: refs.join(", ") || "—" })}</p>
        )}
        {external.length > 0 && (
          <div className="caja-out">
            <SaleElsewhere legs={external} t={t} />
          </div>
        )}
      </section>
    </main>
  );
}
