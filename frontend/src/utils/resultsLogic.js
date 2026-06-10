// ─── Lógica pura de resultados ───────────────────────────────────────────────
// Extraída de App.jsx (Mejora 13) para poder testearla con node --test y como
// primer paso del troceo de App.jsx. Sin React, sin DOM, sin estado.

import { normalizeCode, cityOf } from "./helpers.js";

// ── Conversión de moneda (tasas estáticas aproximadas) ──────────────────────
export const FX_RATES = { EUR: 1, GBP: 0.86, USD: 1.09 };
export const FX_SYMBOLS = { EUR: "€", GBP: "£", USD: "$" };

export function convertPrice(eur, currency) {
  const val = eur * (FX_RATES[currency] || 1);
  return `${FX_SYMBOLS[currency] || "€"}${val.toFixed(0)}`;
}

// ── Coordenadas de aeropuertos (lat, lon) para distancias aproximadas ───────
export const AIRPORT_COORDS = {
  MAD: [40.47, -3.56], BCN: [41.30, 2.08], AGP: [36.67, -4.49], PMI: [39.55, 2.74],
  TFS: [28.04, -16.57], LON: [51.47, -0.46], EDI: [55.95, -3.37], PAR: [49.01, 2.55],
  ROM: [41.80, 12.25], MIL: [45.63, 8.72], NAP: [40.88, 14.29], BER: [52.36, 13.51],
  MUC: [48.35, 11.79], FRA: [50.03, 8.57], AMS: [52.31, 4.76], LIS: [38.77, -9.13],
  OPO: [41.24, -8.68], DUB: [53.42, -6.27], BRU: [50.90, 4.48], GVA: [46.24, 6.11],
  ZRH: [47.46, 8.55], VIE: [48.11, 16.57], PRG: [50.10, 14.26], WAW: [52.17, 20.97],
  BUD: [47.44, 19.26], ATH: [37.94, 23.94], CPH: [55.62, 12.66], IST: [41.28, 28.74],
  RAK: [31.60, -8.04], MLA: [35.86, 14.48], DBV: [42.56, 18.27], SPU: [43.54, 16.30],
  NCE: [43.66, 7.21], MRS: [43.44, 5.22], HEL: [60.32, 24.96], OSL: [60.19, 11.10],
  STO: [59.65, 17.94], OTP: [44.57, 26.09], SOF: [42.70, 23.41], BEG: [44.82, 20.31],
  TIA: [41.41, 19.72], TLV: [32.01, 34.89], KRK: [50.08, 19.78], TLL: [59.41, 24.83],
  RIX: [56.92, 23.97], VNO: [54.63, 25.29], SKG: [40.52, 22.97], RHO: [36.41, 28.09],
  ZAG: [45.74, 16.07], CMN: [33.37, -7.59],
};

// Distancia haversine aproximada entre dos aeropuertos; null si falta alguno.
export function approxDistKm(code1, code2) {
  const c1 = AIRPORT_COORDS[code1], c2 = AIRPORT_COORDS[code2];
  if (!c1 || !c2) return null;
  const R = 6371;
  const dLat = (c2[0] - c1[0]) * Math.PI / 180;
  const dLon = (c2[1] - c1[1]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(c1[0] * Math.PI / 180) * Math.cos(c2[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Mejor destino según criterio ("total" | "fairness") ─────────────────────
// Empates de fairness se rompen por menor coste total (mismo criterio que el
// backend al ordenar).
export function pickBest(arr, mode) {
  if (!arr?.length) return null;
  return arr.reduce((best, cur) => {
    if (mode === "fairness") {
      if (cur.fairnessScore > best.fairnessScore) return cur;
      if (cur.fairnessScore === best.fairnessScore && cur.totalCostEUR < best.totalCostEUR) return cur;
      return best;
    }
    return cur.totalCostEUR < best.totalCostEUR ? cur : best;
  });
}

// ── CSV de resultados (parte pura; la descarga vive en App.jsx) ──────────────
function csvCell(c) {
  // Escapado RFC 4180: comillas dobles duplicadas
  return `"${String(c ?? "").replace(/"/g, '""')}"`;
}

export function buildResultsCsv(flights, origins) {
  const rows = [["Destination", "City", "Total (EUR)", "Avg/person (EUR)", "Fairness", ...origins.map((o) => `${o} price`)]];
  (flights || []).forEach((f) => {
    const code = normalizeCode(f.destination);
    const priceMap = {};
    (f.flights || []).forEach((fl) => { priceMap[String(fl.origin).toUpperCase()] = fl.price; });
    rows.push([
      code,
      cityOf(code) || "",
      f.totalCostEUR?.toFixed(2) || "",
      f.averageCostPerTraveler?.toFixed(2) || "",
      f.fairnessScore ?? "",
      ...origins.map((o) => priceMap[o]?.toFixed(2) || ""),
    ]);
  });
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
