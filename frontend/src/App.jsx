import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense, startTransition } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import FlightResults from "./components/FlightResults";
import { SearchProgress } from "./components/SearchUX";

// Lazy-load heavy visual components (map SVG + chart) for smaller initial bundle
const DestinationMap = React.lazy(() => import("./components/DestinationMap"));
const CompareChart  = React.lazy(() => import("./components/CompareChart"));
import { useI18n } from "./i18n/useI18n";
import {
  AIRPORTS, AIRPORT_MAP, getBaseUrl, normalizeCode, cityOf, destLabel,
  formatEur, formatDate, todayISO, buildSkyscannerUrl, buildGoogleFlightsUrl, copyText, fairnessColor,
  airportName, MULTI_AIRPORT, countryFlag
} from "./utils/helpers";
import { getCityImage } from "./utils/cityImages";

// ─── API ──────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "")
  || "https://flyndme-backend.onrender.com";

const API_URL = `${API_BASE}/api/flights/multi-origin`;

// ─── Currency conversion (approximate static rates) ─────────────────────────
const FX_RATES = { EUR: 1, GBP: 0.86, USD: 1.09 };
const FX_SYMBOLS = { EUR: "€", GBP: "£", USD: "$" };
function convertPrice(eur, currency) {
  const val = eur * (FX_RATES[currency] || 1);
  return `${FX_SYMBOLS[currency] || "€"}${val.toFixed(0)}`;
}

// ─── Fairness label (i18n-dependent) ────────────────────────────────────────

function useFairnessLabel(score) {
  const { t } = useI18n();
  if (score >= 85) return { text: t("fairness.veryBalanced"),      color: fairnessColor(score) };
  if (score >= 65) return { text: t("fairness.fairlyBalanced"),    color: fairnessColor(score) };
  if (score >= 45) return { text: t("fairness.somewhatUnequal"),   color: fairnessColor(score) };
  return             { text: t("fairness.unequal"),                 color: fairnessColor(score) };
}

// ─── Theme (dark mode) ──────────────────────────────────────────────────────

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem("flyndme_theme") || "system"; } catch { return "system"; }
  });

  const resolved = useMemo(() => {
    if (theme === "system") {
      return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  // Listen for system preference changes
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    try { localStorage.setItem("flyndme_theme", t); } catch { /* */ }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  return { theme, resolved, setTheme, toggle };
}

const ThemeToggle = React.memo(function ThemeToggle({ resolved, toggle }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={resolved === "dark" ? t("theme.light") : t("theme.dark")}
      title={resolved === "dark" ? t("theme.light") : t("theme.dark")}
    >
      {resolved === "dark" ? "☀️" : "🌙"}
    </button>
  );
});

// ─── Scroll to top button ──────────────────────────────────────────────────

const ScrollToTopBtn = React.memo(function ScrollToTopBtn() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className={`scroll-top-btn${visible ? " visible" : ""}`}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label={t("a11y.scrollToTop")}
      title={t("a11y.scrollToTop")}
    >
      ↑
    </button>
  );
});

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

// ─── Favorites (localStorage) ───────────────────────────────────────────────

function useFavorites() {
  const KEY = "flyndme_favorites";
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  });

  const toggle = useCallback((dest) => {
    setFavs((prev) => {
      const code = normalizeCode(dest.destination);
      const exists = prev.find((f) => f.code === code);
      const updated = exists
        ? prev.filter((f) => f.code !== code)
        : [{ code, city: cityOf(code) || code, price: dest.averageCostPerTraveler, ts: Date.now() }, ...prev].slice(0, 20);
      try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch { /* */ }
      return updated;
    });
  }, []);

  const isFav = useCallback((destCode) => {
    return favs.some((f) => f.code === normalizeCode(destCode));
  }, [favs]);

  return { favs, toggle, isFav };
}

// ─── CSV export ─────────────────────────────────────────────────────────────

function exportResultsCSV(flights, origins, currency) {
  const rows = [["Destination", "City", "Total (EUR)", "Avg/person (EUR)", "Fairness", ...origins.map((o) => `${o} price`)]];
  flights.forEach((f) => {
    const code = normalizeCode(f.destination);
    const priceMap = {};
    (f.flights || []).forEach((fl) => { priceMap[String(fl.origin).toUpperCase()] = fl.price; });
    rows.push([
      code,
      cityOf(code) || "",
      f.totalCostEUR?.toFixed(2) || "",
      f.averageCostPerTraveler?.toFixed(2) || "",
      f.fairnessScore ?? "",
      ...origins.map((o) => priceMap[o]?.toFixed(2) || ""),
    ]);
  });
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flyndme-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Friendly error display ─────────────────────────────────────────────────

const FriendlyError = React.memo(function FriendlyError({ message, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="fm-error-state">
      <div className="fm-error-icon">😕</div>
      <h3 className="fm-error-title">{t("errors.friendlyTitle")}</h3>
      <p className="fm-error-message">{message}</p>
      {onRetry && (
        <button type="button" className="btn-fm-primary" onClick={onRetry}>
          {t("errors.tryAgain")}
        </button>
      )}
    </div>
  );
});

// ─── Loading tips carousel ──────────────────────────────────────────────────

const LoadingTips = React.memo(function LoadingTips() {
  const { t } = useI18n();
  const tips = t("loading.tips") || [];
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * Math.max(tips.length, 1)));
  const [fade, setFade] = useState(true);

  useEffect(() => {
    if (tips.length <= 1) return;
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % tips.length);
        setFade(true);
      }, 300);
    }, 5000);
    return () => clearInterval(interval);
  }, [tips.length]);

  if (!tips.length) return null;

  return (
    <div className={`loading-tip${fade ? " loading-tip--visible" : ""}`}>
      <span className="loading-tip-icon">💡</span>
      <span className="loading-tip-text">{tips[idx % tips.length]}</span>
    </div>
  );
});

// ─── Search skeleton (loading state) ────────────────────────────────────────

const SearchSkeleton = React.memo(function SearchSkeleton({ origins = [] }) {
  const { t } = useI18n();
  const steps = t("loading.steps") || ["Searching", "Comparing", "Preparing"];
  const [activeStep, setActiveStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setActiveStep(1), 6000),
      setTimeout(() => setActiveStep(2), 14000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const numCombinations = Math.max(origins.length, 1) * 36;
  const estimatedTotal = Math.max(15, Math.ceil(numCombinations / 5));
  const progressPct = Math.min(95, (elapsed / estimatedTotal) * 100);

  return (
    <div className="container py-4" style={{ maxWidth: 1080 }}>
      {/* Progress stepper */}
      <div className="sk-stepper">
        {steps.map((label, i) => (
          <div key={i} className={`sk-step${i <= activeStep ? " sk-step--active" : ""}${i < activeStep ? " sk-step--done" : ""}`}>
            <div className="sk-step-dot">
              {i < activeStep ? "✓" : i + 1}
            </div>
            <span className="sk-step-label">{label}</span>
            {i < steps.length - 1 && <div className="sk-step-line" />}
          </div>
        ))}
      </div>

      {/* Timer + progress bar */}
      <div className="sk-timer-wrap">
        <div className="sk-timer-bar">
          <div className="sk-timer-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="sk-timer-text">
          <span>{t("loading.skeletonHint", { n: numCombinations })}</span>
          <span className="sk-timer-clock">{elapsed}s</span>
        </div>
      </div>

      {/* Travel tips carousel */}
      <LoadingTips />

      {/* Skeleton winner card */}
      <div className="sk-card">
        <div className="sk-card-img fm-skeleton" />
        <div className="sk-card-body">
          <div className="fm-skeleton" style={{ width: "40%", height: 24, borderRadius: 8, marginBottom: 12 }} />
          <div className="fm-skeleton" style={{ width: "65%", height: 16, borderRadius: 6, marginBottom: 20 }} />
          <div style={{ display: "flex", gap: 16 }}>
            <div className="fm-skeleton" style={{ flex: 1, height: 60, borderRadius: 10 }} />
            <div className="fm-skeleton" style={{ flex: 1, height: 60, borderRadius: 10 }} />
            <div className="fm-skeleton" style={{ flex: 1, height: 60, borderRadius: 10 }} />
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            {origins.filter(Boolean).map((o, i) => (
              <div key={i} className="fm-skeleton" style={{ width: 100, height: 40, borderRadius: 8 }} />
            ))}
          </div>
        </div>
      </div>

      {/* Skeleton alternative cards */}
      <div className="sk-alts">
        {[1, 2, 3].map((i) => (
          <div key={i} className="sk-alt">
            <div className="fm-skeleton" style={{ width: "100%", height: 100, borderRadius: "10px 10px 0 0" }} />
            <div style={{ padding: 14 }}>
              <div className="fm-skeleton" style={{ width: "50%", height: 16, borderRadius: 6, marginBottom: 8 }} />
              <div className="fm-skeleton" style={{ width: "70%", height: 14, borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
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

function AnimatedStat({ value }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const to = typeof value === "number" ? value : 0;
    const start = performance.now();
    const duration = 600;
    const animate = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(eased * to));
      if (p < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);
  return <strong>{display}</strong>;
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

// ─── Date validation warnings (real-time) ───────────────────────────────────

function useDateWarnings(departureDate, returnDate, tripType) {
  const { t } = useI18n();
  return useMemo(() => {
    const warnings = [];
    if (!departureDate) return warnings;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dep = new Date(departureDate + "T00:00:00");

    if (dep < today) {
      warnings.push({ key: "past", text: t("search.dateWarnPast"), type: "error" });
    } else {
      const diffDays = Math.round((dep - today) / 86400000);
      if (diffDays <= 3) {
        warnings.push({ key: "soon", text: t("search.dateWarnSoon"), type: "warn" });
      }
      if (diffDays > 330) {
        warnings.push({ key: "far", text: t("search.dateWarnFar"), type: "warn" });
      }
      if (diffDays >= 42 && diffDays <= 56) {
        warnings.push({ key: "sweet", text: t("search.dateWarnSweet"), type: "tip" });
      }
    }

    if (tripType === "roundtrip" && returnDate && departureDate) {
      const ret = new Date(returnDate + "T00:00:00");
      const tripLen = Math.round((ret - dep) / 86400000);
      if (tripLen > 30) {
        warnings.push({ key: "long", text: t("search.dateWarnLong"), type: "warn" });
      }
    }

    return warnings;
  }, [departureDate, returnDate, tripType, t]);
}

// ─── Season/weather hint for destination ─────────────────────────────────────

const SEASON_DATA = {
  // month → season label key (0=Jan)
  // lat-based: "north" for European cities
  getSeasonKey(month) {
    if (month >= 5 && month <= 8) return "summer";
    if (month >= 11 || month <= 1) return "winter";
    if (month >= 2 && month <= 4) return "spring";
    return "autumn";
  },
  // avg temp ranges by destination for summer/winter
  tempHints: {
    AGP: [32, 12], PMI: [31, 10], TFS: [28, 19], BCN: [30, 9],
    ROM: [31, 7], ATH: [34, 8], LIS: [28, 10], MLA: [33, 11],
    LON: [23, 5], PAR: [25, 4], BER: [25, 0], AMS: [22, 3],
    DUB: [20, 5], PRG: [26, -1], VIE: [27, 0], BUD: [28, -1],
    WAW: [25, -2], CPH: [22, 1], OSL: [22, -4], HEL: [22, -6],
    STO: [22, -3], MIL: [30, 2], NAP: [30, 7], OPO: [25, 9],
    RAK: [38, 12], IST: [29, 5],
  }
};

function getWeatherHint(destCode, departureDate, t) {
  if (!departureDate || !destCode) return null;
  const month = new Date(departureDate + "T00:00:00").getMonth();
  const seasonKey = SEASON_DATA.getSeasonKey(month);
  const temps = SEASON_DATA.tempHints[destCode];
  const seasonIcons = { summer: "☀️", winter: "❄️", spring: "🌸", autumn: "🍂" };
  const icon = seasonIcons[seasonKey] || "🌤️";

  let tempStr = "";
  if (temps) {
    // Interpolate between summer [0] and winter [1]
    const summerWeight = seasonKey === "summer" ? 1 : seasonKey === "winter" ? 0 : 0.5;
    const approxTemp = Math.round(temps[1] + (temps[0] - temps[1]) * summerWeight);
    tempStr = ` · ~${approxTemp}°C`;
  }

  return `${icon} ${t("alt.season." + seasonKey)}${tempStr}`;
}

// ─── FAQ accordion item ─────────────────────────────────────────────────────

const FaqItem = React.memo(function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lp-faq-item${open ? " lp-faq-item--open" : ""}`}>
      <button type="button" className="lp-faq-q" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{q}</span>
        <span className="lp-faq-chevron">{open ? "−" : "+"}</span>
      </button>
      <div className="lp-faq-a-wrap">
        <div className="lp-faq-a">{a}</div>
      </div>
    </div>
  );
});

// ─── Landing ──────────────────────────────────────────────────────────────────

const Landing = React.memo(function Landing({ onStart }) {
  const { t } = useI18n();

  const chips = t("landing.chips");
  const steps = t("landing.steps");
  const faqs  = t("landing.faqs");

  // Social proof: pseudo-random daily counter (deterministic per day)
  const [socialCount] = useState(() => {
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    return 120 + (seed % 180); // 120-299 range, varies daily
  });

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
              <div className="lp-social-proof mt-3">
                <span className="lp-social-dot" />
                <span className="lp-social-text">{t("social.counter", { n: socialCount })}</span>
              </div>
              <div className="lp-chips mt-3">
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

      {/* Use cases (SEO) */}
      <section className="lp-usecases">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-usecases-title">{t("landing.useCasesTitle")}</h2>
          <div className="lp-usecases-grid">
            {Array.isArray(t("landing.useCases")) && t("landing.useCases").map((uc, i) => (
              <div key={i} className="lp-usecase-card">
                <span className="lp-usecase-icon">{uc.icon}</span>
                <h3 className="lp-usecase-name">{uc.title}</h3>
                <p className="lp-usecase-desc">{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular routes */}
      <section className="lp-routes">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-routes-title">{t("landing.routesTitle")}</h2>
          <p className="lp-routes-sub">{t("landing.routesSub")}</p>
          <div className="lp-routes-grid">
            {(t("landing.routes") || []).map((route, i) => (
              <button key={i} type="button" className="lp-route-card" onClick={() => {
                onStart();
              }}>
                <span className="lp-route-emoji">{route.emoji}</span>
                <span className="lp-route-name">{route.name}</span>
                <span className="lp-route-cities">{route.cities}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ accordion */}
      <section className="lp-faq">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-faq-title">{t("landing.faqTitle")}</h2>
          <div className="lp-faq-list">
            {Array.isArray(faqs) && faqs.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
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
  flexEnabled, setFlexEnabled,
  flexDays, setFlexDays,
  selectedDests, setSelectedDests,
  passengers, setPassengers,
  directOnly, setDirectOnly,
  cabinClass, setCabinClass,
  currency, setCurrency,
  loading, error,
  onSubmit,
  recentSearches, onLoadRecent, onClearRecent,
}) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [showMobileAirports, setShowMobileAirports] = useState(false);

  const dateWarnings = useDateWarnings(departureDate, returnDate, tripType);

  const safeIdx = activeIdx >= 0 && activeIdx < origins.length ? activeIdx : 0;
  const filterVal = origins[safeIdx]?.trim().toLowerCase() || "";

  // Memoize airport filtering to avoid blocking the main thread on every keystroke (fixes INP)
  const filtered = useMemo(() => {
    if (!filterVal) return AIRPORTS;
    return AIRPORTS.filter((a) =>
      a.code.toLowerCase().includes(filterVal) ||
      a.city.toLowerCase().includes(filterVal) ||
      a.country.toLowerCase().includes(filterVal)
    );
  }, [filterVal]);

  // Memoize destination airports (excludes selected origins)
  const destAirports = useMemo(() => {
    const originCodes = new Set(origins.map(o => normalizeCode(o)));
    return AIRPORTS.filter(a => !originCodes.has(a.code));
  }, [origins]);

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

          {/* Recent searches */}
          {recentSearches?.length > 0 && !loading && (
            <div className="sf-recent">
              <div className="sf-recent-header">
                <span className="sf-recent-title">{t("recentSearches.title")}</span>
                <button type="button" className="sf-recent-clear" onClick={onClearRecent}>{t("recentSearches.clear")}</button>
              </div>
              <div className="sf-recent-chips">
                {recentSearches.map((r, i) => (
                  <button key={i} type="button" className="sf-recent-chip" onClick={() => onLoadRecent(r)}>
                    <span className="sf-recent-origins">{r.origins.join(" · ")}</span>
                    <span className="sf-recent-date">{r.departureDate}{r.tripType === "roundtrip" ? ` ↔ ${r.returnDate}` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            {/* Origins */}
            <div className="sf-section">
              <div className="sf-label">{t("search.originLabel")}</div>
              {origins.map((origin, idx) => {
                const code = normalizeCode(origin);
                const city = cityOf(code);
                const isUnknown = origin.trim().length >= 3 && !city;
                return (
                  <div key={idx} className="sf-origin-row">
                    <span className="sf-badge" title={t("search.travelerTooltip", { n: idx + 1 })}>
                      <span className="sf-badge-icon">👤</span>{idx + 1}
                    </span>
                    <div className="sf-input-wrap">
                      <input
                        type="text"
                        className={`form-control sf-input text-uppercase${isUnknown ? " sf-input--unknown" : ""}`}
                        placeholder={t("search.placeholder")}
                        value={origin}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          startTransition(() => {
                            const copy = [...origins];
                            copy[idx] = val;
                            setOrigins(copy);
                          });
                        }}
                        onFocus={() => setActiveIdx(idx)}
                        disabled={loading}
                        autoComplete="off"
                      />
                      {city && origin.trim() && (
                        <span className="sf-input-city">{countryFlag(code)} {city}</span>
                      )}
                      {isUnknown && (
                        <span className="sf-input-unknown">{t("search.unknownAirport")}</span>
                      )}
                    </div>
                    {/* Passenger count stepper */}
                    <div className="sf-pax" title={t("search.paxTooltip")}>
                      <button type="button" className="sf-pax-btn"
                        onClick={() => { const p = [...passengers]; p[idx] = Math.max(1, (p[idx] || 1) - 1); setPassengers(p); }}
                        disabled={loading || (passengers[idx] || 1) <= 1}>−</button>
                      <span className="sf-pax-count">{passengers[idx] || 1}</span>
                      <button type="button" className="sf-pax-btn"
                        onClick={() => { const p = [...passengers]; p[idx] = Math.min(9, (p[idx] || 1) + 1); setPassengers(p); }}
                        disabled={loading || (passengers[idx] || 1) >= 9}>+</button>
                    </div>
                    {/* Reorder + remove */}
                    <div className="sf-origin-actions-inline">
                      {origins.length > 1 && idx > 0 && (
                        <button type="button" className="sf-reorder-btn" disabled={loading} title={t("search.moveUp")}
                          onClick={() => {
                            const o = [...origins]; const p = [...passengers];
                            [o[idx], o[idx - 1]] = [o[idx - 1], o[idx]];
                            [p[idx], p[idx - 1]] = [p[idx - 1], p[idx]];
                            setOrigins(o); setPassengers(p); setActiveIdx(idx - 1);
                          }}>↑</button>
                      )}
                      {origins.length > 1 && idx < origins.length - 1 && (
                        <button type="button" className="sf-reorder-btn" disabled={loading} title={t("search.moveDown")}
                          onClick={() => {
                            const o = [...origins]; const p = [...passengers];
                            [o[idx], o[idx + 1]] = [o[idx + 1], o[idx]];
                            [p[idx], p[idx + 1]] = [p[idx + 1], p[idx]];
                            setOrigins(o); setPassengers(p); setActiveIdx(idx + 1);
                          }}>↓</button>
                      )}
                    </div>
                    {origins.length > 1 && (
                      <button
                        type="button"
                        className="sf-remove"
                        onClick={() => {
                          const copy = origins.filter((_, i) => i !== idx);
                          const pCopy = passengers.filter((_, i) => i !== idx);
                          setOrigins(copy.length ? copy : [""]);
                          setPassengers(pCopy.length ? pCopy : [1]);
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
                <button type="button" className="sf-add-btn" onClick={() => { setOrigins([...origins, ""]); setPassengers([...passengers, 1]); setActiveIdx(origins.length); }} disabled={loading || origins.length >= 8}>
                  {t("search.addTraveler")}
                </button>
                <button type="button" className="sf-pick-btn" onClick={() => setShowMobileAirports(true)} disabled={loading}>
                  {t("search.pickAirport")}
                </button>
                {origins.length === 1 && !origins[0].trim() && (
                  <button type="button" className="sf-example-btn" onClick={() => {
                    setOrigins(["MAD", "LON", "BER"]);
                    setPassengers([1, 1, 1]);
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
                    onClick={() => {
                      setTripType(v);
                      // Auto-suggest return date when switching to roundtrip
                      if (v === "roundtrip" && !returnDate && departureDate) {
                        const d = new Date(departureDate + "T00:00:00");
                        d.setDate(d.getDate() + 7);
                        setReturnDate(d.toISOString().slice(0, 10));
                      }
                    }} disabled={loading}>{l}</button>
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

              {/* Date warnings */}
              {dateWarnings.length > 0 && (
                <div className="sf-date-warnings mt-2">
                  {dateWarnings.map((w) => (
                    <div key={w.key} className={`sf-date-warn sf-date-warn--${w.type}`}>
                      <span className="sf-date-warn-icon">{w.type === "error" ? "⚠️" : w.type === "warn" ? "⚡" : "💡"}</span>
                      <span>{w.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Flexible dates toggle */}
              <div className="sf-flex-toggle mt-3">
                <div className="d-flex align-items-center justify-content-between">
                  <div>
                    <div className="sf-flex-label">{t("search.flexLabel")}</div>
                    <div className="sf-hint">
                      {flexEnabled
                        ? t("search.flexHintOn", { days: flexDays })
                        : t("search.flexHintOff")}
                    </div>
                  </div>
                  <div className="form-check form-switch mb-0">
                    <input className="form-check-input" type="checkbox" id="flexSwitch"
                      checked={flexEnabled} onChange={(e) => setFlexEnabled(e.target.checked)} disabled={loading} />
                  </div>
                </div>
                {flexEnabled && (
                  <div className="sf-flex-pills mt-2">
                    {[1, 2, 3].map((d) => (
                      <button key={d} type="button"
                        className={`sf-pill sf-pill--sm${flexDays === d ? " sf-pill--active" : ""}`}
                        onClick={() => setFlexDays(d)} disabled={loading}>
                        ±{d} {t("search.flexDaysUnit")}
                      </button>
                    ))}
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

                {/* Direct flights only */}
                <div className="sf-section">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <div className="sf-label mb-0">{t("search.directOnly")}</div>
                      <div className="sf-hint">{t("search.directHint")}</div>
                    </div>
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" id="directSwitch"
                        checked={directOnly} onChange={(e) => setDirectOnly(e.target.checked)} disabled={loading} />
                    </div>
                  </div>
                </div>

                {/* Cabin class */}
                <div className="sf-section">
                  <div className="sf-label mb-1">{t("search.cabinLabel")}</div>
                  <div className="sf-pills">
                    {[["ECONOMY", t("search.cabinEconomy")], ["PREMIUM_ECONOMY", t("search.cabinPremium")], ["BUSINESS", t("search.cabinBusiness")]].map(([v, l]) => (
                      <button key={v} type="button"
                        className={`sf-pill sf-pill--sm${cabinClass === v ? " sf-pill--active" : ""}`}
                        onClick={() => setCabinClass(v)} disabled={loading}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Currency selector */}
                <div className="sf-section">
                  <div className="sf-label mb-1">{t("search.currencyLabel")}</div>
                  <div className="sf-pills">
                    {["EUR", "GBP", "USD"].map((c) => (
                      <button key={c} type="button"
                        className={`sf-pill sf-pill--sm${currency === c ? " sf-pill--active" : ""}`}
                        onClick={() => setCurrency(c)} disabled={loading}>
                        {c === "EUR" ? "€ EUR" : c === "GBP" ? "£ GBP" : "$ USD"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Destination filter */}
                <div className="sf-section">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <div className="sf-label mb-0">{t("search.destLabel")}</div>
                      <div className="sf-hint">
                        {selectedDests.length > 0
                          ? t("search.destSelected", { n: selectedDests.length })
                          : t("search.destAll")}
                      </div>
                    </div>
                    <button type="button" className="btn btn-sm btn-outline-primary"
                      onClick={() => setShowDestPicker((v) => !v)} disabled={loading}>
                      {showDestPicker ? t("search.destHide") : t("search.destChoose")}
                    </button>
                  </div>
                  {showDestPicker && (
                    <div className="sf-dest-picker mt-3">
                      {/* Quick category filters */}
                      <div className="sf-dest-categories">
                        {[
                          ["all",     t("search.destCatAll"),     []],
                          ["beach",   t("search.destCatBeach"),   ["AGP","PMI","TFS","NCE","MLA","DBV","SPU","RHO","TLV"]],
                          ["budget",  t("search.destCatBudget"),  ["OPO","NAP","KRK","BEG","OTP","SOF","TIA","RAK","TLL","RIX","VNO","SKG"]],
                          ["capital", t("search.destCatCapital"), ["LON","PAR","ROM","BER","MAD","LIS","VIE","PRG","ATH","CPH","BUD","DUB","BRU","WAW","OSL","HEL","STO"]],
                        ].map(([key, label, codes]) => (
                          <button key={key} type="button"
                            className={`sf-pill sf-pill--sm${key === "all" && selectedDests.length === 0 ? " sf-pill--active" : ""}`}
                            onClick={() => {
                              if (key === "all") setSelectedDests([]);
                              else setSelectedDests(codes);
                            }} disabled={loading}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {/* Individual city toggles */}
                      <div className="sf-dest-grid">
                        {destAirports.map((a) => {
                          const isOn = selectedDests.length === 0 || selectedDests.includes(a.code);
                          return (
                            <button key={a.code} type="button"
                              className={`sf-dest-chip${isOn ? " sf-dest-chip--on" : ""}`}
                              onClick={() => {
                                if (selectedDests.length === 0) {
                                  // Switch from "all" to "all except this one"
                                  setSelectedDests(destAirports.map(x => x.code).filter(c => c !== a.code));
                                } else if (selectedDests.includes(a.code)) {
                                  setSelectedDests(selectedDests.filter(c => c !== a.code));
                                } else {
                                  setSelectedDests([...selectedDests, a.code]);
                                }
                              }} disabled={loading}>
                              <span className="sf-dest-chip-code">{a.code}</span>
                              <span className="sf-dest-chip-city">{a.city}</span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedDests.length > 0 && (
                        <button type="button" className="sf-dest-clear" onClick={() => setSelectedDests([])} disabled={loading}>
                          {t("search.destReset")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && <FriendlyError message={error} onRetry={onSubmit} />}

            {/* Traveler summary bar */}
            {origins.some((o) => o.trim()) && (
              <div className="sf-summary-bar">
                <div className="sf-summary-travelers">
                  {origins.filter((o) => o.trim()).map((o, i) => {
                    const c = normalizeCode(o);
                    const flag = countryFlag(c);
                    return (
                      <span key={i} className="sf-summary-chip" title={cityOf(c) || c}>
                        {flag && <span className="sf-summary-flag">{flag}</span>}
                        {c}
                        {(passengers[origins.indexOf(o)] || 1) > 1 && (
                          <span className="sf-summary-pax">×{passengers[origins.indexOf(o)]}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div className="sf-summary-meta">
                  {departureDate && <span>{formatDate(departureDate)}</span>}
                  {tripType === "roundtrip" && returnDate && <span> → {formatDate(returnDate)}</span>}
                  {flexEnabled && <span className="sf-summary-flex">±{flexDays}d</span>}
                </div>
              </div>
            )}

            <div className="sf-submit-wrap">
              <button type="submit" className="btn-fm-primary w-100 py-3 fw-bold fs-6" disabled={loading}>
                {loading ? t("search.searching") : t("search.submit")}
              </button>
            </div>
            <div className="sf-footnote">
              <span>{t("search.footnoteTime")}</span>
              <span className="sf-kbd-hint">{t("search.kbdHint")}</span>
              <span>{t("search.footnotePrices")}</span>
            </div>
          </form>
        </div>

        {/* ── Right: airport picker (desktop sidebar / mobile bottom drawer) ── */}
        {showMobileAirports && <div className="sf-drawer-overlay" onClick={() => setShowMobileAirports(false)} />}
        <aside className={`sf-airports fm-card${showMobileAirports ? " sf-airports--open" : ""}`}>
          <div className="sf-drawer-handle" onClick={() => setShowMobileAirports(false)}>
            <span className="sf-drawer-bar" />
          </div>
          <div className="sf-airports-header">
            <div className="sf-label">{t("search.airportsTitle")}</div>
            <button type="button" className="sf-drawer-close" onClick={() => setShowMobileAirports(false)}>
              {t("search.closeDrawer")}
            </button>
          </div>
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
  dest, origins, tripType, returnDate, departureDate: depDate,
  uiCriterion, onChangeCriterion,
  flightsCount, allFlights = [], lastBestPrice = 0,
  onShare, onShareWhatsApp, onShareTelegram, onShareEmail, onShareNative, shareStatus,
  onViewAlternatives, onChangeSearch,
  currency = "EUR",
  searchBadges = [],
  isFav = false, onToggleFav,
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(true);

  useEffect(() => {
    if (dest) {
      const timer = setTimeout(() => setEntered(true), 50);
      return () => clearTimeout(timer);
    }
  }, [dest]);

  if (!dest) return null;

  const code      = normalizeCode(dest.destination);
  const city      = cityOf(code);
  const imgUrl    = getCityImage(code, getBaseUrl(), { w: 1200, h: 500 });
  const fairness  = useFairnessLabel(dest.fairnessScore ?? 0);
  const dep       = dest.bestDate || "";
  const ret       = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");

  const cleanOrigins = (origins || []).map((o) => String(o).trim().toUpperCase()).filter(Boolean);
  const breakdown    = Array.isArray(dest.flights) ? dest.flights : [];

  // Build price map + itinerary info from breakdown
  const priceMap = {};
  const offerMap = {};
  breakdown.forEach((f) => {
    const k = String(f.origin).toUpperCase();
    priceMap[k] = f.price;
    offerMap[k] = f.offer || null;
  });

  // Price comparison vs last search
  const priceVsLast = useMemo(() => {
    if (!lastBestPrice || !dest?.averageCostPerTraveler || lastBestPrice === dest.averageCostPerTraveler) return null;
    const diff = dest.averageCostPerTraveler - lastBestPrice;
    const pct = Math.round((Math.abs(diff) / lastBestPrice) * 100);
    if (pct < 2) return null; // ignore tiny differences
    return { cheaper: diff < 0, pct, diff: Math.abs(diff) };
  }, [lastBestPrice, dest]);

  // Cheapest origin (for highlighting in booking cards)
  const cheapestOrigin = useMemo(() => {
    if (!breakdown.length) return "";
    return breakdown.reduce((best, f) => (!best || (f.price < best.price)) ? f : best, null)?.origin?.toUpperCase() || "";
  }, [breakdown]);

  // Savings vs average of all destinations
  const savingsPct = useMemo(() => {
    if (!allFlights || allFlights.length < 2 || !dest?.averageCostPerTraveler) return 0;
    const avgAll = allFlights.reduce((s, f) => s + (f.averageCostPerTraveler || 0), 0) / allFlights.length;
    if (avgAll <= 0) return 0;
    return Math.round(((avgAll - dest.averageCostPerTraveler) / avgAll) * 100);
  }, [allFlights, dest]);

  // Trip duration in days (roundtrip only)
  const tripDays = useMemo(() => {
    if (tripType !== "roundtrip") return 0;
    const d = dep || depDate;
    const r = ret;
    if (!d || !r) return 0;
    const diff = (new Date(r + "T00:00:00") - new Date(d + "T00:00:00")) / 86400000;
    return diff > 0 ? Math.round(diff) : 0;
  }, [tripType, dep, ret, depDate]);

  return (
    <div className={`wc-card${entered ? " wc-card--entered" : ""}`}>
      {/* Hero image */}
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          <div className="wc-badge-winner">{t("results.eyebrow")}</div>
          <span className="wc-dest-code">{city || code}</span>
          {city && <span className="wc-dest-city">{code}</span>}
        </div>
        <button type="button" className={`wc-fav-btn${isFav ? " wc-fav-btn--active" : ""}`} onClick={onToggleFav} aria-label={t("results.favorite")} title={t("results.favorite")}>
          {isFav ? "❤️" : "🤍"}
        </button>
        {/* Savings + trip duration + vs last search chips */}
        <div className="wc-chips-overlay">
          {savingsPct > 5 && (
            <span className="wc-savings-chip">
              {t("results.savingsPct", { pct: savingsPct })}
            </span>
          )}
          {tripDays > 0 && (
            <span className="wc-trip-days-chip">
              {t("results.tripDays", { n: tripDays })}
            </span>
          )}
          {priceVsLast && (
            <span className={`wc-vs-last-chip${priceVsLast.cheaper ? " wc-vs-last-chip--cheaper" : " wc-vs-last-chip--pricier"}`}>
              {priceVsLast.cheaper
                ? t("results.vsLastCheaper", { pct: priceVsLast.pct })
                : t("results.vsLastPricier", { pct: priceVsLast.pct })}
            </span>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="wc-summary">
        <div className="wc-summary-item wc-summary-item--tooltip">
          <div className="wc-summary-label">{t("results.groupTotal")}</div>
          {currency === "EUR"
            ? <AnimatedPrice value={dest.totalCostEUR} decimals={0} className="wc-summary-price" />
            : <div className="wc-summary-price price-animate">{convertPrice(dest.totalCostEUR, currency)}</div>
          }
          {/* Per-origin breakdown tooltip */}
          {breakdown.length > 0 && (
            <div className="wc-tooltip">
              {breakdown.map((f, i) => (
                <div key={i} className="wc-tooltip-row">
                  <span>{f.origin}</span>
                  <span>{currency === "EUR" ? formatEur(f.price, 0) : convertPrice(f.price, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="wc-summary-divider" />
        <div className="wc-summary-item">
          <div className="wc-summary-label">{t("results.avgPerPerson")}</div>
          {currency === "EUR"
            ? <AnimatedPrice value={dest.averageCostPerTraveler} decimals={0} className="wc-summary-price wc-summary-price--secondary" />
            : <div className="wc-summary-price wc-summary-price--secondary price-animate">{convertPrice(dest.averageCostPerTraveler, currency)}</div>
          }
        </div>
        <div className="wc-summary-divider" />
        <div className="wc-summary-item">
          <div className="wc-summary-label">{t("results.fairnessLabel")}</div>
          <div className="wc-summary-fairness">
            <svg className="wc-fairness-ring" viewBox="0 0 40 40" width="44" height="44">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
              <circle cx="20" cy="20" r="16" fill="none" stroke={fairness.color} strokeWidth="3"
                strokeDasharray={`${((dest.fairnessScore ?? 0) / 100) * 100.53} 100.53`}
                strokeLinecap="round" transform="rotate(-90 20 20)"
                style={{ transition: "stroke-dasharray .8s ease" }} />
              <text x="20" y="22" textAnchor="middle" fill={fairness.color} fontSize="11" fontWeight="800">
                {(dest.fairnessScore ?? 0).toFixed(0)}
              </text>
            </svg>
          </div>
        </div>
        {dep && (
          <>
            <div className="wc-summary-divider" />
            <div className="wc-summary-item">
              <div className="wc-summary-label">
                {tripType === "roundtrip" ? t("results.roundtripTag") : t("results.onewayTag")}
              </div>
              <div className="wc-summary-date">
                {tripType === "roundtrip"
                  ? `${formatDate(dep)} → ${formatDate(ret)}`
                  : formatDate(dep)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Body */}
      <div className="wc-body">
        {/* Criterion toggle */}
        <div className="wc-criterion-row">
          <div className="wc-criterion-pills">
            {[["total", t("results.criterionPrice")], ["fairness", t("results.criterionFairness")]].map(([v, l]) => (
              <button key={v} type="button"
                className={`wc-criterion-pill${uiCriterion === v ? " wc-criterion-pill--active" : ""}`}
                onClick={() => onChangeCriterion(v)}>{l}</button>
            ))}
          </div>
          <div className="wc-stats-mini">
            {t("results.destsAnalyzed")}: <strong>{flightsCount}</strong>
          </div>
        </div>

        {/* ── Booking section (collapsible) ── */}
        {cleanOrigins.length > 0 && dep && (
          <div className="wc-booking">
            <button type="button" className="wc-booking-toggle" onClick={() => setBookingOpen((v) => !v)}>
              <div>
                <div className="wc-booking-title">{t("results.bookTitle")}</div>
                <div className="wc-booking-sub">{t("results.bookSub")}</div>
              </div>
              <span className={`wc-booking-chevron${bookingOpen ? " wc-booking-chevron--open" : ""}`}>▾</span>
            </button>

            <div className={`wc-booking-collapse${bookingOpen ? " wc-booking-collapse--open" : ""}`}>
            <div className="wc-booking-cards">
              {cleanOrigins.map((origin) => {
                const price = priceMap[origin];
                const offer = offerMap[origin];
                const originCity = cityOf(origin);
                const destCity = city || code;
                const ssUrl = buildSkyscannerUrl({ origin, destination: code, departureDate: dep, returnDate: ret, tripType });
                const gfUrl = buildGoogleFlightsUrl({ origin, destination: code, departureDate: dep, returnDate: ret, tripType });

                // Extract itinerary details (outbound)
                const itin = offer?.itineraries?.[0];
                const segments = itin?.segments || [];
                const stops = segments.length > 0 ? segments.length - 1 : null;
                const airline = offer?.validatingAirlineCodes?.[0] || "";
                const duration = itin?.duration || "";
                const durationText = duration
                  ? duration.replace("PT", "").replace("H", "h ").replace("M", "m").trim()
                  : "";
                const depAirport = segments[0]?.departure?.iataCode || "";
                const arrAirport = segments[segments.length - 1]?.arrival?.iataCode || "";
                const depName = airportName(depAirport);
                const arrName = airportName(arrAirport);

                // Extract return itinerary (roundtrip only)
                const retItin = tripType === "roundtrip" ? offer?.itineraries?.[1] : null;
                const retSegments = retItin?.segments || [];
                const retStops = retSegments.length > 0 ? retSegments.length - 1 : null;
                const retDuration = retItin?.duration || "";
                const retDurationText = retDuration
                  ? retDuration.replace("PT", "").replace("H", "h ").replace("M", "m").trim()
                  : "";
                const retDepAirport = retSegments[0]?.departure?.iataCode || "";
                const retArrAirport = retSegments[retSegments.length - 1]?.arrival?.iataCode || "";
                const retDepName = airportName(retDepAirport);
                const retArrName = airportName(retArrAirport);

                return (
                  <div key={origin} className={`wc-flight-card${cleanOrigins.length > 1 && origin === cheapestOrigin ? " wc-flight-card--cheapest" : ""}`}>
                    {cleanOrigins.length > 1 && origin === cheapestOrigin && (
                      <div className="wc-cheapest-label">{t("results.cheapestOrigin")}</div>
                    )}
                    <div className="wc-flight-route">
                      <div className="wc-flight-endpoint">
                        <span className="wc-flight-code">{countryFlag(origin)} {origin}</span>
                        <span className="wc-flight-city">{originCity}</span>
                      </div>
                      <div className="wc-flight-arrow-wrap">
                        <div className="wc-flight-line" />
                        <span className="wc-flight-plane">✈</span>
                        <div className="wc-flight-line" />
                      </div>
                      <div className="wc-flight-endpoint wc-flight-endpoint--right">
                        <span className="wc-flight-code">{code}</span>
                        <span className="wc-flight-city">{destCity}</span>
                      </div>
                      <div className="wc-flight-price-tag">
                        {typeof price === "number" ? (currency === "EUR" ? formatEur(price, 0) : convertPrice(price, currency)) : "—"}
                        {(offer?.passengers || 0) > 1 && (
                          <span className="wc-flight-pax-badge">×{offer.passengers}</span>
                        )}
                      </div>
                    </div>
                    {/* Outbound itinerary */}
                    {(airline || stops !== null || durationText) && (
                      <div className="wc-flight-meta">
                        <span className="wc-flight-meta-item wc-flight-meta-leg">{t("results.outbound")}</span>
                        {airline && <span className="wc-flight-meta-item wc-flight-meta-airline">{airline}</span>}
                        {durationText && <span className="wc-flight-meta-item">{durationText}</span>}
                        {stops !== null && (
                          <span className={`wc-flight-meta-item ${stops === 0 ? "wc-flight-meta--direct" : "wc-flight-meta--stops"}`}>
                            {stops === 0 ? t("results.direct") : t("results.stops", { n: stops })}
                          </span>
                        )}
                        {(depName || arrName) && (
                          <span className="wc-flight-meta-item wc-flight-meta-airport">
                            {depAirport}{depName ? ` ${depName}` : ""} → {arrAirport}{arrName ? ` ${arrName}` : ""}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Return itinerary */}
                    {retItin && (retStops !== null || retDurationText) && (
                      <div className="wc-flight-meta wc-flight-meta--return">
                        <span className="wc-flight-meta-item wc-flight-meta-leg">{t("results.returnLeg")}</span>
                        {retDurationText && <span className="wc-flight-meta-item">{retDurationText}</span>}
                        {retStops !== null && (
                          <span className={`wc-flight-meta-item ${retStops === 0 ? "wc-flight-meta--direct" : "wc-flight-meta--stops"}`}>
                            {retStops === 0 ? t("results.direct") : t("results.stops", { n: retStops })}
                          </span>
                        )}
                        {(retDepName || retArrName) && (
                          <span className="wc-flight-meta-item wc-flight-meta-airport">
                            {retDepAirport}{retDepName ? ` ${retDepName}` : ""} → {retArrAirport}{retArrName ? ` ${retArrName}` : ""}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="wc-flight-ctas">
                      {ssUrl && (
                        <a href={ssUrl} target="_blank" rel="noreferrer" className="wc-cta wc-cta--skyscanner">
                          <span className="wc-cta-icon">🔍</span>
                          Skyscanner
                        </a>
                      )}
                      {gfUrl && (
                        <a href={gfUrl} target="_blank" rel="noreferrer" className="wc-cta wc-cta--google">
                          <span className="wc-cta-icon">✈</span>
                          Google Flights
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>{/* /wc-booking-collapse */}
          </div>
        )}

        {/* Fairness detail (collapsible mini) */}
        <div className="wc-fairness-detail">
          <div className="wc-fairness-bar-full">
            <div className="wc-fairness-fill-full" style={{ width: `${Math.min(100, dest.fairnessScore ?? 0)}%` }} />
          </div>
          <div className="wc-fairness-row">
            <span className="wc-fairness-tag-full" style={{ color: fairness.color }}>{fairness.text}</span>
            <span className="wc-fairness-spread">{t("results.maxSpread")}: {formatEur(dest.priceSpread ?? 0, 0)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="wc-actions">
          <button type="button" className="wc-action-btn wc-action-btn--primary" onClick={onViewAlternatives}>
            {t("results.viewAlternatives")}
          </button>
          <button type="button" className="wc-action-btn" onClick={onShare}>
            {shareStatus === "ok" ? t("results.copied") : shareStatus === "saving" ? "…" : shareStatus === "fail" ? t("results.copyFailed") : t("results.share")}
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--whatsapp" onClick={onShareWhatsApp}>
            <span className="wc-wa-icon">💬</span> WhatsApp
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--telegram" onClick={onShareTelegram}>
            ✈ Telegram
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--summary" onClick={() => {
            const lines = [
              `✈ ${city || code}`,
              `${t("results.groupTotal")}: ${currency === "EUR" ? formatEur(dest.totalCostEUR, 0) : convertPrice(dest.totalCostEUR, currency)}`,
              `${t("results.avgPerPerson")}: ${currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}`,
              `${t("results.fairnessLabel")}: ${(dest.fairnessScore ?? 0).toFixed(0)}/100`,
              "",
              ...breakdown.map((f) => `  ${f.origin}: ${currency === "EUR" ? formatEur(f.price, 0) : convertPrice(f.price, currency)}`),
            ];
            copyText(lines.join("\n"));
          }}>
            📋 {t("results.copySummary")}
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--email" onClick={onShareEmail}>
            ✉ Email
          </button>
          {typeof navigator !== "undefined" && navigator.share && (
            <button type="button" className="wc-action-btn wc-action-btn--native" onClick={onShareNative}>
              📤 {t("results.shareNative")}
            </button>
          )}
          <button type="button" className="wc-action-btn wc-action-btn--link" onClick={onChangeSearch}>
            {t("results.changeSearch")}
          </button>
        </div>

        {/* Search badges */}
        {searchBadges.length > 0 && (
          <div className="wc-badges">
            {searchBadges.map((b, i) => (
              <span key={i} className="wc-badge">{b}</span>
            ))}
          </div>
        )}

        <div className="wc-disclaimer">{t("results.disclaimer")}</div>
      </div>
    </div>
  );
});

// ─── VS Compare (side-by-side) ───────────────────────────────────────────────

const VsCompare = React.memo(function VsCompare({ flights, bestDestination, currency }) {
  const { t } = useI18n();
  const [leftIdx, setLeftIdx]   = useState(0);
  const [rightIdx, setRightIdx] = useState(Math.min(1, flights.length - 1));

  const left  = flights[leftIdx];
  const right = flights[rightIdx];
  if (!left || !right) return null;

  const fmtPrice = (eur) => currency === "EUR" ? formatEur(eur) : convertPrice(eur, currency);

  const rows = [
    { label: t("vs.totalCost"), left: fmtPrice(left.totalCostEUR), right: fmtPrice(right.totalCostEUR), winner: left.totalCostEUR < right.totalCostEUR ? "left" : left.totalCostEUR > right.totalCostEUR ? "right" : "tie" },
    { label: t("vs.avgPerPerson"), left: fmtPrice(left.averageCostPerTraveler), right: fmtPrice(right.averageCostPerTraveler), winner: left.averageCostPerTraveler < right.averageCostPerTraveler ? "left" : left.averageCostPerTraveler > right.averageCostPerTraveler ? "right" : "tie" },
    { label: t("vs.fairness"), left: `${left.fairnessScore ?? "—"}/100`, right: `${right.fairnessScore ?? "—"}/100`, winner: (left.fairnessScore || 0) > (right.fairnessScore || 0) ? "left" : (left.fairnessScore || 0) < (right.fairnessScore || 0) ? "right" : "tie" },
  ];

  return (
    <div className="vs-wrap mt-4 view-enter">
      <h3 className="vs-title">{t("vs.title")}</h3>

      {/* Selectors */}
      <div className="vs-selectors">
        <select className="vs-select" value={leftIdx} onChange={(e) => setLeftIdx(Number(e.target.value))}>
          {flights.map((f, i) => (
            <option key={i} value={i}>{normalizeCode(f.destination)} — {cityOf(normalizeCode(f.destination)) || f.destination}</option>
          ))}
        </select>
        <span className="vs-badge">VS</span>
        <select className="vs-select" value={rightIdx} onChange={(e) => setRightIdx(Number(e.target.value))}>
          {flights.map((f, i) => (
            <option key={i} value={i}>{normalizeCode(f.destination)} — {cityOf(normalizeCode(f.destination)) || f.destination}</option>
          ))}
        </select>
      </div>

      {/* Comparison table */}
      <div className="vs-table">
        <div className="vs-header">
          <div className="vs-col vs-col--label" />
          <div className="vs-col vs-col--dest">
            <span className="vs-dest-code">{normalizeCode(left.destination)}</span>
            <span className="vs-dest-city">{cityOf(normalizeCode(left.destination))}</span>
          </div>
          <div className="vs-col vs-col--dest">
            <span className="vs-dest-code">{normalizeCode(right.destination)}</span>
            <span className="vs-dest-city">{cityOf(normalizeCode(right.destination))}</span>
          </div>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="vs-row">
            <div className="vs-col vs-col--label">{r.label}</div>
            <div className={`vs-col vs-col--val${r.winner === "left" ? " vs-col--winner" : ""}`}>{r.left}</div>
            <div className={`vs-col vs-col--val${r.winner === "right" ? " vs-col--winner" : ""}`}>{r.right}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { t } = useI18n();
  const { resolved: themeResolved, toggle: toggleTheme } = useTheme();
  const { favs, toggle: toggleFav, isFav } = useFavorites();

  // View: 'landing' | 'search' | 'results'
  const [view, setViewRaw] = useState("landing");

  // ── Browser history support (back/forward buttons) ──────────────────────
  const skipHistoryPush = useRef(false);

  const setView = useCallback((newView) => {
    setViewRaw((prev) => {
      if (prev !== newView && !skipHistoryPush.current) {
        window.history.pushState({ view: newView }, "", `#${newView}`);
      }
      skipHistoryPush.current = false;
      return newView;
    });
  }, []);

  useEffect(() => {
    // Set initial state
    window.history.replaceState({ view: "landing" }, "", window.location.pathname + window.location.search);

    const onPopState = (e) => {
      const target = e.state?.view || "landing";
      skipHistoryPush.current = true;
      setView(target);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a ref of current view for keyboard handler (avoids stale closure)
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const tabContentRef = useRef(null);

  // ── Dynamic document title per view ────────────────────────────────────
  useEffect(() => {
    const titles = {
      landing: "FlyndMe — Find the cheapest place to meet your group",
      search: "FlyndMe — Search flights",
      results: bestDestination
        ? `FlyndMe — ${cityOf(normalizeCode(bestDestination.destination)) || bestDestination.destination} · ${formatEur(bestDestination.averageCostPerTraveler, 0)}/pp`
        : "FlyndMe — Results",
    };
    document.title = titles[view] || titles.landing;
  }, [view, bestDestination]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore if user is typing in an input
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Escape: go back one view
      if (e.key === "Escape") {
        const cur = viewRef.current;
        if (cur === "results") setView("search");
        else if (cur === "search") setView("landing");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search params
  const [origins,       setOrigins]       = useState([""]);
  const [tripType,      setTripType]      = useState("oneway");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate,    setReturnDate]    = useState("");
  const [optimizeBy,    setOptimizeBy]    = useState("total");
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [maxBudget,     setMaxBudget]     = useState(200);
  const [flexEnabled,   setFlexEnabled]   = useState(false);
  const [flexDays,      setFlexDays]      = useState(3);
  const [selectedDests, setSelectedDests] = useState([]); // empty = all defaults
  const [passengers,    setPassengers]    = useState([1]); // passengers per origin
  const [directOnly,    setDirectOnly]    = useState(false);
  const [cabinClass,    setCabinClass]    = useState("ECONOMY");
  const [currency,      setCurrency]      = useState("EUR");

  // Results
  const [flights,         setFlights]         = useState([]);
  const [bestByCriterion, setBestByCriterion] = useState({ total: null, fairness: null });
  const [uiCriterion,     setUiCriterion]     = useState("total");
  const [showAlt,         setShowAlt]         = useState(false);
  const [sortMode,        setSortMode]        = useState("default"); // default | price | fairness

  // UI state
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [toast,       setToast]       = useState(null); // { message, type }

  // Last search best price (for comparison)
  const [lastBestPrice, setLastBestPrice] = useState(() => {
    try { return Number(localStorage.getItem("flyndme_last_best") || 0); } catch { return 0; }
  });

  // ── Recent searches (localStorage) ────────────────────────────────────────
  const RECENT_KEY = "flyndme_recent";
  const MAX_RECENT = 5;

  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
  });

  const saveRecentSearch = useCallback((params) => {
    setRecentSearches((prev) => {
      const entry = {
        origins: params.origins,
        tripType: params.tripType,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        ts: Date.now(),
      };
      // De-duplicate by origins+date combo
      const key = `${entry.origins.join(",")}_${entry.departureDate}_${entry.tripType}`;
      const filtered = prev.filter((r) => `${r.origins.join(",")}_${r.departureDate}_${r.tripType}` !== key);
      const updated = [entry, ...filtered].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch { /* quota */ }
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try { localStorage.removeItem(RECENT_KEY); } catch { /* */ }
  }, []);

  const loadRecentSearch = useCallback((entry) => {
    setOrigins(entry.origins);
    setTripType(entry.tripType);
    setDepartureDate(entry.departureDate);
    if (entry.returnDate) setReturnDate(entry.returnDate);
  }, []);

  // ── PWA: Register service worker ────────────────────────────────────────
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // ── PWA: Install prompt ─────────────────────────────────────────────────
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") trackEvent("pwa_install");
    setInstallPrompt(null);
    setShowInstallBanner(false);
  };

  // Keep Render backend alive (free tier sleeps)
  useEffect(() => {
    const ping = () => fetch(`${API_BASE}/api/ping`, { cache: "no-store" }).catch(() => {});
    ping();
    const quick1 = setTimeout(ping, 3000);
    const quick2 = setTimeout(ping, 8000);
    const interval = setInterval(ping, 8 * 60 * 1000);
    return () => { clearTimeout(quick1); clearTimeout(quick2); clearInterval(interval); };
  }, []);

  // Load shared results from URL (?share=ID)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");
    if (!shareId) return;

    setLoading(true);
    fetch(`${API_BASE}/api/share/${shareId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Share not found");
        return res.json();
      })
      .then((data) => {
        const { results, searchParams } = data;
        if (results?.flights?.length) {
          setFlights(results.flights);
          setBestByCriterion(results.bestByCriterion || {
            total: pickBest(results.flights, "total"),
            fairness: pickBest(results.flights, "fairness"),
          });
        }
        if (searchParams) {
          if (searchParams.origins?.length) setOrigins(searchParams.origins);
          if (searchParams.departureDate) setDepartureDate(searchParams.departureDate);
          if (searchParams.returnDate) setReturnDate(searchParams.returnDate);
          if (searchParams.tripType) setTripType(searchParams.tripType);
          if (searchParams.optimizeBy) setOptimizeBy(searchParams.optimizeBy);
          if (searchParams.uiCriterion) setUiCriterion(searchParams.uiCriterion);
        }
        setView("results");
        document.title = "FlyndMe - Shared Results";
        // Clean URL without reload
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => {
        setToast({ message: t("share.expired"), type: "error" });
        window.history.replaceState({}, "", window.location.pathname);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Share (generates a shareable link) ──────────────────────────────────────

  const handleShare = async () => {
    if (!bestDestination || !flights.length) return;
    setShareStatus("saving");

    try {
      // Save results to backend
      const res = await fetch(`${API_BASE}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: { flights, bestByCriterion },
          searchParams: {
            origins: cleanOrigins,
            departureDate,
            returnDate,
            tripType,
            optimizeBy,
            uiCriterion,
          },
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      const { id } = await res.json();
      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${id}`;

      // Copy the link
      const ok = await copyText(shareUrl);
      if (ok) {
        setShareStatus("ok");
        setToast({ message: t("share.linkCopied"), type: "success" });
        trackEvent("share_link", { destination: normalizeCode(bestDestination.destination) });
      } else {
        // Fallback: copy text summary
        const bd = bestDestination;
        const code = normalizeCode(bd.destination);
        const lines = [
          t("share.title", { dest: destLabel(code) }),
          t("share.totalAvg", { total: formatEur(bd.totalCostEUR, 2), avg: formatEur(bd.averageCostPerTraveler, 2) }),
          `🔗 ${shareUrl}`,
        ];
        await copyText(lines.join("\n"));
        setShareStatus("ok");
        setToast({ message: t("share.linkCopied"), type: "success" });
      }
    } catch {
      // Fallback to old text-only share
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
    }
    setTimeout(() => setShareStatus(""), 3000);
  };

  // ── WhatsApp share ─────────────────────────────────────────────────────────

  const handleShareWhatsApp = async () => {
    if (!bestDestination) return;
    const bd = bestDestination;
    const code = normalizeCode(bd.destination);
    const destName = destLabel(code);

    // Try to get a share link first
    let shareUrl = "";
    try {
      const res = await fetch(`${API_BASE}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: { flights, bestByCriterion },
          searchParams: { origins: cleanOrigins, departureDate, returnDate, tripType, optimizeBy, uiCriterion },
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        shareUrl = `${window.location.origin}${window.location.pathname}?share=${id}`;
      }
    } catch { /* fallback without link */ }

    const lines = [
      `✈ *FlyndMe* — ${destName}`,
      `${t("results.groupTotal")}: ${formatEur(bd.totalCostEUR, 0)} · ${formatEur(bd.averageCostPerTraveler, 0)}/${t("results.avgPerPerson").toLowerCase()}`,
    ];
    if (Array.isArray(bd.flights) && bd.flights.length) {
      lines.push(bd.flights.map((f) => `${f.origin}: ${formatEur(f.price, 0)}`).join(" · "));
    }
    // Use OG endpoint for rich social previews (WhatsApp, Telegram, Twitter)
    if (shareUrl) {
      const shareId = shareUrl.split("share=")[1];
      const ogUrl = `${API_BASE}/api/share/${shareId}/og`;
      lines.push(`\n🔗 ${ogUrl}`);
    }

    const waUrl = `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(waUrl, "_blank");
    trackEvent("share_whatsapp", { destination: code });
  };

  const handleShareTelegram = () => {
    if (!bestDestination) return;
    const code = normalizeCode(bestDestination.destination);
    const destName = destLabel(code);
    const text = `✈ FlyndMe — ${destName}\n${t("results.groupTotal")}: ${formatEur(bestDestination.totalCostEUR, 0)} · ${formatEur(bestDestination.averageCostPerTraveler, 0)}/${t("results.avgPerPerson").toLowerCase()}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
    trackEvent("share_telegram", { destination: code });
  };

  const handleShareEmail = () => {
    if (!bestDestination) return;
    const code = normalizeCode(bestDestination.destination);
    const destName = destLabel(code);
    const subject = `FlyndMe — ${t("results.eyebrow")}: ${destName}`;
    const body = [
      `✈ ${destName}`,
      `${t("results.groupTotal")}: ${formatEur(bestDestination.totalCostEUR, 0)}`,
      `${t("results.avgPerPerson")}: ${formatEur(bestDestination.averageCostPerTraveler, 0)}`,
      "",
      window.location.href,
    ].join("\n");
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    trackEvent("share_email", { destination: code });
  };

  // ── Native Web Share API (mobile) ──────────────────────────────────────────

  const handleShareNative = async () => {
    if (!bestDestination || !navigator.share) return;
    const code = normalizeCode(bestDestination.destination);
    const destName = destLabel(code);
    try {
      await navigator.share({
        title: `FlyndMe — ${destName}`,
        text: `✈ ${destName}\n${t("results.groupTotal")}: ${formatEur(bestDestination.totalCostEUR, 0)}\n${t("results.avgPerPerson")}: ${formatEur(bestDestination.averageCostPerTraveler, 0)}`,
        url: window.location.href,
      });
      trackEvent("share_native", { destination: code });
    } catch { /* user cancelled */ }
  };

  // ── Simple analytics (beacon-based, no external deps) ─────────────────────

  function trackEvent(event, data = {}) {
    try {
      // Log to console for now; replace with your analytics endpoint
      console.log(`[analytics] ${event}`, data);
      // If you have an analytics endpoint, uncomment:
      // navigator.sendBeacon?.(`${API_BASE}/api/events`, JSON.stringify({ event, ...data, ts: Date.now() }));
    } catch { /* silent */ }
  }

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
        dateMode: flexEnabled ? "flex" : "exact",
        flexDays: flexEnabled ? flexDays : 0,
        ...(tripType === "roundtrip" && { returnDate }),
        ...(budgetEnabled && { maxBudgetPerTraveler: maxBudget }),
        ...(selectedDests.length > 0 && { destinations: selectedDests }),
        ...(directOnly && { nonStop: true }),
        ...(cabinClass !== "ECONOMY" && { travelClass: cabinClass }),
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

          // Adjust totals for passenger counts (>1 traveler per origin)
          const paxMap = {};
          cleanOrigins.forEach((o, i) => { paxMap[o] = passengers[i] || 1; });
          const totalPax = cleanOrigins.reduce((s, o, i) => s + (passengers[i] || 1), 0);
          const hasMultiPax = totalPax > cleanOrigins.length;

          const adjusted = hasMultiPax ? arr.map((dest) => {
            const adjFlights = (dest.flights || []).map((f) => ({
              ...f,
              passengers: paxMap[f.origin] || 1,
              totalForOrigin: f.price * (paxMap[f.origin] || 1),
            }));
            const adjTotal = adjFlights.reduce((s, f) => s + f.totalForOrigin, 0);
            return {
              ...dest,
              flights: adjFlights,
              totalCostEUR: adjTotal,
              averageCostPerTraveler: adjTotal / totalPax,
              _totalPassengers: totalPax,
            };
          }) : arr;

          setFlights(adjusted);
          setBestByCriterion({ total: pickBest(adjusted, "total"), fairness: pickBest(adjusted, "fairness") });
          setUiCriterion(optimizeBy);
          setView("results");
          document.title = "FlyndMe - Flight Results";
          window.scrollTo({ top: 0, behavior: "smooth" });
          saveRecentSearch({ origins: cleanOrigins, tripType, departureDate, returnDate });
          // Save best price for next-search comparison
          const bestTotal = pickBest(adjusted, "total");
          if (bestTotal?.averageCostPerTraveler) {
            try { localStorage.setItem("flyndme_last_best", String(bestTotal.averageCostPerTraveler)); } catch {}
            setLastBestPrice(bestTotal.averageCostPerTraveler);
          }
          trackEvent("search_complete", {
            origins: cleanOrigins.length,
            results: arr.length,
            flexEnabled,
            tripType,
            winner: arr[0]?.destination,
          });
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
      {/* Skip to content (a11y) */}
      <a href="#main-content" className="skip-link">{t("a11y.skipToContent")}</a>

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
            <ThemeToggle resolved={themeResolved} toggle={toggleTheme} />
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
      <div id="main-content">
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
          flexEnabled={flexEnabled}   setFlexEnabled={setFlexEnabled}
          flexDays={flexDays}         setFlexDays={setFlexDays}
          selectedDests={selectedDests} setSelectedDests={setSelectedDests}
          passengers={passengers}     setPassengers={setPassengers}
          directOnly={directOnly}     setDirectOnly={setDirectOnly}
          cabinClass={cabinClass}     setCabinClass={setCabinClass}
          currency={currency}         setCurrency={setCurrency}
          loading={loading}           error={error}
          onSubmit={handleSubmit}
          recentSearches={recentSearches}
          onLoadRecent={loadRecentSearch}
          onClearRecent={clearRecentSearches}
        />
        </div>
      )}

      {/* Loading skeleton */}
      {loading && view === "search" && (
        <div className="view-enter" key="skeleton">
          <SearchSkeleton origins={cleanOrigins} />
        </div>
      )}

      {view === "results" && bestDestination && (
        <main className="container py-4 view-enter" key="results" style={{ maxWidth: 1080 }}>
          <WinnerCard
            dest={bestDestination}
            origins={cleanOrigins}
            tripType={tripType}
            returnDate={returnDate}
            departureDate={departureDate}
            uiCriterion={uiCriterion}
            onChangeCriterion={handleCriterion}
            flightsCount={flights.length}
            allFlights={flights}
            lastBestPrice={lastBestPrice}
            onShare={handleShare}
            onShareWhatsApp={handleShareWhatsApp}
            onShareTelegram={handleShareTelegram}
            onShareEmail={handleShareEmail}
            onShareNative={handleShareNative}
            shareStatus={shareStatus}
            onViewAlternatives={() => setShowAlt((v) => v ? false : "list")}
            onChangeSearch={() => setView("search")}
            currency={currency}
            searchBadges={[
              cabinClass !== "ECONOMY" && (cabinClass === "BUSINESS" ? t("search.cabinBusiness") : t("search.cabinPremium")),
              directOnly && t("search.directOnly"),
              flexEnabled && `± ${flexDays} ${t("search.flexDaysLabel") || "days"}`,
              tripType === "roundtrip" && t("search.roundtrip"),
            ].filter(Boolean)}
            isFav={isFav(bestDestination.destination)}
            onToggleFav={() => toggleFav(bestDestination)}
          />

          {/* Celebrate badge for cheap flights (avg < €50/pp) */}
          {bestDestination.averageCostPerTraveler < 50 && (
            <div className="fm-celebrate view-enter">
              <span className="fm-celebrate-confetti">🎉</span>
              <div>
                <strong>{t("results.celebrate")}</strong>
                <span className="fm-celebrate-sub">{t("results.celebrateSub")}</span>
              </div>
            </div>
          )}

          {/* Destinations analyzed counter */}
          <div className="fm-stats-bar view-enter">
            <span className="fm-stats-item">
              <AnimatedStat value={flights.length} /> {t("results.destsAnalyzed")}
            </span>
            <span className="fm-stats-sep">·</span>
            <span className="fm-stats-item">
              <AnimatedStat value={cleanOrigins.length} /> {t("results.originsUsed")}
            </span>
            <span className="fm-stats-sep">·</span>
            <span className="fm-stats-item">
              <AnimatedStat value={flights.length * cleanOrigins.length} /> {t("results.routesCompared")}
            </span>
            <button type="button" className="fm-stats-export" onClick={() => exportResultsCSV(flights, cleanOrigins, currency)} title={t("results.exportCSV")}>
              📥 CSV
            </button>
          </div>

          {/* JSON-LD structured data for SEO */}
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TravelAction",
            "name": `Group flight to ${cityOf(normalizeCode(bestDestination.destination)) || bestDestination.destination}`,
            "description": `Cheapest group flight destination from ${cleanOrigins.join(", ")}`,
            "result": {
              "@type": "Flight",
              "arrivalAirport": { "@type": "Airport", "iataCode": normalizeCode(bestDestination.destination) },
              "offers": { "@type": "Offer", "price": bestDestination.averageCostPerTraveler?.toFixed(2), "priceCurrency": "EUR" }
            }
          }) }} />

          {/* Visual tabs: Map & Compare */}
          {flights.length > 1 && (
            <div className="rv-tabs mt-4" ref={tabContentRef}>
              <button type="button"
                className={`rv-tab${showAlt === "map" ? " rv-tab--active" : ""}`}
                onClick={() => { setShowAlt(showAlt === "map" ? false : "map"); setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}>
                🗺 {t("results.showMap")}
              </button>
              <button type="button"
                className={`rv-tab${showAlt === "compare" ? " rv-tab--active" : ""}`}
                onClick={() => { setShowAlt(showAlt === "compare" ? false : "compare"); setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}>
                📊 {t("results.showCompare")}
              </button>
              <button type="button"
                className={`rv-tab${showAlt === "list" ? " rv-tab--active" : ""}`}
                onClick={() => { setShowAlt(showAlt === "list" ? false : "list"); setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}>
                📋 {t("results.otherOptions")} <span className="rv-tab-badge">{flights.length - 1}</span>
              </button>
              {flights.length >= 2 && (
                <button type="button"
                  className={`rv-tab${showAlt === "vs" ? " rv-tab--active" : ""}`}
                  onClick={() => { setShowAlt(showAlt === "vs" ? false : "vs"); setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}>
                  ⚡ {t("results.compareVs")}
                </button>
              )}
            </div>
          )}

          {showAlt === "map" && flights.length > 1 && (
            <div className="mt-3 view-enter">
              <ErrorBoundary renderingLabel={t("errors.rendering")} retryLabel={t("errors.retry")}>
                <Suspense fallback={<div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>}>
                  <DestinationMap flights={flights} bestDestination={bestDestination} origins={cleanOrigins} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}

          {showAlt === "compare" && flights.length > 1 && (
            <div className="mt-3 view-enter">
              <ErrorBoundary renderingLabel={t("errors.rendering")} retryLabel={t("errors.retry")}>
                <Suspense fallback={<div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>}>
                  <CompareChart flights={flights} bestDestination={bestDestination} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}

          {showAlt === "list" && flights.length > 1 && (
            <div className="mt-4">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h3 className="h5 fw-bold mb-0" style={{ color: "#111827" }}>{t("results.otherOptions")}</h3>
                <div className="d-flex align-items-center gap-2">
                  <span className="small" style={{ color: "#64748B" }}>{t("results.sortBy")}:</span>
                  <div className="sf-pills">
                    {[["default", "—"], ["price", t("results.sortPrice")], ["fairness", t("results.sortFairness")]].map(([v, l]) => (
                      <button key={v} type="button"
                        className={`sf-pill sf-pill--sm${sortMode === v ? " sf-pill--active" : ""}`}
                        onClick={() => setSortMode(v)}>{l}</button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowAlt(false)}>{t("results.hide")}</button>
                </div>
              </div>
              <ErrorBoundary renderingLabel={t("errors.rendering")} retryLabel={t("errors.retry")}>
                <FlightResults
                  flights={sortMode === "price" ? [...flights].sort((a, b) => a.totalCostEUR - b.totalCostEUR) : sortMode === "fairness" ? [...flights].sort((a, b) => (b.fairnessScore || 0) - (a.fairnessScore || 0)) : flights}
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

          {/* Side-by-side compare (VS) */}
          {showAlt === "vs" && flights.length >= 2 && (
            <VsCompare flights={flights} bestDestination={bestDestination} currency={currency} />
          )}
        </main>
      )}
      </div>{/* /main-content */}

      {/* Scroll to top */}
      <ScrollToTopBtn />

      {/* PWA Install banner */}
      {showInstallBanner && installPrompt && (
        <div className="pwa-banner">
          <div className="container d-flex align-items-center justify-content-between" style={{ maxWidth: 1080 }}>
            <span className="pwa-banner-text">
              <strong>FlyndMe</strong> — {t("pwa.installHint")}
            </span>
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-light fw-semibold" onClick={handleInstall}>
                {t("pwa.install")}
              </button>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowInstallBanner(false)}>✕</button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="container" style={{ maxWidth: 1080 }}>
          {t("footer")}
        </div>
      </footer>
    </div>
  );
}
