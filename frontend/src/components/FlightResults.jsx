// ─── FlightResults ────────────────────────────────────────────────────────────
// Destinos alternativos como lista compacta (estilo Skyscanner): filas
// escaneables con precio y equidad, desglose por origen plegable. Sin fotos,
// medallas ni chips decorativos — un solo color de acento.
import React, { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import {
  normalizeCode, formatEur, formatDate, fairnessColor, getBaseUrl,
  buildSkyscannerUrl, buildGoogleFlightsUrl, AIRPORT_MAP, cityOf, countryFlag
} from "../utils/helpers";
import { getCityImage } from "../utils/cityImages";
import { sortByCriterion } from "../utils/resultsLogic";
import "../styles/results-simple.css";

function AltThumb({ code, city }) {
  const [error, setError] = useState(false);
  const url = getCityImage(code, getBaseUrl(), { w: 160, h: 160 });
  if (error || !url) {
    return <span className="altl-thumb altl-thumb--placeholder" aria-hidden="true">{code}</span>;
  }
  return (
    <img className="altl-thumb" src={url} alt={city || code} loading="lazy"
      onError={() => setError(true)} />
  );
}

const AltRow = React.memo(function AltRow({ dest, rank, departureDate, returnDate, tripType, open, onToggle }) {
  const { t } = useI18n();

  const code     = normalizeCode(dest.destination);
  const city     = AIRPORT_MAP[code]?.city || code;
  const flights  = Array.isArray(dest.flights) ? dest.flights : [];
  const dep      = dest.bestDate || departureDate || "";
  const ret      = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");
  const fairness = dest.fairnessScore ?? 0;

  return (
    <div className={`altl-row${open ? " altl-row--open" : ""}`}>
      <button type="button" className="altl-main" onClick={onToggle}
        aria-expanded={open} title={open ? t("alt.hideBreakdown") : t("alt.viewBreakdown")}>
        <AltThumb code={code} city={city} />
        <span className="altl-rank">{rank}</span>
        <span className="altl-dest">
          <span className="altl-city">{countryFlag(code)} {city}</span>
          <span className="altl-sub">{code}{dep ? ` · ${formatDate(dep)}` : ""}{ret ? ` → ${formatDate(ret)}` : ""}</span>
        </span>
        <span className="altl-fair" title={t("results.fairnessHelp")} style={{ color: fairnessColor(fairness) }}>
          {fairness.toFixed(0)}<small>/100</small>
        </span>
        <span className="altl-prices">
          <span className="altl-pp">{formatEur(dest.averageCostPerTraveler ?? 0, 0)}<small>/pp</small></span>
          <span className="altl-total">{formatEur(dest.totalCostEUR ?? 0, 0)} {t("alt.groupTotal").toLowerCase()}</span>
        </span>
        <span className="altl-chevron" aria-hidden="true">▾</span>
      </button>

      {open && flights.length > 0 && (
        <div className="altl-detail">
          {flights.map((f, i) => {
            const originCode = String(f.origin || "").toUpperCase();
            // Fecha real del precio (fallback de fecha vecina)
            const effDep = f.flightDate || dep;
            const effRet = tripType === "roundtrip" ? (f.flightReturnDate || ret) : ret;
            // Aeropuertos reales del billete cuando el offer los trae
            const ssOrigin = f.offer?.tp?.originAirport || originCode;
            const ssDest   = f.offer?.tp?.destinationAirport || code;
            const ssUrl = buildSkyscannerUrl({ origin: ssOrigin, destination: ssDest, departureDate: effDep, returnDate: effRet, tripType });
            const gfUrl = buildGoogleFlightsUrl({ origin: ssOrigin, destination: ssDest, departureDate: effDep, returnDate: effRet, tripType });
            return (
              <div key={i} className="altl-detail-row">
                <span className="altl-detail-origin">
                  {originCode} <span className="altl-detail-city">{cityOf(originCode)}</span>
                  {f.dateFallback && (
                    <span className="altl-date-note" title={t("results.dateFallbackHint")}>
                      📅 {formatDate(effDep)}
                    </span>
                  )}
                </span>
                <span className="altl-detail-price">
                  {typeof f.price === "number" ? formatEur(f.price, 0) : t("alt.noData")}
                </span>
                <span className="altl-detail-links">
                  {/* Primario: deep link de Aviasales con marker de afiliado */}
                  {f.offer?.link && <a href={f.offer.link} target="_blank" rel="noreferrer" className="altl-link">{t("results.bookCta")}</a>}
                  {ssUrl && <a href={ssUrl} target="_blank" rel="noreferrer" className="altl-link altl-link--muted">Skyscanner</a>}
                  {gfUrl && <a href={gfUrl} target="_blank" rel="noreferrer" className="altl-link altl-link--muted">Google Flights</a>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default function FlightResults({
  flights = [],
  optimizeBy = "total",
  bestDestination,
  origins = [],
  departureDate = "",
  returnDate = "",
  tripType = "oneway",
  budgetEnabled = false,
  maxBudgetPerTraveler = null,
}) {
  const { t } = useI18n();
  const [openCode, setOpenCode] = useState(null);

  const safeFlights = Array.isArray(flights) ? flights : [];

  // Un único criterio de orden (el mismo que elige al ganador): la lista
  // sigue a `optimizeBy` (uiCriterion en App.jsx) en vez de tener su propio
  // control local — antes había dos controles que se pisaban entre sí.
  const bestCode = normalizeCode(bestDestination?.destination);
  const alternatives = useMemo(() => {
    const list = safeFlights.filter((f) => normalizeCode(f.destination) !== bestCode);
    return sortByCriterion(list, optimizeBy);
  }, [safeFlights, bestCode, optimizeBy]);

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

      {/* Compact list */}
      <div className="altl-list">
        {alternatives.map((dest, i) => {
          const code = normalizeCode(dest.destination);
          return (
            <AltRow
              key={code}
              dest={dest}
              rank={i + 2}
              departureDate={departureDate}
              returnDate={returnDate}
              tripType={tripType}
              open={openCode === code}
              onToggle={() => setOpenCode(openCode === code ? null : code)}
            />
          );
        })}
      </div>

      {!alternatives.length && (
        <p className="text-secondary small">{t("alt.noMore")}</p>
      )}
    </div>
  );
}
