// ─── Paneles de la vista de resultados ───────────────────────────────────────
// Extraídos de App.jsx (Mejora 27): reparto de costes y CTA de planificación.
import { useState } from "react";
import { cityOf, formatEur, countryFlag } from "../utils/helpers";
import { BedDouble, Target, Map as MapIcon } from "lucide-react";
import { convertPrice } from "../utils/resultsLogic";

export function CostSplitCard({ bestDest, origins, currency, t }) {
  const [splitMode, setSplitMode] = useState("equal"); // equal | actual
  if (!bestDest?.flights?.length || origins.length < 2) return null;

  const breakdown = bestDest.flights;
  const totalCost = bestDest.totalCostEUR || 0;
  const equalShare = totalCost / origins.length;

  // In "actual" mode, each pays their own flight
  // In "equal" mode, everyone pays the same (equal share)
  // Show who owes whom
  const diffs = breakdown.map(f => {
    const origin = String(f.origin).toUpperCase();
    const actual = f.price || 0;
    const diff = actual - equalShare; // positive = overpaid, negative = underpaid
    return { origin, actual, equalShare, diff };
  });

  return (
    <div className="fm-split-card view-enter">
      <div className="fm-split-header">
        <h2 className="fm-split-title mb-0">{t("results.splitTitle")}</h2>
        <div className="fm-split-toggle" role="group" aria-label={t("results.splitTitle")}>
          {[["equal", t("results.splitEqual")], ["actual", t("results.splitActual")]].map(([v, l]) => (
            <button key={v} type="button"
              aria-pressed={splitMode === v}
              className={`fm-split-pill${splitMode === v ? " fm-split-pill--active" : ""}`}
              onClick={() => setSplitMode(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="fm-split-grid">
        {diffs.map(d => (
          <div key={d.origin} className="fm-split-row">
            <span className="fm-split-avatar" aria-hidden="true">{d.origin}</span>
            <span className="fm-split-origin">{countryFlag(d.origin)} {d.origin}</span>
            <span className="fm-split-pays">
              {splitMode === "equal"
                ? (currency === "EUR" ? formatEur(equalShare, 0) : convertPrice(equalShare, currency))
                : (currency === "EUR" ? formatEur(d.actual, 0) : convertPrice(d.actual, currency))
              }
            </span>
            {splitMode === "equal" && (
              <span className={`fm-split-diff${d.diff > 2 ? " fm-split-diff--overpaid" : d.diff < -2 ? " fm-split-diff--underpaid" : ""}`}>
                {Math.abs(d.diff) < 2 ? "=" :
                  d.diff > 0
                    ? `${t("results.splitGets")} ${currency === "EUR" ? formatEur(d.diff, 0) : convertPrice(d.diff, currency)}`
                    : `${t("results.splitOwes")} ${currency === "EUR" ? formatEur(Math.abs(d.diff), 0) : convertPrice(Math.abs(d.diff), currency)}`
                }
              </span>
            )}
          </div>
        ))}
      </div>
      {splitMode === "equal" && (
        <div className="fm-split-note">{t("results.splitNote")}</div>
      )}
    </div>
  );
}

export function PlanYourTripCTA({ destCode, departureDate, returnDate, t }) {
  if (!destCode) return null;
  const city = cityOf(destCode) || destCode;
  const checkin = departureDate || "";
  const checkout = returnDate || "";

  const bookingUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}&checkin=${checkin}&checkout=${checkout}`;
  const activitiesUrl = `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}`;
  const mapsUrl = `https://www.google.com/maps/place/${encodeURIComponent(city)}`;

  return (
    <div className="fm-plan-trip view-enter">
      <h2 className="fm-plan-trip-title">{t("results.planTripTitle")}</h2>
      <div className="fm-plan-trip-subtitle">{t("results.planTripSub", { city })}</div>
      <div className="fm-plan-trip-links">
        <a href={bookingUrl} target="_blank" rel="noreferrer" className="fm-plan-trip-link">
          <span className="fm-plan-trip-link-icon"><BedDouble size={18} aria-hidden="true" /></span>
          <span>{t("results.planHotels")}</span>
        </a>
        <a href={activitiesUrl} target="_blank" rel="noreferrer" className="fm-plan-trip-link">
          <span className="fm-plan-trip-link-icon"><Target size={18} aria-hidden="true" /></span>
          <span>{t("results.planActivities")}</span>
        </a>
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="fm-plan-trip-link">
          <span className="fm-plan-trip-link-icon"><MapIcon size={18} aria-hidden="true" /></span>
          <span>{t("results.planMap")}</span>
        </a>
      </div>
    </div>
  );
}
