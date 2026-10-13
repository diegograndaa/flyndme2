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
  arrival: "any",       // any | closest | within4h | gap | sameDay
  maxArrivalMin: null,  // tope de la franja entre la primera y la última llegada
  stops: "any",         // any | direct | max1
  maxDurationMin: null, // tope de la ida, en minutos; null = sin tope
  airlines: null,       // null = todas; si no, códigos permitidos
  domestic: false,      // solo destinos del país común de los orígenes
});

/** Franjas que se pueden pedir (minutos). 2 h y 4 h siempre que haya horas; 8 h solo si alguien se pasa de 4. */
export const ARRIVAL_GAPS = Object.freeze([120, 240, 480]);

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

/** "HH:MM" escrito en el billete. null si el proveedor no trae hora. */
export function ticketClock(iso) {
  const m = typeof iso === "string" ? /T(\d{2}:\d{2})/.exec(iso) : null;
  return m ? m[1] : null;
}

/**
 * Marcas de llegada real de cada tramo, para pintar la franja.
 * La posición se calcula después: aquí solo hay instantes del proveedor.
 * Sin hora (escala) → ms null. No se rellena.
 */
export function arrivalWindow(legs) {
  const list = Array.isArray(legs) ? legs : [];
  const marks = list.map((leg) => {
    const iso = leg?.offer?.itineraries?.[0]?.segments?.[0]?.arrival?.at;
    const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
    return {
      origin: normalizeCode(leg?.origin) || "",
      ms: Number.isFinite(ms) ? ms : null,
      clock: ticketClock(iso),
    };
  });
  const known = marks.filter((m) => m.ms != null);
  const sp = computeArrivalSpread(list);
  if (known.length < 2) {
    return { marks, min: null, max: null, spreadMs: null, partial: sp.partial, differentDays: sp.differentDays };
  }
  const min = Math.min(...known.map((m) => m.ms));
  const max = Math.max(...known.map((m) => m.ms));
  return { marks, min, max, spreadMs: max - min, partial: sp.partial, differentDays: sp.differentDays };
}

/**
 * Cada marca, con pct 0–1 dentro de la franja. Si se pidió un tope, la escala
 * es esa franja (desde la primera llegada); si no, es la distancia real.
 * Quien no tiene hora queda en pct null.
 */
export function arrivalBars(legs, requestedMin) {
  const win = arrivalWindow(legs);
  if (win.min == null) return { ...win, bars: win.marks.map((m) => ({ ...m, pct: null })) };
  const requested = Number(requestedMin);
  const scale = Number.isFinite(requested) && requested > 0
    ? requested * 60 * 1000
    : Math.max(win.spreadMs, 60 * 1000);
  const bars = win.marks.map((m) => {
    if (m.ms == null) return { ...m, pct: null };
    const pct = (m.ms - win.min) / scale;
    return { ...m, pct: Math.min(1, Math.max(0, pct)) };
  });
  return { ...win, bars, scaleMs: scale };
}

function withinGap(legs, capMs) {
  if (!Number.isFinite(capMs) || capMs <= 0) return true;
  const sp = computeArrivalSpread(legs);
  return sp.legsWithTime === legs.length
    && sp.legsWithTime >= 2
    && sp.spreadMs != null
    && !sp.differentDays
    && sp.spreadMs <= capMs;
}

export function matchesArrival(dest, mode, maxArrivalMin) {
  const legs = dest?.flights || [];
  const capMin = mode === "within4h" ? 240 : (maxArrivalMin != null ? Number(maxArrivalMin) : null);
  if (mode === "sameDay") {
    if (legs.length < 2) return false;
    const days = legs.map(departureDay);
    return days.every(Boolean) && new Set(days).size === 1;
  }
  if (capMin != null && (mode === "within4h" || mode === "gap" || mode === "closest" || mode === "any")) {
    if (legs.length < 2) return false;
    return withinGap(legs, capMin * 60 * 1000);
  }
  if (!mode || mode === "any" || mode === "closest") return true;
  return true;
}

/**
 * Recorrido del control de la franja, en minutos, a partir de los huecos
 * reales del mismo día. null si nadie tiene hora en todos los tramos.
 * El máximo es el hueco más ancho (redondeado a 30 min): llevar la barra
 * hasta ahí no recorta. Por debajo, sí.
 */
export function arrivalSliderRange(flights) {
  const spreads = [];
  for (const dest of flights || []) {
    const sp = computeArrivalSpread(dest?.flights || []);
    if (sp.partial || sp.differentDays || sp.legsWithTime < 2 || sp.spreadMs == null) continue;
    spreads.push(sp.spreadMs);
  }
  if (!spreads.length) return null;
  const step = 30;
  const widestMin = Math.max(...spreads) / 60000;
  const max = Math.max(step, Math.ceil(widestMin / step) * step);
  return { min: step, max, step };
}

/** 2 h y 4 h si hay alguna franja medible el mismo día; 8 h si alguien se pasa de 4 h. */
export function arrivalGapChoices(flights) {
  const spreads = [];
  for (const dest of flights || []) {
    const sp = computeArrivalSpread(dest?.flights || []);
    if (sp.partial || sp.differentDays || sp.legsWithTime < 2 || sp.spreadMs == null) continue;
    spreads.push(sp.spreadMs);
  }
  if (!spreads.length) return [];
  const out = [120, 240];
  if (spreads.some((s) => s > FOUR_H)) out.push(480);
  return out;
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
    if (!matchesArrival(dest, f.arrival, f.maxArrivalMin)) return false;
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

/** El filtro sigue recortando o reordenando la decisión. Sin eso, la tarjeta vuelve al destino de antes. */
export function filtersHoldResults(filters) {
  const f = filters || {};
  return (f.arrival && f.arrival !== "any")
    || f.maxArrivalMin != null
    || (f.stops && f.stops !== "any")
    || f.maxDurationMin != null
    || Array.isArray(f.airlines)
    || !!f.domestic;
}

/**
 * Destino de la tarjeta al mover un filtro.
 * Si el filtro aparta el que se veía, se recuerda su código y se enseña el primero que queda.
 * Al quitarlo, si ese código vuelve a estar en la lista, se recupera.
 * «Lo más cerca» manda mientras está activo. Un clic del usuario borra el recuerdo (anchor null).
 */
export function nextShownDestination({ listed, current, anchor, arrival }) {
  const rows = listed || [];
  if (!rows.length) return { dest: null, anchor: anchor || null };
  const code = normalizeCode(current?.destination) || null;
  const top = rows[0];
  if (arrival === "closest") {
    if (normalizeCode(top?.destination) !== code) {
      return { dest: top, anchor: anchor || code };
    }
    return { dest: current, anchor: anchor || null };
  }
  const saved = anchor
    ? rows.find((d) => normalizeCode(d.destination) === anchor)
    : null;
  if (saved && anchor !== code) return { dest: saved, anchor };
  const stillThere = rows.some((d) => normalizeCode(d.destination) === code);
  if (!stillThere) return { dest: top, anchor: anchor || code };
  return { dest: current, anchor: anchor || null };
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
