import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import FlightResults from "./components/FlightResults";
import { SearchProgress } from "./components/SearchUX";
import { useI18n } from "./i18n/useI18n";

// ─── API ──────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "")
  || "https://flyndme-backend.onrender.com";

const API_URL = `${API_BASE}/api/flights/multi-origin`;

// ─── Airport data ─────────────────────────────────────────────────────────────

const AIRPORTS = [
  { code: "MAD", city: "Madrid",     country: "Spain" },
  { code: "BCN", city: "Barcelona",  country: "Spain" },
  { code: "LON", city: "London",     country: "United Kingdom" },
  { code: "PAR", city: "Paris",      country: "France" },
  { code: "ROM", city: "Rome",       country: "Italy" },
  { code: "MIL", city: "Milan",      country: "Italy" },
  { code: "BER", city: "Berlin",     country: "Germany" },
  { code: "AMS", city: "Amsterdam",  country: "Netherlands" },
  { code: "LIS", city: "Lisbon",     country: "Portugal" },
  { code: "DUB", city: "Dublin",     country: "Ireland" },
  { code: "VIE", city: "Vienna",     country: "Austria" },
];

const AIRPORT_MAP = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

// ─── Utilities ────────────────────────────────────────────────────────────────

function getBaseUrl() { return import.meta.env.BASE_URL || "/"; }

function normalizeCode(v) {
  const raw = String(v || "").trim().toUpperCase();
  const m   = raw.match(/\b[A-Z]{3}\b/);
  return m ? m[0] : raw.slice(0, 3);
}

function cityOf(code) {
  return AIRPORT_MAP[normalizeCode(code)]?.city || "";
}

function destLabel(code) {
  const c = cityOf(code);
  return c ? `${normalizeCode(code)} · ${c}` : normalizeCode(code);
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

function formatDate(s) {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d)) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO() { return new Date().toISOString().split("T")[0]; }

function buildSkyscannerUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = String(origin || "").toLowerCase();
  const to   = String(destination || "").toLowerCase();
  const dep  = String(departureDate || "").replace(/-/g, "");
  const ret  = tripType === "roundtrip" ? String(returnDate || "").replace(/-/g, "") : "";
  if (!from || !to || !dep) return "";
  const base = "https://www.skyscanner.es/transport/flights";
  const path = ret ? `${base}/${from}/${to}/${dep}/${ret}/` : `${base}/${from}/${to}/${dep}/`;
  const params = new URLSearchParams({ adultsv2: "1", cabinclass: "economy", rtn: ret ? "1" : "0" });
  return `${path}?${params}`;
}

function useFairnessLabel(score) {
  const { t } = useI18n();
  if (score >= 85) return { text: t("fairness.veryBalanced"),      color: "#16A34A" };
  if (score >= 65) return { text: t("fairness.fairlyBalanced"),    color: "#0062E3" };
  if (score >= 45) return { text: t("fairness.somewhatUnequal"),   color: "#D97706" };
  return             { text: t("fairness.unequal"),                 color: "#DC2626" };
}

async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta); return ok;
  } catch { return false; }
}

// ─── Language selector ───────────────────────────────────────────────────────

function LangSelector() {
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
}

// ─── Toast notification ──────────────────────────────────────────────────────

function Toast({ message, type = "success", onDone }) {
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
}

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

function Landing({ onStart }) {
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
}

// ─── Search form ──────────────────────────────────────────────────────────────

function SearchPage({
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
              {origins.map((origin, idx) => (
                <div key={idx} className="sf-origin-row">
                  <span className="sf-badge">{t("search.travelerBadge", { n: idx + 1 })}</span>
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
              ))}
              <button type="button" className="sf-add-btn" onClick={() => { setOrigins([...origins, ""]); setActiveIdx(origins.length); }} disabled={loading || origins.length >= 8}>
                {t("search.addTraveler")}
              </button>
            </div>

            {/* Trip type */}
            <div className="sf-section">
              <div className="sf-label">{t("search.tripTypeLabel")}</div>
              <div className="sf-pills">
                {[["oneway", t("search.oneway")], ["roundtrip", t("search.roundtrip")]].map(([v, l]) => (
                  <button key={v} type="button"
                    className={`sf-pill ${tripType === v ? "sf-pill--active" : ""}`}
                    onClick={() => setTripType(v)} disabled={loading}>{l}</button>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div className="sf-section">
              <div className="sf-label">{t("search.datesLabel")}</div>
              <div className="row g-3">
                <div className="col-sm-6">
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

            {/* Optimize */}
            <div className="sf-section">
              <div className="sf-label">{t("search.optimizeLabel")}</div>
              <div className="sf-pills">
                {[["total", t("search.optTotal")], ["fairness", t("search.optFairness")]].map(([v, l]) => (
                  <button key={v} type="button"
                    className={`sf-pill ${optimizeBy === v ? "sf-pill--active" : ""}`}
                    onClick={() => setOptimizeBy(v)} disabled={loading}>{l}</button>
                ))}
              </div>
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

            {error && <div className="alert alert-danger py-2 mt-3">{error}</div>}

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
          <div className="sf-hint">{t("search.airportsHint", { n: safeIdx + 1 })}</div>
          <div className="sf-airport-list">
            {filtered.map((a) => (
              <div key={a.code} className="sf-airport-item"
                onClick={() => !loading && handleClickAirport(a.code)}
                role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleClickAirport(a.code)}>
                <span className="sf-airport-code">{a.code}</span>
                <span className="sf-airport-city">{a.city}</span>
                <span className="sf-airport-country">{a.country}</span>
              </div>
            ))}
            {!filtered.length && <div className="text-center small" style={{ color: "#94A3B8", padding: "16px 0" }}>{t("search.noMatches")}</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Winner card ──────────────────────────────────────────────────────────────

function WinnerCard({
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
            <div className="wc-metric-label">{t("results.fairnessLabel")}</div>
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
}

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
    const RETRY_DELAY = 5000;

    try {
      let lastErr = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (res.status === 503 && attempt < MAX_RETRIES) {
            lastErr = new Error("Server is waking up…");
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
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        } catch (err) {
          lastErr = err;
          if (err.message && !err.message.includes("waking up") && attempt < MAX_RETRIES) {
            if (err instanceof TypeError) {
              await new Promise((r) => setTimeout(r, RETRY_DELAY));
              continue;
            }
          }
          if (attempt >= MAX_RETRIES) break;
          if (!(err instanceof TypeError) && !err.message?.includes("waking up")) break;
          await new Promise((r) => setTimeout(r, RETRY_DELAY));
        }
      }

      if (lastErr?.message?.includes("waking up") || lastErr instanceof TypeError) {
        setError(t("errors.serverWaking"));
      } else {
        setError(lastErr?.message || t("errors.unexpected"));
      }
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
