import { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";

// ─── Utilities ────────────────────────────────────────────────────────────────

function getBaseUrl() { return import.meta.env.BASE_URL || "/"; }

function normalizeCode(v) {
  const raw = String(v || "").trim().toUpperCase();
  const m   = raw.match(/\b[A-Z]{3}\b/);
  return m ? m[0] : raw.slice(0, 3);
}

function formatEur(n, dec = 0) {
  const v = typeof n === "number" ? n : Number(n || 0);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency", currency: "EUR",
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(v);
  } catch { return `€${v.toFixed(dec)}`; }
}

function fairnessColor(s) {
  if (s >= 85) return "#16A34A";
  if (s >= 65) return "#3B82F6";
  if (s >= 45) return "#D97706";
  return "#DC2626";
}

function buildSkyscannerUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = String(origin || "").toLowerCase();
  const to   = String(destination || "").toLowerCase();
  const dep  = String(departureDate || "").replace(/-/g, "");
  const ret  = tripType === "roundtrip" ? String(returnDate || "").replace(/-/g, "") : "";
  if (!from || !to || !dep) return "";
  const base   = "https://www.skyscanner.es/transport/flights";
  const path   = ret ? `${base}/${from}/${to}/${dep}/${ret}/` : `${base}/${from}/${to}/${dep}/`;
  const params = new URLSearchParams({ adultsv2: "1", cabinclass: "economy", rtn: ret ? "1" : "0" });
  return `${path}?${params}`;
}

const AIRPORT_MAP = {
  MAD: "Madrid",   BCN: "Barcelona", LON: "London",    PAR: "Paris",
  ROM: "Rome",     MIL: "Milan",     BER: "Berlin",    AMS: "Amsterdam",
  LIS: "Lisbon",   DUB: "Dublin",    VIE: "Vienna",
};

// ─── Alternative card ─────────────────────────────────────────────────────────

function AltCard({ dest, rank, origins, departureDate, returnDate, tripType, bestDest }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const code     = normalizeCode(dest.destination);
  const city     = AIRPORT_MAP[code] || "";
  const imgUrl   = `${getBaseUrl()}destinations/${code}.jpg`;
  const isBest   = normalizeCode(bestDest?.destination) === code;
  const flights  = Array.isArray(dest.flights) ? dest.flights : [];
  const dep      = dest.bestDate || departureDate || "";
  const ret      = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");
  const fairness = dest.fairnessScore ?? 0;
  const fColor   = fairnessColor(fairness);

  return (
    <div className={`alt-card${isBest ? " alt-card--best" : ""}`}>
      {/* Image */}
      <div className="alt-card-img-wrap">
        <img src={imgUrl} alt={city || code} className="alt-card-img"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="alt-card-img-overlay" />
        <div className="alt-card-img-label">
          <span className="alt-card-code">{code}</span>
          {city && <span className="alt-card-city">{city}</span>}
        </div>
        {isBest && <div className="alt-card-badge">{t("alt.recommended")}</div>}
      </div>

      {/* Content */}
      <div className="alt-card-body">
        <div className="alt-card-rank">#{rank}</div>

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

        {/* Skyscanner buttons */}
        {dep && origins.length > 0 && (
          <div className="alt-card-links">
            {origins.map((origin) => {
              const url = buildSkyscannerUrl({ origin, destination: code, departureDate: dep, returnDate: ret, tripType });
              return url ? (
                <a key={origin} href={url} target="_blank" rel="noreferrer" className="alt-card-link">
                  {origin} → {code}
                </a>
              ) : null;
            })}
          </div>
        )}

        {/* Expand per-origin prices */}
        {flights.length > 0 && (
          <>
            <button type="button" className="alt-card-toggle" onClick={() => setOpen((v) => !v)}>
              {open ? t("alt.hideBreakdown") : t("alt.viewBreakdown")}
            </button>
            {open && (
              <ul className="alt-card-detail">
                {flights.map((f, i) => (
                  <li key={i} className="alt-card-detail-row">
                    <span className="alt-card-detail-origin">{String(f.origin || "").toUpperCase()} → {code}</span>
                    <span className="alt-card-detail-price">
                      {typeof f.price === "number" ? formatEur(f.price, 2) : t("alt.noData")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

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
      <div className="alt-empty-title">{t("alt.noAlternatives")}</div>
      {budgetEnabled && (
        <div className="alt-empty-sub">
          {t("alt.budgetActive", { amount: formatEur(Number(maxBudgetPerTraveler ?? 0), 0) })}
        </div>
      )}
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
