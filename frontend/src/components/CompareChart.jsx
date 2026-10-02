import React, { useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur } from "../utils/helpers";
import { convertPrice, sortByCriterion, payRows, paySpread, travelerSlot } from "../utils/resultsLogic";
import { TravelerLegend } from "./TravelerBits";

/**
 * Comparativa de destinos: ranking de barras horizontales ordenado de más
 * barato a más caro (precio medio por persona, escala compartida).
 *
 * Debajo de cada barra, un punto por viajero con SU color en la misma escala:
 * se ve de un vistazo quién paga más y quién menos en cada destino (precios
 * REALES por viajero, flights[].price; nunca inventados, regla 1).
 *
 * "★ Mejor" es el primero según el criterio activo (más barato o más
 * equitativo) y NO se mueve al elegir otro destino: el elegido lleva su propia
 * marca "En tu tarjeta".
 */
const EVEN_SCORE = 65; // mismo umbral que las etiquetas de equidad

export default function CompareChart({ flights, bestDestination, singleOrigin = false, criterion = "total", origins = [], currency = "EUR" }) {
  const { t, lang } = useI18n();
  const selectedCode = normalizeCode(bestDestination?.destination || "");
  const money = (v) => (currency === "EUR" ? formatEur(v, 0) : convertPrice(v, currency));

  const topCode = useMemo(() => {
    const top = sortByCriterion(flights, criterion)[0];
    return top ? normalizeCode(top.destination) : "";
  }, [flights, criterion]);

  const rows = useMemo(() => {
    const list = (flights || []).map((f) => {
      const code = normalizeCode(f.destination);
      const legs = payRows(f, origins);
      const prices = legs.map((l) => l.price);
      return {
        code,
        city: cityOf(code) || code,
        avg: f.averageCostPerTraveler || 0,
        total: f.totalCostEUR || 0,
        fairness: f.fairnessScore || 0,
        spread: paySpread(f),
        legs,
        min: prices.length ? Math.min(...prices) : null,
        max: prices.length ? Math.max(...prices) : null,
        isTop: code === topCode,
        isSelected: code === selectedCode,
      };
    });
    // de más barato a más caro por precio medio/persona
    return list.sort((a, b) => a.avg - b.avg);
    // lang: el nombre de la ciudad cambia con el idioma
  }, [flights, topCode, selectedCode, origins, lang]);

  // Escala compartida 0 → precio máximo (incluye el máximo individual para que
  // los puntos de cada viajero quepan). Hace comparables todas las filas.
  const scaleMax = useMemo(() => {
    const vals = rows.flatMap((r) => [r.avg, r.max ?? 0]);
    return Math.max(1, ...vals) * 1.04;
  }, [rows]);

  const pct = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;

  if (!rows.length) return null;

  return (
    <section className="cmp" aria-label={t("compare.title")}>
      <header className="cmp-head">
        <div>
          <h3 className="cmp-title">{t("compare.title")}</h3>
          <p className="cmp-sub">{t("compare.subtitle")}</p>
        </div>
        {!singleOrigin && <TravelerLegend origins={origins} />}
      </header>

      <ol className="cmp-list">
        {rows.map((r, i) => {
          const hasRange = !singleOrigin && r.legs.length >= 2;
          const even = r.fairness >= EVEN_SCORE;
          return (
            <li key={r.code} className={`cmp-row${r.isTop ? " cmp-row--best" : ""}${r.isSelected ? " cmp-row--selected" : ""}`} style={{ "--i": i }}>
              <div className="cmp-rank" aria-hidden="true">{i + 1}</div>

              <div className="cmp-main">
                <div className="cmp-top">
                  <span className="cmp-city">{r.city}</span>
                  <span className="cmp-code">{r.code}</span>
                  {r.isTop && <span className="cmp-best">★ {t(criterion === "fairness" ? "compare.bestFair" : "compare.best")}</span>}
                  {r.isSelected && <span className="cmp-selected">{t("board.selected")}</span>}
                  {hasRange && (
                    <span className={`cmp-fair${even ? " cmp-fair--even" : ""}`}>
                      {even ? t("board.payEven") : t("board.paySpread", { amount: money(r.spread) })}
                    </span>
                  )}
                </div>

                <div className="cmp-graph">
                  {/* Barra: precio medio por persona (escala compartida) */}
                  <div
                    className="cmp-bar"
                    role="img"
                    aria-label={`${r.city}: ${money(r.avg)} ${t("compare.perPerson")}`}
                  >
                    <div className="cmp-bar-fill" style={{ width: pct(r.avg) }} />
                  </div>
                  <div className="cmp-price">
                    {money(r.avg)}
                    <span className="cmp-price-u">{t("compare.perPerson")}</span>
                  </div>

                  {/* Lo que paga cada viajero, en la misma escala (un punto por
                      viajero con su color, unidos por una línea neutra) */}
                  {hasRange && (
                    <div className="cmp-spread" aria-hidden="true">
                      <div className="cmp-spread-rail" style={{ left: pct(r.min), width: `calc(${pct(r.max)} - ${pct(r.min)})` }} />
                      {/* desfase vertical por viajero: dos precios casi iguales
                          no se tapan del todo */}
                      {r.legs.map((l, li) => (
                        <span key={l.origin} className={`cmp-leg-dot trav-c${travelerSlot(origins, l.origin)}`}
                          style={{ left: pct(l.price), marginTop: `${((li - (r.legs.length - 1) / 2) * 5).toFixed(1)}px` }}
                          title={`${l.origin} ${money(l.price)}`} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="cmp-meta">
                  {hasRange && (
                    <span className="cmp-meta-range">
                      {r.legs.map((l) => `${l.origin} ${money(l.price)}`).join(" · ")}
                    </span>
                  )}
                  <span className="cmp-meta-total">{t("compare.group", { total: money(r.total) })}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
