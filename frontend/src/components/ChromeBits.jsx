// ─── Piezas del shell de la app ──────────────────────────────────────────────
// Extraídas de App.jsx (Mejora 27): tema, idioma, toast, scroll-top y
// esqueletos de carga. Sin estado de negocio.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { scrollBehavior } from "../utils/helpers";

export const ThemeToggle = React.memo(function ThemeToggle({ resolved, toggle }) {
  const { t } = useI18n();
  // Patrón toggle button: nombre accesible constante ("Modo oscuro") +
  // aria-pressed según el estado; el icono es decorativo.
  const isDark = resolved === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={t("theme.dark")}
      title={isDark ? t("theme.light") : t("theme.dark")}
    >
      <span aria-hidden="true">{isDark ? "☀️" : "🌙"}</span>
    </button>
  );
});

export const ScrollToTopBtn = React.memo(function ScrollToTopBtn() {
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
      onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
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

export const LangSelector = React.memo(function LangSelector() {
  const { lang, setLang } = useI18n();
  return (
    <div className="btn-group btn-group-sm" role="group" aria-label="Language">
      {[["en", "EN"], ["es", "ES"]].map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={`btn ${lang === code ? "btn-light fw-bold" : "btn-outline-secondary"}`}
          style={{ minWidth: 38, fontSize: 13 }}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
});

export const Toast = React.memo(function Toast({ message, type = "success", onDone }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setExiting(true), 2200);
    const t2 = setTimeout(() => onDone?.(), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div className={`fm-toast fm-toast--${type}${exiting ? " fm-toast--exit" : ""}`} role="status">
      <span className="fm-toast-icon" aria-hidden="true">
        {type === "success" ? "✓" : type === "error" ? "✗" : "ℹ"}
      </span>
      {message}
    </div>
  );
});

export const LoadingTips = React.memo(function LoadingTips() {
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

export const AIRLINE_LOGOS = {};

export const SearchSkeleton = React.memo(function SearchSkeleton({ origins = [] }) {
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
