// ─── Paneles de la vista de resultados ───────────────────────────────────────
// Extraídos de App.jsx (Mejora 27): reparto de costes y CTA de planificación.
import { useState } from "react";
import { cityOf, formatEur, countryFlag } from "../utils/helpers";
import { BedDouble, Target, Map as MapIcon } from "lucide-react";
import { convertPrice, travelerSlot, splitRows } from "../utils/resultsLogic";
import { tapHaptic } from "../utils/haptics";

export function CostSplitCard({ bestDest, origins, currency, t }) {
  const [splitMode, setSplitMode] = useState("equal"); // equal | actual
  if (!bestDest?.flights?.length || origins.length < 2) return null;

  // A partes iguales = la misma cantidad POR PERSONA (no por ciudad): una
  // ciudad con 3 viajeros pone 3 partes. Lo que debe o recibe es de su grupo.
  const diffs = splitRows(bestDest).map((r) => ({
    origin: r.origin, pax: r.pax, actual: r.pricePP, equalShare: r.fairPP, diff: r.diff,
  }));
  const times = (d) => (d.pax > 1 ? ` × ${d.pax}` : "");

  return (
    <div className="fm-split-card view-enter">
      <div className="fm-split-header">
        <h2 className="fm-split-title mb-0">{t("results.splitTitle")}</h2>
        <div className="fm-split-toggle" role="group" aria-label={t("results.splitTitle")}>
          {[["equal", t("results.splitEqual")], ["actual", t("results.splitActual")]].map(([v, l]) => (
            <button key={v} type="button"
              aria-pressed={splitMode === v}
              className={`fm-split-pill fm-switch${splitMode === v ? " fm-split-pill--active" : ""}`}
              onClick={() => { tapHaptic(); setSplitMode(v); }}><span className="fm-led" aria-hidden="true" />{l}</button>
          ))}
        </div>
      </div>
      <div className="fm-split-grid">
        {diffs.map(d => (
          <div key={d.origin} className="fm-split-row">
            <span className={`fm-split-avatar trav-c${travelerSlot(origins, d.origin)}`} aria-hidden="true">{d.origin}</span>
            <span className="fm-split-origin">{countryFlag(d.origin)} {d.origin}</span>
            <span className="fm-split-pays">
              {splitMode === "equal"
                ? (currency === "EUR" ? formatEur(d.equalShare, 0) : convertPrice(d.equalShare, currency))
                : (currency === "EUR" ? formatEur(d.actual, 0) : convertPrice(d.actual, currency))
              }{times(d)}
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

export function PlanYourTripCTA({ destCode, departureDate, returnDate, travelers = 0, t }) {
  if (!destCode) return null;
  const city = cityOf(destCode) || destCode;
  const checkin = departureDate || "";
  const checkout = returnDate || "";

  // Booking abre por defecto con 2 adultos: se le pasa el grupo real.
  const adults = Math.max(1, Math.min(30, Math.floor(Number(travelers)) || 0));
  const bookingUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}&checkin=${checkin}&checkout=${checkout}${travelers ? `&group_adults=${adults}` : ""}`;
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
