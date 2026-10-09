// Pure logic for the "cheaper date" nudge: given per-origin dated prices for the
// winning destination, find nearby dates where the GROUP pays less.
//
// No network, no provider coupling — easy to unit test. Honesty rules (CLAUDE.md
// #1): only suggests a date for which we have a real price for EVERY origin; the
// group must all fly the same day, so we only consider dates present for all.
//
// Round trips keep the trip length: a candidate departure D only counts with a
// return on D + tripNights, so the suggestion is one shift of both dates
// ("leave the 12th, back the 19th") with real prices for that exact pair.

function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((da - db) / 86400000);
}

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} args
 * @param {string[]} args.originList            origin IATA codes
 * @param {number[]} args.originPax             travelers per origin (aligned)
 * @param {Array<Array<{date:string,returnDate?:string,price:number}>>} args.perOrigin  dated prices per origin (aligned)
 * @param {string} args.currentDate             date currently shown (excluded as candidate)
 * @param {number|null} [args.tripNights=null]  round trip: nights between departure and return (kept fixed)
 * @param {number} args.currentTotalEUR         group total to beat (what the user sees)
 * @param {string} args.today                   YYYY-MM-DD; candidates must be strictly after
 * @param {number} [args.windowDays=14]         max |candidate - currentDate| in days
 * @param {number} [args.minSavingAbs=15]       min absolute group saving (EUR)
 * @param {number} [args.minSavingPct=0.05]     min relative group saving
 * @returns {Array<{date,returnDate?,totalEUR,savingEUR,perOrigin:Array<{origin,price,passengers}>}>}
 */
function collectCheaperDates({
  originList,
  originPax,
  perOrigin,
  currentDate,
  tripNights = null,
  currentTotalEUR,
  today,
  windowDays = 14,
  minSavingAbs = 15,
  minSavingPct = 0.05,
}) {
  if (!Array.isArray(perOrigin) || perOrigin.length === 0) return [];
  if (perOrigin.length !== originList.length) return [];
  if (!Number.isFinite(currentTotalEUR) || currentTotalEUR <= 0) return [];
  const roundtrip = tripNights != null;
  if (roundtrip && !(Number.isInteger(tripNights) && tripNights >= 0)) return [];

  // cheapest price per (departure) date, per origin
  const maps = perOrigin.map((list) => {
    const m = new Map();
    for (const t of Array.isArray(list) ? list : []) {
      const price = Number(t?.price);
      const date = t?.date;
      if (!date || !Number.isFinite(price) || price <= 0) continue;
      if (roundtrip && t?.returnDate !== shiftDays(date, tripNights)) continue;
      if (!m.has(date) || price < m.get(date)) m.set(date, price);
    }
    return m;
  });

  // candidate dates = present for ALL origins
  let candidates = [...maps[0].keys()];
  for (let i = 1; i < maps.length; i++) {
    const mi = maps[i];
    candidates = candidates.filter((d) => mi.has(d));
  }

  const threshold = Math.max(minSavingAbs, currentTotalEUR * minSavingPct);
  const qualified = [];
  for (const date of candidates) {
    if (date === currentDate) continue;
    if (today && !(date > today)) continue; // strictly future
    if (Math.abs(daysBetween(date, currentDate)) > windowDays) continue;
    let total = 0;
    for (let i = 0; i < maps.length; i++) {
      total += maps[i].get(date) * (originPax[i] || 1);
    }
    const saving = currentTotalEUR - total;
    if (saving < threshold) continue;
    qualified.push({ date, total, saving });
  }
  qualified.sort((a, b) => a.total - b.total || a.date.localeCompare(b.date));

  return qualified.map((item) => ({
    date: item.date,
    ...(roundtrip ? { returnDate: shiftDays(item.date, tripNights) } : {}),
    totalEUR: Math.round(item.total),
    savingEUR: Math.round(item.saving),
    perOrigin: originList.map((origin, i) => ({
      origin,
      price: Math.round(maps[i].get(item.date)),
      passengers: originPax[i] || 1,
    })),
  }));
}

// La más barata, o null. Misma forma de siempre para quien solo pide una.
function findCheaperGroupDate(args) {
  return collectCheaperDates(args)[0] || null;
}

// Hasta `limit` fechas (por defecto 3) que de verdad abaratan el total del grupo.
function findCheaperGroupDates(args) {
  const limit = Number.isInteger(args?.limit) && args.limit > 0 ? args.limit : 3;
  const all = collectCheaperDates(args);
  return all.slice(0, limit);
}

module.exports = { findCheaperGroupDate, findCheaperGroupDates, daysBetween, shiftDays };
