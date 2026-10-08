import { useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { X } from "lucide-react";
import { FlapText, FlapCycle } from "./FlapBoard";

// Códigos que el panel "baraja" mientras dura la búsqueda. Es un indicador de
// actividad, no un resultado: nunca se asienta en ninguno ni muestra precios.
const SHUFFLE_CODES = ["PAR", "ROM", "LIS", "PRG", "BCN", "AMS", "VIE", "BUD", "MIL", "DUB"];

/**
 * Panel de salidas mientras se busca: los orígenes REALES del usuario →
 * destino que baraja códigos. Sustituye al "spinner genérico" encima del
 * skeleton de resultados.
 */
export function SearchingBoard({ origins = [], title, className = "", onCancel }) {
  const { t } = useI18n();
  const codes = (origins || []).map((o) => String(o).trim().toUpperCase()).filter(Boolean).slice(0, 8);
  return (
    <div className={`fm-searching-board ${className}`.trim()}>
      <div className="fm-searching-board-head" role="status" aria-live="polite">
        <span className="fm-searching-board-dot" aria-hidden="true" />
        {title || t("loading.boardTitle")}
      </div>
      <div className="fm-searching-board-row">
        <span className="fm-searching-board-origins">
          {codes.map((c, i) => <FlapText key={c + i} text={c} size="md" delay={i * 120} />)}
        </span>
        {/* Luces de aproximación que corren hacia el destino (decorativo) */}
        <span className="fm-rabbit" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ "--i": i }} />)}
          <b />
        </span>
        <span aria-hidden="true"><FlapCycle words={SHUFFLE_CODES} interval={650} size="md" /></span>
      </div>
      {onCancel && (
        <button type="button" className="fm-searching-cancel" onClick={onCancel}>
          <X size={14} aria-hidden="true" /> {t("loading.cancel")}
        </button>
      )}
    </div>
  );
}

/**
 * Thin animated progress bar at the top of the page — non-blocking.
 * Replaces the old full-screen overlay so the user can keep reading
 * while the search runs.
 */
export function SearchProgress({ loading, origins = [], onCancel, waking = false }) {
  const { t } = useI18n();
  const messages = t("loading.messages");
  const ariaLabel = t("loading.ariaLabel");

  const [step, setStep]       = useState(0);
  const [width, setWidth]     = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      // Finish animation then hide
      setWidth(100);
      const timer = setTimeout(() => { setVisible(false); setWidth(0); setStep(0); }, 400);
      return () => clearTimeout(timer);
    }

    setVisible(true);
    setWidth(8);
    setStep(0);

    // Advance message every 4 s (slower to cover long cold-starts)
    const msgTimer = setInterval(() => {
      setStep((p) => (p + 1) % (Array.isArray(messages) ? messages.length : 1));
    }, 4000);

    // Simulate progress (asymptotic — never quite reaches 95 % while loading)
    const progTimer = setInterval(() => {
      setWidth((w) => w + (95 - w) * 0.06);
    }, 800);

    return () => { clearInterval(msgTimer); clearInterval(progTimer); };
  }, [loading, messages]);

  if (!visible) return null;

  const currentMessage = Array.isArray(messages) ? messages[step] : "";

  return (
    <>
      {/* Progress bar */}
      <div
        className="fm-progress-bar"
        role="progressbar"
        aria-label={ariaLabel}
        style={{
          position:   "fixed",
          top:        0,
          left:       0,
          width:      `${width}%`,
          height:     3,
          background: "var(--sign, #FFC20E)",
          transition: loading ? "width 0.6s ease" : "width 0.35s ease",
          zIndex:     9999,
          borderRadius: "0 2px 2px 0",
        }}
      />

      {/* Panel de salidas acoplado abajo: orígenes reales → destino que baraja,
          con el mensaje de estado rotando como cabecera (antes: chip genérico
          con spinner). */}
      {loading && (
        <div className="fm-searching-dock">
          <SearchingBoard origins={origins} title={waking ? t("loading.waking") : currentMessage} onCancel={onCancel} />
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
