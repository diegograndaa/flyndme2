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
import React, { useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur, formatDate, getBaseUrl } from "../utils/helpers";
import { convertPrice, sortByCriterion, paySpread, maxLegPrice } from "../utils/resultsLogic";
import { getCityImage } from "../utils/cityImages";
import { FlapText } from "./FlapBoard";
import { PayBars, TravelerLegend } from "./TravelerBits";
import { ChevronRight } from "lucide-react";
import { useFlip } from "../hooks/useFlip";

function money(v, currency) {
  return currency === "EUR" ? formatEur(v, 0) : convertPrice(v, currency);
}

// Reparto "parejo": mismo umbral que las etiquetas de equidad (≥ 65/100).
const EVEN_SCORE = 65;

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
            {travelers > 0 && <> · {travelers === 1 ? t("results.travelerOne") : t("board.travelers", { n: travelers })}</>}
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
      {tag && (
        <span className="fm-notice-tag">
          <span className="fm-announce-dot" aria-hidden="true" />
          {tag}
        </span>
      )}
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

/** Miniatura de la ciudad (foto a color). Sin foto → bloque con el código. */
function DestThumb({ code }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="dep-thumb" aria-hidden="true">
      <span className="dep-thumb-code">{code}</span>
      {!failed && (
        <img src={getCityImage(code, getBaseUrl(), { w: 192, h: 128 })} alt="" loading="lazy" decoding="async"
          width="96" height="64" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

/**
 * Panel de salidas: todos los destinos encontrados, ordenados por el criterio
 * activo. Cada fila lleva la miniatura de la ciudad y "quién paga qué": una
 * barra por viajero con SU color (misma escala en todas las filas), en vez de
 * una etiqueta de equidad. El destino de la tarjeta va marcado; el resto se
 * puede pulsar para verlo arriba. Con un solo origen no hay reparto.
 */
export const DeparturesBoard = React.memo(function DeparturesBoard({
  flights = [], current, criterion = "total", singleOrigin = false, currency = "EUR", savings = 0, onSelect, origins = [],
}) {
  const { t } = useI18n();
  const listRef = useRef(null);
  const rows = flights && flights.length >= 2 ? sortByCriterion(flights, criterion) : [];
  // Al cambiar de criterio las filas se recolocan deslizándose (FLIP): se ve
  // qué destino sube y cuál baja en vez de un salto brusco.
  useFlip(listRef, rows.map((f) => normalizeCode(f.destination)).join(","));
  if (rows.length < 2) return null;
  const currentCode = current ? normalizeCode(current.destination) : "";
  const scale = maxLegPrice(flights);
  return (
    <section className={`fm-board dep${singleOrigin ? " dep--single" : ""}`} id="fm-board" aria-labelledby="fm-board-title">
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

      <div className="dep-cols" aria-hidden="true">
        <span>{t("board.colDest")}</span>
        {!singleOrigin && (
          <span className="dep-col-pay">
            {t("board.colPay")}
            <TravelerLegend origins={origins} className="trav-legend--inline" />
          </span>
        )}
        <span className="dep-col-price">{t("board.colPrice")}</span>
        <span />
      </div>

      <ol className="dep-rows" ref={listRef}>
        {rows.map((f, i) => {
          const code = normalizeCode(f.destination);
          const city = cityOf(code) || code;
          const isCurrent = code === currentCode;
          const even = (f.fairnessScore ?? 0) >= EVEN_SCORE;
          return (
            <li key={code} data-flip={code} style={{ "--i": i }}>
              <button type="button"
                className={`dep-row${isCurrent ? " dep-row--current" : ""}`}
                onClick={() => !isCurrent && onSelect && onSelect(f)}
                aria-current={isCurrent ? "true" : undefined}>
                <DestThumb code={code} />
                <span className="dep-dest">
                  <FlapText text={code} size="sm" delay={120 + i * 110} />
                  <span className="dep-city">{city}</span>
                  {isCurrent && <span className="dep-now">{t("board.selected")}</span>}
                </span>
                {!singleOrigin && (
                  <span className="dep-pay">
                    <PayBars dest={f} origins={origins} max={scale} currency={currency} />
                  </span>
                )}
                <span className="dep-price">
                  <span className="dep-price-main">
                    <span className="dep-price-v">{money(f.averageCostPerTraveler, currency)}</span>
                    <span className="dep-price-u">{t("compare.perPerson")}</span>
                  </span>
                  {!singleOrigin && (
                    <span className={`dep-spread${even ? " dep-spread--even" : ""}`}>
                      {even ? t("board.payEven") : t("board.paySpread", { amount: money(paySpread(f), currency) })}
                    </span>
                  )}
                </span>
                <span className="dep-go" aria-hidden="true">{!isCurrent && <ChevronRight size={18} />}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
