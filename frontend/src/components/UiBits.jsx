// ─── Componentes presentacionales pequeños ───────────────────────────────────
// Extraídos de App.jsx (Mejora 17): sin estado de negocio, sin llamadas a red.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { formatEur } from "../utils/helpers";

// Esqueleto de carga de la vista de resultados
export function ResultsSkeleton() {
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

// Barra de progreso de scroll (parte superior)
export function ScrollProgressBar() {
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

// Overlay de atajos de teclado
export function KeyboardShortcutsOverlay({ show, onClose, t }) {
  if (!show) return null;
  const shortcuts = [
    { key: "Esc", desc: t("shortcuts.escape") },
    { key: "?", desc: t("shortcuts.help") },
    { key: "H", desc: t("shortcuts.home") },
    { key: "S", desc: t("shortcuts.search") },
  ];
  return (
    <div className="fm-shortcuts-overlay" onClick={onClose}>
      <div className="fm-shortcuts-modal" role="dialog" aria-modal="true" aria-label={t("shortcuts.title")} onClick={(e) => e.stopPropagation()}>
        <div className="fm-shortcuts-header">
          <span className="fm-shortcuts-title">{t("shortcuts.title")}</span>
          <button type="button" className="fm-shortcuts-close" onClick={onClose} aria-label={t("a11y.close")}>✕</button>
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

// Miga de pan de navegación entre vistas
export function Breadcrumb({ current, onNavigate }) {
  const { t } = useI18n();
  // Dos pantallas (rediseño jun-2026): Inicio › Resultados
  const crumbs = [
    { key: "landing", label: t("breadcrumb.home") },
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
            aria-current={c.key === current ? "page" : undefined}
            disabled={c.key === current}>
            {c.label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

// Estado de error amigable con botón de reintento
export const FriendlyError = React.memo(function FriendlyError({ message, onRetry }) {
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

// Contador animado (compartido por AnimatedStat aquí y AnimatedPrice en WinnerCard)
export function useCountUp(target, duration = 800, decimals = 0) {
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

// Número animado para estadísticas
export function AnimatedStat({ value }) {
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
