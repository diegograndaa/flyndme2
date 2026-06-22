import React, { useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur, fairnessColor } from "../utils/helpers";

/**
 * Comparativa de destinos: ranking de barras horizontales ordenado de más
 * barato a más caro (precio medio por persona, escala compartida).
 *
 * Sustituye al antiguo scatter "precio vs fairness": para el usuario final una
 * barra ordenada se lee de un vistazo, y la equidad se muestra concreta
 * ("cada uno paga €min–€max" + banda en la misma escala) en lugar de un número
 * abstracto 0-100. Los €min/€max son precios REALES por viajero (flights[].price),
 * nunca inventados (regla 1).
 */

// Etiqueta humana de equidad — mismos umbrales que WinnerCard.
function fairnessLabelKey(score) {
  if (score >= 85) return "fairness.veryBalanced";
  if (score >= 65) return "fairness.fairlyBalanced";
  if (score >= 45) return "fairness.somewhatUnequal";
  return "fairness.unequal";
}

export default function CompareChart({ flights, bestDestination, singleOrigin = false }) {
  const { t } = useI18n();
  const bestCode = normalizeCode(bestDestination?.destination || "");

  const rows = useMemo(() => {
    const list = (flights || []).map((f) => {
      const code = normalizeCode(f.destination);
      const perTraveler = (Array.isArray(f.flights) ? f.flights : [])
        .map((fl) => fl.price)
        .filter((p) => typeof p === "number" && isFinite(p));
      const min = perTraveler.length ? Math.min(...perTraveler) : null;
      const max = perTraveler.length ? Math.max(...perTraveler) : null;
      return {
        code,
        city: cityOf(code) || code,
        avg: f.averageCostPerTraveler || 0,
        total: f.totalCostEUR || 0,
        fairness: f.fairnessScore || 0,
        min,
        max,
        isBest: code === bestCode,
      };
    });
    // de más barato a más caro por precio medio/persona
    return list.sort((a, b) => a.avg - b.avg);
  }, [flights, bestCode]);

  // Escala compartida 0 → precio máximo (incluye el máximo individual para que
  // la banda de reparto quepa). Hace que las barras de todas las filas sean
  // comparables entre sí.
  const scaleMax = useMemo(() => {
    const vals = rows.flatMap((r) => [r.avg, r.max ?? 0]);
    return Math.max(1, ...vals) * 1.04;
  }, [rows]);

  const pct = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;

  if (!rows.length) return null;

  return (
    <section className="cmp" aria-label={t("compare.title")}>
      <header className="cmp-head">
        <h3 className="cmp-title">{t("compare.title")}</h3>
        <p className="cmp-sub">{t("compare.subtitle")}</p>
      </header>

      <ol className="cmp-list">
        {rows.map((r, i) => {
          const fLabel = t(fairnessLabelKey(r.fairness));
          const fColor = fairnessColor(r.fairness);
          const hasRange = r.min != null && r.max != null && r.max > r.min;
          return (
            <li key={r.code} className={`cmp-row${r.isBest ? " cmp-row--best" : ""}`}>
              <div className="cmp-rank" aria-hidden="true">{i + 1}</div>

              <div className="cmp-main">
                <div className="cmp-top">
                  <span className="cmp-city">{r.city}</span>
                  <span className="cmp-code">{r.code}</span>
                  {r.isBest && <span className="cmp-best">★ {t("compare.best")}</span>}
                  {!singleOrigin && (
                    <span className="cmp-fair" style={{ color: fColor }}>
                      <span className="cmp-fair-dot" style={{ background: fColor }} />
                      {fLabel}
                    </span>
                  )}
                </div>

                <div className="cmp-graph">
                  {/* Barra: precio medio por persona (escala compartida) */}
                  <div
                    className="cmp-bar"
                    role="img"
                    aria-label={`${r.city}: ${formatEur(r.avg, 0)} ${t("compare.perPerson")}`}
                  >
                    <div
                      className="cmp-bar-fill"
                      style={{ width: pct(r.avg), background: r.isBest ? "var(--primary)" : "var(--slate-400)" }}
                    />
                  </div>
                  <div className="cmp-price">
                    {formatEur(r.avg, 0)}
                    <span className="cmp-price-u">{t("compare.perPerson")}</span>
                  </div>

                  {/* Reparto entre viajeros: banda €min→€max en la misma escala */}
                  {hasRange && (
                    <div className="cmp-spread" aria-hidden="true">
                      <div
                        className="cmp-spread-rail"
                        style={{ left: pct(r.min), width: `calc(${pct(r.max)} - ${pct(r.min)})`, background: fColor }}
                      />
                      <div className="cmp-spread-dot" style={{ left: pct(r.avg), background: fColor }} />
                    </div>
                  )}
                </div>

                <div className="cmp-meta">
                  {hasRange && (
                    <span className="cmp-meta-range">
                      {t("compare.eachPays", { min: formatEur(r.min, 0), max: formatEur(r.max, 0) })}
                    </span>
                  )}
                  <span className="cmp-meta-total">{t("compare.group", { total: formatEur(r.total, 0) })}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
