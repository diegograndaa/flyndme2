// Desglose de un cobro ya calculado. Cada tramo y el total salen del servidor.
import React from "react";
import { formatEur } from "../utils/helpers";

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

export default function SaleBreakdown({ quote, t }) {
  if (!quote) return null;
  const money = (amount) => saleMoney(amount, quote.currency);
  return (
    <div className="wc-sale-legs">
      {quote.legs.map((leg) => {
        const bits = flightBits(leg);
        return (
          <section key={`${leg.origin}-${leg.flightNumber || ""}-${leg.departureDate || ""}`} className="wc-sale-leg">
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
      <div className="wc-sale-lines wc-sale-lines--total">
        <div><span>{t("results.saleFare")}</span><span>{money(quote.fare)}</span></div>
        <div><span>{t("results.saleFee", { pct: quote.markupPercent })}</span><span>{money(quote.commission)}</span></div>
        <div><span>{t("results.saleCardFee")}</span><span>{money(quote.cardFee)}</span></div>
        <div><strong>{t("results.saleTotal")}</strong><strong>{money(quote.charge)}</strong></div>
      </div>
    </div>
  );
}

export { saleMoney };
