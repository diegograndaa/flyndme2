// Filtros de la lista de destinos. Solo usan datos que el billete más barato
// ya trae: no hay inventario de horarios, maletas ni aeropuertos de escala.
//
// Hora de llegada: únicamente en vuelos directos (con escalas el proveedor no
// da la hora y no se inventa). La diferencia es entre instantes reales, la
// misma regla que arrivalSpread.js.

import { computeArrivalSpread, splitSpread } from "./arrivalSpread";
import { AIRPORTS, AIRPORT_MAP, normalizeCode } from "./helpers";
import { sortByCriterion } from "./resultsLogic";

export const DEFAULT_FILTERS = Object.freeze({
  arrival: "any",       // any | closest | within4h | sameDay
  stops: "any",         // any | direct | max1
  maxDurationMin: null, // tope de la ida, en minutos; null = sin tope
  airlines: null,       // null = todas; si no, códigos permitidos
  domestic: false,      // solo destinos del país común de los orígenes
});

export function countryKey(code) {
  return AIRPORT_MAP[normalizeCode(code)]?.country || null;
}

/** País común si TODOS los orígenes están en el catálogo y coinciden. Si no, null. */
export function sharedCountry(origins) {
  const keys = [];
  for (const o of origins || []) {
    const k = countryKey(o);
    if (!k) return null;
    keys.push(k);
  }
  if (!keys.length) return null;
  return keys.every((k) => k === keys[0]) ? keys[0] : null;
}

/** Aeropuertos de ese país, sin los orígenes (no se vuela de una ciudad a sí misma). */
export function domesticCodes(country, origins) {
  if (!country) return [];
  const skip = new Set((origins || []).map((o) => normalizeCode(o)));
  return AIRPORTS.filter((a) => a.country === country && !skip.has(a.code)).map((a) => a.code);
}

/**
 * null = todas encendidas. El primer toque OCULTA esa aerolínea (en un grupo
 * casi nunca coinciden las dos ciudades en la misma, y «solo esta» vaciaba
 * la lista). Volver a pulsarla la enciende. La última no se puede apagar:
 * para verlas todas está «Quitar filtros».
 */
export function nextAirlines(current, code, universe) {
  const all = Array.isArray(universe) ? universe : [];
  if (!all.includes(code)) return Array.isArray(current) ? current : null;
  const base = Array.isArray(current) ? current.filter((c) => all.includes(c)) : all;
  const next = base.includes(code) ? base.filter((c) => c !== code) : [...base, code];
  if (next.length === 0) return base;
  if (next.length >= all.length) return null;
  return next;
}

const FOUR_H = 4 * 60 * 60 * 1000;

function departureDay(leg) {
  const fd = leg?.flightDate;
  if (typeof fd === "string" && /^\d{4}-\d{2}-\d{2}/.test(fd)) return fd.slice(0, 10);
  const depAt = leg?.offer?.itineraries?.[0]?.segments?.[0]?.departure?.at;
  if (typeof depAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(depAt)) return depAt.slice(0, 10);
  return null;
}

/** Escalas conocidas de un tramo (0 = directo). null si el proveedor no lo dice. */
export function legTransfers(leg, which = 0) {
  const offer = leg?.offer;
  if (which === 0 && Number.isInteger(offer?.transfers) && offer.transfers >= 0) return offer.transfers;
  if (which === 1 && Number.isInteger(offer?.returnTransfers) && offer.returnTransfers >= 0) return offer.returnTransfers;
  const segs = offer?.itineraries?.[which]?.segments;
  if (Array.isArray(segs) && segs.length === 1) return 0;
  if (which === 1 && !offer?.itineraries?.[1]) return null;
  return null;
}

export function durationMinutes(iso) {
  if (typeof iso !== "string") return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso);
  if (!m || (m[1] == null && m[2] == null)) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

export function legDurationMin(leg) {
  return durationMinutes(leg?.offer?.itineraries?.[0]?.duration);
}

export function legAirline(leg) {
  const c = leg?.offer?.validatingAirlineCodes?.[0];
  return typeof c === "string" && /^[A-Z0-9]{2}$/.test(c) ? c : null;
}

function knownStops(leg) {
  const out = legTransfers(leg, 0);
  const back = legTransfers(leg, 1);
  const nums = [out, back].filter((n) => n != null);
  if (!nums.length) return null;
  return Math.max(...nums);
}

export function matchesArrival(dest, mode) {
  if (!mode || mode === "any" || mode === "closest") return true;
  const legs = dest?.flights || [];
  if (legs.length < 2) return false;
  if (mode === "sameDay") {
    const days = legs.map(departureDay);
    return days.every(Boolean) && new Set(days).size === 1;
  }
  if (mode === "within4h") {
    const sp = computeArrivalSpread(legs);
    return sp.legsWithTime === legs.length
      && sp.legsWithTime >= 2
      && sp.spreadMs != null
      && !sp.differentDays
      && sp.spreadMs <= FOUR_H;
  }
  return true;
}

function matchesStops(dest, mode) {
  if (!mode || mode === "any") return true;
  const legs = dest?.flights || [];
  if (!legs.length) return false;
  for (const leg of legs) {
    const n = knownStops(leg);
    if (n == null) return false;
    if (mode === "direct" && n !== 0) return false;
    if (mode === "max1" && n > 1) return false;
  }
  return true;
}

function matchesDuration(dest, maxMin) {
  const legs = dest?.flights || [];
  if (!legs.length) return false;
  for (const leg of legs) {
    const m = legDurationMin(leg);
    if (m == null || m > maxMin) return false;
  }
  return true;
}

function matchesAirlines(dest, allowed) {
  const legs = dest?.flights || [];
  if (!legs.length) return false;
  for (const leg of legs) {
    const code = legAirline(leg);
    if (!code || !allowed.includes(code)) return false;
  }
  return true;
}

export function applyResultFilters(flights, filters, ctx) {
  const f = filters || DEFAULT_FILTERS;
  const allowed = Array.isArray(f.airlines) ? f.airlines : null;
  const country = f.domestic ? (ctx?.country || null) : null;
  return (flights || []).filter((dest) => {
    if (f.domestic && countryKey(dest?.destination) !== country) return false;
    if (!matchesArrival(dest, f.arrival)) return false;
    if (!matchesStops(dest, f.stops)) return false;
    if (f.maxDurationMin != null && !matchesDuration(dest, f.maxDurationMin)) return false;
    if (allowed && !matchesAirlines(dest, allowed)) return false;
    return true;
  });
}

/** Minutos entre la primera y la última llegada, o null si no se puede comparar. */
export function arrivalSpreadMs(dest) {
  const legs = dest?.flights || [];
  if (legs.length < 2) return null;
  const sp = computeArrivalSpread(legs);
  if (sp.partial || sp.legsWithTime < 2 || sp.spreadMs == null) return null;
  return sp.spreadMs;
}

export function sortByArrival(list) {
  return [...(list || [])].sort((a, b) => {
    const sa = arrivalSpreadMs(a);
    const sb = arrivalSpreadMs(b);
    if (sa == null && sb == null) return (a.totalCostEUR || 0) - (b.totalCostEUR || 0);
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sa - sb || (a.totalCostEUR || 0) - (b.totalCostEUR || 0);
  });
}

export function listResults(flights, filters, criterion, ctx) {
  const visible = applyResultFilters(flights, filters, ctx);
  if (filters?.arrival === "closest") return sortByArrival(visible);
  return sortByCriterion(visible, criterion);
}

export function airlinesIn(flights) {
  const set = new Set();
  for (const dest of flights || []) {
    for (const leg of dest?.flights || []) {
      const code = legAirline(leg);
      if (code) set.add(code);
    }
  }
  return [...set].sort();
}

/** Topes de duración (minutos) que de verdad separan destinos. Vacío si no hay rango. */
export function durationSteps(flights) {
  const mins = [];
  for (const dest of flights || []) {
    let worst = null;
    for (const leg of dest?.flights || []) {
      const m = legDurationMin(leg);
      if (m == null) { worst = null; break; }
      worst = worst == null ? m : Math.max(worst, m);
    }
    if (worst != null) mins.push(worst);
  }
  if (mins.length < 2) return [];
  const min = Math.min(...mins);
  const max = Math.max(...mins);
  if (max - min < 45) return [];
  const caps = [];
  for (const raw of [min + (max - min) / 3, min + (2 * (max - min)) / 3]) {
    const cap = Math.ceil(raw / 30) * 30;
    if (cap > min && cap < max && !caps.includes(cap)) caps.push(cap);
  }
  return caps;
}

export function formatDurationMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** Estado de llegada del destino que se está viendo, para la línea bajo el filtro. */
export function arrivalStatus(dest) {
  const legs = dest?.flights || [];
  if (legs.length < 2) return null;
  const sp = computeArrivalSpread(legs);
  if (sp.legsWithTime < 2 || sp.spreadMs == null) return { kind: "unknown" };
  const parts = splitSpread(sp.spreadMs) || { totalHours: 0, days: 0, hours: 0 };
  if (sp.partial) return { kind: "partial", ...parts };
  if (sp.differentDays) return { kind: "days", ...parts };
  if (sp.spreadMs <= FOUR_H) return { kind: "close", ...parts };
  return { kind: "spread", ...parts };
}
