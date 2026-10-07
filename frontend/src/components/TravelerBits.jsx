// ─── TravelerBits ────────────────────────────────────────────────────────────
// "Quién paga qué" con UN COLOR POR VIAJERO (oct-2026). El color identifica a
// la ciudad de salida (no juzga): la misma ciudad lleva el mismo color en la
// tarjeta, en el panel de salidas y en el comparador, sea cual sea el destino.
// Sustituye a las etiquetas DESIGUAL / ALGO DESIGUAL en rojo: la diferencia se
// VE en las barras y se cuenta con un dato neutro ("€144 de diferencia").
// Datos 100% reales: flights[].price tal cual del backend (regla 1).
import React from "react";
import { useI18n } from "../i18n/useI18n";
import { cityOf, formatEur } from "../utils/helpers";
import { convertPrice, travelerSlot, payRows } from "../utils/resultsLogic";

const money = (v, currency) => (currency === "EUR" ? formatEur(v, 0) : convertPrice(v, currency));

/** Punto de color de un viajero (decorativo: siempre va junto a su código). */
export function TravelerDot({ origins, code }) {
  return <span className={`trav-dot trav-c${travelerSlot(origins, code)}`} aria-hidden="true" />;
}

/** Leyenda: ● MAD ● LON ● BER (color fijo por ciudad de salida). */
export function TravelerLegend({ origins = [], className = "" }) {
  const { t } = useI18n();
  if (origins.length < 2) return null;
  return (
    <ul className={`trav-legend ${className}`} aria-label={t("board.travLegend")}>
      {origins.map((o) => (
        <li key={o} className="trav-legend-item" title={cityOf(o) || o}>
          <TravelerDot origins={origins} code={o} />
          <span className="trav-legend-code">{o}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Barras de lo que paga cada viajero para UN destino. `max` es la escala
 * común (el precio individual más alto de todos los destinos), para que las
 * barras de una fila se puedan comparar con las de otra.
 * variant: "row" (compacta, panel de salidas) | "card" (con nombre de ciudad).
 */
export function PayBars({ dest, origins = [], max, currency = "EUR", variant = "row" }) {
  const { t } = useI18n();
  const rows = payRows(dest, origins);
  if (rows.length < 2) return null;
  const scale = Math.max(1, max || Math.max(...rows.map((r) => r.price)));
  const label = rows.map((r) => `${cityOf(r.origin) || r.origin} ${money(r.price, currency)}`).join(", ");
  return (
    <span className={`pay pay--${variant}`} role="img" aria-label={t("board.payAria", { list: label })}>
      {rows.map((r, i) => (
        <span key={r.origin} className={`pay-row trav-c${travelerSlot(origins, r.origin)}`} style={{ "--i": i }}
          title={`${cityOf(r.origin) || r.origin}: ${money(r.price, currency)}`}>
          <span className="pay-code">{variant === "card" ? (cityOf(r.origin) || r.origin) : r.origin}</span>
          <span className="pay-track"><span className="pay-fill" style={{ width: `${Math.max(3, Math.min(100, (r.price / scale) * 100)).toFixed(1)}%` }} /></span>
          <span className="pay-price">{money(r.price, currency)}{r.pax > 1 && <small> ×{r.pax}</small>}</span>
        </span>
      ))}
    </span>
  );
}
