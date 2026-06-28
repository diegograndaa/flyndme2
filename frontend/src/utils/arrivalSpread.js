// ─── Coordinación de llegadas del grupo (lógica pura) ────────────────────────
// Calcula cuánta diferencia hay entre la PRIMERA y la ÚLTIMA llegada del grupo
// al destino ganador, SIN inventar datos (regla dura #1): solo usa horas de
// llegada que el proveedor da de verdad.
//
// HONESTIDAD:
//  · Los `segments` SOLO existen para vuelos DIRECTOS. En vuelos con escalas el
//    backend NO inventa aeropuertos/horas intermedias → `segments` vacío → ese
//    tramo NO tiene hora de llegada conocida (no se rellena).
//  · `arrival.at` viene en instante absoluto (ISO con zona/UTC). La DIFERENCIA
//    entre llegadas (resta de instantes) es correcta e independiente de la zona
//    horaria del destino —que NO tenemos—, por eso nunca mostramos horas de
//    llegada locales absolutas, solo el spread.
//  · Los vuelos más baratos de cada origen caen a menudo en DÍAS distintos
//    (fallback de fecha vecina ±2d): eso NO es "esperar en el aeropuerto", es
//    llegar en días distintos → se detecta aparte con `differentDays`.
//
// Sin React, sin DOM, sin estado. Robusta a datos ausentes: nunca lanza.

/** Instante (ms) de llegada de un tramo directo, o null si no hay hora. */
function arrivalMsOf(leg) {
  const iso = leg?.offer?.itineraries?.[0]?.segments?.[0]?.arrival?.at;
  if (typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Fecha de salida (date-only "YYYY-MM-DD") real del tramo, o null.
 *  OJO: el backend solo rellena `leg.flightDate` cuando hubo fallback de fecha
 *  vecina; en un vuelo en la fecha exacta pedida queda sin él. Por eso, si no
 *  hay flightDate, se deriva del instante de salida real del billete
 *  (`departure.at`, ISO con la zona del origen → su parte de fecha ES el día
 *  local de salida). Ambas fuentes son datos reales, nunca inventados. */
function departureDayOf(leg) {
  const fd = leg?.flightDate;
  if (typeof fd === "string" && fd.trim()) return fd.trim().slice(0, 10);
  const depAt = leg?.offer?.itineraries?.[0]?.segments?.[0]?.departure?.at;
  if (typeof depAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(depAt)) return depAt.slice(0, 10);
  return null;
}

/**
 * @param {Array} legs - bestDestination.flights (un tramo por origen).
 * @returns {{legsTotal:number, legsWithTime:number, spreadMs:(number|null),
 *            differentDays:boolean, partial:boolean}}
 *   - legsTotal      nº de tramos (orígenes) del destino ganador.
 *   - legsWithTime   nº de tramos con hora de llegada conocida (directos).
 *   - spreadMs       max(llegadas) − min(llegadas) si legsWithTime ≥ 2; si no, null.
 *   - differentDays  true si hay más de una FECHA de salida distinta (flightDate).
 *   - partial        true si algún tramo (con escalas) no informa de la hora.
 */
export function computeArrivalSpread(legs) {
  const list = Array.isArray(legs) ? legs : [];
  const legsTotal = list.length;

  const arrivals = list.map(arrivalMsOf).filter((ms) => ms !== null);
  const legsWithTime = arrivals.length;
  const spreadMs =
    legsWithTime >= 2 ? Math.max(...arrivals) - Math.min(...arrivals) : null;

  const days = new Set(list.map(departureDayOf).filter(Boolean));
  const differentDays = days.size > 1;

  const partial = legsWithTime < legsTotal;

  return { legsTotal, legsWithTime, spreadMs, differentDays, partial };
}

/**
 * Reparte una diferencia en ms en {days, hours, totalHours} para presentación.
 * Redondea al cuarto de hora más cercano a horas enteras; null si entrada no
 * válida. `totalHours === 0` → la diferencia es menor de 1 hora.
 */
export function splitSpread(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalHours = Math.round(ms / 3_600_000);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24, totalHours };
}
