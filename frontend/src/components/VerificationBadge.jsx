import React from "react";
import { useI18n } from "../i18n/useI18n";
import { formatEur } from "../utils/helpers";
import { convertPrice } from "../utils/resultsLogic";
import { Check, ArrowUp, ArrowDown, Info } from "lucide-react";

// Renders a trust chip for the winning destination based on its live-price check
// (SerpAPI / Google Flights, on demand). Reads dest.verificationStatus +
// dest.priceChangePct + dest.verifiedAt.
//   verified/changed → confirmed ✓ / updated ↑↓ (the verified price is shown)
//   skipped          → cached estimate (default; not yet checked) — honest caveat
//   partial/failed/timeout → indicative (we tried, it didn't conclude)

export default function VerificationBadge({ dest, currency = "EUR" }) {
  const { t, lang } = useI18n();
  const status = dest?.verificationStatus;
  if (!status) return null; // older cached payloads or response without verification

  const pct = Number(dest?.priceChangePct ?? 0);

  let kind, icon, text, hint;
  if (status === "verified") {
    kind = "verified";
    icon = <Check size={13} aria-hidden="true" />;
    text = t("verifyBadge.confirmed");
  } else if (status === "changed") {
    kind = "changed";
    icon = pct > 0 ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />;
    const sign = pct > 0 ? "+" : "";
    text = t("verifyBadge.changed", { pct: `${sign}${pct.toFixed(0)}%` });
    // Transparencia: el precio mostrado YA es el verificado; enseñamos de cuánto
    // venía el orientativo (cached* lo guarda mergeVerification al promocionar).
    const wasAvg = Number(dest?.cachedAveragePerTraveler);
    if (Number.isFinite(wasAvg) && wasAvg > 0) {
      hint = t("verifyBadge.wasPrice", { price: currency === "EUR" ? formatEur(wasAvg, 0) : convertPrice(wasAvg, currency) });
    }
  } else if (status === "skipped") {
    // Default, not yet checked against Google Flights. Honest caveat: the shown
    // price comes from a cached search feed, so it's an estimate, not verified.
    kind = "estimate";
    icon = <Info size={13} aria-hidden="true" />;
    text = t("verifyBadge.estimate");
    hint = t("verifyBadge.estimateHint");
  } else {
    // partial / failed / timeout → we tried but it didn't conclude → low confidence
    kind = "indicative";
    icon = <Info size={13} aria-hidden="true" />;
    text = t("verifyBadge.indicative");
    hint = t("verifyBadge.indicativeHint");
  }

  let title = hint || "";
  if (dest?.verifiedAt) {
    try {
      const d = new Date(dest.verifiedAt);
      const time = d.toLocaleTimeString(lang === "es" ? "es-ES" : "en-GB", { hour: "2-digit", minute: "2-digit" });
      const stamp = t("verifyBadge.verifiedAt", { time });
      title = title ? `${stamp} · ${title}` : stamp;
    } catch { /* ignore bad timestamp */ }
  }

  // aria-label en un <span> sin rol no lo leen todos los lectores de pantalla:
  // el detalle va como texto oculto, que además llega a quien no tiene hover.
  return (
    <span className={`wc-verify-chip wc-verify-chip--${kind}`} title={title || undefined}>
      <span className="wc-verify-icon" aria-hidden="true">{icon}</span>
      {text}
      {title && <span className="sr-only"> — {title}</span>}
    </span>
  );
}
