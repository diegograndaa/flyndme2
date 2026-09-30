// ─── BoardPanels ─────────────────────────────────────────────────────────────
// Bloques de la vista de resultados con la identidad "terminal de aeropuerto"
// (sep-2026). La vista se ordena en DOS zonas (01 Decisión · 02 Explorar):
//   · FlightHeader     → cabecera del vuelo del grupo (antes: migas + resumen)
//   · ZoneHead         → cabecera de cada zona (01 decisión final / 02 explorar)
//   · Notice           → aviso en línea donde importa: fecha más barata bajo la
//                        tarjeta, plan de grupo como "siguiente paso",
//                        resultados parciales sobre las alternativas
//   · DeparturesBoard  → "Salidas": todos los destinos encontrados, clicables
//                        (antes: podio Top 3 + barra de stats + lista aparte)
// Presentacionales puros (reciben props, emiten eventos). Datos 100% reales:
// precios/equidad vienen tal cual del backend, nada se inventa.
import React from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur, formatDate } from "../utils/helpers";
import { convertPrice, sortByCriterion } from "../utils/resultsLogic";
import { FlapText } from "./FlapBoard";
import { ChevronRight } from "lucide-react";

function money(v, currency) {
  return currency === "EUR" ? formatEur(v, 0) : convertPrice(v, currency);
}

// Tono de la etiqueta sobre el fondo navy del panel (los --fair-* normales
// están pensados para fondo claro y no contrastan aquí).
const FAIR_TONE = { veryBalanced: "good", fairlyBalanced: "good", somewhatUnequal: "mid", unequal: "bad" };

// Mismos umbrales que useFairnessLabel de WinnerCard (coherencia de etiquetas)
function fairnessKey(score) {
  if (score >= 85) return "veryBalanced";
  if (score >= 65) return "fairlyBalanced";
  if (score >= 45) return "somewhatUnequal";
  return "unequal";
}

/** Cabecera del vuelo: orígenes → fecha · viajeros · extras  [Cambiar] */
export const FlightHeader = React.memo(function FlightHeader({
  origins = [], departureDate, returnDate, tripType, travelers = 0, badges = [], onChange,
}) {
  const { t } = useI18n();
  const dates = tripType === "roundtrip" && returnDate
    ? `${formatDate(departureDate)} → ${formatDate(returnDate)}`
    : formatDate(departureDate);
  return (
    <div className="fm-flight-head">
      <div className="fm-flight-head-main">
        <span className="fm-board-label">{t("board.flightHead")}</span>
        <div className="fm-flight-head-row">
          <span className="fm-flight-head-origins">
            {origins.map((o, i) => <FlapText key={o + i} text={o} size="sm" delay={i * 90} />)}
          </span>
          <span className="fm-flight-head-arrow" aria-hidden="true">→</span>
          <span className="fm-flight-head-meta">
            {dates}
            {travelers > 0 && <> · {t("board.travelers", { n: travelers })}</>}
            {badges.map((b) => <span key={b} className="fm-flight-head-badge">{b}</span>)}
          </span>
        </div>
      </div>
      {onChange && (
        <button type="button" className="fm-flight-head-btn" onClick={onChange}>
          {t("results.changeSearch")}
        </button>
      )}
    </div>
  );
});

/** Cabecera de zona: 01 Decisión final · 02 Explorar alternativas */
export function ZoneHead({ id, num, title, sub, variant = "explore" }) {
  return (
    <div className={`fm-zone-head fm-zone-head--${variant}`}>
      <span className="fm-zone-num" aria-hidden="true">{num}</span>
      <div className="fm-zone-text">
        <h2 id={id} className="fm-zone-title">{title}</h2>
        {sub && <p className="fm-zone-sub">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * Aviso en línea, colocado junto a lo que afecta (no en un panel aparte).
 * variant: date | next | partial
 */
export function Notice({ tag, text, detail, actionLabel, onAction, disabled, variant = "date" }) {
  return (
    <div className={`fm-notice fm-notice--${variant}`} role={variant === "partial" ? "status" : undefined}>
      <span className="fm-notice-tag">
        <span className="fm-announce-dot" aria-hidden="true" />
        {tag}
      </span>
      <div className="fm-notice-body">
        <span className="fm-notice-text">{text}</span>
        {detail && <span className="fm-notice-detail">{detail}</span>}
      </div>
      {actionLabel && onAction && (
        <button type="button" className="fm-notice-btn" onClick={onAction} disabled={disabled}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Panel de salidas: todos los destinos encontrados, ordenados por el criterio
 * activo. El destino mostrado en la tarjeta va marcado; el resto se puede
 * pulsar para verlo arriba. Con un solo origen no hay columna de equidad.
 */
export const DeparturesBoard = React.memo(function DeparturesBoard({
  flights = [], current, criterion = "total", singleOrigin = false, currency = "EUR", savings = 0, onSelect,
}) {
  const { t } = useI18n();
  if (!flights || flights.length < 2) return null;
  const rows = sortByCriterion(flights, criterion);
  const currentCode = current ? normalizeCode(current.destination) : "";
  return (
    <section className="fm-board" id="fm-board" aria-labelledby="fm-board-title">
      <div className="fm-board-top">
        <div>
          <h2 id="fm-board-title" className="fm-board-title">{t("board.departures")}</h2>
          <p className="fm-board-sub">{t("board.departuresSub", { n: flights.length })}</p>
          {/* Regla de datos: todos los importes son estimaciones de la caché de
              búsquedas (Travelpayouts), nunca ofertas reservables. */}
          <p className="fm-board-note">{t("board.estimateNote")}</p>
        </div>
        {savings > 10 && (
          <span className="fm-board-savings">
            {t("results.groupSavings", { amount: money(savings, currency) })}
          </span>
        )}
      </div>

      <div className={`fm-board-cols${singleOrigin ? " fm-board-cols--single" : ""}`} aria-hidden="true">
        <span>{t("board.colDest")}</span>
        <span className="fm-board-col-price">{t("board.colPrice")}</span>
        {!singleOrigin && <span className="fm-board-col-fair">{t("board.colFair")}</span>}
        <span />
      </div>

      <ol className="fm-board-rows">
        {rows.map((f, i) => {
          const code = normalizeCode(f.destination);
          const city = cityOf(code) || code;
          const isCurrent = code === currentCode;
          const fk = fairnessKey(f.fairnessScore ?? 0);
          return (
            <li key={code} style={{ "--i": i }}>
              <button type="button"
                className={`fm-board-row${singleOrigin ? " fm-board-row--single" : ""}${isCurrent ? " fm-board-row--current" : ""}`}
                onClick={() => !isCurrent && onSelect && onSelect(f)}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={isCurrent ? `${city} · ${t("board.selected")}` : t("board.select", { city })}>
                <span className="fm-board-dest">
                  <FlapText text={code} size="sm" delay={120 + i * 110} />
                  <span className="fm-board-city">{city}</span>
                </span>
                <span className="fm-board-price">{money(f.averageCostPerTraveler, currency)}</span>
                {!singleOrigin && (
                  <span className={`fm-board-fair fm-board-fair--${FAIR_TONE[fk]}`}>
                    {t(`fairness.${fk}`)}
                  </span>
                )}
                <span className="fm-board-go" aria-hidden="true">
                  {isCurrent ? <span className="fm-board-now">{t("board.selected")}</span> : <ChevronRight size={16} />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
