// ─── Paneles de la vista de resultados ───────────────────────────────────────
// Extraídos de App.jsx (Mejora 27): reparto de costes, CTA de planificación,
// historial, banner de destino, enlace compartible y podio de destinos.
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur, getBaseUrl, countryFlag, fairnessColor } from "../utils/helpers";
import { convertPrice } from "../utils/resultsLogic";
import { getCityImage } from "../utils/cityImages";

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
          <span className="fm-plan-trip-link-icon">🏨</span>
          <span>{t("results.planHotels")}</span>
        </a>
        <a href={activitiesUrl} target="_blank" rel="noreferrer" className="fm-plan-trip-link">
          <span className="fm-plan-trip-link-icon">🎯</span>
          <span>{t("results.planActivities")}</span>
        </a>
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="fm-plan-trip-link">
          <span className="fm-plan-trip-link-icon">🗺️</span>
          <span>{t("results.planMap")}</span>
        </a>
      </div>
    </div>
  );
}

export function SearchHistoryPanel({ searches, onLoad, onClear, t }) {
  const [expanded, setExpanded] = useState(false);
  if (!searches || !searches.length) return null;

  return (
    <div className="fm-history view-enter">
      <button type="button" className="fm-history-toggle" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        <span className="fm-history-toggle-left">
          <span className="fm-history-icon">🕘</span>
          <span className="fm-history-title">{t("history.title")}</span>
          <span className="fm-history-count">{searches.length}</span>
        </span>
        <span className={`fm-history-chevron${expanded ? " fm-history-chevron--open" : ""}`}>▾</span>
      </button>
      {expanded && (
        <div className="fm-history-body">
          {searches.slice(0, 10).map((s, i) => (
            <button key={i} type="button" className="fm-history-item" onClick={() => { onLoad(s); setExpanded(false); }}>
              <span className="fm-history-item-origins">{(s.origins || []).join(" · ")}</span>
              <span className="fm-history-item-date">{s.departureDate || "—"}</span>
              {s.bestDest && <span className="fm-history-item-dest">→ {s.bestDest}</span>}
              {s.bestPrice != null && <span className="fm-history-item-price">{formatEur(s.bestPrice, 0)}</span>}
            </button>
          ))}
          <button type="button" className="fm-history-clear" onClick={onClear}>{t("history.clear")}</button>
        </div>
      )}
    </div>
  );
}

export function DestImageBanner({ destCode }) {
  const imgUrl = getCityImage(destCode, getBaseUrl(), { w: 1200, h: 300 });
  const city = cityOf(destCode) || destCode;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error || !imgUrl) return null;

  return (
    <div className={`fm-dest-banner${loaded ? " fm-dest-banner--loaded" : ""}`}>
      <img
        src={imgUrl}
        alt={city}
        className="fm-dest-banner-img"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        loading="lazy"
      />
      <div className="fm-dest-banner-overlay">
        <span className="fm-dest-banner-city">{city}</span>
        <span className="fm-dest-banner-code">{destCode}</span>
      </div>
    </div>
  );
}

export function ResultsShareLink({ origins, departureDate, returnDate, tripType, t }) {
  const [copied, setCopied] = useState(false);

  const buildLink = useCallback(() => {
    const params = new URLSearchParams();
    if (origins?.length) params.set("origins", origins.join(","));
    if (departureDate) params.set("dep", departureDate);
    if (returnDate) params.set("ret", returnDate);
    if (tripType) params.set("trip", tripType);
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, [origins, departureDate, returnDate, tripType]);

  const handleCopy = useCallback(() => {
    const link = buildLink();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [buildLink]);

  return (
    <div className="fm-sharelink view-enter">
      <span className="fm-sharelink-icon">🔗</span>
      <span className="fm-sharelink-text">{t("shareLink.label")}</span>
      <button type="button" className="fm-sharelink-btn" onClick={handleCopy}>
        {copied ? "✓ " + t("shareLink.copied") : t("shareLink.copy")}
      </button>
    </div>
  );
}

export function TopDestinationsPodium({ flights, currency, onSelect }) {
  const { t } = useI18n();
  if (!flights || flights.length < 3) return null;

  const sorted = [...flights].sort((a, b) => a.totalCostEUR - b.totalCostEUR).slice(0, 3);

  return (
    <div className="fm-podium view-enter">
      <h2 className="fm-podium-title">{t("results.topDestinations")}</h2>
      <div className="fm-podium-cards">
        {sorted.map((dest, pos) => {
          const code = normalizeCode(dest.destination);
          const city = cityOf(code);
          const imgUrl = getCityImage(code, getBaseUrl(), { w: 160, h: 160 });
          return (
            <button key={code} type="button"
              className={`fm-podium-card fm-podium-card--pos${pos + 1}`}
              onClick={() => onSelect?.(dest)}>
              {imgUrl && (
                <img className="fm-podium-thumb" src={imgUrl} alt={city || code} loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              )}
              <span className="fm-podium-info">
                <span className="fm-podium-city">{city || code}</span>
                <span className="fm-podium-code">{code}</span>
              </span>
              <span className="fm-podium-info" style={{ alignItems: "flex-end", flex: "0 0 auto" }}>
                <span className="fm-podium-price">
                  {currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}
                  <span className="fm-podium-pp">/pp</span>
                </span>
                <span className="fm-podium-fairness" style={{ color: fairnessColor(dest.fairnessScore ?? 0) }}>
                  {(dest.fairnessScore ?? 0).toFixed(0)}/100
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
