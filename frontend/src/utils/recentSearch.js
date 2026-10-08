// Fechas flexibles y tope de presupuesto de una búsqueda reciente.
// Mismos valores que el formulario: ±1/±2/±3 y 30–800 € de 10 en 10.
// 0 (o un valor que el formulario no puede enseñar) significa «apagado».
// Una búsqueda guardada antes de tener estos campos no los trae: se abre
// en el día exacto y sin tope, que es lo que el formulario enseña por defecto.

import { AIRPORT_MAP } from "./helpers.js";

const FLEX_DAYS = new Set([1, 2, 3]);
const BUDGET_MIN = 30;
const BUDGET_MAX = 800;
const BUDGET_STEP = 10;
// Las que el formulario puede dejar marcadas. FIRST la acepta el backend
// (un enlace puede dejarla) aunque el formulario no tenga pastilla.
const CABINS = new Set(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]);

// El formulario elige destinos del catálogo. Vacío = el pool por defecto.
const MAX_DESTS = Object.keys(AIRPORT_MAP).length;

export function savedFlexDays(flexEnabled, flexDays) {
  const n = Number(flexDays);
  return flexEnabled && FLEX_DAYS.has(n) ? n : 0;
}

export function savedBudget(budgetEnabled, maxBudget) {
  const n = Number(maxBudget);
  return budgetEnabled && Number.isInteger(n) && n >= BUDGET_MIN && n <= BUDGET_MAX && n % BUDGET_STEP === 0
    ? n
    : 0;
}

export function savedCabin(cabinClass) {
  const c = String(cabinClass || "").toUpperCase();
  return CABINS.has(c) ? c : "ECONOMY";
}

/** Destinos del catálogo, sin orígenes ni repetidos. [] = pool por defecto. */
export function savedDestinations(destinations, origins) {
  const skip = new Set((origins || []).map((c) => String(c || "").trim().toUpperCase()));
  const out = [];
  for (const raw of destinations || []) {
    const code = String(raw || "").trim().toUpperCase();
    if (!AIRPORT_MAP[code] || skip.has(code) || out.includes(code)) continue;
    out.push(code);
    if (out.length >= MAX_DESTS) break;
  }
  return out;
}

/** @returns {{ flexDays: number|null, maxBudget: number|null }} null = apagado */
export function restoreFlexBudget(entry) {
  const flex = Number(entry?.flexDays);
  const budget = Number(entry?.maxBudget);
  return {
    flexDays: FLEX_DAYS.has(flex) ? flex : null,
    maxBudget: Number.isInteger(budget) && budget >= BUDGET_MIN && budget <= BUDGET_MAX && budget % BUDGET_STEP === 0
      ? budget
      : null,
  };
}

/** Sin el campo (búsquedas viejas): el pool por defecto. */
export function restoreDestinations(entry) {
  return savedDestinations(entry?.destinations, entry?.origins);
}

/** Sin el campo (búsquedas viejas): directo apagado y turista. */
export function restoreDirectCabin(entry) {
  const cabin = String(entry?.cabinClass || "").toUpperCase();
  return {
    directOnly: entry?.directOnly === true,
    cabinClass: CABINS.has(cabin) ? cabin : "ECONOMY",
  };
}

// Dos búsquedas con las mismas ciudades y la misma salida pueden dar tarifas
// distintas si cambian la vuelta, los viajeros, el margen de fechas o el tope.
export function recentSearchKey(entry) {
  const origins = Array.isArray(entry?.origins) ? entry.origins : [];
  const raw = Array.isArray(entry?.passengers) ? entry.passengers : [];
  // Sin viajeros guardados (búsquedas de antes) cuenta como 1 por ciudad,
  // que es lo que el formulario hacía. Así una repetición sustituye a la vieja.
  const pax = origins.map((_, i) => {
    const n = Math.floor(Number(raw[i]));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  });
  return [
    origins.join(","),
    pax.join(","),
    entry?.departureDate || "",
    entry?.tripType || "",
    entry?.returnDate || "",
    entry?.flexDays || 0,
    entry?.maxBudget || 0,
    entry?.directOnly === true ? 1 : 0,
    CABINS.has(String(entry?.cabinClass || "").toUpperCase()) ? String(entry.cabinClass).toUpperCase() : "ECONOMY",
    restoreDestinations(entry).slice().sort().join(","),
  ].join("|");
}
