import React, { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import {
  getBaseUrl, normalizeCode, formatEur, fairnessColor,
  buildSkyscannerUrl, buildGoogleFlightsUrl, AIRPORT_MAP, cityOf
} from "../utils/helpers";
import { getCityImage } from "../utils/cityImages";

// ─── Season helper ────────────────────────────────────────────────────────────

const SEASON_ICONS = { summer: "☀️", winter: "❄️", spring: "🌸", autumn: "🍂" };
const TEMP_HINTS = {
  AGP: [32, 12], PMI: [31, 10], TFS: [28, 19], BCN: [30, 9],
  ROM: [31, 7], ATH: [34, 8], LIS: [28, 10], MLA: [33, 11],
  LON: [23, 5], PAR: [25, 4], BER: [25, 0], AMS: [22, 3],
  DUB: [20, 5], PRG: [26, -1], VIE: [27, 0], BUD: [28, -1],
  WAW: [25, -2], CPH: [22, 1], OSL: [22, -4], HEL: [22, -6],
  STO: [22, -3], MIL: [30, 2], NAP: [30, 7], OPO: [25, 9],
  RAK: [38, 12], IST: [29, 5], DBV: [30, 6], SPU: [30, 6],
  NCE: [28, 7], GVA: [26, 1], ZRH: [25, 0], MUC: [24, -1],
};

function getSeasonKey(month) {
  if (month >= 5 && month <= 8) return "summer";
  if (month >= 11 || month <= 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  return "autumn";
}

function getWeatherChip(code, dateStr, t) {
  if (!dateStr) return null;
  const month = new Date(dateStr + "T00:00:00").getMonth();
  const season = getSeasonKey(month);
  const icon = SEASON_ICONS[season] || "🌤️";
  const temps = TEMP_HINTS[code];
  let tempStr = "";
  if (temps) {
    const w = season === "summer" ? 1 : season === "winter" ? 0 : 0.5;
    tempStr = ` ~${Math.round(temps[1] + (temps[0] - temps[1]) * w)}°C`;
  }
  const seasonLabel = t("alt.season." + season) || season;
  return `${icon} ${seasonLabel}${tempStr}`;
}

// ─── Alternative card ─────────────────────────────────────────────────────────

const AltCard = React.memo(function AltCard({ dest, rank, origins, departureDate, returnDate, tripType, bestDest }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const code     = normalizeCode(dest.destination);
  const city     = AIRPORT_MAP[code]?.city || "";
  const imgUrl   = getCityImage(code, getBaseUrl(), { w: 600, h: 300 });
  const isBest   = normalizeCode(bestDest?.destination) === code;
  const flights  = Array.isArray(dest.flights) ? dest.flights : [];
  const dep      = dest.bestDate || departureDate || "";
  const ret      = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");
  const fairness = dest.fairnessScore ?? 0;
  const fColor   = fairnessColor(fairness);

  // Weather/season chip
  const weatherChip = getWeatherChip(code, dep, t);

  // Build first origin's Skyscanner URL for the main CTA
  const firstOrigin = origins[0] || "";
  const mainSsUrl = buildSkyscannerUrl({ origin: firstOrigin, destination: code, departureDate: dep, returnDate: ret, tripType });

  return (
    <div className={`alt-card${isBest ? " alt-card--best" : ""}`}>
      {/* Image */}
      <div className="alt-card-img-wrap">
        <img src={imgUrl} alt={city || code} className="alt-card-img"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="alt-card-img-overlay" />
        <div className="alt-card-img-label">
          <span className="alt-card-code">{city || code}</span>
          {city && <span className="alt-card-city">{code}</span>}
        </div>
        {isBest && <div className="alt-card-badge">{t("alt.recommended")}</div>}
        <div className="alt-card-price-badge">{formatEur(dest.averageCostPerTraveler ?? 0, 0)}<span>/pp</span></div>
      </div>

      {/* Content */}
      <div className="alt-card-body">
        <div className="alt-card-rank-row">
          <div className="alt-card-rank">#{rank}</div>
          {weatherChip && <span className="alt-card-weather">{weatherChip}</span>}
        </div>

        <div className="alt-card-prices">
          <div>
            <div className="alt-card-plabel">{t("alt.groupTotal")}</div>
            <div className="alt-card-price">{formatEur(dest.totalCostEUR ?? 0, 0)}</div>
          </div>
          <div>
            <div className="alt-card-plabel">{t("alt.perPerson")}</div>
            <div className="alt-card-price">{formatEur(dest.averageCostPerTraveler ?? 0, 0)}</div>
          </div>
          <div>
            <div className="alt-card-plabel">{t("alt.fairness")}</div>
            <div className="alt-card-price" style={{ color: fColor }}>{fairness.toFixed(0)}/100</div>
          </div>
        </div>

        {/* Fairness bar */}
        <div className="alt-card-bar-wrap">
          <div className="alt-card-bar-fill" style={{ width: `${Math.min(100, fairness)}%`, background: fColor }} />
        </div>

        {/* Main booking CTA */}
        {mainSsUrl && (
          <a href={mainSsUrl} target="_blank" rel="noreferrer" className="alt-card-book-btn">
            {t("alt.bookOn")} Skyscanner
          </a>
        )}

        {/* More booking options + breakdown */}
        {flights.length > 0 && (
          <>
            <button type="button" className="alt-card-toggle" onClick={() => setOpen((v) => !v)}>
              {open ? t("alt.hideBreakdown") : t("alt.viewBreakdown")}
            </button>
            <div className={`alt-card-detail-wrap${open ? " open" : ""}`}>
              <div>
                <ul className="alt-card-detail">
                  {flights.map((f, i) => {
                    const originCode = String(f.origin || "").toUpperCase();
                    const ssUrl = buildSkyscannerUrl({ origin: originCode, destination: code, departureDate: dep, returnDate: ret, tripType });
                    const gfUrl = buildGoogleFlightsUrl({ origin: originCode, destination: code, departureDate: dep, returnDate: ret, tripType });
                    return (
                      <li key={i} className="alt-card-detail-row">
                        <span className="alt-card-detail-origin">
                          {originCode} <span className="alt-card-detail-city">{cityOf(originCode)}</span>
                        </span>
                        <span className="alt-card-detail-price">
                          {typeof f.price === "number" ? formatEur(f.price, 0) : t("alt.noData")}
                        </span>
                        <span className="alt-card-detail-links">
                          {ssUrl && <a href={ssUrl} target="_blank" rel="noreferrer" className="alt-mini-link">SS</a>}
                          {gfUrl && <a href={gfUrl} target="_blank" rel="noreferrer" className="alt-mini-link alt-mini-link--gf">GF</a>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

// ─── FlightResults ────────────────────────────────────────────────────────────

export default function FlightResults({
  flights = [],
  bestDestination,
  origins = [],
  departureDate = "",
  returnDate = "",
  tripType = "oneway",
  budgetEnabled = false,
  maxBudgetPerTraveler = null,
}) {
  const { t } = useI18n();
  const [sortBy, setSortBy] = useState("default");

  const safeFlights = Array.isArray(flights) ? flights : [];

  const bestCode = normalizeCode(bestDestination?.destination);
  const alternatives = useMemo(() => {
    let list = safeFlights.filter((f) => normalizeCode(f.destination) !== bestCode);

    if (sortBy === "priceAsc")   list = [...list].sort((a, b) => (a.totalCostEUR ?? 0) - (b.totalCostEUR ?? 0));
    if (sortBy === "priceDesc")  list = [...list].sort((a, b) => (b.totalCostEUR ?? 0) - (a.totalCostEUR ?? 0));
    if (sortBy === "perPerson")  list = [...list].sort((a, b) => (a.averageCostPerTraveler ?? 0) - (b.averageCostPerTraveler ?? 0));
    if (sortBy === "fairness")   list = [...list].sort((a, b) => (b.fairnessScore ?? 0) - (a.fairnessScore ?? 0));

    return list;
  }, [safeFlights, bestCode, sortBy]);

  const cleanOrigins = useMemo(
    () => origins.map((o) => String(o || "").trim().toUpperCase()).filter(Boolean),
    [origins]
  );

  if (!safeFlights.length) return (
    <div className="alt-empty">
      <div className="alt-empty-icon">🔎</div>
      <div className="alt-empty-title">{t("alt.noAlternatives")}</div>
      <div className="alt-empty-sub">
        {budgetEnabled
          ? t("alt.budgetActive", { amount: formatEur(Number(maxBudgetPerTraveler ?? 0), 0) })
          : t("alt.noAltSuggestion")}
      </div>
    </div>
  );

  return (
    <div>
      {budgetEnabled && (
        <div className="alert alert-info py-2 mb-3">
          {t("alt.budgetFilter", { amount: formatEur(Number(maxBudgetPerTraveler ?? 0), 0) })}
        </div>
      )}

      {/* Sort control */}
      {alternatives.length > 1 && (
        <div className="d-flex align-items-center gap-2 mb-3">
          <label className="form-label small mb-0 fw-semibold" htmlFor="altSort" style={{ color: "#475569", whiteSpace: "nowrap" }}>
            {t("alt.sortLabel")}
          </label>
          <select id="altSort" className="form-select form-select-sm" style={{ maxWidth: 260 }}
            value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="default">{t("alt.sortDefault")}</option>
            <option value="priceAsc">{t("alt.sortPriceAsc")}</option>
            <option value="priceDesc">{t("alt.sortPriceDesc")}</option>
            <option value="perPerson">{t("alt.sortPerPerson")}</option>
            <option value="fairness">{t("alt.sortFairness")}</option>
          </select>
        </div>
      )}

      {/* Cards grid */}
      <div className="alt-grid">
        {alternatives.map((dest, i) => (
          <AltCard
            key={dest.destination}
            dest={dest}
            rank={i + 2}
            origins={cleanOrigins}
            departureDate={departureDate}
            returnDate={returnDate}
            tripType={tripType}
            bestDest={bestDestination}
          />
        ))}
      </div>

      {!alternatives.length && (
        <p className="text-secondary small">{t("alt.noMore")}</p>
      )}
    </div>
  );
}
