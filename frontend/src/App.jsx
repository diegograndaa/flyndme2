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
  formatEur, formatDate, weekdayOf, todayISO, buildSkyscannerUrl, buildGoogleFlightsUrl, copyText, fairnessColor,
  airportName, MULTI_AIRPORT, countryFlag, destQuickInfo
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
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 400);
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docH > 0 ? Math.min(1, window.scrollY / docH) : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  const r = 18, c = 2 * Math.PI * r;
  const offset = c * (1 - progress);

  return (
    <button
      type="button"
      className={`scroll-top-btn${visible ? " visible" : ""}`}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label={t("a11y.scrollToTop")}
      title={t("a11y.scrollToTop")}
    >
      <svg className="scroll-top-ring" viewBox="0 0 44 44" width="44" height="44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(0,0,0,.08)" strokeWidth="3" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--primary)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset .1s" }} />
      </svg>
      <span className="scroll-top-arrow">↑</span>
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

// ─── Price trend mini-sparkline ───────────────────────────────────────────────

function PriceSparkline({ flights }) {
  if (!flights || flights.length < 3) return null;
  const prices = flights.slice(0, 10).map(f => f.averageCostPerTraveler || 0).filter(Boolean);
  if (prices.length < 3) return null;
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const w = 80, h = 24, pad = 2;
  const points = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (p - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg className="fm-sparkline" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points.split(" ")[0].split(",")[0]} cy={points.split(" ")[0].split(",")[1]} r="2" fill="#22C55E" />
    </svg>
  );
}

// ─── Origin summary chips ────────────────────────────────────────────────────

function OriginSummaryChips({ origins, bestDestination, currency }) {
  if (!origins.length || !bestDestination) return null;
  const breakdown = Array.isArray(bestDestination.flights) ? bestDestination.flights : [];
  const priceMap = {};
  breakdown.forEach(f => { priceMap[String(f.origin).toUpperCase()] = f.price; });

  return (
    <div className="fm-origin-chips view-enter">
      {origins.map(o => {
        const price = priceMap[o];
        return (
          <div key={o} className="fm-origin-chip">
            <span className="fm-origin-chip-flag">{countryFlag(o)}</span>
            <span className="fm-origin-chip-code">{o}</span>
            {typeof price === "number" && (
              <span className="fm-origin-chip-price">{formatEur(price, 0)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Results skeleton ────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <div className="fm-results-skeleton view-enter">
      <div className="fm-skel-hero fm-skel-pulse" />
      <div className="fm-skel-row">
        <div className="fm-skel-box fm-skel-pulse" style={{ width: "30%", height: 20 }} />
        <div className="fm-skel-box fm-skel-pulse" style={{ width: "20%", height: 20 }} />
        <div className="fm-skel-box fm-skel-pulse" style={{ width: "25%", height: 20 }} />
      </div>
      {[1,2,3].map(i => (
        <div key={i} className="fm-skel-card fm-skel-pulse" style={{ animationDelay: `${i * .1}s` }} />
      ))}
    </div>
  );
}

// ─── Top 3 destinations podium ─────────────────────────────────────────────────

// ─── Airline logo helper ──────────────────────────────────────────────────────

const AIRLINE_LOGOS = {};
function airlineLogo(iata) {
  if (!iata || iata.length < 2) return null;
  return `https://images.kiwi.com/airlines/64/${iata}.png`;
}

// ─── Price confidence meter ──────────────────────────────────────────────────

function PriceConfidence({ breakdown, t }) {
  // Estimate confidence from data availability:
  // - all origins have prices → high
  // - has offer details (itineraries) → higher
  // - breakdown has duration → highest
  const total = breakdown.length;
  if (!total) return null;
  const withPrice = breakdown.filter(f => typeof f.price === "number").length;
  const withOffer = breakdown.filter(f => f.offer?.itineraries?.[0]).length;
  const pricePct = Math.round((withPrice / total) * 100);
  const offerPct = Math.round((withOffer / total) * 100);
  const confidence = Math.round((pricePct * 0.6) + (offerPct * 0.4));
  const level = confidence >= 85 ? "high" : confidence >= 55 ? "medium" : "low";
  const labels = { high: t("results.confidenceHigh"), medium: t("results.confidenceMedium"), low: t("results.confidenceLow") };

  return (
    <div className={`fm-confidence fm-confidence--${level}`}>
      <span className="fm-confidence-icon">{level === "high" ? "🟢" : level === "medium" ? "🟡" : "🔴"}</span>
      <span className="fm-confidence-label">{labels[level]}</span>
      <div className="fm-confidence-bar">
        <div className="fm-confidence-fill" style={{ width: `${confidence}%` }} />
      </div>
    </div>
  );
}

// ─── Per-origin savings card ─────────────────────────────────────────────────

function OriginSavingsCard({ bestDest, allFlights, origins, currency, t }) {
  if (!allFlights || allFlights.length < 2 || !bestDest?.flights?.length) return null;

  // For each origin, find what they'd pay at the most expensive destination vs this one
  const worstDest = [...allFlights].sort((a, b) => b.totalCostEUR - a.totalCostEUR)[0];
  if (!worstDest?.flights?.length) return null;

  const savings = origins.map(o => {
    const bestPrice = bestDest.flights.find(f => String(f.origin).toUpperCase() === o)?.price;
    const worstPrice = worstDest.flights.find(f => String(f.origin).toUpperCase() === o)?.price;
    if (typeof bestPrice !== "number" || typeof worstPrice !== "number") return null;
    return { origin: o, saved: worstPrice - bestPrice, bestPrice, worstPrice };
  }).filter(Boolean);

  if (!savings.length || savings.every(s => s.saved <= 0)) return null;
  const maxSaved = Math.max(...savings.map(s => s.saved));

  return (
    <div className="fm-origin-savings view-enter">
      <div className="fm-origin-savings-title">{t("results.savingsPerOrigin")}</div>
      <div className="fm-origin-savings-grid">
        {savings.map(s => (
          <div key={s.origin} className="fm-origin-savings-item">
            <span className="fm-origin-savings-code">{countryFlag(s.origin)} {s.origin}</span>
            <div className="fm-origin-savings-bar-wrap">
              <div className="fm-origin-savings-bar" style={{ width: `${maxSaved > 0 ? (s.saved / maxSaved) * 100 : 0}%` }} />
            </div>
            <span className="fm-origin-savings-amount">
              {s.saved > 0
                ? `−${currency === "EUR" ? formatEur(s.saved, 0) : convertPrice(s.saved, currency)}`
                : "—"}
            </span>
          </div>
        ))}
      </div>
      <div className="fm-origin-savings-note">{t("results.savingsVsWorst", { dest: destLabel(normalizeCode(worstDest.destination)) })}</div>
    </div>
  );
}

// ─── Cost split calculator ────────────────────────────────────────────────────

function CostSplitCard({ bestDest, origins, currency, t }) {
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
        <span className="fm-split-title">{t("results.splitTitle")}</span>
        <div className="fm-split-toggle">
          {[["equal", t("results.splitEqual")], ["actual", t("results.splitActual")]].map(([v, l]) => (
            <button key={v} type="button"
              className={`fm-split-pill${splitMode === v ? " fm-split-pill--active" : ""}`}
              onClick={() => setSplitMode(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="fm-split-grid">
        {diffs.map(d => (
          <div key={d.origin} className="fm-split-row">
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

// ─── Plan Your Trip CTA ──────────────────────────────────────────────────────

function PlanYourTripCTA({ destCode, departureDate, returnDate, t }) {
  if (!destCode) return null;
  const city = cityOf(destCode) || destCode;
  const checkin = departureDate || "";
  const checkout = returnDate || "";

  const bookingUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}&checkin=${checkin}&checkout=${checkout}`;
  const activitiesUrl = `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}`;
  const mapsUrl = `https://www.google.com/maps/place/${encodeURIComponent(city)}`;

  return (
    <div className="fm-plan-trip view-enter">
      <div className="fm-plan-trip-title">{t("results.planTripTitle")}</div>
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

// ─── Group Travel Checklist ──────────────────────────────────────────────────

function TravelChecklist({ destCode, tripType, t }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState({});

  const items = useMemo(() => {
    const base = [
      { id: "passport", icon: "🛂", label: t("checklist.passport") },
      { id: "insurance", icon: "🏥", label: t("checklist.insurance") },
      { id: "accommodation", icon: "🏨", label: t("checklist.accommodation") },
      { id: "transport", icon: "🚕", label: t("checklist.transport") },
      { id: "currency", icon: "💱", label: t("checklist.currency") },
      { id: "charger", icon: "🔌", label: t("checklist.charger") },
    ];
    if (tripType === "roundtrip") {
      base.push({ id: "return", icon: "🔙", label: t("checklist.returnConfirm") });
    }
    return base;
  }, [destCode, tripType, t]);

  const progress = items.length ? Math.round((Object.values(checked).filter(Boolean).length / items.length) * 100) : 0;

  return (
    <div className="fm-checklist view-enter">
      <button type="button" className="fm-checklist-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="fm-checklist-toggle-left">
          <span className="fm-checklist-icon">📋</span>
          <span className="fm-checklist-title">{t("checklist.title")}</span>
        </span>
        <span className="fm-checklist-progress">
          <span className="fm-checklist-pct">{progress}%</span>
          <span className={`fm-checklist-chevron${open ? " fm-checklist-chevron--open" : ""}`}>▾</span>
        </span>
      </button>
      {open && (
        <div className="fm-checklist-body">
          {items.map(item => (
            <label key={item.id} className={`fm-checklist-item${checked[item.id] ? " fm-checklist-item--done" : ""}`}>
              <input
                type="checkbox"
                className="fm-checklist-check"
                checked={!!checked[item.id]}
                onChange={() => setChecked(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
              />
              <span className="fm-checklist-item-icon">{item.icon}</span>
              <span className="fm-checklist-item-label">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Destination Radar Chart (SVG) ───────────────────────────────────────────

function DestRadarChart({ flights, bestDest, t }) {
  if (!flights || flights.length < 2 || !bestDest) return null;

  // Compare top 2 destinations on 4 axes: price, fairness, distance, stops
  const sorted = [...flights].sort((a, b) => a.totalCostEUR - b.totalCostEUR);
  const d1 = sorted[0];
  const d2 = sorted[1];
  if (!d1 || !d2) return null;

  const axes = [
    { key: "price", label: t("radar.price") },
    { key: "fairness", label: t("radar.fairness") },
    { key: "destinations", label: t("radar.popularity") },
    { key: "value", label: t("radar.value") },
  ];

  // Normalize values to 0-1 scale
  const maxPrice = Math.max(d1.averageCostPerTraveler || 1, d2.averageCostPerTraveler || 1);
  const normalize = (dest) => [
    1 - ((dest.averageCostPerTraveler || 0) / maxPrice), // price: lower = better
    (dest.fairnessScore || 0) / 100,
    Math.min(1, (dest.flights?.length || 0) / 6), // how many origins have coverage
    dest.fairnessScore > 70 && dest.averageCostPerTraveler < maxPrice * 0.8 ? 0.9 : 0.5,
  ];

  const v1 = normalize(d1);
  const v2 = normalize(d2);

  const cx = 80, cy = 80, r = 60;
  const angleStep = (2 * Math.PI) / axes.length;

  const toPoints = (vals) => vals.map((v, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    return [cx + r * v * Math.cos(angle), cy + r * v * Math.sin(angle)];
  });

  const p1 = toPoints(v1);
  const p2 = toPoints(v2);
  const axisEnds = axes.map((_, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
  const labelPos = axes.map((_, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    return [cx + (r + 18) * Math.cos(angle), cy + (r + 18) * Math.sin(angle)];
  });

  return (
    <div className="fm-radar view-enter">
      <div className="fm-radar-title">{t("radar.title")}</div>
      <div className="fm-radar-content">
        <svg viewBox="0 0 160 160" width="160" height="160" className="fm-radar-svg">
          {/* Grid circles */}
          {[0.33, 0.66, 1].map(s => (
            <circle key={s} cx={cx} cy={cy} r={r * s} fill="none" stroke="var(--slate-200)" strokeWidth=".5" />
          ))}
          {/* Axis lines */}
          {axisEnds.map((e, i) => (
            <line key={i} x1={cx} y1={cy} x2={e[0]} y2={e[1]} stroke="var(--slate-200)" strokeWidth=".5" />
          ))}
          {/* Area 1 (winner) */}
          <polygon points={p1.map(p => p.join(",")).join(" ")} fill="rgba(59,130,246,.15)" stroke="#3B82F6" strokeWidth="1.5" />
          {/* Area 2 (runner-up) */}
          <polygon points={p2.map(p => p.join(",")).join(" ")} fill="rgba(234,88,12,.1)" stroke="#EA580C" strokeWidth="1" strokeDasharray="3,2" />
          {/* Axis labels */}
          {labelPos.map((lp, i) => (
            <text key={i} x={lp[0]} y={lp[1]} textAnchor="middle" dominantBaseline="middle"
              fontSize="7" fill="var(--slate-500)" fontWeight="600">{axes[i].label}</text>
          ))}
        </svg>
        <div className="fm-radar-legend">
          <span className="fm-radar-legend-item">
            <span className="fm-radar-dot" style={{ background: "#3B82F6" }} />
            {cityOf(normalizeCode(d1.destination)) || d1.destination}
          </span>
          <span className="fm-radar-legend-item">
            <span className="fm-radar-dot" style={{ background: "#EA580C" }} />
            {cityOf(normalizeCode(d2.destination)) || d2.destination}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Flight Timeline (visual per-origin departure/arrival) ─────────────────

function FlightTimeline({ bestDest, origins, t }) {
  if (!bestDest?.flights?.length) return null;
  const legs = bestDest.flights.map(f => {
    const origin = String(f.origin).toUpperCase();
    const itin = f.offer?.itineraries?.[0];
    if (!itin?.segments?.length) return null;
    const firstSeg = itin.segments[0];
    const lastSeg = itin.segments[itin.segments.length - 1];
    const depTime = firstSeg.departure?.at ? new Date(firstSeg.departure.at) : null;
    const arrTime = lastSeg.arrival?.at ? new Date(lastSeg.arrival.at) : null;
    if (!depTime || !arrTime) return null;
    const durationMin = Math.round((arrTime - depTime) / 60000);
    const hours = Math.floor(durationMin / 60);
    const mins = durationMin % 60;
    const airline = firstSeg.carrierCode || "";
    const stops = itin.segments.length - 1;
    return { origin, depTime, arrTime, durationMin, hours, mins, airline, stops };
  }).filter(Boolean);

  if (!legs.length) return null;

  // Find earliest dep and latest arr to compute time span
  const earliestDep = Math.min(...legs.map(l => l.depTime.getTime()));
  const latestArr = Math.max(...legs.map(l => l.arrTime.getTime()));
  const totalSpan = latestArr - earliestDep || 1;

  const fmtTime = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="fm-timeline view-enter">
      <div className="fm-timeline-title">{t("results.timelineTitle")}</div>
      <div className="fm-timeline-grid">
        {legs.map(leg => {
          const leftPct = ((leg.depTime.getTime() - earliestDep) / totalSpan) * 100;
          const widthPct = ((leg.arrTime.getTime() - leg.depTime.getTime()) / totalSpan) * 100;
          return (
            <div key={leg.origin} className="fm-timeline-row">
              <span className="fm-timeline-origin">{countryFlag(leg.origin)} {leg.origin}</span>
              <div className="fm-timeline-track">
                <div className="fm-timeline-bar"
                  style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 4)}%` }}
                  title={`${fmtTime(leg.depTime)} → ${fmtTime(leg.arrTime)}`}>
                  <span className="fm-timeline-bar-label">
                    {leg.hours}h{leg.mins > 0 ? `${leg.mins}m` : ""}
                    {leg.stops > 0 ? ` · ${leg.stops} stop${leg.stops > 1 ? "s" : ""}` : ""}
                  </span>
                </div>
              </div>
              <span className="fm-timeline-times">
                <span className="fm-timeline-dep">{fmtTime(leg.depTime)}</span>
                <span className="fm-timeline-arr">{fmtTime(leg.arrTime)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Search History Panel ─────────────────────────────────────────────────

function SearchHistoryPanel({ searches, onLoad, onClear, t }) {
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

// ─── Destination Weather Hint (seasonal) ──────────────────────────────────

function DestWeatherBadge({ destCode, departureDate, t }) {
  const hint = getWeatherHint(destCode, departureDate, t);
  if (!hint) return null;
  return (
    <div className="fm-weather-badge view-enter">
      <span className="fm-weather-badge-text">{hint}</span>
    </div>
  );
}

// ─── Reduced Motion + High Contrast accessibility hook ────────────────────

function useA11yPrefs() {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  });
  const [highContrast, setHighContrast] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-contrast: more)")?.matches || false;
  });

  useEffect(() => {
    const mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqContrast = window.matchMedia("(prefers-contrast: more)");
    const hMotion = (e) => setReducedMotion(e.matches);
    const hContrast = (e) => setHighContrast(e.matches);
    mqMotion.addEventListener("change", hMotion);
    mqContrast.addEventListener("change", hContrast);
    return () => {
      mqMotion.removeEventListener("change", hMotion);
      mqContrast.removeEventListener("change", hContrast);
    };
  }, []);

  return { reducedMotion, highContrast };
}

// ─── Results Summary Card (compact printable overview) ────────────────────

function ResultsSummaryCard({ bestDest, origins, flights, currency, departureDate, returnDate, tripType, t }) {
  if (!bestDest) return null;
  const destCode = normalizeCode(bestDest.destination);
  const city = cityOf(destCode) || destCode;
  const total = bestDest.totalCostEUR || 0;
  const avg = bestDest.averageCostPerTraveler || 0;
  const fairness = bestDest.fairnessScore ?? 0;
  const analyzed = flights?.length || 0;

  return (
    <div className="fm-summary-card view-enter">
      <div className="fm-summary-card-header">
        <span className="fm-summary-card-dest">{city}</span>
        <span className="fm-summary-card-code">{destCode}</span>
      </div>
      <div className="fm-summary-card-grid">
        <div className="fm-summary-card-stat">
          <span className="fm-summary-card-stat-label">{t("results.groupTotal")}</span>
          <span className="fm-summary-card-stat-value">{currency === "EUR" ? formatEur(total, 0) : convertPrice(total, currency)}</span>
        </div>
        <div className="fm-summary-card-stat">
          <span className="fm-summary-card-stat-label">{t("results.avgPerPerson")}</span>
          <span className="fm-summary-card-stat-value">{currency === "EUR" ? formatEur(avg, 0) : convertPrice(avg, currency)}</span>
        </div>
        <div className="fm-summary-card-stat">
          <span className="fm-summary-card-stat-label">{t("results.fairnessLabel")}</span>
          <span className="fm-summary-card-stat-value" style={{ color: fairnessColor(fairness) }}>{fairness.toFixed(0)}/100</span>
        </div>
        <div className="fm-summary-card-stat">
          <span className="fm-summary-card-stat-label">{t("results.destsAnalyzed")}</span>
          <span className="fm-summary-card-stat-value">{analyzed}</span>
        </div>
      </div>
      <div className="fm-summary-card-origins">
        {origins.map(o => <span key={o} className="fm-summary-card-origin">{countryFlag(o)} {o}</span>)}
      </div>
      {departureDate && (
        <div className="fm-summary-card-dates">
          {departureDate}{tripType === "roundtrip" && returnDate ? ` → ${returnDate}` : ""}
        </div>
      )}
    </div>
  );
}

// ─── Trip Countdown (live departure timer) ────────────────────────────────

function TripCountdown({ departureDate, t }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  if (!departureDate) return null;
  const dep = new Date(departureDate + "T00:00:00").getTime();
  const diff = dep - now;
  if (diff <= 0) return (
    <div className="fm-countdown fm-countdown--today view-enter">
      <span className="fm-countdown-icon">🛫</span>
      <span className="fm-countdown-text">{t("results.countdownToday")}</span>
    </div>
  );

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  let urgency = "relaxed";
  if (days <= 1) urgency = "urgent";
  else if (days <= 7) urgency = "soon";
  else if (days <= 30) urgency = "coming";

  return (
    <div className={`fm-countdown fm-countdown--${urgency} view-enter`}>
      <span className="fm-countdown-icon">{urgency === "urgent" ? "⏰" : urgency === "soon" ? "📆" : "✈️"}</span>
      <div className="fm-countdown-digits">
        {days > 0 && <span className="fm-countdown-unit"><strong>{days}</strong>{t("countdown.days")}</span>}
        <span className="fm-countdown-unit"><strong>{hours}</strong>{t("countdown.hours")}</span>
        <span className="fm-countdown-unit"><strong>{mins}</strong>{t("countdown.mins")}</span>
      </div>
      <span className="fm-countdown-label">{t("countdown.until")}</span>
    </div>
  );
}

// ─── CO2 Estimate Badge ───────────────────────────────────────────────────

function CO2EstimateBadge({ bestDest, origins, t }) {
  if (!bestDest || !origins.length) return null;
  const destCode = normalizeCode(bestDest.destination);

  // Average CO2: ~90g per km per passenger (economy class average)
  const CO2_PER_KM_G = 90;
  let totalKm = 0, count = 0;
  origins.forEach(o => {
    const km = approxDistKm(o, destCode);
    if (km) { totalKm += km; count++; }
  });
  if (!count) return null;

  const avgKm = totalKm / count;
  const co2PerPerson = Math.round((avgKm * CO2_PER_KM_G) / 1000); // kg
  const totalCO2 = co2PerPerson * origins.length;

  // Compare: 1 tree absorbs ~22kg CO2/year
  const treesEquiv = Math.max(1, Math.round(totalCO2 / 22));

  let level = "low";
  if (co2PerPerson > 200) level = "high";
  else if (co2PerPerson > 100) level = "medium";

  return (
    <div className={`fm-co2 fm-co2--${level} view-enter`}>
      <span className="fm-co2-icon">🌱</span>
      <div className="fm-co2-text">
        <span className="fm-co2-main">
          ~{co2PerPerson} kg CO₂/{t("co2.perPerson")} · {totalCO2} kg {t("co2.groupTotal")}
        </span>
        <span className="fm-co2-equiv">
          ≈ {treesEquiv} {treesEquiv === 1 ? t("co2.tree") : t("co2.trees")} {t("co2.toOffset")}
        </span>
      </div>
    </div>
  );
}

// ─── Destination Popularity Meter ─────────────────────────────────────────

function DestPopularityMeter({ flights, bestDest, t }) {
  if (!flights || flights.length < 2 || !bestDest) return null;

  const destCode = normalizeCode(bestDest.destination);
  const coverage = bestDest.flights?.length || 0;
  const maxCoverage = Math.max(...flights.map(f => f.flights?.length || 0));
  const totalDests = flights.length;

  // Rank of this destination by total cost
  const sorted = [...flights].sort((a, b) => a.totalCostEUR - b.totalCostEUR);
  const rank = sorted.findIndex(f => normalizeCode(f.destination) === destCode) + 1;

  const coveragePct = maxCoverage > 0 ? Math.round((coverage / maxCoverage) * 100) : 0;

  return (
    <div className="fm-popularity view-enter">
      <div className="fm-popularity-title">{t("popularity.title")}</div>
      <div className="fm-popularity-stats">
        <div className="fm-popularity-stat">
          <span className="fm-popularity-stat-value">#{rank}</span>
          <span className="fm-popularity-stat-label">{t("popularity.rank", { total: totalDests })}</span>
        </div>
        <div className="fm-popularity-stat">
          <span className="fm-popularity-stat-value">{coverage}/{maxCoverage}</span>
          <span className="fm-popularity-stat-label">{t("popularity.routes")}</span>
        </div>
        <div className="fm-popularity-stat">
          <div className="fm-popularity-bar-wrap">
            <div className="fm-popularity-bar" style={{ width: `${coveragePct}%` }} />
          </div>
          <span className="fm-popularity-stat-label">{t("popularity.coverage")} {coveragePct}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Group Chat Link generator ────────────────────────────────────────────

function GroupChatLink({ bestDest, origins, departureDate, returnDate, tripType, currency, t }) {
  const [copied, setCopied] = useState(false);
  if (!bestDest) return null;

  const destCode = normalizeCode(bestDest.destination);
  const city = cityOf(destCode) || destCode;
  const total = bestDest.totalCostEUR || 0;
  const avg = bestDest.averageCostPerTraveler || 0;
  const fmtPrice = (v) => currency === "EUR" ? `€${Math.round(v)}` : convertPrice(v, currency);

  const buildMessage = () => {
    const lines = [
      `✈️ FlyndMe — ${t("groupChat.header")}`,
      "",
      `📍 ${t("groupChat.destination")}: ${city} (${destCode})`,
      `📅 ${departureDate}${tripType === "roundtrip" && returnDate ? ` → ${returnDate}` : ""}`,
      `💰 ${t("results.groupTotal")}: ${fmtPrice(total)}`,
      `👤 ${t("results.avgPerPerson")}: ${fmtPrice(avg)}`,
      "",
      `${t("groupChat.origins")}:`,
    ];

    (bestDest.flights || []).forEach(f => {
      const o = String(f.origin).toUpperCase();
      const price = typeof f.price === "number" ? fmtPrice(f.price) : "—";
      lines.push(`  ${countryFlag(o)} ${o} → ${price}`);
    });

    lines.push("", `🔗 flyndme.com`, "");
    return lines.join("\n");
  };

  const handleCopy = async () => {
    const msg = buildMessage();
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  };

  const handleWhatsApp = () => {
    const msg = buildMessage();
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleTelegram = () => {
    const msg = buildMessage();
    window.open(`https://t.me/share/url?url=${encodeURIComponent("https://flyndme.com")}&text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div className="fm-groupchat view-enter">
      <div className="fm-groupchat-title">{t("groupChat.title")}</div>
      <div className="fm-groupchat-sub">{t("groupChat.sub")}</div>
      <div className="fm-groupchat-actions">
        <button type="button" className="fm-groupchat-btn fm-groupchat-btn--wa" onClick={handleWhatsApp}>
          <span>💬</span> WhatsApp
        </button>
        <button type="button" className="fm-groupchat-btn fm-groupchat-btn--tg" onClick={handleTelegram}>
          <span>✈️</span> Telegram
        </button>
        <button type="button" className="fm-groupchat-btn fm-groupchat-btn--copy" onClick={handleCopy}>
          <span>{copied ? "✅" : "📋"}</span> {copied ? t("results.copied") : t("groupChat.copy")}
        </button>
      </div>
    </div>
  );
}

// ─── Baggage Reminder ─────────────────────────────────────────────────────

function BaggageReminder({ bestDest, t }) {
  if (!bestDest?.flights?.length) return null;

  // Detect budget airlines from carrier codes
  const BUDGET_CARRIERS = new Set([
    "FR", "W6", "U2", "VY", "NK", "F9", "TP", "DY", "HV", "LS",
    "QS", "PC", "XR", "TO", "BJ", "ZB", "EW"
  ]);

  const budgetLegs = bestDest.flights.filter(f => {
    const itin = f.offer?.itineraries?.[0];
    if (!itin?.segments?.length) return false;
    return itin.segments.some(s => BUDGET_CARRIERS.has(s.carrierCode));
  });

  if (!budgetLegs.length) return null;

  const carriers = [...new Set(budgetLegs.flatMap(f => {
    const itin = f.offer?.itineraries?.[0];
    return (itin?.segments || []).filter(s => BUDGET_CARRIERS.has(s.carrierCode)).map(s => s.carrierCode);
  }))];

  return (
    <div className="fm-baggage view-enter">
      <span className="fm-baggage-icon">🧳</span>
      <div className="fm-baggage-text">
        <span className="fm-baggage-title">{t("baggage.title")}</span>
        <span className="fm-baggage-sub">
          {t("baggage.hint", { airlines: carriers.join(", ") })}
        </span>
      </div>
    </div>
  );
}

// ─── Origin Ranking Table ─────────────────────────────────────────────────

function OriginRankingTable({ bestDest, currency, t }) {
  const [sortBy, setSortBy] = useState("price"); // price | origin
  if (!bestDest?.flights?.length || bestDest.flights.length < 2) return null;

  const rows = bestDest.flights.map(f => ({
    origin: String(f.origin).toUpperCase(),
    price: f.price || 0,
    airline: f.offer?.itineraries?.[0]?.segments?.[0]?.carrierCode || "—",
    stops: f.offer?.itineraries?.[0]?.segments ? f.offer.itineraries[0].segments.length - 1 : 0,
  }));

  const sorted = [...rows].sort((a, b) => sortBy === "price" ? a.price - b.price : a.origin.localeCompare(b.origin));
  const cheapest = Math.min(...rows.map(r => r.price));
  const priciest = Math.max(...rows.map(r => r.price));

  return (
    <div className="fm-origin-table view-enter">
      <div className="fm-origin-table-header">
        <span className="fm-origin-table-title">{t("originTable.title")}</span>
        <div className="fm-origin-table-sort">
          {[["price", t("originTable.byPrice")], ["origin", t("originTable.byOrigin")]].map(([v, l]) => (
            <button key={v} type="button"
              className={`fm-origin-table-pill${sortBy === v ? " fm-origin-table-pill--active" : ""}`}
              onClick={() => setSortBy(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="fm-origin-table-rows">
        {sorted.map((r, i) => (
          <div key={r.origin} className={`fm-origin-table-row${r.price === cheapest ? " fm-origin-table-row--best" : r.price === priciest ? " fm-origin-table-row--worst" : ""}`}>
            <span className="fm-origin-table-pos">{i + 1}</span>
            <span className="fm-origin-table-flag">{countryFlag(r.origin)}</span>
            <span className="fm-origin-table-code">{r.origin}</span>
            <span className="fm-origin-table-airline">{r.airline}</span>
            <span className="fm-origin-table-stops">
              {r.stops === 0 ? t("results.direct") : `${r.stops}✈`}
            </span>
            <span className="fm-origin-table-price">
              {currency === "EUR" ? formatEur(r.price, 0) : convertPrice(r.price, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Trip Type Insight ────────────────────────────────────────────────────

function TripTypeInsight({ tripType, bestDest, departureDate, t }) {
  if (!bestDest || tripType !== "roundtrip") return null;

  const avg = bestDest.averageCostPerTraveler || 0;
  if (avg <= 0) return null;

  // Estimate: one-way is typically 60-75% of round trip price
  // So 2 one-ways ≈ 120-150% of round trip
  const estTwoOneWays = avg * 1.35;
  const savingPct = Math.round(((estTwoOneWays - avg) / estTwoOneWays) * 100);

  if (savingPct < 5) return null;

  return (
    <div className="fm-triptype-insight view-enter">
      <span className="fm-triptype-insight-icon">💡</span>
      <span className="fm-triptype-insight-text">
        {t("tripInsight.roundtripSaving", { pct: savingPct })}
      </span>
    </div>
  );
}

// ─── Destination Image Banner ─────────────────────────────────────────────

function DestImageBanner({ destCode }) {
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

// ─── Alternative Dates Hint (Round 29) ────────────────────────────────────

function AlternativeDatesHint({ departureDate, t }) {
  if (!departureDate) return null;
  const d = new Date(departureDate + "T00:00:00");
  const dow = d.getDay(); // 0=Sun … 6=Sat
  // Flights on Tue/Wed tend to be cheapest; Fri/Sun most expensive
  const CHEAP_DAYS = new Set([2, 3]); // Tue, Wed
  const EXPENSIVE_DAYS = new Set([0, 5]); // Sun, Fri
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (CHEAP_DAYS.has(dow)) return null; // already a cheap day

  // Suggest nearest cheap day
  const nearestCheap = [2, 3].map(cd => {
    const diff = cd - dow;
    return diff >= -3 ? diff : diff + 7;
  }).sort((a, b) => Math.abs(a) - Math.abs(b))[0];

  const suggestedDate = new Date(d);
  suggestedDate.setDate(suggestedDate.getDate() + nearestCheap);
  const sugDay = dayNames[suggestedDate.getDay()];
  const saving = EXPENSIVE_DAYS.has(dow) ? "15-25%" : "5-15%";

  return (
    <div className="fm-altdates view-enter">
      <span className="fm-altdates-icon">📅</span>
      <div className="fm-altdates-body">
        <span className="fm-altdates-title">{t("altDates.title")}</span>
        <span className="fm-altdates-text">
          {t("altDates.hint").replace("{{day}}", sugDay).replace("{{saving}}", saving)}
        </span>
      </div>
    </div>
  );
}

// ─── Flight Duration Comparison (Round 29) ────────────────────────────────

function FlightDurationComparison({ bestDest, t }) {
  if (!bestDest?.flights) return null;

  const entries = Object.entries(bestDest.flights).map(([origin, data]) => {
    const offer = data?.offer || data;
    const segs = offer?.itineraries?.[0]?.segments || [];
    if (!segs.length) return null;
    const dep = new Date(segs[0].departure?.at);
    const arr = new Date(segs[segs.length - 1].arrival?.at);
    const totalMin = Math.round((arr - dep) / 60000);
    const flyMin = segs.reduce((s, seg) => {
      const sd = new Date(seg.departure?.at);
      const sa = new Date(seg.arrival?.at);
      return s + Math.round((sa - sd) / 60000);
    }, 0);
    const layoverMin = Math.max(0, totalMin - flyMin);
    return { origin: normalizeCode(origin), totalMin, flyMin, layoverMin };
  }).filter(Boolean);

  if (entries.length < 2) return null;

  const maxMin = Math.max(...entries.map(e => e.totalMin));

  return (
    <div className="fm-duration view-enter">
      <h4 className="fm-duration-title">{t("duration.title")}</h4>
      <div className="fm-duration-bars">
        {entries.map(e => {
          const flyPct = maxMin > 0 ? (e.flyMin / maxMin) * 100 : 0;
          const layPct = maxMin > 0 ? (e.layoverMin / maxMin) * 100 : 0;
          const hrs = Math.floor(e.totalMin / 60);
          const mins = e.totalMin % 60;
          return (
            <div key={e.origin} className="fm-duration-row">
              <span className="fm-duration-origin">{countryFlag(e.origin)} {e.origin}</span>
              <div className="fm-duration-barwrap">
                <div className="fm-duration-fly" style={{ width: `${flyPct}%` }} />
                {e.layoverMin > 0 && (
                  <div className="fm-duration-lay" style={{ width: `${layPct}%` }} />
                )}
              </div>
              <span className="fm-duration-label">{hrs}h {mins > 0 ? `${mins}m` : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="fm-duration-legend">
        <span className="fm-duration-legend-item"><span className="fm-duration-dot fm-duration-dot--fly" /> {t("duration.flying")}</span>
        <span className="fm-duration-legend-item"><span className="fm-duration-dot fm-duration-dot--lay" /> {t("duration.layover")}</span>
      </div>
    </div>
  );
}

// ─── Destination Currency Converter (Round 29) ───────────────────────────

const DEST_CURRENCIES = {
  GB: { code: "GBP", symbol: "£", rate: 0.86 },
  US: { code: "USD", symbol: "$", rate: 1.09 },
  CH: { code: "CHF", symbol: "CHF", rate: 0.96 },
  CZ: { code: "CZK", symbol: "Kč", rate: 25.2 },
  PL: { code: "PLN", symbol: "zł", rate: 4.32 },
  HU: { code: "HUF", symbol: "Ft", rate: 395 },
  SE: { code: "SEK", symbol: "kr", rate: 11.3 },
  DK: { code: "DKK", symbol: "kr", rate: 7.46 },
  NO: { code: "NOK", symbol: "kr", rate: 11.6 },
  RO: { code: "RON", symbol: "lei", rate: 4.97 },
  BG: { code: "BGN", symbol: "лв", rate: 1.96 },
  HR: { code: "EUR", symbol: "€", rate: 1 },
  TR: { code: "TRY", symbol: "₺", rate: 35.2 },
  MA: { code: "MAD", symbol: "MAD", rate: 10.8 },
  // Eurozone countries get EUR by default
};

function DestCurrencyConverter({ destCode, t }) {
  const [eurVal, setEurVal] = useState("50");
  const info = destQuickInfo(destCode);
  const countryCode = info?.country || "";
  const destCurr = DEST_CURRENCIES[countryCode];

  // Skip if destination uses EUR
  if (!destCurr || destCurr.code === "EUR") return null;

  const numEur = parseFloat(eurVal) || 0;
  const converted = (numEur * destCurr.rate).toFixed(destCurr.rate > 50 ? 0 : 2);

  return (
    <div className="fm-fxcalc view-enter">
      <h4 className="fm-fxcalc-title">💱 {t("fxCalc.title")}</h4>
      <div className="fm-fxcalc-row">
        <div className="fm-fxcalc-input-wrap">
          <span className="fm-fxcalc-symbol">€</span>
          <input
            type="number"
            className="fm-fxcalc-input"
            value={eurVal}
            onChange={e => setEurVal(e.target.value)}
            min="0"
            step="10"
          />
        </div>
        <span className="fm-fxcalc-arrow">→</span>
        <div className="fm-fxcalc-result">
          <span className="fm-fxcalc-converted">{destCurr.symbol} {converted}</span>
          <span className="fm-fxcalc-code">{destCurr.code}</span>
        </div>
      </div>
      <span className="fm-fxcalc-note">{t("fxCalc.note")}</span>
    </div>
  );
}

// ─── Booking Window Tip (Round 29) ────────────────────────────────────────

function BookingWindowTip({ departureDate, t }) {
  if (!departureDate) return null;
  const now = new Date();
  const dep = new Date(departureDate + "T00:00:00");
  const daysAway = Math.round((dep - now) / 86400000);

  if (daysAway < 0) return null;

  let level, icon, msgKey;
  if (daysAway <= 3) {
    level = "urgent"; icon = "🔴"; msgKey = "bookWindow.lastMinute";
  } else if (daysAway <= 14) {
    level = "soon"; icon = "🟠"; msgKey = "bookWindow.soon";
  } else if (daysAway <= 45) {
    level = "good"; icon = "🟢"; msgKey = "bookWindow.ideal";
  } else if (daysAway <= 120) {
    level = "early"; icon = "🟢"; msgKey = "bookWindow.early";
  } else {
    level = "veryearly"; icon = "🔵"; msgKey = "bookWindow.veryEarly";
  }

  return (
    <div className={`fm-bookwin fm-bookwin--${level} view-enter`}>
      <span className="fm-bookwin-icon">{icon}</span>
      <div className="fm-bookwin-body">
        <span className="fm-bookwin-title">{t("bookWindow.title")}</span>
        <span className="fm-bookwin-text">
          {t(msgKey).replace("{{days}}", daysAway)}
        </span>
      </div>
    </div>
  );
}

// ─── Results Share Link (Round 29) ────────────────────────────────────────

function ResultsShareLink({ origins, departureDate, returnDate, tripType, t }) {
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

// ─── Stopover Info (Round 30) ─────────────────────────────────────────────

function StopoverInfo({ bestDest, t }) {
  if (!bestDest?.flights) return null;
  const entries = Object.entries(bestDest.flights).map(([origin, data]) => {
    const offer = data?.offer || data;
    const segs = offer?.itineraries?.[0]?.segments || [];
    const stops = Math.max(0, segs.length - 1);
    return { origin: normalizeCode(origin), stops };
  }).filter(Boolean);

  if (!entries.length) return null;
  const allDirect = entries.every(e => e.stops === 0);

  return (
    <div className="fm-stopover view-enter">
      <h4 className="fm-stopover-title">✈️ {t("stopover.title")}</h4>
      {allDirect && <span className="fm-stopover-alldirect">{t("stopover.allDirect")}</span>}
      <div className="fm-stopover-list">
        {entries.map(e => (
          <div key={e.origin} className="fm-stopover-row">
            <span className="fm-stopover-origin">{countryFlag(e.origin)} {e.origin}</span>
            <span className={`fm-stopover-badge fm-stopover-badge--${e.stops === 0 ? "direct" : e.stops === 1 ? "one" : "multi"}`}>
              {e.stops === 0 ? t("stopover.direct") : e.stops === 1 ? t("stopover.oneStop") : `${e.stops} ${t("stopover.stops")}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Airline Logos (Round 30) ─────────────────────────────────────────────

function AirlineLogos({ bestDest, t }) {
  if (!bestDest?.flights) return null;
  const airlinesSet = new Set();
  Object.values(bestDest.flights).forEach(data => {
    const offer = data?.offer || data;
    const segs = offer?.itineraries?.[0]?.segments || [];
    segs.forEach(seg => {
      const code = seg.carrierCode || seg.operating?.carrierCode;
      if (code) airlinesSet.add(code);
    });
  });
  const airlines = [...airlinesSet];
  if (!airlines.length) return null;

  return (
    <div className="fm-airlines view-enter">
      <span className="fm-airlines-label">{t("airlines.label")}</span>
      <div className="fm-airlines-logos">
        {airlines.map(code => (
          <div key={code} className="fm-airlines-chip">
            <img
              src={`https://images.kiwi.com/airlines/64/${code}.png`}
              alt={code}
              className="fm-airlines-img"
              onError={e => { e.target.style.display = "none"; }}
              loading="lazy"
            />
            <span className="fm-airlines-code">{code}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Price History Hint (Round 30) ────────────────────────────────────────

function PriceHistoryHint({ departureDate, bestDest, t }) {
  if (!departureDate || !bestDest) return null;
  const now = new Date();
  const dep = new Date(departureDate + "T00:00:00");
  const daysAway = Math.round((dep - now) / 86400000);
  if (daysAway < 0) return null;

  const avgPP = bestDest.averageCostPerTraveler || 0;
  let trend, icon, msgKey;
  if (daysAway <= 7) {
    trend = "rising"; icon = "📈"; msgKey = "priceHint.rising";
  } else if (daysAway <= 21 && avgPP < 80) {
    trend = "stable"; icon = "➡️"; msgKey = "priceHint.stable";
  } else if (daysAway <= 21) {
    trend = "rising"; icon = "📈"; msgKey = "priceHint.risingModerate";
  } else if (daysAway <= 60) {
    trend = "stable"; icon = "➡️"; msgKey = "priceHint.goodWindow";
  } else {
    trend = "may-drop"; icon = "📉"; msgKey = "priceHint.mayDrop";
  }

  return (
    <div className={`fm-pricehint fm-pricehint--${trend} view-enter`}>
      <span className="fm-pricehint-icon">{icon}</span>
      <span className="fm-pricehint-text">{t(msgKey)}</span>
    </div>
  );
}

// ─── Group Budget Gauge (Round 30) ────────────────────────────────────────

function GroupBudgetGauge({ bestDest, origins, budgetEnabled, maxBudget, currency, t }) {
  if (!budgetEnabled || !maxBudget || !bestDest) return null;
  const totalBudget = maxBudget * (origins?.length || 1);
  const totalCost = bestDest.totalCostEUR || 0;
  const pct = Math.min(100, (totalCost / totalBudget) * 100);
  const remaining = Math.max(0, totalBudget - totalCost);

  let color;
  if (pct <= 60) color = "#22c55e";
  else if (pct <= 85) color = "#f59e0b";
  else color = "#ef4444";

  return (
    <div className="fm-budgetgauge view-enter">
      <h4 className="fm-budgetgauge-title">💰 {t("budgetGauge.title")}</h4>
      <div className="fm-budgetgauge-track">
        <div className="fm-budgetgauge-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="fm-budgetgauge-info">
        <span>{convertPrice(totalCost, currency)} / {convertPrice(totalBudget, currency)}</span>
        <span className="fm-budgetgauge-remaining">
          {t("budgetGauge.remaining").replace("{{amount}}", convertPrice(remaining, currency))}
        </span>
      </div>
    </div>
  );
}

// ─── Destination Visa Hint (Round 30) ─────────────────────────────────────

const SCHENGEN = new Set(["AT","BE","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IT","LV","LT","LU","MT","NL","NO","PL","PT","SK","SI","ES","SE","CH","LI","HR"]);
const EU_EEA = new Set([...SCHENGEN, "IE","BG","RO","CY"]);

function DestVisaHint({ destCode, t }) {
  const info = destQuickInfo(destCode);
  const cc = info?.country;
  if (!cc) return null;

  let msgKey, level;
  if (SCHENGEN.has(cc)) {
    msgKey = "visa.schengen"; level = "ok";
  } else if (EU_EEA.has(cc)) {
    msgKey = "visa.euEea"; level = "ok";
  } else if (cc === "GB") {
    msgKey = "visa.uk"; level = "check";
  } else if (cc === "TR") {
    msgKey = "visa.turkey"; level = "check";
  } else if (cc === "MA") {
    msgKey = "visa.morocco"; level = "check";
  } else {
    msgKey = "visa.other"; level = "check";
  }

  return (
    <div className={`fm-visa fm-visa--${level} view-enter`}>
      <span className="fm-visa-icon">{level === "ok" ? "✅" : "⚠️"}</span>
      <span className="fm-visa-text">{t(msgKey)}</span>
    </div>
  );
}

// ─── Return Flight Preview (Round 31) ─────────────────────────────────────

function ReturnFlightPreview({ bestDest, tripType, t }) {
  if (tripType !== "roundtrip" || !bestDest?.flights) return null;

  const entries = Object.entries(bestDest.flights).map(([origin, data]) => {
    const offer = data?.offer || data;
    const retItin = offer?.itineraries?.[1];
    if (!retItin?.segments?.length) return null;
    const segs = retItin.segments;
    const dep = segs[0].departure;
    const arr = segs[segs.length - 1].arrival;
    const stops = Math.max(0, segs.length - 1);
    const carrier = segs[0].carrierCode || "";
    const depTime = dep?.at ? new Date(dep.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const arrTime = arr?.at ? new Date(arr.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    return { origin: normalizeCode(origin), carrier, stops, depTime, arrTime };
  }).filter(Boolean);

  if (!entries.length) return null;

  return (
    <div className="fm-returnflight view-enter">
      <h4 className="fm-returnflight-title">🔄 {t("returnFlight.title")}</h4>
      <div className="fm-returnflight-list">
        {entries.map(e => (
          <div key={e.origin} className="fm-returnflight-row">
            <span className="fm-returnflight-origin">{countryFlag(e.origin)} {e.origin}</span>
            <img
              src={`https://images.kiwi.com/airlines/64/${e.carrier}.png`}
              alt={e.carrier}
              className="fm-returnflight-logo"
              onError={ev => { ev.target.style.display = "none"; }}
              loading="lazy"
            />
            <span className="fm-returnflight-carrier">{e.carrier}</span>
            <span className="fm-returnflight-times">{e.depTime} → {e.arrTime}</span>
            <span className={`fm-stopover-badge fm-stopover-badge--${e.stops === 0 ? "direct" : e.stops === 1 ? "one" : "multi"}`}>
              {e.stops === 0 ? t("stopover.direct") : e.stops === 1 ? t("stopover.oneStop") : `${e.stops} ${t("stopover.stops")}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Destination Event Hint (Round 31) ────────────────────────────────────

const DEST_EVENTS = {
  BCN: [{ m: [6, 7, 8], event: "La Mercè / Beach Season" }, { m: [9], event: "La Mercè Festival" }],
  FCO: [{ m: [4, 5], event: "Spring in Rome" }, { m: [12], event: "Christmas Markets" }],
  CDG: [{ m: [6, 7], event: "Summer Festivals" }, { m: [12], event: "Christmas Markets / Lights" }],
  LIS: [{ m: [6], event: "Santo António Festival" }, { m: [7, 8], event: "Beach Season" }],
  AMS: [{ m: [4], event: "King's Day / Tulip Season" }, { m: [12], event: "Christmas Markets" }],
  MXP: [{ m: [4, 5], event: "Fashion Week afterglow" }, { m: [12], event: "Christmas Markets" }],
  ATH: [{ m: [6, 7, 8], event: "Greek Summer / Island Season" }, { m: [3, 4], event: "Easter Celebrations" }],
  VIE: [{ m: [12], event: "Christmas Markets / Ball Season" }, { m: [6, 7], event: "Summer Concerts" }],
  PRG: [{ m: [12], event: "Christmas Markets" }, { m: [6, 7, 8], event: "Summer Beer Gardens" }],
  DUB: [{ m: [3], event: "St. Patrick's Day" }, { m: [6, 7, 8], event: "Festival Season" }],
  BER: [{ m: [10], event: "Festival of Lights" }, { m: [12], event: "Christmas Markets" }],
  CPH: [{ m: [6, 7], event: "Copenhagen Jazz Festival" }, { m: [12], event: "Tivoli Christmas" }],
  BUD: [{ m: [8], event: "Sziget Festival" }, { m: [12], event: "Christmas Markets / Thermal Baths" }],
};

function DestEventHint({ destCode, departureDate, t }) {
  if (!destCode || !departureDate) return null;
  const events = DEST_EVENTS[destCode];
  if (!events) return null;
  const month = new Date(departureDate + "T00:00:00").getMonth() + 1;
  const match = events.find(e => e.m.includes(month));
  if (!match) return null;

  return (
    <div className="fm-destevent view-enter">
      <span className="fm-destevent-icon">🎭</span>
      <div className="fm-destevent-body">
        <span className="fm-destevent-title">{t("destEvent.title")}</span>
        <span className="fm-destevent-text">{match.event}</span>
      </div>
    </div>
  );
}

// ─── Price Breakdown Accordion (Round 31) ─────────────────────────────────

function PriceBreakdownAccordion({ bestDest, currency, t }) {
  const [open, setOpen] = useState(false);
  if (!bestDest?.flights) return null;

  const rows = Object.entries(bestDest.flights).map(([origin, data]) => {
    const offer = data?.offer || data;
    const price = parseFloat(offer?.price?.total || data?.price || 0);
    const base = parseFloat(offer?.price?.base || 0);
    const taxes = price - base;
    return { origin: normalizeCode(origin), total: price, base, taxes: taxes > 0 ? taxes : 0 };
  }).filter(r => r.total > 0);

  if (!rows.length) return null;

  return (
    <div className="fm-pricebd view-enter">
      <button type="button" className="fm-pricebd-toggle" onClick={() => setOpen(!open)}>
        <span className="fm-pricebd-toggle-icon">{open ? "▾" : "▸"}</span>
        <span className="fm-pricebd-toggle-label">{t("priceBreakdown.title")}</span>
      </button>
      {open && (
        <div className="fm-pricebd-content">
          <div className="fm-pricebd-header">
            <span>{t("priceBreakdown.origin")}</span>
            <span>{t("priceBreakdown.base")}</span>
            <span>{t("priceBreakdown.taxes")}</span>
            <span>{t("priceBreakdown.total")}</span>
          </div>
          {rows.map(r => (
            <div key={r.origin} className="fm-pricebd-row">
              <span className="fm-pricebd-origin">{countryFlag(r.origin)} {r.origin}</span>
              <span className="fm-pricebd-val">{convertPrice(r.base, currency)}</span>
              <span className="fm-pricebd-val fm-pricebd-val--tax">{convertPrice(r.taxes, currency)}</span>
              <span className="fm-pricebd-val fm-pricebd-val--total">{convertPrice(r.total, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Group Size Indicator (Round 31) ──────────────────────────────────────

function GroupSizeIndicator({ origins, bestDest, currency, t }) {
  const [showTotal, setShowTotal] = useState(false);
  if (!origins?.length || !bestDest) return null;
  const count = origins.length;
  const total = bestDest.totalCostEUR || 0;
  const avg = bestDest.averageCostPerTraveler || 0;

  return (
    <div className="fm-groupsize view-enter">
      <div className="fm-groupsize-avatars">
        {origins.slice(0, 6).map((o, i) => (
          <span key={o} className="fm-groupsize-avatar" style={{ zIndex: 10 - i }}>
            {countryFlag(o)}
          </span>
        ))}
        {count > 6 && <span className="fm-groupsize-more">+{count - 6}</span>}
      </div>
      <span className="fm-groupsize-label">
        {count} {t("groupSize.travelers")}
      </span>
      <button
        type="button"
        className="fm-groupsize-toggle"
        onClick={() => setShowTotal(!showTotal)}
      >
        {showTotal
          ? `${t("groupSize.total")}: ${convertPrice(total, currency)}`
          : `${t("groupSize.perPerson")}: ${convertPrice(avg, currency)}`}
      </button>
    </div>
  );
}

// ─── Search Duration Badge (Round 31) ─────────────────────────────────────

function SearchDurationBadge({ duration, t }) {
  if (!duration || duration <= 0) return null;
  let rating, color;
  if (duration <= 5) { rating = t("searchSpeed.fast"); color = "#22c55e"; }
  else if (duration <= 15) { rating = t("searchSpeed.normal"); color = "#f59e0b"; }
  else { rating = t("searchSpeed.slow"); color = "#ef4444"; }

  return (
    <div className="fm-searchspeed view-enter">
      <span className="fm-searchspeed-icon">⚡</span>
      <span className="fm-searchspeed-time">{duration}s</span>
      <span className="fm-searchspeed-rating" style={{ color }}>{rating}</span>
    </div>
  );
}

// ─── Nearby Airports Hint (Round 32) ──────────────────────────────────────

const NEARBY_AIRPORTS = {
  MAD: ["TOJ"], BCN: ["GRO", "REU"], LON: ["LHR", "LGW", "STN", "LTN", "SEN"],
  LHR: ["LGW", "STN", "LTN"], LGW: ["LHR", "STN", "LTN"], STN: ["LHR", "LGW"],
  BER: ["SXF"], MIL: ["MXP", "LIN", "BGY"], MXP: ["LIN", "BGY"], LIN: ["MXP", "BGY"],
  PAR: ["CDG", "ORY", "BVA"], CDG: ["ORY", "BVA"], ORY: ["CDG", "BVA"],
  ROM: ["FCO", "CIA"], FCO: ["CIA"], NYC: ["JFK", "EWR", "LGA"],
  BRU: ["CRL"], OSL: ["TRF", "RYG"], STO: ["ARN", "NYO", "BMA"],
};

function NearbyAirportsHint({ origins, t }) {
  if (!origins?.length) return null;
  const hints = origins.map(o => {
    const code = normalizeCode(o);
    const nearby = NEARBY_AIRPORTS[code];
    if (!nearby?.length) return null;
    return { origin: code, nearby };
  }).filter(Boolean);

  if (!hints.length) return null;

  return (
    <div className="fm-nearby view-enter">
      <span className="fm-nearby-icon">📍</span>
      <div className="fm-nearby-body">
        <span className="fm-nearby-title">{t("nearby.title")}</span>
        {hints.map(h => (
          <span key={h.origin} className="fm-nearby-text">
            {countryFlag(h.origin)} {h.origin}: {t("nearby.also")} {h.nearby.join(", ")}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Destination Timezone Compare (Round 32) ──────────────────────────────

const TZ_OFFSETS = {
  ES: 1, FR: 1, DE: 1, IT: 1, NL: 1, BE: 1, AT: 1, CH: 1, CZ: 1, PL: 1,
  HU: 1, HR: 1, SK: 1, SI: 1, DK: 1, NO: 1, SE: 1, MT: 1,
  GB: 0, IE: 0, PT: 0, IS: 0,
  GR: 2, BG: 2, RO: 2, FI: 2, EE: 2, LV: 2, LT: 2, CY: 2,
  TR: 3, MA: 1, US: -5,
};

function DestTimezoneCompare({ origins, destCode, t }) {
  const destInfo = destQuickInfo(destCode);
  const destCC = destInfo?.country;
  if (!destCC || TZ_OFFSETS[destCC] === undefined) return null;
  const destTZ = TZ_OFFSETS[destCC];

  const diffs = origins.map(o => {
    const info = destQuickInfo(normalizeCode(o));
    const cc = info?.country;
    if (!cc || TZ_OFFSETS[cc] === undefined) return null;
    const diff = destTZ - TZ_OFFSETS[cc];
    return { origin: normalizeCode(o), diff };
  }).filter(Boolean);

  if (!diffs.length || diffs.every(d => d.diff === 0)) return null;

  return (
    <div className="fm-timezone view-enter">
      <span className="fm-timezone-icon">🕐</span>
      <div className="fm-timezone-body">
        <span className="fm-timezone-title">{t("timezone.title")}</span>
        <div className="fm-timezone-list">
          {diffs.map(d => (
            <span key={d.origin} className="fm-timezone-item">
              {countryFlag(d.origin)} {d.origin}: {d.diff === 0 ? t("timezone.same") : `${d.diff > 0 ? "+" : ""}${d.diff}h`}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Flight Class Badge (Round 32) ────────────────────────────────────────

function FlightClassBadge({ bestDest, t }) {
  if (!bestDest?.flights) return null;
  const classes = new Set();
  Object.values(bestDest.flights).forEach(data => {
    const offer = data?.offer || data;
    const travelerPricings = offer?.travelerPricings || [];
    travelerPricings.forEach(tp => {
      tp.fareDetailsBySegment?.forEach(fd => {
        if (fd.cabin) classes.add(fd.cabin);
      });
    });
    // Fallback: check segments
    if (!classes.size) {
      const segs = offer?.itineraries?.[0]?.segments || [];
      segs.forEach(seg => {
        if (seg.cabin) classes.add(seg.cabin);
      });
    }
  });

  if (!classes.size) {
    // Default assumption
    classes.add("ECONOMY");
  }

  const classLabels = {
    ECONOMY: { label: t("flightClass.economy"), icon: "💺", color: "#3b82f6" },
    PREMIUM_ECONOMY: { label: t("flightClass.premEconomy"), icon: "💺", color: "#8b5cf6" },
    BUSINESS: { label: t("flightClass.business"), icon: "🪑", color: "#f59e0b" },
    FIRST: { label: t("flightClass.first"), icon: "👑", color: "#ef4444" },
  };

  return (
    <div className="fm-flightclass view-enter">
      {[...classes].map(c => {
        const info = classLabels[c] || classLabels.ECONOMY;
        return (
          <span key={c} className="fm-flightclass-badge" style={{ borderColor: info.color }}>
            <span>{info.icon}</span> {info.label}
          </span>
        );
      })}
    </div>
  );
}

// ─── Trip Summary Export (Round 32) ───────────────────────────────────────

function TripSummaryExport({ bestDest, origins, departureDate, returnDate, tripType, currency, t }) {
  const [copied, setCopied] = useState(false);
  if (!bestDest) return null;

  const handleCopy = useCallback(() => {
    const dest = cityOf(normalizeCode(bestDest.destination)) || bestDest.destination;
    const lines = [
      `✈️ ${t("tripExport.header")}`,
      `━━━━━━━━━━━━━━━━━━`,
      `📍 ${t("tripExport.dest")}: ${dest} (${normalizeCode(bestDest.destination)})`,
      `📅 ${departureDate}${returnDate ? ` → ${returnDate}` : ""}`,
      `👥 ${origins.length} ${t("groupSize.travelers")}`,
      `💰 ${t("groupSize.total")}: ${convertPrice(bestDest.totalCostEUR || 0, currency)}`,
      `💰 ${t("groupSize.perPerson")}: ${convertPrice(bestDest.averageCostPerTraveler || 0, currency)}`,
      ``,
      `${t("tripExport.origins")}:`,
      ...origins.map(o => `  ${countryFlag(o)} ${o}`),
      ``,
      `— ${t("tripExport.via")} FlyndMe`,
    ];
    const text = lines.join("\n");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    }
  }, [bestDest, origins, departureDate, returnDate, currency, t]);

  return (
    <div className="fm-tripexport view-enter">
      <button type="button" className="fm-tripexport-btn" onClick={handleCopy}>
        {copied ? "✓ " + t("tripExport.copied") : "📋 " + t("tripExport.copy")}
      </button>
    </div>
  );
}

// ─── Price Compare External (Round 32) ────────────────────────────────────

function PriceCompareExternal({ bestDest, origins, departureDate, returnDate, tripType, t }) {
  if (!bestDest || !origins?.length) return null;
  const destCode = normalizeCode(bestDest.destination);
  const mainOrigin = normalizeCode(origins[0]);

  const skyscannerUrl = buildSkyscannerUrl
    ? buildSkyscannerUrl(mainOrigin, destCode, departureDate, tripType === "roundtrip" ? returnDate : "")
    : `https://www.skyscanner.net/transport/flights/${mainOrigin.toLowerCase()}/${destCode.toLowerCase()}/${departureDate?.replace(/-/g, "").slice(2)}/`;

  const googleUrl = buildGoogleFlightsUrl
    ? buildGoogleFlightsUrl(mainOrigin, destCode, departureDate, tripType === "roundtrip" ? returnDate : "")
    : `https://www.google.com/travel/flights?q=flights+from+${mainOrigin}+to+${destCode}`;

  return (
    <div className="fm-extcompare view-enter">
      <span className="fm-extcompare-label">{t("extCompare.label")}</span>
      <div className="fm-extcompare-links">
        <a href={skyscannerUrl} target="_blank" rel="noopener noreferrer" className="fm-extcompare-link fm-extcompare-link--sky">
          Skyscanner ↗
        </a>
        <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="fm-extcompare-link fm-extcompare-link--gf">
          Google Flights ↗
        </a>
      </div>
    </div>
  );
}

// ─── Destination Safety Rating (Round 33) ─────────────────────────────────

const SAFETY_RATINGS = {
  ES: 4, FR: 4, DE: 5, IT: 4, NL: 5, BE: 4, AT: 5, CH: 5, PT: 4,
  CZ: 5, PL: 4, SE: 5, DK: 5, NO: 5, FI: 5, IE: 5, IS: 5,
  GR: 4, HR: 4, HU: 4, SI: 5, SK: 4, EE: 5, LV: 4, LT: 4,
  GB: 4, MT: 4, CY: 4, LU: 5, BG: 3, RO: 3, TR: 3, MA: 3,
};

function DestSafetyRating({ destCode, t }) {
  const info = destQuickInfo(destCode);
  const cc = info?.country;
  if (!cc || !SAFETY_RATINGS[cc]) return null;
  const score = SAFETY_RATINGS[cc];

  let label, color;
  if (score >= 5) { label = t("safety.veryHigh"); color = "#22c55e"; }
  else if (score >= 4) { label = t("safety.high"); color = "#84cc16"; }
  else { label = t("safety.moderate"); color = "#f59e0b"; }

  return (
    <div className="fm-safety view-enter">
      <span className="fm-safety-icon">🛡️</span>
      <div className="fm-safety-body">
        <span className="fm-safety-title">{t("safety.title")}</span>
        <div className="fm-safety-bar-wrap">
          <div className="fm-safety-bar" style={{ width: `${score * 20}%`, background: color }} />
        </div>
        <span className="fm-safety-label" style={{ color }}>{label} ({score}/5)</span>
      </div>
    </div>
  );
}

// ─── Flight Connection Warning (Round 33) ─────────────────────────────────

function FlightConnectionWarning({ bestDest, t }) {
  if (!bestDest?.flights) return null;
  const tightConnections = [];

  Object.entries(bestDest.flights).forEach(([origin, data]) => {
    const offer = data?.offer || data;
    (offer?.itineraries || []).forEach(itin => {
      const segs = itin?.segments || [];
      for (let i = 0; i < segs.length - 1; i++) {
        const arr = new Date(segs[i].arrival?.at);
        const dep = new Date(segs[i + 1].departure?.at);
        const layoverMin = Math.round((dep - arr) / 60000);
        if (layoverMin > 0 && layoverMin < 90) {
          tightConnections.push({
            origin: normalizeCode(origin),
            airport: segs[i].arrival?.iataCode || "?",
            minutes: layoverMin,
          });
        }
      }
    });
  });

  if (!tightConnections.length) return null;

  return (
    <div className="fm-connwarn view-enter">
      <span className="fm-connwarn-icon">⏰</span>
      <div className="fm-connwarn-body">
        <span className="fm-connwarn-title">{t("connWarn.title")}</span>
        {tightConnections.map((c, i) => (
          <span key={i} className="fm-connwarn-text">
            {countryFlag(c.origin)} {c.origin} — {c.minutes}{t("connWarn.min")} {t("connWarn.at")} {c.airport}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Seasonal Demand Indicator (Round 33) ─────────────────────────────────

function SeasonalDemandIndicator({ departureDate, destCode, t }) {
  if (!departureDate) return null;
  const month = new Date(departureDate + "T00:00:00").getMonth() + 1;
  const info = destQuickInfo(destCode);
  const cc = info?.country;

  // Mediterranean destinations: peak Jun-Aug, shoulder Apr-May/Sep-Oct, off Nov-Mar
  const MED = new Set(["ES", "IT", "GR", "HR", "PT", "MT", "CY", "TR", "MA"]);
  // Nordic destinations: peak Jun-Aug (summer), Dec (Christmas), shoulder rest
  const NORDIC = new Set(["NO", "SE", "DK", "FI", "IS"]);

  let level, msgKey;
  if (MED.has(cc)) {
    if ([6, 7, 8].includes(month)) { level = "peak"; msgKey = "season.peakSummer"; }
    else if ([4, 5, 9, 10].includes(month)) { level = "shoulder"; msgKey = "season.shoulder"; }
    else { level = "off"; msgKey = "season.offSeason"; }
  } else if (NORDIC.has(cc)) {
    if ([6, 7, 8].includes(month)) { level = "peak"; msgKey = "season.peakSummer"; }
    else if (month === 12) { level = "peak"; msgKey = "season.peakWinter"; }
    else { level = "shoulder"; msgKey = "season.shoulder"; }
  } else {
    // Central/Western Europe: peak Jun-Aug, Dec, shoulder rest
    if ([6, 7, 8].includes(month)) { level = "peak"; msgKey = "season.peakSummer"; }
    else if (month === 12) { level = "peak"; msgKey = "season.peakWinter"; }
    else if ([4, 5, 9, 10].includes(month)) { level = "shoulder"; msgKey = "season.shoulder"; }
    else { level = "off"; msgKey = "season.offSeason"; }
  }

  const icons = { peak: "🔥", shoulder: "🌤️", off: "❄️" };

  return (
    <div className={`fm-season fm-season--${level} view-enter`}>
      <span className="fm-season-icon">{icons[level]}</span>
      <div className="fm-season-body">
        <span className="fm-season-title">{t("season.title")}</span>
        <span className="fm-season-text">{t(msgKey)}</span>
      </div>
    </div>
  );
}

// ─── Origin Distance Map (Round 33) ──────────────────────────────────────

function OriginDistanceMap({ bestDest, origins, t }) {
  if (!bestDest || !origins?.length) return null;
  const destCode = normalizeCode(bestDest.destination);

  const distances = origins.map(o => {
    const code = normalizeCode(o);
    const km = typeof approxDistKm === "function" ? approxDistKm(code, destCode) : 0;
    return { origin: code, km };
  }).filter(d => d.km > 0);

  if (!distances.length) return null;
  const maxKm = Math.max(...distances.map(d => d.km));

  return (
    <div className="fm-distmap view-enter">
      <h4 className="fm-distmap-title">📏 {t("distMap.title")}</h4>
      <div className="fm-distmap-bars">
        {distances.sort((a, b) => a.km - b.km).map(d => {
          const pct = maxKm > 0 ? (d.km / maxKm) * 100 : 0;
          return (
            <div key={d.origin} className="fm-distmap-row">
              <span className="fm-distmap-origin">{countryFlag(d.origin)} {d.origin}</span>
              <div className="fm-distmap-barwrap">
                <div className="fm-distmap-bar" style={{ width: `${pct}%` }} />
              </div>
              <span className="fm-distmap-label">{d.km.toLocaleString()} km</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Quick Bookmark Button (Round 33) ─────────────────────────────────────

function QuickBookmarkBtn({ bestDest, departureDate, t }) {
  const [saved, setSaved] = useState(false);
  if (!bestDest) return null;

  const handleBookmark = useCallback(() => {
    try {
      const bookmarks = JSON.parse(localStorage.getItem("flyndme_bookmarks") || "[]");
      const entry = {
        destination: bestDest.destination,
        city: cityOf(normalizeCode(bestDest.destination)) || bestDest.destination,
        price: bestDest.averageCostPerTraveler,
        total: bestDest.totalCostEUR,
        date: departureDate,
        savedAt: new Date().toISOString(),
      };
      // Avoid duplicates
      const exists = bookmarks.some(b => b.destination === entry.destination && b.date === entry.date);
      if (!exists) {
        bookmarks.unshift(entry);
        localStorage.setItem("flyndme_bookmarks", JSON.stringify(bookmarks.slice(0, 20)));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* localStorage unavailable */ }
  }, [bestDest, departureDate]);

  return (
    <button type="button" className={`fm-bookmark-btn view-enter${saved ? " fm-bookmark-btn--saved" : ""}`} onClick={handleBookmark}>
      {saved ? "★ " + t("bookmark.saved") : "☆ " + t("bookmark.save")}
    </button>
  );
}

// ─── Departure Countdown 24h (Round 34) ───────────────────────────────────

function DepartureCountdown24h({ bestDest, t }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  if (!bestDest?.flights) return null;
  // Find earliest departure across all origins
  let earliest = Infinity;
  Object.values(bestDest.flights).forEach(data => {
    const offer = data?.offer || data;
    const seg = offer?.itineraries?.[0]?.segments?.[0];
    if (seg?.departure?.at) {
      const t = new Date(seg.departure.at).getTime();
      if (t < earliest) earliest = t;
    }
  });
  if (earliest === Infinity) return null;

  const diff = earliest - now;
  if (diff < 0 || diff > 86400000) return null; // Only show within 24h

  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  return (
    <div className="fm-dep24 view-enter">
      <span className="fm-dep24-icon">🚨</span>
      <span className="fm-dep24-text">
        {t("dep24.text").replace("{{hours}}", hrs).replace("{{mins}}", mins)}
      </span>
    </div>
  );
}

// ─── Price Savings vs Solo (Round 34) ─────────────────────────────────────

function PriceSavingsVsSolo({ bestDest, origins, currency, t }) {
  if (!bestDest || !origins?.length || origins.length < 2) return null;
  // Estimate: searching individually typically costs ~12-18% more due to
  // not being able to compare across destinations simultaneously
  const total = bestDest.totalCostEUR || 0;
  const soloMarkup = 1.15; // 15% average individual search overhead
  const soloEstimate = total * soloMarkup;
  const saved = soloEstimate - total;

  if (saved < 5) return null;

  return (
    <div className="fm-solosave view-enter">
      <span className="fm-solosave-icon">🤝</span>
      <div className="fm-solosave-body">
        <span className="fm-solosave-title">{t("soloSave.title")}</span>
        <span className="fm-solosave-text">
          {t("soloSave.text").replace("{{amount}}", convertPrice(saved, currency))}
        </span>
      </div>
    </div>
  );
}

// ─── Destination Local Transport (Round 34) ───────────────────────────────

const LOCAL_TRANSPORT = {
  BCN: { metro: true, bus: true, tram: true, tip: "T-Casual 10-trip card" },
  MAD: { metro: true, bus: true, tram: false, tip: "Multi card (tourist pass)" },
  CDG: { metro: true, bus: true, tram: true, tip: "Navigo Easy card" },
  FCO: { metro: true, bus: true, tram: true, tip: "Roma 48/72h pass" },
  LIS: { metro: true, bus: true, tram: true, tip: "Viva Viagem card" },
  AMS: { metro: true, bus: true, tram: true, tip: "OV-chipkaart" },
  BER: { metro: true, bus: true, tram: true, tip: "Berlin Welcome Card" },
  MXP: { metro: true, bus: true, tram: true, tip: "ATM daily ticket" },
  PRG: { metro: true, bus: true, tram: true, tip: "Lítačka 72h pass" },
  ATH: { metro: true, bus: true, tram: true, tip: "Ath.ena card" },
  VIE: { metro: true, bus: true, tram: true, tip: "Vienna Card" },
  BUD: { metro: true, bus: true, tram: true, tip: "Budapest Card" },
  CPH: { metro: true, bus: false, tram: false, tip: "Rejsekort" },
  DUB: { metro: false, bus: true, tram: true, tip: "Leap Card" },
  LHR: { metro: true, bus: true, tram: false, tip: "Oyster / contactless" },
  LGW: { metro: true, bus: true, tram: false, tip: "Oyster / contactless" },
};

function DestLocalTransport({ destCode, t }) {
  const info = LOCAL_TRANSPORT[destCode];
  if (!info) return null;

  return (
    <div className="fm-transport view-enter">
      <h4 className="fm-transport-title">🚇 {t("transport.title")}</h4>
      <div className="fm-transport-modes">
        {info.metro && <span className="fm-transport-mode">🚇 Metro</span>}
        {info.bus && <span className="fm-transport-mode">🚌 Bus</span>}
        {info.tram && <span className="fm-transport-mode">🚊 Tram</span>}
      </div>
      {info.tip && (
        <span className="fm-transport-tip">💡 {t("transport.tip")}: {info.tip}</span>
      )}
    </div>
  );
}

// ─── Multi-City Badge (Round 34) ──────────────────────────────────────────

const MULTI_CITY_AIRPORTS = {
  MXP: "Milan, Lake Como, Bergamo",
  LIN: "Milan city center",
  BGY: "Bergamo, Milan",
  BCN: "Barcelona, Costa Brava",
  FCO: "Rome, Vatican City",
  CDG: "Paris, Disneyland, Versailles",
  AMS: "Amsterdam, Haarlem, Utrecht",
  ATH: "Athens, Piraeus, Glyfada",
  LIS: "Lisbon, Sintra, Cascais",
  VIE: "Vienna, Bratislava (1h away)",
  PRG: "Prague, Kutná Hora",
  BUD: "Budapest, Szentendre",
  CPH: "Copenhagen, Malmö (20 min)",
};

function MultiCityBadge({ destCode, t }) {
  const cities = MULTI_CITY_AIRPORTS[destCode];
  if (!cities) return null;

  return (
    <div className="fm-multicity view-enter">
      <span className="fm-multicity-icon">🏙️</span>
      <div className="fm-multicity-body">
        <span className="fm-multicity-title">{t("multiCity.title")}</span>
        <span className="fm-multicity-text">{cities}</span>
      </div>
    </div>
  );
}

// ─── Flight Operator Note (Round 34) ──────────────────────────────────────

function FlightOperatorNote({ bestDest, t }) {
  if (!bestDest?.flights) return null;
  const codeshares = [];

  Object.entries(bestDest.flights).forEach(([origin, data]) => {
    const offer = data?.offer || data;
    const segs = offer?.itineraries?.[0]?.segments || [];
    segs.forEach(seg => {
      const marketing = seg.carrierCode;
      const operating = seg.operating?.carrierCode;
      if (marketing && operating && marketing !== operating) {
        codeshares.push({
          origin: normalizeCode(origin),
          marketing,
          operating,
        });
      }
    });
  });

  if (!codeshares.length) return null;

  // Deduplicate
  const unique = [...new Map(codeshares.map(c => [`${c.marketing}-${c.operating}`, c])).values()];

  return (
    <div className="fm-codeshare view-enter">
      <span className="fm-codeshare-icon">🔄</span>
      <div className="fm-codeshare-body">
        <span className="fm-codeshare-title">{t("codeshare.title")}</span>
        {unique.map((c, i) => (
          <span key={i} className="fm-codeshare-text">
            {c.marketing} → {t("codeshare.operatedBy")} {c.operating}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Destination Food Culture (Round 35) ──────────────────────────────────

const DEST_FOOD = {
  BCN: { dish: "Pa amb tomàquet, Paella", emoji: "🥘" },
  MAD: { dish: "Cocido madrileño, Churros", emoji: "🫕" },
  FCO: { dish: "Carbonara, Supplì", emoji: "🍝" },
  CDG: { dish: "Croissant, Croque-monsieur", emoji: "🥐" },
  LIS: { dish: "Pastel de nata, Bacalhau", emoji: "🍮" },
  AMS: { dish: "Stroopwafel, Bitterballen", emoji: "🧇" },
  BER: { dish: "Currywurst, Döner Kebab", emoji: "🌭" },
  MXP: { dish: "Risotto alla milanese, Cotoletta", emoji: "🍚" },
  PRG: { dish: "Trdelník, Svíčková", emoji: "🥨" },
  ATH: { dish: "Souvlaki, Moussaka", emoji: "🥙" },
  VIE: { dish: "Wiener Schnitzel, Sachertorte", emoji: "🍰" },
  BUD: { dish: "Goulash, Lángos", emoji: "🍲" },
  CPH: { dish: "Smørrebrød, Danish pastry", emoji: "🥪" },
  DUB: { dish: "Irish stew, Soda bread", emoji: "🍀" },
  LHR: { dish: "Fish & chips, Sunday roast", emoji: "🐟" },
  LGW: { dish: "Fish & chips, Sunday roast", emoji: "🐟" },
};

function DestFoodCulture({ destCode, t }) {
  const food = DEST_FOOD[destCode];
  if (!food) return null;
  return (
    <div className="fm-food view-enter">
      <span className="fm-food-icon">{food.emoji}</span>
      <div className="fm-food-body">
        <span className="fm-food-title">{t("food.title")}</span>
        <span className="fm-food-text">{food.dish}</span>
      </div>
    </div>
  );
}

// ─── Wifi Availability Hint (Round 35) ────────────────────────────────────

const WIFI_RATINGS = {
  ES: 4, FR: 4, DE: 5, IT: 3, NL: 5, BE: 4, AT: 5, CH: 5, PT: 4,
  CZ: 4, PL: 4, SE: 5, DK: 5, NO: 5, FI: 5, IE: 4, IS: 4,
  GR: 3, HR: 3, HU: 4, SI: 4, SK: 4, EE: 5, LV: 4, LT: 4,
  GB: 4, MT: 3, CY: 3, LU: 5, BG: 3, RO: 4, TR: 3, MA: 2,
};

function WifiAvailabilityHint({ destCode, t }) {
  const info = destQuickInfo(destCode);
  const cc = info?.country;
  if (!cc || !WIFI_RATINGS[cc]) return null;
  const score = WIFI_RATINGS[cc];

  let label, icon;
  if (score >= 5) { label = t("wifi.excellent"); icon = "📶"; }
  else if (score >= 4) { label = t("wifi.good"); icon = "📶"; }
  else if (score >= 3) { label = t("wifi.decent"); icon = "📡"; }
  else { label = t("wifi.limited"); icon = "📡"; }

  return (
    <div className="fm-wifi view-enter">
      <span className="fm-wifi-icon">{icon}</span>
      <span className="fm-wifi-text">{t("wifi.title")}: {label}</span>
    </div>
  );
}

// ─── Price Per Day Calculator (Round 35) ──────────────────────────────────

function PricePerDayCalc({ bestDest, departureDate, returnDate, tripType, currency, t }) {
  if (tripType !== "roundtrip" || !departureDate || !returnDate || !bestDest) return null;
  const dep = new Date(departureDate + "T00:00:00");
  const ret = new Date(returnDate + "T00:00:00");
  const days = Math.max(1, Math.round((ret - dep) / 86400000));
  const totalPP = bestDest.averageCostPerTraveler || 0;
  const perDay = totalPP / days;

  return (
    <div className="fm-perday view-enter">
      <span className="fm-perday-icon">📊</span>
      <div className="fm-perday-body">
        <span className="fm-perday-title">{t("perDay.title")}</span>
        <span className="fm-perday-amount">{convertPrice(perDay, currency)}{t("perDay.perDay")}</span>
        <span className="fm-perday-sub">{days} {t("perDay.days")} · {convertPrice(totalPP, currency)} {t("perDay.total")}</span>
      </div>
    </div>
  );
}

// ─── Early Morning Warning (Round 35) ─────────────────────────────────────

function EarlyMorningWarning({ bestDest, t }) {
  if (!bestDest?.flights) return null;
  const earlyFlights = [];

  Object.entries(bestDest.flights).forEach(([origin, data]) => {
    const offer = data?.offer || data;
    const seg = offer?.itineraries?.[0]?.segments?.[0];
    if (seg?.departure?.at) {
      const hour = new Date(seg.departure.at).getHours();
      if (hour < 7) {
        earlyFlights.push({
          origin: normalizeCode(origin),
          time: new Date(seg.departure.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        });
      }
    }
  });

  if (!earlyFlights.length) return null;

  return (
    <div className="fm-earlyam view-enter">
      <span className="fm-earlyam-icon">🌅</span>
      <div className="fm-earlyam-body">
        <span className="fm-earlyam-title">{t("earlyAm.title")}</span>
        {earlyFlights.map(f => (
          <span key={f.origin} className="fm-earlyam-text">
            {countryFlag(f.origin)} {f.origin}: {f.time}
          </span>
        ))}
        <span className="fm-earlyam-tip">{t("earlyAm.tip")}</span>
      </div>
    </div>
  );
}

// ─── Destination Language Phrase (Round 35) ───────────────────────────────

const DEST_PHRASES = {
  ES: { hello: "¡Hola!", thanks: "Gracias", lang: "Spanish" },
  FR: { hello: "Bonjour!", thanks: "Merci", lang: "French" },
  DE: { hello: "Hallo!", thanks: "Danke", lang: "German" },
  IT: { hello: "Ciao!", thanks: "Grazie", lang: "Italian" },
  PT: { hello: "Olá!", thanks: "Obrigado/a", lang: "Portuguese" },
  NL: { hello: "Hallo!", thanks: "Dank je", lang: "Dutch" },
  CZ: { hello: "Ahoj!", thanks: "Děkuji", lang: "Czech" },
  PL: { hello: "Cześć!", thanks: "Dziękuję", lang: "Polish" },
  GR: { hello: "Γειά σου!", thanks: "Ευχαριστώ", lang: "Greek" },
  HU: { hello: "Szia!", thanks: "Köszönöm", lang: "Hungarian" },
  HR: { hello: "Bok!", thanks: "Hvala", lang: "Croatian" },
  SE: { hello: "Hej!", thanks: "Tack", lang: "Swedish" },
  DK: { hello: "Hej!", thanks: "Tak", lang: "Danish" },
  NO: { hello: "Hei!", thanks: "Takk", lang: "Norwegian" },
  FI: { hello: "Moi!", thanks: "Kiitos", lang: "Finnish" },
  TR: { hello: "Merhaba!", thanks: "Teşekkürler", lang: "Turkish" },
  RO: { hello: "Bună!", thanks: "Mulțumesc", lang: "Romanian" },
  BG: { hello: "Здравей!", thanks: "Благодаря", lang: "Bulgarian" },
};

function DestLanguagePhrase({ destCode, t }) {
  const info = destQuickInfo(destCode);
  const cc = info?.country;
  if (!cc) return null;
  const phrase = DEST_PHRASES[cc];
  if (!phrase) return null;

  return (
    <div className="fm-phrase view-enter">
      <span className="fm-phrase-icon">🗣️</span>
      <div className="fm-phrase-body">
        <span className="fm-phrase-title">{t("phrase.title")} ({phrase.lang})</span>
        <div className="fm-phrase-items">
          <span className="fm-phrase-item">👋 {phrase.hello}</span>
          <span className="fm-phrase-item">🙏 {phrase.thanks}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Price per km ranking ──────────────────────────────────────────────────

function PricePerKmRanking({ flights, origins, currency, t }) {
  if (!flights || flights.length < 2 || !origins.length) return null;

  const ranked = flights.map(f => {
    const code = normalizeCode(f.destination);
    let totalKm = 0, count = 0;
    origins.forEach(o => {
      const km = approxDistKm(o, code);
      if (km) { totalKm += km; count++; }
    });
    if (!count || !f.totalCostEUR) return null;
    const avgKm = totalKm / count;
    const pricePerKm = (f.averageCostPerTraveler || 0) / (avgKm || 1);
    return { code, city: cityOf(code) || code, pricePerKm, avgKm: Math.round(avgKm), avg: f.averageCostPerTraveler || 0 };
  }).filter(Boolean).sort((a, b) => a.pricePerKm - b.pricePerKm).slice(0, 5);

  if (!ranked.length) return null;
  const maxPpk = Math.max(...ranked.map(r => r.pricePerKm));

  return (
    <div className="fm-ppkm view-enter">
      <div className="fm-ppkm-title">{t("results.pricePerKm")}</div>
      <div className="fm-ppkm-sub">{t("results.pricePerKmSub")}</div>
      <div className="fm-ppkm-list">
        {ranked.map((r, i) => (
          <div key={r.code} className="fm-ppkm-row">
            <span className="fm-ppkm-rank">{i + 1}</span>
            <span className="fm-ppkm-city">{r.city}</span>
            <div className="fm-ppkm-bar-wrap">
              <div className="fm-ppkm-bar" style={{ width: `${maxPpk > 0 ? (r.pricePerKm / maxPpk) * 100 : 0}%` }} />
            </div>
            <span className="fm-ppkm-value">{(r.pricePerKm * 100).toFixed(1)}¢/km</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Group Arrival Sync indicator ──────────────────────────────────────────

function GroupArrivalSync({ bestDest, t }) {
  if (!bestDest?.flights?.length) return null;

  const arrTimes = bestDest.flights.map(f => {
    const itin = f.offer?.itineraries?.[0];
    if (!itin?.segments?.length) return null;
    const lastSeg = itin.segments[itin.segments.length - 1];
    return lastSeg.arrival?.at ? new Date(lastSeg.arrival.at).getTime() : null;
  }).filter(Boolean);

  if (arrTimes.length < 2) return null;

  const earliest = Math.min(...arrTimes);
  const latest = Math.max(...arrTimes);
  const spreadMin = Math.round((latest - earliest) / 60000);
  const spreadHrs = Math.floor(spreadMin / 60);
  const spreadMins = spreadMin % 60;

  let syncLevel, syncIcon;
  if (spreadMin <= 60) { syncLevel = "great"; syncIcon = "🟢"; }
  else if (spreadMin <= 180) { syncLevel = "good"; syncIcon = "🟡"; }
  else { syncLevel = "wide"; syncIcon = "🔴"; }

  const spreadLabel = spreadHrs > 0
    ? `${spreadHrs}h${spreadMins > 0 ? ` ${spreadMins}m` : ""}`
    : `${spreadMins}m`;

  return (
    <div className={`fm-arrival-sync fm-arrival-sync--${syncLevel} view-enter`}>
      <span className="fm-arrival-sync-icon">{syncIcon}</span>
      <div className="fm-arrival-sync-text">
        <span className="fm-arrival-sync-label">{t("results.arrivalSync")}</span>
        <span className="fm-arrival-sync-spread">
          {t("results.arrivalSpread", { time: spreadLabel })}
        </span>
      </div>
    </div>
  );
}

// ─── Share as Story (canvas-based vertical card) ──────────────────────────

function ShareAsStoryBtn({ bestDest, origins, currency, departureDate, t }) {
  const canvasRef = useRef(null);
  if (!bestDest) return null;

  const handleGenerate = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 540;
    canvas.height = 960;
    const ctx = canvas.getContext("2d");

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 960);
    grad.addColorStop(0, "#0F172A");
    grad.addColorStop(0.5, "#1E3A5F");
    grad.addColorStop(1, "#0F172A");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 540, 960);

    // Decorative circles
    ctx.beginPath();
    ctx.arc(440, 120, 80, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(59,130,246,.15)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(100, 800, 60, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(16,185,129,.1)";
    ctx.fill();

    // Brand
    ctx.fillStyle = "#60A5FA";
    ctx.font = "bold 16px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("✈ FlyndMe", 270, 80);

    // Destination city
    const destCode = normalizeCode(bestDest.destination);
    const city = cityOf(destCode) || destCode;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 42px system-ui, -apple-system, sans-serif";
    ctx.fillText(city, 270, 200);

    // Code
    ctx.fillStyle = "#94A3B8";
    ctx.font = "600 18px system-ui, -apple-system, sans-serif";
    ctx.fillText(destCode, 270, 240);

    // Divider line
    ctx.strokeStyle = "rgba(255,255,255,.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(120, 280);
    ctx.lineTo(420, 280);
    ctx.stroke();

    // Stats
    const total = bestDest.totalCostEUR || 0;
    const avg = bestDest.averageCostPerTraveler || 0;
    const fairness = bestDest.fairnessScore ?? 0;
    const fmtPrice = (v) => currency === "EUR" ? `€${Math.round(v)}` : convertPrice(v, currency);

    const stats = [
      { label: t("results.groupTotal"), value: fmtPrice(total) },
      { label: t("results.avgPerPerson"), value: fmtPrice(avg) },
      { label: t("results.fairnessLabel"), value: `${fairness.toFixed(0)}/100` },
    ];

    stats.forEach((s, i) => {
      const y = 340 + i * 90;
      ctx.fillStyle = "#94A3B8";
      ctx.font = "500 14px system-ui, -apple-system, sans-serif";
      ctx.fillText(s.label, 270, y);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 32px system-ui, -apple-system, sans-serif";
      ctx.fillText(s.value, 270, y + 38);
    });

    // Origins
    ctx.fillStyle = "#64748B";
    ctx.font = "500 14px system-ui, -apple-system, sans-serif";
    ctx.fillText(origins.join("  ·  "), 270, 650);

    // Date
    if (departureDate) {
      ctx.fillStyle = "#475569";
      ctx.font = "500 13px system-ui, -apple-system, sans-serif";
      ctx.fillText(departureDate, 270, 690);
    }

    // Footer
    ctx.fillStyle = "#334155";
    ctx.font = "500 12px system-ui, -apple-system, sans-serif";
    ctx.fillText("flyndme.com", 270, 920);

    // Convert to blob and share/download
    canvas.toBlob(async (blob) => {
      if (navigator.share && navigator.canShare?.({ files: [new File([blob], "flyndme-story.png", { type: "image/png" })] })) {
        try {
          await navigator.share({
            files: [new File([blob], "flyndme-story.png", { type: "image/png" })],
            title: `FlyndMe - ${city}`,
          });
        } catch { /* user cancelled */ }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "flyndme-story.png";
        a.click();
        URL.revokeObjectURL(url);
      }
    }, "image/png");
  };

  return (
    <button type="button" className="fm-story-btn" onClick={handleGenerate} title={t("results.shareStory")}>
      <span className="fm-story-btn-icon">📱</span>
      <span>{t("results.shareStory")}</span>
    </button>
  );
}

// ─── Destination Quick Facts ──────────────────────────────────────────────

function DestQuickFacts({ destCode, t }) {
  const info = destQuickInfo(destCode);
  if (!info) return null;

  const PLUG_TYPES = {
    "UK": "G (UK)", "ES": "C/F (EU)", "FR": "C/E (EU)", "DE": "C/F (EU)",
    "IT": "C/F/L (EU)", "PT": "C/F (EU)", "NL": "C/F (EU)", "GR": "C/F (EU)",
    "CZ": "C/E (EU)", "HU": "C/F (EU)", "PL": "C/E (EU)", "AT": "C/F (EU)",
    "BE": "C/E (EU)", "IE": "G (UK)", "DK": "C/K (EU)", "SE": "C/F (EU)",
    "NO": "C/F (EU)", "FI": "C/F (EU)", "HR": "C/F (EU)", "BG": "C/F (EU)",
    "RO": "C/F (EU)", "TR": "C/F (EU)", "MA": "C/E (EU)", "MT": "G (UK)",
    "CH": "C/J (CH)", "IS": "C/F (EU)",
  };

  const CURRENCIES = {
    "UK": "GBP (£)", "ES": "EUR (€)", "FR": "EUR (€)", "DE": "EUR (€)",
    "IT": "EUR (€)", "PT": "EUR (€)", "NL": "EUR (€)", "GR": "EUR (€)",
    "CZ": "CZK (Kč)", "HU": "HUF (Ft)", "PL": "PLN (zł)", "AT": "EUR (€)",
    "BE": "EUR (€)", "IE": "EUR (€)", "DK": "DKK (kr)", "SE": "SEK (kr)",
    "NO": "NOK (kr)", "FI": "EUR (€)", "HR": "EUR (€)", "BG": "BGN (лв)",
    "RO": "RON (lei)", "TR": "TRY (₺)", "MA": "MAD (د.م.)", "MT": "EUR (€)",
    "CH": "CHF (Fr)", "IS": "ISK (kr)",
  };

  // Derive country from airport code (rough)
  const AIRPORT_COUNTRY = {
    LON: "UK", LHR: "UK", LGW: "UK", STN: "UK", LTN: "UK",
    MAD: "ES", BCN: "ES", AGP: "ES", PMI: "ES",
    PAR: "FR", CDG: "FR", ORY: "FR",
    ROM: "IT", FCO: "IT", MXP: "IT", MIL: "IT", NAP: "IT",
    BER: "DE", FRA: "DE", MUC: "DE",
    LIS: "PT", OPO: "PT", AMS: "NL",
    ATH: "GR", SKG: "GR", RHO: "GR",
    PRG: "CZ", BUD: "HU", WAW: "PL", KRK: "PL",
    VIE: "AT", BRU: "BE", DUB: "IE",
    CPH: "DK", STO: "SE", ARN: "SE", OSL: "NO", HEL: "FI",
    DBV: "HR", SPU: "HR", SOF: "BG", OTP: "RO", BEG: "RS",
    IST: "TR", RAK: "MA", MLA: "MT", TIA: "AL",
    GVA: "CH", ZRH: "CH", TLL: "EE", RIX: "LV", VNO: "LT",
    TLV: "IL",
  };

  const country = AIRPORT_COUNTRY[destCode];
  const plug = country ? PLUG_TYPES[country] : null;
  const curr = country ? CURRENCIES[country] : null;

  const facts = [
    { icon: "🗣️", label: t("facts.language"), value: info.lang },
    { icon: "🕐", label: t("facts.timezone"), value: `UTC${info.tz}` },
    curr && { icon: "💰", label: t("facts.currency"), value: curr },
    plug && { icon: "🔌", label: t("facts.plugType"), value: plug },
  ].filter(Boolean);

  return (
    <div className="fm-facts view-enter">
      <div className="fm-facts-title">{t("facts.title")}</div>
      <div className="fm-facts-grid">
        {facts.map((f, i) => (
          <div key={i} className="fm-facts-item">
            <span className="fm-facts-item-icon">{f.icon}</span>
            <div className="fm-facts-item-text">
              <span className="fm-facts-item-label">{f.label}</span>
              <span className="fm-facts-item-value">{f.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scroll Progress Bar ──────────────────────────────────────────────────

function ScrollProgressBar() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      setPct(docH > 0 ? Math.min(100, (window.scrollY / docH) * 100) : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (pct < 1) return null;
  return <div className="fm-scroll-progress" style={{ width: `${pct}%` }} />;
}

function TopDestinationsPodium({ flights, currency, onSelect }) {
  const { t } = useI18n();
  if (!flights || flights.length < 3) return null;

  const sorted = [...flights].sort((a, b) => a.totalCostEUR - b.totalCostEUR).slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const positions = [1, 0, 2]; // visual order: 2nd, 1st, 3rd for podium effect

  return (
    <div className="fm-podium view-enter">
      <div className="fm-podium-title">{t("results.topDestinations")}</div>
      <div className="fm-podium-cards">
        {positions.map((pos) => {
          const dest = sorted[pos];
          if (!dest) return null;
          const code = normalizeCode(dest.destination);
          const city = cityOf(code);
          return (
            <button key={code} type="button"
              className={`fm-podium-card fm-podium-card--pos${pos + 1}`}
              onClick={() => onSelect?.(dest)}>
              <span className="fm-podium-medal">{medals[pos]}</span>
              <span className="fm-podium-city">{city || code}</span>
              <span className="fm-podium-code">{code}</span>
              <span className="fm-podium-price">
                {currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}
                <span className="fm-podium-pp">/pp</span>
              </span>
              <span className="fm-podium-fairness" style={{ color: fairnessColor(dest.fairnessScore ?? 0) }}>
                {(dest.fairnessScore ?? 0).toFixed(0)}/100
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Price distribution donut ──────────────────────────────────────────────────

function PriceDonut({ breakdown, currency }) {
  const { t } = useI18n();
  if (!breakdown || breakdown.length < 2) return null;
  const total = breakdown.reduce((s, f) => s + (f.price || 0), 0);
  if (total <= 0) return null;

  const colors = ["#0062E3", "#05C3A8", "#7C3AED", "#F59E0B", "#EF4444", "#06B6D4", "#8B5CF6", "#EC4899"];
  const r = 40, cx = 50, cy = 50;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = breakdown.map((f, i) => {
    const pct = f.price / total;
    const dash = pct * circumference;
    const seg = { dash, offset, color: colors[i % colors.length], origin: String(f.origin).toUpperCase(), pct: Math.round(pct * 100) };
    offset += dash;
    return seg;
  });

  return (
    <div className="fm-donut-wrap view-enter">
      <div className="fm-donut-title">{t("results.priceDistribution")}</div>
      <div className="fm-donut-content">
        <svg viewBox="0 0 100 100" width="100" height="100" className="fm-donut-svg">
          {segments.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth="16"
              strokeDasharray={`${s.dash} ${circumference - s.dash}`}
              strokeDashoffset={-s.offset}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dasharray .6s ease, stroke-dashoffset .6s ease" }} />
          ))}
        </svg>
        <div className="fm-donut-legend">
          {segments.map((s, i) => (
            <div key={i} className="fm-donut-legend-item">
              <span className="fm-donut-legend-dot" style={{ background: s.color }} />
              <span className="fm-donut-legend-origin">{s.origin}</span>
              <span className="fm-donut-legend-pct">{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Backend connection status ─────────────────────────────────────────────────

function useBackendStatus(apiBase) {
  const [status, setStatus] = useState("unknown"); // unknown | online | offline
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch(`${apiBase}/api/ping`, { cache: "no-store", signal: AbortSignal.timeout?.(5000) })
        .then(res => { if (!cancelled) setStatus(res.ok ? "online" : "offline"); })
        .catch(() => { if (!cancelled) setStatus("offline"); });
    };
    check();
    const id = setInterval(check, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [apiBase]);
  return status;
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

// ─── Animated mini-demo for landing ──────────────────────────────────────────

function LandingMiniDemo({ t }) {
  const [step, setStep] = useState(0);
  const steps = [
    { origins: ["MAD"], dest: "", price: "" },
    { origins: ["MAD", "LON"], dest: "", price: "" },
    { origins: ["MAD", "LON", "BER"], dest: "", price: "" },
    { origins: ["MAD", "LON", "BER"], dest: "LIS", price: "€89" },
  ];
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 1200);
    const t2 = setTimeout(() => setStep(2), 2400);
    const t3 = setTimeout(() => setStep(3), 3800);
    const t4 = setTimeout(() => setStep(0), 7000);
    const interval = setInterval(() => {
      setStep(0);
      setTimeout(() => setStep(1), 1200);
      setTimeout(() => setStep(2), 2400);
      setTimeout(() => setStep(3), 3800);
    }, 7000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearInterval(interval); };
  }, []);

  const cur = steps[step];
  return (
    <div className="lp-mini-demo">
      <div className="lp-mini-demo-window">
        <div className="lp-mini-demo-bar">
          <span className="lp-mini-demo-dot lp-mini-demo-dot--red" />
          <span className="lp-mini-demo-dot lp-mini-demo-dot--yellow" />
          <span className="lp-mini-demo-dot lp-mini-demo-dot--green" />
          <span className="lp-mini-demo-bar-title">FlyndMe</span>
        </div>
        <div className="lp-mini-demo-body">
          <div className="lp-mini-demo-origins">
            {cur.origins.map((o, i) => (
              <span key={o} className="lp-mini-demo-chip" style={{ animationDelay: `${i * 0.15}s` }}>
                {countryFlag(o)} {o}
              </span>
            ))}
          </div>
          {cur.dest && (
            <div className="lp-mini-demo-result">
              <span className="lp-mini-demo-arrow">→</span>
              <span className="lp-mini-demo-dest">{countryFlag(cur.dest)} {cur.dest}</span>
              <span className="lp-mini-demo-price">{cur.price}/pp</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Landing = React.memo(function Landing({ onStart, onStartWithRoute }) {
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
              <div className="lp-live-stats mt-2">
                <span className="lp-live-stat">
                  <AnimatedStat value={42} /> {t("landing.statDestinations")}
                </span>
                <span className="lp-live-stat-sep">·</span>
                <span className="lp-live-stat">
                  <AnimatedStat value={6} /> {t("landing.statOrigins")}
                </span>
                <span className="lp-live-stat-sep">·</span>
                <span className="lp-live-stat">
                  <AnimatedStat value={252} /> {t("landing.statRoutes")}
                </span>
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

      {/* Trust badges */}
      <section className="lp-trust">
        <div className="container" style={{ maxWidth: 1080 }}>
          <div className="lp-trust-grid">
            {(t("landing.trustBadges") || []).map((b, i) => (
              <div key={i} className="lp-trust-badge">
                <span className="lp-trust-icon">{b.icon}</span>
                <span className="lp-trust-text">{b.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Animated mini demo */}
      <section className="lp-demo-section">
        <div className="container" style={{ maxWidth: 1080 }}>
          <LandingMiniDemo t={t} />
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
                // Parse "MAD · LON · BER → BCN, LIS, ROM" into origins + destinations
                const parts = (route.cities || "").split("→").map(s => s.trim());
                const origins = (parts[0] || "").split("·").map(s => s.trim()).filter(Boolean);
                const dests = (parts[1] || "").split(",").map(s => s.trim()).filter(Boolean);
                if (origins.length && onStartWithRoute) {
                  onStartWithRoute(origins, dests);
                } else {
                  onStart();
                }
              }}>
                <span className="lp-route-emoji">{route.emoji}</span>
                <span className="lp-route-name">{route.name}</span>
                <span className="lp-route-cities">{route.cities}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="lp-testimonials">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-testimonials-title">{t("landing.testimonialsTitle")}</h2>
          <div className="lp-testimonials-grid">
            {(t("landing.testimonials") || []).map((item, i) => (
              <div key={i} className="lp-testimonial-card">
                <div className="lp-testimonial-stars">{"★".repeat(item.stars || 5)}</div>
                <p className="lp-testimonial-text">{item.text}</p>
                <div className="lp-testimonial-author">
                  <span className="lp-testimonial-avatar">{item.avatar}</span>
                  <div>
                    <span className="lp-testimonial-name">{item.name}</span>
                    <span className="lp-testimonial-origin">{item.origin}</span>
                  </div>
                </div>
              </div>
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

// ─── Breadcrumb ──────────────────────────────────────────────────────────────

// ─── Keyboard shortcuts overlay ──────────────────────────────────────────────

function KeyboardShortcutsOverlay({ show, onClose, t }) {
  if (!show) return null;
  const shortcuts = [
    { key: "Esc", desc: t("shortcuts.escape") },
    { key: "?", desc: t("shortcuts.help") },
    { key: "H", desc: t("shortcuts.home") },
    { key: "S", desc: t("shortcuts.search") },
  ];
  return (
    <div className="fm-shortcuts-overlay" onClick={onClose}>
      <div className="fm-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fm-shortcuts-header">
          <span className="fm-shortcuts-title">{t("shortcuts.title")}</span>
          <button type="button" className="fm-shortcuts-close" onClick={onClose}>✕</button>
        </div>
        <div className="fm-shortcuts-list">
          {shortcuts.map(s => (
            <div key={s.key} className="fm-shortcuts-row">
              <kbd className="fm-shortcuts-key">{s.key}</kbd>
              <span className="fm-shortcuts-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Breadcrumb({ current, onNavigate }) {
  const { t } = useI18n();
  const crumbs = [
    { key: "landing", label: t("breadcrumb.home") },
    { key: "search", label: t("breadcrumb.search") },
    ...(current === "results" ? [{ key: "results", label: t("breadcrumb.results") }] : []),
  ];
  return (
    <nav className="fm-breadcrumb" aria-label="breadcrumb">
      {crumbs.map((c, i) => (
        <React.Fragment key={c.key}>
          {i > 0 && <span className="fm-breadcrumb-sep">›</span>}
          <button type="button"
            className={`fm-breadcrumb-item${c.key === current ? " fm-breadcrumb-item--active" : ""}`}
            onClick={() => c.key !== current && onNavigate(c.key)}
            disabled={c.key === current}>
            {c.label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

// ─── Animated typing placeholder ─────────────────────────────────────────────

const TYPING_EXAMPLES = ["Madrid", "London", "Berlin", "Rome", "Paris", "Lisbon", "MAD", "LON", "BCN"];

function useTypingPlaceholder(active) {
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(true);
  const idxRef = useRef(0);
  const charRef = useRef(0);
  const dirRef = useRef(1); // 1 = typing, -1 = deleting

  useEffect(() => {
    if (!active) { setText(""); return; }
    const id = setInterval(() => {
      const word = TYPING_EXAMPLES[idxRef.current % TYPING_EXAMPLES.length];
      if (dirRef.current === 1) {
        charRef.current++;
        if (charRef.current > word.length) {
          dirRef.current = -1;
          setTyping(false);
          return;
        }
        setTyping(true);
      } else {
        charRef.current--;
        if (charRef.current <= 0) {
          dirRef.current = 1;
          idxRef.current++;
          setTyping(true);
          return;
        }
        setTyping(true);
      }
      setText(word.slice(0, charRef.current));
    }, dirRef.current === 1 ? 110 : 60);
    return () => clearInterval(id);
  }, [active]);

  return { text, typing };
}

// ─── Approximate distances for price-per-km ─────────────────────────────────

const CITY_COORDS = {
  MAD: [40.47, -3.56], BCN: [41.30, 2.08], AGP: [36.67, -4.49], PMI: [39.55, 2.74],
  TFS: [28.04, -16.57], LON: [51.47, -0.46], EDI: [55.95, -3.37], PAR: [49.01, 2.55],
  ROM: [41.80, 12.25], MIL: [45.63, 8.72], NAP: [40.88, 14.29], BER: [52.36, 13.51],
  MUC: [48.35, 11.79], FRA: [50.03, 8.57], AMS: [52.31, 4.76], LIS: [38.77, -9.13],
  OPO: [41.24, -8.68], DUB: [53.42, -6.27], BRU: [50.90, 4.48], GVA: [46.24, 6.11],
  ZRH: [47.46, 8.55], VIE: [48.11, 16.57], PRG: [50.10, 14.26], WAW: [52.17, 20.97],
  BUD: [47.44, 19.26], ATH: [37.94, 23.94], CPH: [55.62, 12.66], IST: [41.28, 28.74],
  RAK: [31.60, -8.04], MLA: [35.86, 14.48], DBV: [42.56, 18.27], SPU: [43.54, 16.30],
  NCE: [43.66, 7.21], MRS: [43.44, 5.22], HEL: [60.32, 24.96], OSL: [60.19, 11.10],
  STO: [59.65, 17.94], OTP: [44.57, 26.09], SOF: [42.70, 23.41], BEG: [44.82, 20.31],
  TIA: [41.41, 19.72], TLV: [32.01, 34.89], KRK: [50.08, 19.78], TLL: [59.41, 24.83],
  RIX: [56.92, 23.97], VNO: [54.63, 25.29], SKG: [40.52, 22.97], RHO: [36.41, 28.09],
  ZAG: [45.74, 16.07], CMN: [33.37, -7.59],
};

function approxDistKm(code1, code2) {
  const c1 = CITY_COORDS[code1], c2 = CITY_COORDS[code2];
  if (!c1 || !c2) return null;
  const R = 6371;
  const dLat = (c2[0] - c1[0]) * Math.PI / 180;
  const dLon = (c2[1] - c1[1]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(c1[0] * Math.PI / 180) * Math.cos(c2[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  const [acFocus, setAcFocus] = useState(-1); // which origin input has autocomplete open
  const [acHighlight, setAcHighlight] = useState(0); // keyboard nav index
  const [dragIdx, setDragIdx] = useState(-1); // drag-drop reorder
  const [dragOver, setDragOver] = useState(-1);

  // Animated typing placeholder for empty first origin
  const showTyping = origins.length >= 1 && !origins[0]?.trim() && !loading;
  const { text: typingText, typing: typingActive } = useTypingPlaceholder(showTyping);

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

  // Inline autocomplete suggestions (max 5, only when typing 1+ chars)
  const acSuggestions = useMemo(() => {
    if (acFocus < 0) return [];
    const val = (origins[acFocus] || "").trim().toLowerCase();
    if (!val || val.length < 1) return [];
    // Don't show if already a valid code
    if (AIRPORT_MAP[val.toUpperCase()]) return [];
    return AIRPORTS.filter((a) =>
      a.code.toLowerCase().includes(val) ||
      a.city.toLowerCase().includes(val)
    ).slice(0, 5);
  }, [acFocus, origins]);

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

          {/* Form completion indicators */}
          {!loading && (
            <div className="sf-completion-strip">
              <div className={`sf-completion-step${origins.some(o => o.trim() && cityOf(normalizeCode(o))) ? " sf-completion-step--done" : ""}`}>
                <span className="sf-completion-icon">{origins.some(o => o.trim() && cityOf(normalizeCode(o))) ? "✓" : "1"}</span>
                <span className="sf-completion-label">{t("search.completionOrigins")}</span>
              </div>
              <div className="sf-completion-line" />
              <div className={`sf-completion-step${departureDate ? " sf-completion-step--done" : ""}`}>
                <span className="sf-completion-icon">{departureDate ? "✓" : "2"}</span>
                <span className="sf-completion-label">{t("search.completionDates")}</span>
              </div>
              <div className="sf-completion-line" />
              <div className={`sf-completion-step${origins.some(o => o.trim() && cityOf(normalizeCode(o))) && departureDate ? " sf-completion-step--done" : ""}`}>
                <span className="sf-completion-icon">{origins.some(o => o.trim() && cityOf(normalizeCode(o))) && departureDate ? "✓" : "3"}</span>
                <span className="sf-completion-label">{t("search.completionReady")}</span>
              </div>
            </div>
          )}

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
            {/* Empty state prompt */}
            {origins.length === 1 && !origins[0].trim() && !loading && (
              <div className="sf-empty-state">
                <div className="sf-empty-icon">🗺️</div>
                <div className="sf-empty-text">{t("search.emptyHint")}</div>
              </div>
            )}

            {/* Origins */}
            <div className="sf-section">
              <div className="sf-label">{t("search.originLabel")}</div>
              {origins.map((origin, idx) => {
                const code = normalizeCode(origin);
                const city = cityOf(code);
                const isUnknown = origin.trim().length >= 3 && !city;
                return (
                  <div key={idx}
                    className={`sf-origin-row${dragIdx === idx ? " sf-origin-row--dragging" : ""}${dragOver === idx ? " sf-origin-row--dragover" : ""}`}
                    draggable={origins.length > 1 && !loading}
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
                    onDragLeave={() => setDragOver(-1)}
                    onDrop={() => {
                      if (dragIdx >= 0 && dragIdx !== idx) {
                        const o = [...origins]; const p = [...passengers];
                        const [oItem] = o.splice(dragIdx, 1); o.splice(idx, 0, oItem);
                        const [pItem] = p.splice(dragIdx, 1); p.splice(idx, 0, pItem);
                        setOrigins(o); setPassengers(p);
                      }
                      setDragIdx(-1); setDragOver(-1);
                    }}
                    onDragEnd={() => { setDragIdx(-1); setDragOver(-1); }}>
                    {origins.length > 1 && <span className="sf-drag-handle" title="Drag to reorder">⠿</span>}
                    <span className="sf-badge" title={t("search.travelerTooltip", { n: idx + 1 })}>
                      <span className="sf-badge-icon">👤</span>{idx + 1}
                    </span>
                    <div className="sf-input-wrap">
                      {/* Typing placeholder animation */}
                      {idx === 0 && showTyping && typingText && (
                        <span className={`sf-typing-placeholder${typingActive ? " sf-typing-placeholder--active" : ""}`}>
                          {typingText}
                        </span>
                      )}
                      <input
                        type="text"
                        className={`form-control sf-input text-uppercase${isUnknown ? " sf-input--unknown" : ""}`}
                        placeholder={idx === 0 && showTyping ? "" : t("search.placeholder")}
                        value={origin}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          startTransition(() => {
                            const copy = [...origins];
                            copy[idx] = val;
                            setOrigins(copy);
                          });
                          setAcFocus(idx);
                          setAcHighlight(0);
                        }}
                        onFocus={() => { setActiveIdx(idx); setAcFocus(idx); setAcHighlight(0); }}
                        onBlur={() => setTimeout(() => setAcFocus(-1), 150)}
                        onKeyDown={(e) => {
                          if (acFocus === idx && acSuggestions.length > 0) {
                            if (e.key === "ArrowDown") { e.preventDefault(); setAcHighlight((h) => Math.min(h + 1, acSuggestions.length - 1)); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setAcHighlight((h) => Math.max(h - 1, 0)); }
                            else if (e.key === "Enter" && acSuggestions[acHighlight]) {
                              e.preventDefault();
                              const copy = [...origins]; copy[idx] = acSuggestions[acHighlight].code; setOrigins(copy); setAcFocus(-1);
                            }
                          }
                        }}
                        disabled={loading}
                        autoComplete="off"
                      />
                      {/* Inline autocomplete dropdown */}
                      {acFocus === idx && acSuggestions.length > 0 && (
                        <div className="sf-ac-dropdown">
                          {acSuggestions.map((a, ai) => (
                            <div key={a.code}
                              className={`sf-ac-item${ai === acHighlight ? " sf-ac-item--hl" : ""}`}
                              onMouseDown={(e) => { e.preventDefault(); const copy = [...origins]; copy[idx] = a.code; setOrigins(copy); setAcFocus(-1); }}
                              onMouseEnter={() => setAcHighlight(ai)}>
                              <span className="sf-ac-code">{a.code}</span>
                              <span className="sf-ac-city">{a.city}</span>
                              <span className="sf-ac-country">{countryFlag(a.code)} {a.country}</span>
                            </div>
                          ))}
                        </div>
                      )}
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
                  <div className="sf-date-wrap">
                    <input type="date" className="form-control sf-input"
                      value={departureDate} min={todayISO()}
                      onChange={(e) => setDepartureDate(e.target.value)} disabled={loading} />
                    {departureDate && <span className={`sf-weekday-badge${["Tue","Wed"].includes(weekdayOf(departureDate)) ? " sf-weekday-badge--cheap" : ""}`}>{weekdayOf(departureDate)}</span>}
                  </div>
                </div>
                {tripType === "roundtrip" && (
                  <div className="col-sm-6">
                    <label className="sf-input-label">{t("search.return")}</label>
                    <div className="sf-date-wrap">
                      <input type="date" className="form-control sf-input"
                        value={returnDate} min={departureDate || todayISO()}
                        onChange={(e) => setReturnDate(e.target.value)} disabled={loading} />
                      {returnDate && <span className={`sf-weekday-badge${["Tue","Wed"].includes(weekdayOf(returnDate)) ? " sf-weekday-badge--cheap" : ""}`}>{weekdayOf(returnDate)}</span>}
                    </div>
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

            {/* Advanced: Flex dates + Optimize + Budget */}
            {showAdvanced && (
              <div className="sf-advanced-panel">
                {/* Flexible dates */}
                <div className="sf-section">
                  <div className="d-flex align-items-center justify-content-between">
                    <div>
                      <div className="sf-label mb-0">{t("search.flexLabel")}</div>
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
                  {(() => {
                    const totalPax = origins.filter(o => o.trim()).reduce((s, o, i) => s + (passengers[i] || 1), 0);
                    return totalPax > 1 ? <span className="sf-summary-pax-total">👥 {totalPax} {t("search.paxLabel")}</span> : null;
                  })()}
                  {departureDate && <span>{formatDate(departureDate)}</span>}
                  {tripType === "roundtrip" && returnDate && <span> → {formatDate(returnDate)}</span>}
                  {flexEnabled && <span className="sf-summary-flex">±{flexDays}d</span>}
                </div>
              </div>
            )}

            <div className="sf-submit-wrap">
              <button type="submit" className={`btn-fm-primary w-100 py-3 fw-bold fs-6${!loading && origins.some(o => o.trim()) && departureDate ? " sf-submit--ready" : ""}`} disabled={loading}>
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
  onShare, onShareWhatsApp, onShareTelegram, onShareEmail, onShareNative, onCopySearchLink, shareStatus,
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
      {/* Confetti burst on entrance */}
      {entered && (
        <div className="wc-confetti" aria-hidden="true">
          {[...Array(12)].map((_, i) => <span key={i} className="wc-confetti-piece" style={{ "--ci": i }} />)}
        </div>
      )}
      {/* Hero image */}
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          <div className="wc-badge-winner">{t("results.eyebrow")}</div>
          <span className="wc-dest-code">{city || code}</span>
          {city && <span className="wc-dest-city">{code}</span>}
          {/* Destination category tags */}
          {(() => {
            const cats = destCategoryTags(code, t);
            if (!cats.length) return null;
            return (
              <div className="wc-dest-categories">
                {cats.map(c => <span key={c.key} className={`wc-dest-cat wc-dest-cat--${c.key}`}>{c.label}</span>)}
              </div>
            );
          })()}
        </div>
        <button type="button" className={`wc-fav-btn${isFav ? " wc-fav-btn--active" : ""}`} onClick={onToggleFav} aria-label={t("results.favorite")} title={t("results.favorite")}>
          {isFav ? "❤️" : "🤍"}
        </button>
        {/* Savings + trip duration + countdown + vs last search chips */}
        <div className="wc-chips-overlay">
          {/* Countdown to departure */}
          {(() => {
            const depD = dep || depDate;
            if (!depD) return null;
            const days = Math.ceil((new Date(depD + "T00:00:00") - new Date()) / 86400000);
            if (days < 0 || days > 365) return null;
            const urgency = days <= 3 ? "urgent" : days <= 14 ? "soon" : "normal";
            return (
              <span className={`wc-countdown-chip wc-countdown-chip--${urgency}`}>
                {days === 0 ? t("results.countdownToday") : days === 1 ? t("results.countdownTomorrow") : t("results.countdownDays", { n: days })}
              </span>
            );
          })()}
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

      {/* Destination quick info (timezone, language, weather) */}
      {(() => {
        const qi = destQuickInfo(code);
        const weather = getWeatherHint(code, dep || depDate, t);
        if (!qi && !weather) return null;
        return (
          <div className="wc-quick-info">
            {qi?.tz && <span className="wc-quick-info-item">🕐 UTC{qi.tz}</span>}
            {qi?.lang && <span className="wc-quick-info-item">🗣️ {qi.lang}</span>}
            {qi?.currency && <span className="wc-quick-info-item">💱 {qi.currency}</span>}
            {weather && <span className="wc-quick-info-item">{weather}</span>}
          </div>
        );
      })()}

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
        <div className="wc-summary-item wc-summary-item--tooltip">
          <div className="wc-summary-label">{t("results.fairnessLabel")} <span className="wc-fairness-help">?</span></div>
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
          <div className="wc-tooltip wc-tooltip--fairness">
            <div>{t("results.fairnessHelp")}</div>
            <div className="wc-tooltip-row" style={{ marginTop: 6 }}>
              <span>{t("results.maxSpread")}</span>
              <span>{formatEur(dest.priceSpread ?? 0, 0)}</span>
            </div>
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
                        {typeof price === "number" && (() => {
                          const km = approxDistKm(origin, code);
                          if (!km || km < 50) return null;
                          const ppkm = (price / km).toFixed(2);
                          return <span className="wc-km-badge">€{ppkm}/km</span>;
                        })()}
                      </div>
                    </div>
                    {/* Outbound itinerary */}
                    {(airline || stops !== null || durationText) && (
                      <div className="wc-flight-meta">
                        <span className="wc-flight-meta-item wc-flight-meta-leg">{t("results.outbound")}</span>
                        {airline && <span className="wc-flight-meta-item wc-flight-meta-airline"><img src={airlineLogo(airline)} alt={airline} className="wc-airline-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} /><span className="wc-airline-badge">{airline}</span></span>}
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
                    {/* Duration comparison bar */}
                    {durationText && (() => {
                      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
                      if (!match) return null;
                      const mins = (parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0);
                      if (!mins) return null;
                      const maxMins = 12 * 60; // 12h reference
                      const pct = Math.min(100, (mins / maxMins) * 100);
                      const color = mins <= 120 ? "#22C55E" : mins <= 300 ? "var(--primary)" : "#F59E0B";
                      return (
                        <div className="wc-duration-bar-wrap">
                          <div className="wc-duration-bar">
                            <div className="wc-duration-bar-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="wc-duration-bar-label">{durationText}</span>
                        </div>
                      );
                    })()}
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
                      <button type="button" className="wc-cta wc-cta--copy" onClick={() => {
                        const txt = `${originCity || origin} → ${destCity} · ${typeof price === "number" ? (currency === "EUR" ? formatEur(price, 0) : convertPrice(price, currency)) : "—"}${durationText ? ` · ${durationText}` : ""}`;
                        copyText(txt);
                      }} title={t("results.copyFlight")}>
                        📋
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

              {/* Flight time comparison mini-table */}
              {cleanOrigins.length > 1 && breakdown.length > 1 && (() => {
                const durations = breakdown.map((f) => {
                  const itin = f.offer?.itineraries?.[0];
                  const dur = itin?.duration || "";
                  const match = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
                  const mins = match ? (parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0) : 0;
                  const durText = dur ? dur.replace("PT", "").replace("H", "h ").replace("M", "m").trim() : "";
                  return { origin: String(f.origin).toUpperCase(), mins, durText, price: f.price };
                }).filter(d => d.mins > 0);
                if (durations.length < 2) return null;
                const maxMins = Math.max(...durations.map(d => d.mins));
                return (
                  <div className="wc-flight-compare-section">
                    <div className="wc-flight-compare-title">{t("results.flightComparison")}</div>
                    {durations.map((d) => {
                      const pct = maxMins > 0 ? (d.mins / maxMins) * 100 : 0;
                      const color = d.mins <= 120 ? "#22C55E" : d.mins <= 300 ? "var(--primary)" : "#F59E0B";
                      return (
                        <div key={d.origin} className="wc-flight-compare-row">
                          <span className="wc-flight-compare-origin">{d.origin}</span>
                          <div className="wc-flight-compare-bar-wrap">
                            <div className="wc-flight-compare-bar-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="wc-flight-compare-dur">{d.durText}</span>
                          <span className="wc-flight-compare-price">{currency === "EUR" ? formatEur(d.price, 0) : convertPrice(d.price, currency)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            </div>{/* /wc-booking-collapse */}
          </div>
        )}

        {/* Trip summary compact card */}
        {cleanOrigins.length > 0 && (
          <div className="wc-trip-summary">
            <div className="wc-trip-summary-item">
              <span className="wc-trip-summary-value">{cleanOrigins.length}</span>
              <span className="wc-trip-summary-label">{t("results.originsUsed")}</span>
            </div>
            <div className="wc-trip-summary-sep" />
            <div className="wc-trip-summary-item">
              <span className="wc-trip-summary-value">{currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}</span>
              <span className="wc-trip-summary-label">{t("results.avgPerPerson")}</span>
            </div>
            <div className="wc-trip-summary-sep" />
            <div className="wc-trip-summary-item">
              <span className="wc-trip-summary-value">{(dest.fairnessScore ?? 0).toFixed(0)}</span>
              <span className="wc-trip-summary-label">{t("results.fairnessLabel")}</span>
            </div>
            {tripDays > 0 && (
              <>
                <div className="wc-trip-summary-sep" />
                <div className="wc-trip-summary-item">
                  <span className="wc-trip-summary-value">{tripDays}</span>
                  <span className="wc-trip-summary-label">{t("results.tripSummaryDays")}</span>
                </div>
              </>
            )}
            {(() => {
              const km = approxDistKm(cleanOrigins[0], code);
              if (!km) return null;
              return (
                <>
                  <div className="wc-trip-summary-sep" />
                  <div className="wc-trip-summary-item">
                    <span className="wc-trip-summary-value">{Math.round(km).toLocaleString()}</span>
                    <span className="wc-trip-summary-label">km</span>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Price confidence meter */}
        <PriceConfidence breakdown={breakdown} t={t} />

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
          {onCopySearchLink && (
            <button type="button" className="wc-action-btn wc-action-btn--link" onClick={onCopySearchLink}>
              🔗 {t("results.copySearchLink")}
            </button>
          )}
          <button type="button" className="wc-share-img-btn" onClick={() => {
            const canvas = document.createElement("canvas");
            canvas.width = 600; canvas.height = 340;
            const ctx = canvas.getContext("2d");
            // Background gradient
            const bg = ctx.createLinearGradient(0, 0, 600, 340);
            bg.addColorStop(0, "#0062E3"); bg.addColorStop(1, "#7C3AED");
            ctx.fillStyle = bg; ctx.fillRect(0, 0, 600, 340);
            // Text
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 14px system-ui"; ctx.fillText("FlyndMe", 300, 35);
            ctx.font = "bold 32px system-ui"; ctx.fillText(city || code, 300, 80);
            ctx.font = "18px system-ui";
            ctx.fillText(`${t("results.groupTotal")}: ${currency === "EUR" ? formatEur(dest.totalCostEUR, 0) : convertPrice(dest.totalCostEUR, currency)}`, 300, 120);
            ctx.fillText(`${t("results.avgPerPerson")}: ${currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}`, 300, 150);
            ctx.fillText(`${t("results.fairnessLabel")}: ${(dest.fairnessScore ?? 0).toFixed(0)}/100`, 300, 180);
            // Per-origin breakdown
            ctx.font = "14px system-ui"; ctx.fillStyle = "rgba(255,255,255,.85)";
            breakdown.forEach((f, i) => {
              const km = approxDistKm(String(f.origin).toUpperCase(), code);
              const kmStr = km ? ` · ${Math.round(km)} km` : "";
              ctx.fillText(`${f.origin}: ${currency === "EUR" ? formatEur(f.price, 0) : convertPrice(f.price, currency)}${kmStr}`, 300, 220 + i * 24);
            });
            ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "11px system-ui";
            ctx.fillText("flyndme.com", 300, 330);
            canvas.toBlob((blob) => {
              if (!blob) return;
              try {
                const item = new ClipboardItem({ "image/png": blob });
                navigator.clipboard.write([item]);
              } catch { /* fallback: download */ }
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `flyndme-${code}.png`;
              a.click(); URL.revokeObjectURL(url);
            });
          }}>
            🖼️ Share as image
          </button>
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

// ─── Search params summary (results page) ────────────────────────────────────

const SearchParamsSummary = React.memo(function SearchParamsSummary({
  origins, departureDate, returnDate, tripType, flexEnabled, flexDays,
  cabinClass, directOnly, budgetEnabled, maxBudget, currency,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const tags = [
    tripType === "roundtrip" ? t("search.roundtrip") : t("search.oneway"),
    departureDate && formatDate(departureDate),
    tripType === "roundtrip" && returnDate && `→ ${formatDate(returnDate)}`,
    flexEnabled && `±${flexDays}d`,
    cabinClass !== "ECONOMY" && (cabinClass === "BUSINESS" ? t("search.cabinBusiness") : t("search.cabinPremium")),
    directOnly && t("search.directOnly"),
    budgetEnabled && t("search.budgetHintOn", { amount: formatEur(maxBudget) }),
  ].filter(Boolean);

  return (
    <div className="fm-search-summary">
      <button type="button" className="fm-search-summary-toggle" onClick={() => setOpen(v => !v)}>
        <div className="fm-search-summary-origins">
          {origins.map(o => (
            <span key={o} className="fm-search-summary-chip">{countryFlag(o)} {o}</span>
          ))}
        </div>
        <span className={`fm-search-summary-chevron${open ? " fm-search-summary-chevron--open" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="fm-search-summary-tags">
          {tags.map((tag, i) => (
            <span key={i} className="fm-search-summary-tag">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Destination category tags ───────────────────────────────────────────────

const DEST_CATEGORIES = {
  beach:   new Set(["AGP","PMI","TFS","NCE","MLA","DBV","SPU","RHO","TLV"]),
  budget:  new Set(["OPO","NAP","KRK","BEG","OTP","SOF","TIA","RAK","TLL","RIX","VNO","SKG"]),
  capital: new Set(["LON","PAR","ROM","BER","MAD","LIS","VIE","PRG","ATH","CPH","BUD","DUB","BRU","WAW","OSL","HEL","STO"]),
};

function destCategoryTags(code, t) {
  const tags = [];
  if (DEST_CATEGORIES.beach.has(code))   tags.push({ key: "beach",   label: t("search.destCatBeach") });
  if (DEST_CATEGORIES.budget.has(code))  tags.push({ key: "budget",  label: t("search.destCatBudget") });
  if (DEST_CATEGORIES.capital.has(code)) tags.push({ key: "capital", label: t("search.destCatCapital") });
  return tags;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { t } = useI18n();
  const { resolved: themeResolved, toggle: toggleTheme } = useTheme();
  const { favs, toggle: toggleFav, isFav } = useFavorites();
  const backendStatus = useBackendStatus(API_BASE);
  const { reducedMotion, highContrast } = useA11yPrefs();

  // Set a11y attributes on root
  useEffect(() => {
    document.documentElement.setAttribute("data-reduced-motion", reducedMotion ? "true" : "false");
    document.documentElement.setAttribute("data-high-contrast", highContrast ? "true" : "false");
  }, [reducedMotion, highContrast]);

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

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore if user is typing in an input
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Escape: close panels first, then go back
      if (e.key === "Escape") {
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (showFavPanel) { setShowFavPanel(false); return; }
        const cur = viewRef.current;
        if (cur === "results") setView("search");
        else if (cur === "search") setView("landing");
      }
      // ? = show shortcuts
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        setShowShortcuts(v => !v); return;
      }
      // H = go home
      if (e.key.toLowerCase() === "h") { setView("landing"); return; }
      // S = go to search
      if (e.key.toLowerCase() === "s") { setView("search"); return; }
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
  const [showFavPanel, setShowFavPanel] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Last search best price (for comparison)
  const [lastBestPrice, setLastBestPrice] = useState(() => {
    try { return Number(localStorage.getItem("flyndme_last_best") || 0); } catch { return 0; }
  });

  // Search duration (seconds)
  const [searchDuration, setSearchDuration] = useState(0);
  const searchStartRef = useRef(0);

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

  // ── Auto-save search draft to localStorage ────────────────────────────
  const DRAFT_KEY = "flyndme_draft";

  // Restore draft on mount
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft && draft.origins?.length) {
        setOrigins(draft.origins);
        if (draft.tripType) setTripType(draft.tripType);
        if (draft.departureDate) setDepartureDate(draft.departureDate);
        if (draft.returnDate) setReturnDate(draft.returnDate);
        if (draft.passengers) setPassengers(draft.passengers);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save draft on change (debounced)
  useEffect(() => {
    const tid = setTimeout(() => {
      try {
        const hasInput = origins.some(o => o.trim());
        if (hasInput) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ origins, tripType, departureDate, returnDate, passengers }));
        }
      } catch { /* quota */ }
    }, 500);
    return () => clearTimeout(tid);
  }, [origins, tripType, departureDate, returnDate, passengers]);

  // Clear draft on successful search
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
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

  // ── Load search params from URL (from copy-search-link) ────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("share")) return; // handled above
    const urlOrigins = params.getAll("o").map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!urlOrigins.length) return;
    setOrigins(urlOrigins);
    setPassengers(urlOrigins.map(() => 1));
    if (params.get("dep")) setDepartureDate(params.get("dep"));
    if (params.get("ret")) setReturnDate(params.get("ret"));
    if (params.get("trip")) setTripType(params.get("trip"));
    if (params.get("opt")) setOptimizeBy(params.get("opt"));
    if (params.get("direct") === "1") setDirectOnly(true);
    if (params.get("cabin")) setCabinClass(params.get("cabin"));
    if (params.get("cur")) setCurrency(params.get("cur"));
    setView("search");
    window.history.replaceState({}, "", window.location.pathname);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bestDestination = bestByCriterion[uiCriterion] || bestByCriterion.total || null;

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

  // ── Copy search params as URL ─────────────────────────────────────────────

  const handleCopySearchLink = () => {
    const params = new URLSearchParams();
    cleanOrigins.forEach(o => params.append("o", o));
    if (departureDate) params.set("dep", departureDate);
    if (tripType === "roundtrip" && returnDate) params.set("ret", returnDate);
    params.set("trip", tripType);
    if (optimizeBy !== "total") params.set("opt", optimizeBy);
    if (directOnly) params.set("direct", "1");
    if (cabinClass !== "ECONOMY") params.set("cabin", cabinClass);
    if (currency !== "EUR") params.set("cur", currency);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    copyText(url);
    setToast({ message: t("share.searchLinkCopied"), type: "success" });
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
    setSearchDuration(0);
    searchStartRef.current = Date.now();
    clearDraft();

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
          // Preload top destination images for smoother results UX
          adjusted.slice(0, 6).forEach((d) => {
            const img = new Image();
            img.src = getCityImage(normalizeCode(d.destination), getBaseUrl(), { w: 1200, h: 500 });
          });

          setView("results");
          document.title = "FlyndMe - Flight Results";
          window.scrollTo({ top: 0, behavior: "smooth" });
          // Record search duration
          if (searchStartRef.current) {
            setSearchDuration(((Date.now() - searchStartRef.current) / 1000).toFixed(1));
          }
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
            <span className={`fm-backend-dot fm-backend-dot--${backendStatus}`} title={backendStatus === "online" ? t("header.serverOnline") : backendStatus === "offline" ? t("header.serverWaking") : ""} />
          </div>
          <div className="d-flex align-items-center gap-2">
            {favs.length > 0 && (
              <button type="button" className="fm-fav-header-btn" onClick={() => setShowFavPanel((v) => !v)}
                title={t("results.favorite")}>
                ❤️ <span className="fm-fav-header-count">{favs.length}</span>
              </button>
            )}
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

      {/* Favorites panel */}
      {showFavPanel && (
        <>
          <div className="fm-fav-overlay" onClick={() => setShowFavPanel(false)} />
          <div className="fm-fav-panel">
            <div className="fm-fav-panel-header">
              <span className="fm-fav-panel-title">{t("favorites.title")}</span>
              <button type="button" className="fm-fav-panel-close" onClick={() => setShowFavPanel(false)}>✕</button>
            </div>
            {favs.length === 0 ? (
              <div className="fm-fav-panel-empty">{t("favorites.empty")}</div>
            ) : (
              <div className="fm-fav-panel-list">
                {favs.map((f) => (
                  <div key={f.code} className="fm-fav-panel-item">
                    <span className="fm-fav-panel-flag">{countryFlag(f.code)}</span>
                    <div className="fm-fav-panel-info">
                      <span className="fm-fav-panel-code">{f.code}</span>
                      <span className="fm-fav-panel-city">{f.city}</span>
                    </div>
                    <span className="fm-fav-panel-price">{formatEur(f.price, 0)}/pp</span>
                    <button type="button" className="fm-fav-panel-remove"
                      onClick={() => toggleFav({ destination: f.code, averageCostPerTraveler: f.price })}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Loading bar */}
      <SearchProgress loading={loading} />

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}

      {/* Keyboard shortcuts overlay */}
      <KeyboardShortcutsOverlay show={showShortcuts} onClose={() => setShowShortcuts(false)} t={t} />

      {/* Views */}
      <div id="main-content">
      {view === "landing" && (
        <div className="view-enter" key="landing">
          <Landing onStart={() => setView("search")} onStartWithRoute={(origins, dests) => {
            setOrigins(origins);
            setPassengers(origins.map(() => 1));
            if (dests.length) setSelectedDests(dests);
            setView("search");
          }} />
          {/* Search history panel on landing */}
          <div className="container" style={{ maxWidth: 1080 }}>
            <SearchHistoryPanel
              searches={recentSearches}
              onLoad={(entry) => { loadRecentSearch(entry); setView("search"); }}
              onClear={clearRecentSearches}
              t={t}
            />
          </div>
        </div>
      )}

      {view === "search" && (
        <div className="view-enter view-enter-search" key="search">
        <div className="container" style={{ maxWidth: 960 }}>
          <Breadcrumb current="search" onNavigate={(k) => { setView(k); if (k === "landing") setShowAlt(false); }} />
        </div>
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

      {/* Results loading skeleton */}
      {loading && view === "results" && !bestDestination && (
        <div className="container py-4 view-enter" key="results-skeleton" style={{ maxWidth: 1080 }}>
          <ResultsSkeleton />
        </div>
      )}

      {view === "results" && bestDestination && (
        <main className="container py-4 view-enter" key="results" style={{ maxWidth: 1080 }}>
          <Breadcrumb current="results" onNavigate={(k) => { setView(k); if (k !== "results") setShowAlt(false); }} />

          {/* Search params summary (collapsible) */}
          <SearchParamsSummary
            origins={cleanOrigins}
            departureDate={departureDate}
            returnDate={returnDate}
            tripType={tripType}
            flexEnabled={flexEnabled}
            flexDays={flexDays}
            cabinClass={cabinClass}
            directOnly={directOnly}
            budgetEnabled={budgetEnabled}
            maxBudget={maxBudget}
            currency={currency}
          />

          {/* Sticky results mini-bar */}
          <div className="fm-sticky-bar">
            <div className="fm-sticky-inner">
              <span className="fm-sticky-dest">✈ {cityOf(normalizeCode(bestDestination.destination)) || normalizeCode(bestDestination.destination)}</span>
              <span className="fm-sticky-price">{currency === "EUR" ? formatEur(bestDestination.averageCostPerTraveler, 0) : convertPrice(bestDestination.averageCostPerTraveler, currency)}/pp</span>
              <span className="fm-sticky-origins">{cleanOrigins.join(" · ")}</span>
              <div className="fm-currency-switcher">
                {["EUR", "GBP", "USD"].map(c => (
                  <button key={c} type="button"
                    className={`fm-currency-btn${currency === c ? " fm-currency-btn--active" : ""}`}
                    onClick={() => setCurrency(c)}>
                    {FX_SYMBOLS[c]}
                  </button>
                ))}
              </div>
              <button type="button" className="fm-sticky-btn" onClick={() => setView("search")}>{t("results.changeSearch")}</button>
            </div>
          </div>

          {/* Destination image banner */}
          <DestImageBanner destCode={normalizeCode(bestDestination.destination)} />

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
            onCopySearchLink={handleCopySearchLink}
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

          {/* ── CORE: Origin ranking table ── */}
          <OriginRankingTable bestDest={bestDestination} currency={currency} t={t} />

          {/* ── CORE: Top 3 destinations podium ── */}
          <TopDestinationsPodium flights={flights} currency={currency} onSelect={(dest) => {
            const idx = flights.findIndex(f => f.destination === dest.destination);
            if (idx >= 0) {
              setBestByCriterion(prev => ({ ...prev, [uiCriterion]: dest }));
            }
          }} />

          {/* ── CORE: Stats bar ── */}
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
            {searchDuration > 0 && (
              <>
                <span className="fm-stats-sep">·</span>
                <span className="fm-stats-item fm-stats-item--time">
                  ⏱ {searchDuration}s
                </span>
              </>
            )}
            <button type="button" className="fm-stats-export" onClick={() => exportResultsCSV(flights, cleanOrigins, currency)} title={t("results.exportCSV")}>
              📥 CSV
            </button>
            <ShareAsStoryBtn
              bestDest={bestDestination}
              origins={cleanOrigins}
              currency={currency}
              departureDate={departureDate}
              t={t}
            />
          </div>

          {/* ── CORE: Price compare on external sites ── */}
          <PriceCompareExternal
            bestDest={bestDestination}
            origins={cleanOrigins}
            departureDate={departureDate}
            returnDate={returnDate}
            tripType={tripType}
            t={t}
          />

          {/* ── MORE DETAILS toggle ── */}
          <button
            type="button"
            className="fm-more-toggle"
            onClick={() => setShowMoreDetails(v => !v)}
          >
            {showMoreDetails ? t("results.hideDetails") : t("results.showDetails")}
            <span className={`fm-more-arrow${showMoreDetails ? " fm-more-arrow--open" : ""}`}>▾</span>
          </button>

          {showMoreDetails && (
            <div className="fm-more-section view-enter">
              <AirlineLogos bestDest={bestDestination} t={t} />
              <GroupSizeIndicator origins={cleanOrigins} bestDest={bestDestination} currency={currency} t={t} />
              <DepartureCountdown24h bestDest={bestDestination} t={t} />
              <TripCountdown departureDate={bestDestination.bestDate || departureDate} t={t} />
              <BookingWindowTip departureDate={bestDestination.bestDate || departureDate} t={t} />
              <PriceHistoryHint departureDate={bestDestination.bestDate || departureDate} bestDest={bestDestination} t={t} />

              {flights.length >= 2 && (() => {
                const maxTotal = Math.max(...flights.map(f => f.totalCostEUR || 0));
                const saved = maxTotal - bestDestination.totalCostEUR;
                if (saved > 10) return (
                  <div className="fm-group-savings view-enter">
                    <span className="fm-group-savings-icon">💰</span>
                    <span>{t("results.groupSavings", { amount: currency === "EUR" ? formatEur(saved, 0) : convertPrice(saved, currency) })}</span>
                  </div>
                );
                return null;
              })()}

              <GroupBudgetGauge bestDest={bestDestination} origins={cleanOrigins} budgetEnabled={budgetEnabled} maxBudget={maxBudget} currency={currency} t={t} />
              <PriceSavingsVsSolo bestDest={bestDestination} origins={cleanOrigins} currency={currency} t={t} />

              {bestDestination.averageCostPerTraveler < 50 && (
                <div className="fm-celebrate view-enter">
                  <span className="fm-celebrate-confetti">🎉</span>
                  <div>
                    <strong>{t("results.celebrate")}</strong>
                    <span className="fm-celebrate-sub">{t("results.celebrateSub")}</span>
                  </div>
                </div>
              )}

              <DestWeatherBadge destCode={normalizeCode(bestDestination.destination)} departureDate={bestDestination.bestDate || departureDate} t={t} />
              <DestQuickFacts destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestCurrencyConverter destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestVisaHint destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestSafetyRating destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestLocalTransport destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestFoodCulture destCode={normalizeCode(bestDestination.destination)} t={t} />
              <WifiAvailabilityHint destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestLanguagePhrase destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestEventHint destCode={normalizeCode(bestDestination.destination)} departureDate={bestDestination.bestDate || departureDate} t={t} />
              <MultiCityBadge destCode={normalizeCode(bestDestination.destination)} t={t} />
              <SeasonalDemandIndicator departureDate={bestDestination.bestDate || departureDate} destCode={normalizeCode(bestDestination.destination)} t={t} />
              <DestTimezoneCompare origins={cleanOrigins} destCode={normalizeCode(bestDestination.destination)} t={t} />
              <FlightClassBadge bestDest={bestDestination} t={t} />
              <TripTypeInsight tripType={tripType} bestDest={bestDestination} departureDate={departureDate} t={t} />
              <PricePerDayCalc bestDest={bestDestination} departureDate={bestDestination.bestDate || departureDate} returnDate={returnDate} tripType={tripType} currency={currency} t={t} />
              <AlternativeDatesHint departureDate={bestDestination.bestDate || departureDate} t={t} />
              <CO2EstimateBadge bestDest={bestDestination} origins={cleanOrigins} t={t} />
              <DestPopularityMeter flights={flights} bestDest={bestDestination} t={t} />

              {(() => {
                const destCode = normalizeCode(bestDestination.destination);
                let totalKm = 0;
                let count = 0;
                cleanOrigins.forEach(o => {
                  const km = approxDistKm(o, destCode);
                  if (km) { totalKm += km; count++; }
                });
                if (!count) return null;
                return (
                  <div className="fm-distance-summary view-enter">
                    <span className="fm-distance-icon">🌍</span>
                    <span>{t("results.totalDistance", { km: Math.round(totalKm).toLocaleString() })}</span>
                    <span className="fm-distance-avg">{t("results.avgDistance", { km: Math.round(totalKm / count).toLocaleString() })}</span>
                  </div>
                );
              })()}

              <OriginSummaryChips origins={cleanOrigins} bestDestination={bestDestination} currency={currency} />

              {flights.length >= 3 && (
                <div className="fm-sparkline-wrap view-enter">
                  <span className="fm-sparkline-label">{t("results.priceTrend")}</span>
                  <PriceSparkline flights={flights} />
                  <span className="fm-sparkline-range">
                    {formatEur(Math.min(...flights.map(f => f.averageCostPerTraveler || Infinity)), 0)}
                    {" – "}
                    {formatEur(Math.max(...flights.map(f => f.averageCostPerTraveler || 0)), 0)}
                  </span>
                </div>
              )}

              {bestDestination?.flights?.length >= 2 && (
                <PriceDonut breakdown={bestDestination.flights} currency={currency} />
              )}
              <DestRadarChart flights={flights} bestDest={bestDestination} t={t} />
              <FlightTimeline bestDest={bestDestination} origins={cleanOrigins} t={t} />
              <FlightDurationComparison bestDest={bestDestination} t={t} />
              <StopoverInfo bestDest={bestDestination} t={t} />
              <ReturnFlightPreview bestDest={bestDestination} tripType={tripType} t={t} />
              <FlightConnectionWarning bestDest={bestDestination} t={t} />
              <FlightOperatorNote bestDest={bestDestination} t={t} />
              <EarlyMorningWarning bestDest={bestDestination} t={t} />
              <GroupArrivalSync bestDest={bestDestination} t={t} />
              <BaggageReminder bestDest={bestDestination} t={t} />
              <PriceBreakdownAccordion bestDest={bestDestination} currency={currency} t={t} />
              <CostSplitCard bestDest={bestDestination} origins={cleanOrigins} currency={currency} t={t} />
              <OriginSavingsCard bestDest={bestDestination} allFlights={flights} origins={cleanOrigins} currency={currency} t={t} />
              <PricePerKmRanking flights={flights} origins={cleanOrigins} currency={currency} t={t} />
              <NearbyAirportsHint origins={cleanOrigins} t={t} />
              <OriginDistanceMap bestDest={bestDestination} origins={cleanOrigins} t={t} />
              <ResultsSummaryCard bestDest={bestDestination} origins={cleanOrigins} flights={flights} currency={currency} departureDate={departureDate} returnDate={returnDate} tripType={tripType} t={t} />
              <SearchDurationBadge duration={searchDuration} t={t} />
              <TripSummaryExport bestDest={bestDestination} origins={cleanOrigins} departureDate={departureDate} returnDate={returnDate} tripType={tripType} currency={currency} t={t} />
              <QuickBookmarkBtn bestDest={bestDestination} departureDate={departureDate} t={t} />
              <GroupChatLink bestDest={bestDestination} origins={cleanOrigins} departureDate={departureDate} returnDate={returnDate} tripType={tripType} currency={currency} t={t} />
              <ResultsShareLink origins={cleanOrigins} departureDate={departureDate} returnDate={returnDate} tripType={tripType} t={t} />
              <TravelChecklist destCode={normalizeCode(bestDestination.destination)} tripType={tripType} t={t} />
              <PlanYourTripCTA destCode={normalizeCode(bestDestination.destination)} departureDate={bestDestination.bestDate || departureDate} returnDate={bestDestination.bestReturnDate || (tripType === "roundtrip" ? returnDate : "")} t={t} />
            </div>
          )}

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

          {/* Quick re-search: try nearby dates */}
          <div className="fm-quick-research view-enter">
            <span className="fm-quick-research-label">{t("results.tryNearbyDates")}</span>
            <div className="fm-quick-research-btns">
              {[-1, 1, -2, 2].map((offset) => {
                const d = new Date((departureDate || todayISO()) + "T00:00:00");
                d.setDate(d.getDate() + offset);
                const iso = d.toISOString().slice(0, 10);
                const label = `${offset > 0 ? "+" : ""}${offset}d · ${weekdayOf(iso)}`;
                return (
                  <button key={offset} type="button" className="fm-quick-research-btn"
                    onClick={() => {
                      setDepartureDate(iso);
                      if (tripType === "roundtrip" && returnDate) {
                        const r = new Date(returnDate + "T00:00:00");
                        r.setDate(r.getDate() + offset);
                        setReturnDate(r.toISOString().slice(0, 10));
                      }
                      setView("search");
                      setTimeout(() => {
                        document.querySelector(".sf-form form")?.requestSubmit?.();
                      }, 200);
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      )}
      </div>{/* /main-content */}

      {/* Scroll progress bar */}
      <ScrollProgressBar />

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
          <div className="app-footer-inner">
            <span className="app-footer-brand">{t("footerBrand")}</span>
            <span className="app-footer-tagline">{t("footerTagline")}</span>
            <nav className="app-footer-links">
              <a className="app-footer-link" onClick={() => { setView("landing"); window.scrollTo(0, 0); }}>{t("footerHow")}</a>
              <a className="app-footer-link" onClick={() => { setView("landing"); setTimeout(() => { const el = document.querySelector(".lp-faq"); if (el) el.scrollIntoView({ behavior: "smooth" }); }, 100); }}>{t("footerFaq")}</a>
              <a className="app-footer-link" href="mailto:hello@flyndme.com">{t("footerContact")}</a>
            </nav>
            <span className="app-footer-copy">{t("footerCopy")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
