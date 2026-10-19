// Desglose de un cobro ya calculado. Cada tramo y el total salen del servidor.
import React from "react";
import { cityOf, formatEur } from "../utils/helpers";

function saleMoney(amount, currency) {
  const cur = String(currency || "").toUpperCase();
  if (cur === "EUR") return formatEur(Number(amount), 2);
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} ${cur}`;
}

export function flightBits(leg) {
  const who = leg.airlineName || leg.airline || "";
  const num = leg.flightNumber ? ` ${leg.flightNumber}` : "";
  return { line: who ? `${who}${num}`.trim() : "", time: leg.departsAt || "" };
}

export default function SaleBreakdown({ quote, t, part = "all", variant = "compact" }) {
  if (!quote) return null;
  const money = (amount) => saleMoney(amount, quote.currency);
  const flights = part !== "totals" && part !== "fees";
  // La ficha y la caja enseñan el precio de cada vuelo ya con la comisión y
  // la tarjeta dentro. Esas líneas sueltas hacían parecer otro importe.
  const totals = part === "totals";
  return (
    <div className="wc-sale-legs">
      {flights && quote.legs.map((leg) => {
        const bits = flightBits(leg);
        const key = `${leg.origin}-${leg.flightNumber || ""}-${leg.departureDate || ""}`;
        if (variant === "itinerary") {
          const fromCity = cityOf(leg.origin);
          const toCity = cityOf(leg.destination);
          return (
            <section key={key} className="caja-itin">
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
              <p className="caja-itin-meta">
                {bits.line && <span>{bits.line}</span>}
                <strong>{money(leg.charge)}</strong>
              </p>
            </section>
          );
        }
        return (
          <section key={key} className="wc-sale-leg">
            <div className="wc-sale-route">
              <span className="wc-sale-codes">{`${leg.origin} → ${leg.destination}`}</span>
              <strong>{money(leg.charge)}</strong>
            </div>
            {(bits.line || bits.time) && (
              <p className="wc-sale-flight">
                {bits.line && <span>{bits.line}</span>}
                {bits.time && <span className="wc-sale-time">{bits.time}</span>}
              </p>
            )}
          </section>
        );
      })}
      {totals && (
        <div className="wc-sale-lines wc-sale-lines--total">
          <div><span>{t("results.saleFare")}</span><span>{money(quote.fare)}</span></div>
          <div><span>{t("results.saleFee", { pct: quote.markupPercent })}</span><span>{money(quote.commission)}</span></div>
          <div><span>{t("results.saleCardFee")}</span><span>{money(quote.cardFee)}</span></div>
          {part !== "fees" && (
            <div><strong>{t("results.saleTotal")}</strong><strong>{money(quote.charge)}</strong></div>
          )}
        </div>
      )}
    </div>
  );
}

export { saleMoney };
