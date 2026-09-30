// ─── BoardPanels ─────────────────────────────────────────────────────────────
// Bloques de la vista de resultados con la identidad "terminal de aeropuerto"
// (sep-2026). Sustituyen a la pila de paneles sueltos por 3 piezas claras:
//   · FlightHeader     → cabecera del vuelo del grupo (antes: migas + resumen)
//   · Announcements    → "Avisos": fecha más barata, plan de grupo, parciales
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

/**
 * Avisos: un solo panel con las sugerencias accionables.
 * items: [{ key, tag, text, actionLabel?, onAction?, disabled? }]
 */
export const Announcements = React.memo(function Announcements({ items = [] }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <section className="fm-announce" aria-label={t("board.announcements")}>
      <div className="fm-announce-head">
        <span className="fm-announce-dot" aria-hidden="true" />
        <span className="fm-board-label">{t("board.announcements")}</span>
      </div>
      <ul className="fm-announce-list">
        {items.map((it) => (
          <li key={it.key} className="fm-announce-item">
            <span className="fm-announce-tag">{it.tag}</span>
            <span className="fm-announce-text">{it.text}</span>
            {it.actionLabel && it.onAction && (
              <button type="button" className="fm-announce-btn" onClick={it.onAction} disabled={it.disabled}>
                {it.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
});

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
