// Compra de los vuelos del grupo en FlyndMe. El importe sale de la tarifa
// emitible que devuelve el servidor (más comisión y coste del cobro). Sin esa
// tarifa no se pinta un precio de cobro. Ryanair y Wizz, y cualquier vuelo
// que Duffel no tenga, se reservan en su web y no entran en este pago.
import React from "react";
import { Ticket } from "lucide-react";
import { useI18n } from "../i18n/useI18n";
import { formatEur } from "../utils/helpers";
import { checkoutPath, quoteAddsUp } from "../utils/saleCheckout";
import SaleBreakdown from "./SaleBreakdown";
import SaleElsewhere from "./SaleElsewhere";

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

function flightLabel(leg) {
  const who = leg.airlineName || leg.airline || "";
  const num = leg.flightNumber ? ` ${leg.flightNumber}` : "";
  return `${leg.origin} → ${leg.destination}${who ? ` · ${who}${num}` : ""}`;
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

export default function GroupSalePanel({ legs = [], sale = null, estimateLabel = "", onRequest }) {
  const { t } = useI18n();
  const quote = sale?.quote || null;

  const phase = sale?.phase || "idle";
  const busy = phase === "quoting" || phase === "paying" || phase === "completing";
  const quoted = quote && phase !== "error";
  const external = quoted ? (quote.external || []) : (phase === "error" ? (sale?.external || []) : []);
  // Un botón. Duffel busca la tarifa que puede emitir; el cobro es esa tarifa.
  const showBuy = phase === "idle" || phase === "quoting";
  const retryable = phase === "error" && !["BOOKING_NOT_CONFIGURED", "FLIGHT_NOT_IDENTIFIED", "REFUND_FAILED", "AIRLINE_SITE"].includes(sale?.code);
  const balanced = Boolean(quoted && quoteAddsUp(quote));
  const cur = quote?.currency || "EUR";
  const money = (amount) => saleMoney(amount, cur);
  const note = saleMessage(t, sale);
  const refs = (sale?.orders || []).map((o) => o.bookingReference || o.orderId).filter(Boolean);

  return (
    <div className="wc-sale">
      {showBuy && (
        <button type="button" className="wc-sale-btn" disabled={busy}
          onClick={() => onRequest?.(legs)}>
          <Ticket size={16} aria-hidden="true" />
          {phase === "quoting" ? t("results.saleQuoting") : t("results.buyGroup")}
        </button>
      )}
      {phase === "quoting" && (
        <p className="wc-sale-note" role="status">{t("results.saleQuoting")}</p>
      )}
      {note && <p className="wc-sale-note" role="alert">{note}</p>}
      {quoted && !balanced && (
        <ul className="wc-sale-flights">
          {(quote.legs || []).map((leg) => (
            <li key={`${leg.origin}-${leg.flightNumber || ""}`}>{flightLabel(leg)}</li>
          ))}
        </ul>
      )}
      {quoted && external.length > 0 && (
        <p className="wc-sale-kicker">{t("results.saleHere")}</p>
      )}
      {balanced && <SaleBreakdown quote={quote} t={t} />}
      {balanced && estimateLabel && (
        <p className="wc-sale-flight">{t("results.saleEstimateApart", { amount: estimateLabel })}</p>
      )}
      {quoted && !balanced && <p className="wc-sale-note" role="alert">{t("results.saleMismatch")}</p>}
      {balanced && (
        <a className="wc-sale-btn" href={checkoutPath(quote.quoteId)} target="_blank" rel="noopener noreferrer">
          {t("results.saleOpen", { amount: money(quote.charge) })}
        </a>
      )}
      {balanced && external.length > 0 && (
        <p className="wc-sale-note">{t("results.saleDeskAlso")}</p>
      )}
      {phase === "completing" && <p className="wc-sale-note" role="status">{t("results.saleCompleting")}</p>}
      {(phase === "issued" || (phase === "partial" && refs.length > 0)) && (
        <p className="wc-sale-note" role="status">{t("results.saleIssued", { ref: refs.join(", ") || "—" })}</p>
      )}
      {!balanced && <SaleElsewhere legs={external} t={t} />}
      {retryable && (
        <button type="button" className="wc-sale-btn wc-sale-btn--ghost" onClick={() => onRequest?.(legs)}>
          {t("results.saleRetry")}
        </button>
      )}
    </div>
  );
}
