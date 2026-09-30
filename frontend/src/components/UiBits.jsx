// ─── Componentes presentacionales pequeños ───────────────────────────────────
// Extraídos de App.jsx (Mejora 17): sin estado de negocio, sin llamadas a red.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { X, AlertCircle } from "lucide-react";

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
  // Focus-trap (a11y): debe llamarse antes del early return (reglas de hooks).
  const trapRef = useFocusTrap(show, onClose);
  if (!show) return null;
  const shortcuts = [
    { key: "Esc", desc: t("shortcuts.escape") },
    { key: "?", desc: t("shortcuts.help") },
    { key: "H", desc: t("shortcuts.home") },
    { key: "S", desc: t("shortcuts.search") },
  ];
  return (
    <div className="fm-shortcuts-overlay" onClick={onClose}>
      <div className="fm-shortcuts-modal" ref={trapRef} role="dialog" aria-modal="true" aria-label={t("shortcuts.title")} onClick={(e) => e.stopPropagation()}>
        <div className="fm-shortcuts-header">
          <span className="fm-shortcuts-title">{t("shortcuts.title")}</span>
          <button type="button" className="fm-shortcuts-close" onClick={onClose} aria-label={t("a11y.close")}><X size={18} aria-hidden="true" /></button>
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

// Estado de error: el MOTIVO específico lidera (es el heading), no un genérico.
// `message` siempre llega con sentido (validación → específico; backend → mapeado;
// inesperado → "Algo salió mal"), así que se muestra prominente. role="alert"
// para que los lectores de pantalla lo anuncien.
export const FriendlyError = React.memo(function FriendlyError({ message, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="fm-error-state" role="alert">
      <div className="fm-error-icon" aria-hidden="true"><AlertCircle size={26} /></div>
      <p className="fm-error-message">{message}</p>
      {onRetry && (
        <button type="button" className="btn-fm-primary" onClick={onRetry}>
          {t("errors.tryAgain")}
        </button>
      )}
    </div>
  );
});

