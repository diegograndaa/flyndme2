import React from "react";
import { useI18n } from "../i18n/useI18n";

// Renders a trust chip for the winning destination based on whether the backend
// successfully re-priced its offers via Amadeus Flight Offers Price.
// Reads dest.verificationStatus + dest.priceChangePct + dest.verifiedAt.

export default function VerificationBadge({ dest }) {
  const { t } = useI18n();
  const status = dest?.verificationStatus;
  if (!status) return null; // older cached payloads or response without verification

  const pct = Number(dest?.priceChangePct ?? 0);

  let kind, icon, text, hint;
  if (status === "verified") {
    kind = "verified";
    icon = "✓";
    text = t("verifyBadge.confirmed");
  } else if (status === "changed") {
    kind = "changed";
    icon = pct > 0 ? "↑" : "↓";
    const sign = pct > 0 ? "+" : "";
    text = t("verifyBadge.changed", { pct: `${sign}${pct.toFixed(0)}%` });
  } else {
    // partial / failed / timeout → low confidence
    kind = "indicative";
    icon = "ℹ";
    text = t("verifyBadge.indicative");
    hint = t("verifyBadge.indicativeHint");
  }

  let title = hint || "";
  if (dest?.verifiedAt) {
    try {
      const d = new Date(dest.verifiedAt);
      const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      const stamp = t("verifyBadge.verifiedAt", { time });
      title = title ? `${stamp} · ${title}` : stamp;
    } catch { /* ignore bad timestamp */ }
  }

  return (
    <span
      className={`wc-verify-chip wc-verify-chip--${kind}`}
      title={title || undefined}
      aria-label={title ? `${text} — ${title}` : text}
    >
      <span className="wc-verify-icon" aria-hidden="true">{icon}</span>
      {text}
    </span>
  );
}
