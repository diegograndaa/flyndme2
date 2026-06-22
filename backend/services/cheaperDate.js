// Pure logic for the "cheaper date" nudge: given per-origin dated prices for the
// winning destination, find the single nearby date where the GROUP pays less.
//
// No network, no provider coupling — easy to unit test. Honesty rules (CLAUDE.md
// #1): only suggests a date for which we have a real price for EVERY origin; the
// group must all fly the same day, so we only consider dates present for all.

function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((da - db) / 86400000);
}

/**
 * @param {object} args
 * @param {string[]} args.originList            origin IATA codes
 * @param {number[]} args.originPax             travelers per origin (aligned)
 * @param {Array<Array<{date:string,price:number}>>} args.perOrigin  dated prices per origin (aligned)
 * @param {string} args.currentDate             date currently shown (excluded as candidate)
 * @param {number} args.currentTotalEUR         group total to beat (what the user sees)
 * @param {string} args.today                   YYYY-MM-DD; candidates must be strictly after
 * @param {number} [args.windowDays=14]         max |candidate - currentDate| in days
 * @param {number} [args.minSavingAbs=15]       min absolute group saving (EUR)
 * @param {number} [args.minSavingPct=0.05]     min relative group saving
 * @returns {null | {date,totalEUR,savingEUR,perOrigin:Array<{origin,price,passengers}>}}
 */
function findCheaperGroupDate({
  originList,
  originPax,
  perOrigin,
  currentDate,
  currentTotalEUR,
  today,
  windowDays = 14,
  minSavingAbs = 15,
  minSavingPct = 0.05,
}) {
  if (!Array.isArray(perOrigin) || perOrigin.length === 0) return null;
  if (perOrigin.length !== originList.length) return null;
  if (!Number.isFinite(currentTotalEUR) || currentTotalEUR <= 0) return null;

  // cheapest price per date, per origin
  const maps = perOrigin.map((list) => {
    const m = new Map();
    for (const t of Array.isArray(list) ? list : []) {
      const price = Number(t?.price);
      const date = t?.date;
      if (!date || !Number.isFinite(price) || price <= 0) continue;
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

  let best = null;
  for (const date of candidates) {
    if (date === currentDate) continue;
    if (today && !(date > today)) continue; // strictly future
    if (Math.abs(daysBetween(date, currentDate)) > windowDays) continue;
    let total = 0;
    for (let i = 0; i < maps.length; i++) {
      total += maps[i].get(date) * (originPax[i] || 1);
    }
    if (!best || total < best.total) best = { date, total };
  }

  if (!best) return null;
  const saving = currentTotalEUR - best.total;
  const threshold = Math.max(minSavingAbs, currentTotalEUR * minSavingPct);
  if (saving < threshold) return null;

  return {
    date: best.date,
    totalEUR: Math.round(best.total),
    savingEUR: Math.round(saving),
    perOrigin: originList.map((origin, i) => ({
      origin,
      price: Math.round(maps[i].get(best.date)),
      passengers: originPax[i] || 1,
    })),
  };
}

module.exports = { findCheaperGroupDate, daysBetween };
