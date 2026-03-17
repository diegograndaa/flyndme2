import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import FlightResults from "./components/FlightResults";
import { SearchProgress } from "./components/SearchUX";
import { useI18n } from "./i18n/useI18n";
import {
  AIRPORTS, AIRPORT_MAP, getBaseUrl, normalizeCode, cityOf, destLabel,
  formatEur, formatDate, todayISO, buildSkyscannerUrl, copyText, fairnessColor
} from "./utils/helpers";

// ─── API ──────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "")
  || "https://flyndme-backend.onrender.com";

const API_URL = `${API_BASE}/api/flights/multi-origin`;

// ─── Fairness label (i18n-dependent) ────────────────────────────────────────

function useFairnessLabel(score) {
  const { t } = useI18n();
  if (score >= 85) return { text: t("fairness.veryBalanced"),      color: fairnessColor(score) };
  if (score >= 65) return { text: t("fairness.fairlyBalanced"),    color: fairnessColor(score) };
  if (score >= 45) return { text: t("fairness.somewhatUnequal"),   color: fairnessColor(score) };
  return             { text: t("fairness.unequal"),                 color: fairnessColor(score) };
}

// ─── Language selector ───────────────────────────────────────────────────────

const LangSelector = React.memo(function LangSelector() {
  const { lang, setLang } = useI18n();
  return (
    <div className="btn-group btn-group-sm" role="group" aria-label="Language">
      {[["en", "EN"], ["es", "ES"]].map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={`btn ${lang === code ? "btn-light fw-bold" : "btn-outline-secondary"}`}
          style={{ minWidth: 38, fontSize: 13 }}
          onClick={() => setLang(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
});

// ─── Toast notification ──────────────────────────────────────────────────────

const Toast = React.memo(function Toast({ message, type = "success", onDone }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setExiting(true), 2200);
    const t2 = setTimeout(() => onDone?.(), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div className={`fm-toast fm-toast--${type}${exiting ? " fm-toast--exit" : ""}`}>
      <span className="fm-toast-icon">
        {type === "success" ? "✓" : type === "error" ? "✗" : "ℹ"}
      </span>
      {message}
    </div>
  );
});

// ─── Animated price counter ─────────────────────────────────────────────────

function useCountUp(target, duration = 800, decimals = 0) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const prevTarget = useRef(0);

  useEffect(() => {
    const from = prevTarget.current;
    const to = typeof target === "number" ? target : Number(target || 0);
    prevTarget.current = to;
    if (from === to) { setDisplay(to); return; }

    const start = performance.now();
    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return formatEur(display, decimals);
}

function AnimatedPrice({ value, decimals = 2, className = "" }) {
  const formatted = useCountUp(value, 800, decimals);
  return <div className={`${className} price-animate`}>{formatted}</div>;
}

// ─── Error boundary ───────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e?.message || "Error" }; }
  componentDidCatch(e, i) { console.error("[UI]", e, i); }
  render() {
    if (this.state.err) return (
      <div className="alert alert-danger">
        <strong>{this.props.renderingLabel || "Rendering error."}</strong> {this.state.err}
        <button className="btn btn-sm btn-outline-danger ms-3" onClick={() => this.setState({ err: null })}>
          {this.props.retryLabel || "Retry"}
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Landing ──────────────────────────────────────────────────────────────────

const Landing = React.memo(function Landing({ onStart }) {
  const { t } = useI18n();

  const chips = t("landing.chips");
  const steps = t("landing.steps");
  const faqs  = t("landing.faqs");

  return (
    <>
      {/* Hero */}
      <section className="lp-hero">
        <div className="container" style={{ maxWidth: 1080 }}>
          <div className="row g-5 align-items-center">
            <div className="col-lg-6">
              <span className="lp-eyebrow">{t("landing.eyebrow")}</span>
              <h1 className="lp-h1">{t("landing.title")}</h1>
              <p className="lp-lead">{t("landing.lead")}</p>
              <button className="btn-fm-primary btn-lg-fm" onClick={onStart} type="button">
                {t("landing.cta")}
              </button>
              <div className="lp-chips mt-4">
                {Array.isArray(chips) && chips.map((c) => (
                  <span key={c} className="lp-chip">{c}</span>
                ))}
              </div>
            </div>

            <div className="col-lg-6">
              <div className="lp-card">
                <div className="lp-card-title">{t("landing.howTitle")}</div>
                <ul className="lp-steps">
                  {Array.isArray(steps) && steps.map((s, i) => (
                    <li key={i}><span className="lp-step-num">{i + 1}</span>{s}</li>
                  ))}
                </ul>
                <div className="lp-card-meta">
                  <span>{t("landing.metaSource")}</span>
                  <span>{t("landing.metaTime")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Example preview */}
      <section className="lp-example">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-example-title">{t("landing.exampleTitle")}</h2>
          <p className="lp-example-sub">{t("landing.exampleSub")}</p>
          <div className="lp-example-card">
            <div className="lp-example-origins">
              <span className="lp-example-origin">MAD <span>Madrid</span></span>
              <span className="lp-example-origin">LON <span>London</span></span>
              <span className="lp-example-origin">BER <span>Berlin</span></span>
            </div>
            <div className="lp-example-arrow">→</div>
            <div className="lp-example-result">
              <div className="lp-example-winner">{t("landing.exampleWinner")}</div>
              <div className="lp-example-dest">LIS · Lisbon</div>
              <div className="lp-example-price">€85 {t("landing.exampleTotal")}</div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-faq">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-faq-title">{t("landing.faqTitle")}</h2>
          <div className="row g-3">
            {Array.isArray(faqs) && faqs.map((item, i) => (
              <div key={i} className="col-md-6">
                <div className="lp-faq-card">
                  <div className="lp-faq-q">{item.q}</div>
                  <div className="lp-faq-a">{item.a}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-5">
            <button className="btn-fm-primary btn-lg-fm" onClick={onStart} type="button">
              {t("landing.getStarted")}
            </button>
          </div>
        </div>
      </section>
    </>
  );
});

// ─── Search form ──────────────────────────────────────────────────────────────

const SearchPage = React.memo(function SearchPage({
  origins, setOrigins,
  tripType, setTripType,
  departureDate, setDepartureDate,
  returnDate, setReturnDate,
  optimizeBy, setOptimizeBy,
  budgetEnabled, setBudgetEnabled,
  maxBudget, setMaxBudget,
  loading, error,
  onSubmit,
}) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const safeIdx = activeIdx >= 0 && activeIdx < origins.length ? activeIdx : 0;
  const filterVal = origins[safeIdx]?.trim().toLowerCase() || "";

  const filtered = AIRPORTS.filter((a) => {
    if (!filterVal) return true;
    return (
      a.code.toLowerCase().includes(filterVal) ||
      a.city.toLowerCase().includes(filterVal) ||
      a.country.toLowerCase().includes(filterVal)
    );
  });

  const handleClickAirport = (code) => {
    const copy = [...origins];
    if (!copy[safeIdx]?.trim()) {
      copy[safeIdx] = code;
    } else {
      const empty = copy.findIndex((v) => !v.trim());
      if (empty !== -1) copy[empty] = code;
      else if (!copy.includes(code)) copy.push(code);
    }
    setOrigins(copy);
  };

  const BUDGET_MIN = 30; const BUDGET_MAX = 800; const BUDGET_STEP = 10;

  // Show city name next to code in the origin input
  const originDisplay = (val) => {
    const code = normalizeCode(val);
    const city = cityOf(code);
    return city ? `${code}` : val;
  };

  return (
    <div className="container py-4" style={{ maxWidth: 960 }}>
      <div className="sf-grid">
        {/* ── Left: form ── */}
        <div className="sf-form fm-card">
          <h2 className="sf-title">{t("search.title")}</h2>
          <p className="sf-sub">{t("search.subtitle")}</p>

          <form onSubmit={onSubmit} noValidate>
            {/* Origins */}
            <div className="sf-section">
              <div className="sf-label">{t("search.originLabel")}</div>
              {origins.map((origin, idx) => {
                const code = normalizeCode(origin);
                const city = cityOf(code);
                return (
                  <div key={idx} className="sf-origin-row">
                    <span className="sf-badge" title={t("search.travelerTooltip", { n: idx + 1 })}>
                      <span className="sf-badge-icon">👤</span>{idx + 1}
                    </span>
                    <div className="sf-input-wrap">
                      <input
                        type="text"
                        className="form-control sf-input text-uppercase"
                        placeholder={t("search.placeholder")}
                        value={origin}
                        onChange={(e) => {
                          const copy = [...origins];
                          copy[idx] = e.target.value.toUpperCase();
                          setOrigins(copy);
                        }}
                        onFocus={() => setActiveIdx(idx)}
                        disabled={loading}
                        autoComplete="off"
                      />
                      {city && origin.trim() && (
                        <span className="sf-input-city">{city}</span>
                      )}
                    </div>
                    {origins.length > 1 && (
                      <button
                        type="button"
                        className="sf-remove"
                        onClick={() => {
                          const copy = origins.filter((_, i) => i !== idx);
                          setOrigins(copy.length ? copy : [""]);
                          setActiveIdx(Math.min(safeIdx, copy.length - 1));
                        }}
                        disabled={loading}
                        title={t("search.removeTitle")}
                      >✕</button>
                    )}
                  </div>
                );
              })}
              <div className="sf-origin-actions">
                <button type="button" className="sf-add-btn" onClick={() => { setOrigins([...origins, ""]); setActiveIdx(origins.length); }} disabled={loading || origins.length >= 8}>
                  {t("search.addTraveler")}
                </button>
                {origins.length === 1 && !origins[0].trim() && (
                  <button type="button" className="sf-example-btn" onClick={() => {
                    setOrigins(["MAD", "LON", "BER"]);
                    setActiveIdx(0);
                  }} disabled={loading}>
                    {t("search.tryExample")}
                  </button>
                )}
              </div>
            </div>

            {/* Trip type + Dates combined */}
            <div className="sf-section">
              <div className="sf-label">{t("search.tripTypeLabel")}</div>
              <div className="sf-pills" style={{ marginBottom: 16 }}>
                {[["oneway", t("search.oneway")], ["roundtrip", t("search.roundtrip")]].map(([v, l]) => (
                  <button key={v} type="button"
                    className={`sf-pill ${tripType === v ? "sf-pill--active" : ""}`}
                    onClick={() => setTripType(v)} disabled={loading}>{l}</button>
                ))}
              </div>

              <div className="sf-label">{t("search.datesLabel")}</div>
              <div className="row g-3">
                <div className={tripType === "roundtrip" ? "col-sm-6" : "col-12"}>
                  <label className="sf-input-label">{t("search.departure")}</label>
                  <input type="date" className="form-control sf-input"
                    value={departureDate} min={todayISO()}
                    onChange={(e) => setDepartureDate(e.target.value)} disabled={loading} />
                </div>
                {tripType === "roundtrip" && (
                  <div className="col-sm-6">
                    <label className="sf-input-label">{t("search.return")}</label>
                    <input type="date" className="form-control sf-input"
                      value={returnDate} min={departureDate || todayISO()}
                      onChange={(e) => setReturnDate(e.target.value)} disabled={loading} />
                  </div>
                )}
              </div>
            </div>

            {/* Advanced options toggle */}
            <button
              type="button"
              className="sf-advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? t("search.hideAdvanced") : t("search.showAdvanced")}
              <span className={`sf-advanced-arrow${showAdvanced ? " sf-advanced-arrow--open" : ""}`}>▾</span>
            </button>

            {/* Advanced: Optimize + Budget */}
            {showAdvanced && (
              <div className="sf-advanced-panel">
                {/* Optimize */}
                <div className="sf-section">
                  <div className="sf-label">
                    {t("search.optimizeLabel")}
                    <span className="sf-label-help" title={t("search.optimizeHelp")}>?</span>
                  </div>
                  <div className="sf-pills">
                    {[["total", t("search.optTotal")], ["fairness", t("search.optFairness")]].map(([v, l]) => (
                      <button key={v} type="button"
                        className={`sf-pill ${optimizeBy === v ? "sf-pill--active" : ""}`}
                        onClick={() => setOptimizeBy(v)} disabled={loading}>{l}</button>
                    ))}
                  </div>
                  <div className="sf-hint mt-1">{t("search.optimizeHint")}</div>
                </div>

                {/* Budget */}
                <div className="sf-section">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <div className="sf-label mb-0">{t("search.budgetLabel")}</div>
                      <div className="sf-hint">
                        {budgetEnabled ? t("search.budgetHintOn", { amount: formatEur(maxBudget) }) : t("search.budgetHintOff")}
                      </div>
                    </div>
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" id="budgetSwitch"
                        checked={budgetEnabled} onChange={(e) => setBudgetEnabled(e.target.checked)} disabled={loading} />
                      <label className="form-check-label small" htmlFor="budgetSwitch">
                        {budgetEnabled ? t("search.budgetOn") : t("search.budgetOff")}
                      </label>
                    </div>
                  </div>
                  {budgetEnabled && (
                    <div className="sf-budget-box mt-3">
                      <input type="range" className="form-range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP}
                        value={maxBudget} onChange={(e) => setMaxBudget(Number(e.target.value))} disabled={loading} />
                      <div className="d-flex justify-content-between small" style={{ color: "#64748B" }}>
                        <span>{formatEur(BUDGET_MIN)}</span>
                        <strong>{formatEur(maxBudget)}</strong>
                        <span>{formatEur(BUDGET_MAX)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && <div className="alert alert-danger py-2 mt-3" aria-live="polite">{error}</div>}

            <button type="submit" className="btn-fm-primary w-100 mt-3 py-3 fw-bold fs-6" disabled={loading}>
              {loading ? t("search.searching") : t("search.submit")}
            </button>
            <div className="sf-footnote">
              <span>{t("search.footnoteTime")}</span>
              <span>{t("search.footnotePrices")}</span>
            </div>
          </form>
        </div>

        {/* ── Right: airport picker ── */}
        <aside className="sf-airports fm-card">
          <div className="sf-label">{t("search.airportsTitle")}</div>
          <div className="sf-picker-hint">
            <span className="sf-picker-hint-icon">👆</span>
            {t("search.airportsHint", { n: safeIdx + 1 })}
          </div>
          <div className="sf-airport-list">
            {filtered.map((a) => {
              const isSelected = origins.some((o) => normalizeCode(o) === a.code);
              return (
                <div key={a.code}
                  className={`sf-airport-item${isSelected ? " sf-airport-item--selected" : ""}`}
                  onClick={() => !loading && handleClickAirport(a.code)}
                  role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && handleClickAirport(a.code)}>
                  <span className="sf-airport-code">{a.code}</span>
                  <span className="sf-airport-city">{a.city}</span>
                  <span className="sf-airport-country">{a.country}</span>
                  {isSelected && <span className="sf-airport-check">✓</span>}
                </div>
              );
            })}
            {!filtered.length && <div className="text-center small" style={{ color: "#94A3B8", padding: "16px 0" }}>{t("search.noMatches")}</div>}
          </div>
        </aside>
      </div>
    </div>
  );
});

// ─── Winner card ──────────────────────────────────────────────────────────────

const WinnerCard = React.memo(function WinnerCard({
  dest, origins, tripType, returnDate,
  uiCriterion, onChangeCriterion,
  flightsCount, onShare, shareStatus,
  onViewAlternatives, onChangeSearch,
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (dest) {
      const timer = setTimeout(() => setEntered(true), 50);
      return () => clearTimeout(timer);
    }
  }, [dest]);

  if (!dest) return null;

  const code      = normalizeCode(dest.destination);
  const city      = cityOf(code);
  const imgUrl    = `${getBaseUrl()}destinations/${code}.jpg`;
  const fairness  = useFairnessLabel(dest.fairnessScore ?? 0);
  const dep       = dest.bestDate || "";
  const ret       = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");

  const cleanOrigins = (origins || []).map((o) => String(o).trim().toUpperCase()).filter(Boolean);
  const breakdown    = Array.isArray(dest.flights) ? dest.flights : [];

  return (
    <div className={`wc-card${entered ? " wc-card--entered" : ""}`}>
      {/* Image strip */}
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          <span className="wc-dest-code">{code}</span>
          {city && <span className="wc-dest-city">{city}</span>}
        </div>
      </div>

      {/* Body */}
      <div className="wc-body">
        {/* Header row */}
        <div className="wc-header-row">
          <div>
            <div className="wc-eyebrow">{t("results.eyebrow")}</div>
            <div className="wc-dest-big">{code}{city ? ` · ${city}` : ""}</div>
          </div>

          {/* Criterion toggle */}
          <div className="btn-group btn-group-sm" role="group" aria-label="Criterio">
            {[["total", t("results.criterionPrice")], ["fairness", t("results.criterionFairness")]].map(([v, l]) => (
              <button key={v} type="button"
                className={`btn ${uiCriterion === v ? "btn-light fw-bold" : "btn-outline-light"}`}
                onClick={() => onChangeCriterion(v)}>{l}</button>
            ))}
          </div>
        </div>

        {/* Dates */}
        {dep && (
          <div className="wc-dates">
            {tripType === "roundtrip"
              ? `${formatDate(dep)} → ${formatDate(ret)}`
              : t("results.departureLabel", { date: formatDate(dep) })}
            {" · "}{tripType === "roundtrip" ? t("results.roundtripTag") : t("results.onewayTag")}
          </div>
        )}

        {/* Price block */}
        <div className="wc-price-block">
          <div>
            <div className="wc-price-label">{t("results.groupTotal")}</div>
            <AnimatedPrice value={dest.totalCostEUR} decimals={2} className="wc-price" />
          </div>
          <div className="wc-price-divider" />
          <div>
            <div className="wc-price-label">{t("results.avgPerPerson")}</div>
            <AnimatedPrice value={dest.averageCostPerTraveler} decimals={2} className="wc-price wc-price--secondary" />
          </div>
        </div>

        {/* Per-origin pills */}
        {breakdown.length > 0 && (
          <div className="wc-breakdown">
            <div className="wc-breakdown-label">{t("results.pricePerOrigin")}</div>
            <div className="wc-breakdown-pills">
              {breakdown.map((f, i) => (
                <span key={i} className="wc-pill">
                  <strong>{String(f.origin).toUpperCase()}</strong>
                  <span className="wc-pill-arrow">→</span>
                  <strong>{code}</strong>
                  <span className="wc-pill-price">{typeof f.price === "number" ? formatEur(f.price, 0) : t("results.noData")}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Fairness + spread */}
        <div className="wc-metrics">
          <div className="wc-metric">
            <div className="wc-metric-label">{t("results.fairnessLabel")} <span className="wc-metric-help" title={t("results.fairnessHelp")}>?</span></div>
            <div className="wc-metric-value">{(dest.fairnessScore ?? 0).toFixed(0)}<span className="wc-metric-unit">{t("results.fairnessUnit")}</span></div>
            <div className="wc-fairness-bar">
              <div className="wc-fairness-fill" style={{ width: `${Math.min(100, dest.fairnessScore ?? 0)}%` }} />
            </div>
            <div className="wc-fairness-tag" style={{ color: fairness.color }}>{fairness.text}</div>
          </div>
          <div className="wc-metric">
            <div className="wc-metric-label">{t("results.maxSpread")}</div>
            <div className="wc-metric-value">{formatEur(dest.priceSpread ?? 0, 2)}</div>
            <div className="wc-metric-sub">{t("results.spreadSub")}</div>
          </div>
          <div className="wc-metric">
            <div className="wc-metric-label">{t("results.destsAnalyzed")}</div>
            <div className="wc-metric-value">{flightsCount}</div>
            <div className="wc-metric-sub">{t("results.destsAnalyzedSub")}</div>
          </div>
        </div>

        {/* Skyscanner links */}
        {cleanOrigins.length > 0 && dep && (
          <div className="wc-book">
            <div className="wc-book-label">{t("results.bookLabel")}</div>
            <div className="wc-book-links">
              {cleanOrigins.map((origin) => {
                const url = buildSkyscannerUrl({ origin, destination: code, departureDate: dep, returnDate: ret, tripType });
                return url ? (
                  <a key={origin} href={url} target="_blank" rel="noreferrer" className="btn-fm-primary btn-sm-fm">
                    {origin} → {code}
                  </a>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Secondary actions */}
        <div className="wc-actions">
          <button type="button" className="btn btn-outline-light btn-sm" onClick={onViewAlternatives}>
            {t("results.viewAlternatives")}
          </button>
          <button type="button" className="btn btn-outline-light btn-sm" onClick={onShare}>
            {shareStatus === "ok" ? t("results.copied") : shareStatus === "fail" ? t("results.copyFailed") : t("results.share")}
          </button>
          <button type="button" className="btn btn-link text-white text-decoration-none btn-sm" onClick={onChangeSearch}>
            {t("results.changeSearch")}
          </button>
        </div>

        <div className="wc-disclaimer">{t("results.disclaimer")}</div>
      </div>
    </div>
  );
});

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { t } = useI18n();

  // View: 'landing' | 'search' | 'results'
  const [view, setView] = useState("landing");

  // Search params
  const [origins,       setOrigins]       = useState([""]);
  const [tripType,      setTripType]      = useState("oneway");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate,    setReturnDate]    = useState("");
  const [optimizeBy,    setOptimizeBy]    = useState("total");
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [maxBudget,     setMaxBudget]     = useState(200);

  // Results
  const [flights,         setFlights]         = useState([]);
  const [bestByCriterion, setBestByCriterion] = useState({ total: null, fairness: null });
  const [uiCriterion,     setUiCriterion]     = useState("total");
  const [showAlt,         setShowAlt]         = useState(false);

  // UI state
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [toast,       setToast]       = useState(null); // { message, type }

  // Keep Render backend alive (free tier sleeps)
  useEffect(() => {
    const ping = () => fetch(`${API_BASE}/api/ping`, { cache: "no-store" }).catch(() => {});
    ping();
    const quick1 = setTimeout(ping, 3000);
    const quick2 = setTimeout(ping, 8000);
    const t = setInterval(ping, 8 * 60 * 1000);
    return () => { clearTimeout(quick1); clearTimeout(quick2); clearInterval(t); };
  }, []);

  const bestDestination = bestByCriterion[uiCriterion] || bestByCriterion.total || null;

  const cleanOrigins = useMemo(
    () => [...new Set(origins.map((o) => String(o || "").trim().toUpperCase()).filter(Boolean))],
    [origins]
  );

  // ── Compute best for each criterion ────────────────────────────────────────

  function pickBest(arr, mode) {
    if (!arr?.length) return null;
    return arr.reduce((best, cur) => {
      if (mode === "fairness") {
        if (cur.fairnessScore > best.fairnessScore) return cur;
        if (cur.fairnessScore === best.fairnessScore && cur.totalCostEUR < best.totalCostEUR) return cur;
        return best;
      }
      return cur.totalCostEUR < best.totalCostEUR ? cur : best;
    });
  }

  // ── Handle criterion toggle ─────────────────────────────────────────────────

  const handleCriterion = (mode) => {
    setUiCriterion(mode);
    setShowAlt(false);
  };

  // ── Share ───────────────────────────────────────────────────────────────────

  const handleShare = async () => {
    if (!bestDestination) return;
    const bd = bestDestination;
    const code = normalizeCode(bd.destination);
    const lines = [
      t("share.title", { dest: destLabel(code) }),
      t("share.totalAvg", { total: formatEur(bd.totalCostEUR, 2), avg: formatEur(bd.averageCostPerTraveler, 2) }),
      t("share.fairness", { score: (bd.fairnessScore ?? 0).toFixed(0) }),
      t("share.date", { date: `${bd.bestDate || departureDate}${tripType === "roundtrip" ? ` → ${bd.bestReturnDate || returnDate}` : ""}` }),
    ];
    if (Array.isArray(bd.flights) && bd.flights.length) {
      lines.push(t("share.perOrigin", { details: bd.flights.map((f) => `${f.origin}: ${formatEur(f.price, 0)}`).join(" · ") }));
    }
    const ok = await copyText(lines.join("\n"));
    setShareStatus(ok ? "ok" : "fail");
    setToast({ message: ok ? t("results.copied") : t("results.copyFailed"), type: ok ? "success" : "error" });
    setTimeout(() => setShareStatus(""), 2500);
  };

  // ── Ensure backend is awake before searching ─────────────────────────────────

  async function ensureBackendAwake() {
    const PING_URL = `${API_BASE}/api/ping`;
    const MAX_WAKE = 15;           // up to 15 attempts = ~60 s
    const WAKE_DELAY = 4000;

    for (let i = 0; i < MAX_WAKE; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(PING_URL, { cache: "no-store", signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) return true;    // backend is alive
      } catch { /* network error or timeout — keep trying */ }
      await new Promise((r) => setTimeout(r, WAKE_DELAY));
    }
    return false;                    // gave up
  }

  // ── Submit (with automatic retry for Render cold-starts) ────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!cleanOrigins.length) { setError(t("errors.noOrigin")); return; }
    if (!departureDate)        { setError(t("errors.noDeparture")); return; }
    if (tripType === "roundtrip") {
      if (!returnDate)               { setError(t("errors.noReturn")); return; }
      if (returnDate <= departureDate) { setError(t("errors.returnBeforeDep")); return; }
    }

    setFlights([]);
    setBestByCriterion({ total: null, fairness: null });
    setShowAlt(false);
    setLoading(true);

    try {
      // Step 1: wake backend if needed (ping is lightweight)
      const awake = await ensureBackendAwake();
      if (!awake) {
        setError(t("errors.serverWaking"));
        return;
      }

      // Step 2: actual search (backend is now warm)
      const body = {
        origins: cleanOrigins,
        departureDate,
        tripType,
        optimizeBy,
        dateMode: "exact",
        flexDays: 0,
        ...(tripType === "roundtrip" && { returnDate }),
        ...(budgetEnabled && { maxBudgetPerTraveler: maxBudget }),
      };

      const MAX_RETRIES = 3;
      const RETRY_DELAY = 3000;
      let lastErr = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45000);

          const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (res.status === 503 && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
            continue;
          }

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || data.error || `Error ${res.status}`);
          }

          const data = await res.json();
          const arr  = Array.isArray(data.flights) ? data.flights : [];

          if (!arr.length) {
            setError(budgetEnabled ? t("errors.noBudgetResults") : t("errors.noResults"));
            return;
          }

          setFlights(arr);
          setBestByCriterion({ total: pickBest(arr, "total"), fairness: pickBest(arr, "fairness") });
          setUiCriterion(optimizeBy);
          setView("results");
          document.title = "FlyndMe - Flight Results";
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        } catch (err) {
          lastErr = err;
          const isTransient = err instanceof TypeError || err.name === "AbortError";
          if (isTransient && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
            continue;
          }
          if (!isTransient) break;
        }
      }

      setError(lastErr?.message || t("errors.unexpected"));
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="container d-flex align-items-center justify-content-between" style={{ maxWidth: 1080 }}>
          <div className="app-logo" onClick={() => { setView("landing"); setFlights([]); setBestByCriterion({ total: null, fairness: null }); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setView("landing")}>
            <img src={`${getBaseUrl()}logo-flyndme.svg`} alt="FlyndMe" height={28}
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <span className="app-logo-name">FlyndMe</span>
            <span className="app-logo-sub">{t("header.tagline")}</span>
          </div>
          <div className="d-flex align-items-center gap-2">
            <LangSelector />
            {view !== "landing" && (
              <button type="button" className="btn btn-sm btn-outline-secondary"
                onClick={() => { setView("search"); setShowAlt(false); }}>
                {view === "results" ? t("header.newSearch") : t("header.home")}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Loading bar */}
      <SearchProgress loading={loading} />

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}

      {/* Views */}
      {view === "landing" && (
        <div className="view-enter" key="landing">
          <Landing onStart={() => setView("search")} />
        </div>
      )}

      {view === "search" && (
        <div className="view-enter view-enter-search" key="search">
        <SearchPage
          origins={origins}           setOrigins={setOrigins}
          tripType={tripType}         setTripType={setTripType}
          departureDate={departureDate} setDepartureDate={setDepartureDate}
          returnDate={returnDate}     setReturnDate={setReturnDate}
          optimizeBy={optimizeBy}     setOptimizeBy={setOptimizeBy}
          budgetEnabled={budgetEnabled} setBudgetEnabled={setBudgetEnabled}
          maxBudget={maxBudget}       setMaxBudget={setMaxBudget}
          loading={loading}           error={error}
          onSubmit={handleSubmit}
        />
        </div>
      )}

      {view === "results" && bestDestination && (
        <main className="container py-4 view-enter" key="results" style={{ maxWidth: 1080 }}>
          <WinnerCard
            dest={bestDestination}
            origins={cleanOrigins}
            tripType={tripType}
            returnDate={returnDate}
            uiCriterion={uiCriterion}
            onChangeCriterion={handleCriterion}
            flightsCount={flights.length}
            onShare={handleShare}
            shareStatus={shareStatus}
            onViewAlternatives={() => setShowAlt((v) => !v)}
            onChangeSearch={() => setView("search")}
          />

          {showAlt && flights.length > 1 && (
            <div className="mt-4">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h3 className="h5 fw-bold mb-0" style={{ color: "#111827" }}>{t("results.otherOptions")}</h3>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowAlt(false)}>{t("results.hide")}</button>
              </div>
              <ErrorBoundary renderingLabel={t("errors.rendering")} retryLabel={t("errors.retry")}>
                <FlightResults
                  flights={flights}
                  optimizeBy={uiCriterion}
                  bestDestination={bestDestination}
                  origins={cleanOrigins}
                  departureDate={departureDate}
                  returnDate={returnDate}
                  tripType={tripType}
                  budgetEnabled={budgetEnabled}
                  maxBudgetPerTraveler={maxBudget}
                />
              </ErrorBoundary>
            </div>
          )}
        </main>
      )}

      <footer className="app-footer">
        <div className="container" style={{ maxWidth: 1080 }}>
          {t("footer")}
        </div>
      </footer>
    </div>
  );
}
