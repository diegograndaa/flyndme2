// Junta, por destino, las fechas cercanas que tienen precio en TODOS los
// orígenes. Una fecha que solo cubre a parte del grupo no es una opción.
const MAX_DATE_OPTIONS = 6;

function dayDistance(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms)) return Infinity;
  return Math.round(ms / 86_400_000);
}

function combineDateOptions({
  origins,
  passengers,
  destination,
  requestedDeparture,
  requestedReturn,
  perOrigin,
  maxFlight = null,
  maxAvg = null,
  limit = MAX_DATE_OPTIONS,
}) {
  const byPair = new Map();
  const wantsReturn = Boolean(requestedReturn);
  (perOrigin || []).forEach((rows, i) => {
    for (const row of rows || []) {
      const price = Number(row?.price);
      const dep = String(row?.departureDate || "");
      const ret = String(row?.returnDate || "");
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dep)) continue;
      if (wantsReturn && !/^\d{4}-\d{2}-\d{2}$/.test(ret)) continue;
      if (!wantsReturn && ret) continue;
      if (dep === requestedDeparture && (!wantsReturn || ret === requestedReturn)) continue;
      if (maxFlight != null && price > maxFlight) continue;
      const key = wantsReturn ? `${dep}|${ret}` : dep;
      if (!byPair.has(key)) byPair.set(key, new Array(origins.length).fill(null));
      const slot = byPair.get(key);
      if (!slot[i] || price < slot[i].price) slot[i] = { price, departureDate: dep, returnDate: wantsReturn ? ret : null };
    }
  });

  const out = [];
  for (const slots of byPair.values()) {
    if (slots.some((s) => !s)) continue;
    const flights = slots.map((s, i) => {
      const pax = Number(passengers?.[i]) > 0 ? Number(passengers[i]) : 1;
      return {
        origin: origins[i],
        price: s.price,
        passengers: pax,
        totalForOrigin: Number((s.price * pax).toFixed(2)),
      };
    });
    const totalCost = flights.reduce((sum, f) => sum + f.price * f.passengers, 0);
    const totalPax = flights.reduce((sum, f) => sum + f.passengers, 0);
    const avg = totalPax > 0 ? totalCost / totalPax : 0;
    if (maxAvg != null && avg > maxAvg) continue;
    out.push({
      destination,
      departureDate: slots[0].departureDate,
      returnDate: slots[0].returnDate,
      totalCostEUR: Number(totalCost.toFixed(2)),
      totalPassengers: totalPax,
      averageCostPerTraveler: Number(avg.toFixed(2)),
      distance: Math.abs(dayDistance(requestedDeparture, slots[0].departureDate))
        + (slots[0].returnDate ? Math.abs(dayDistance(requestedReturn, slots[0].returnDate)) : 0),
    });
  }
  out.sort((a, b) => a.distance - b.distance || a.totalCostEUR - b.totalCostEUR);
  return out.slice(0, limit);
}

// Quién tiene algún precio en las fechas pedidas y quién no. Un fallo del
// proveedor no cuenta como «sin precio».
function summarizeSearchGap(origins, hits, misses, errors) {
  const list = Array.isArray(origins) ? origins : [];
  if (list.length < 2) return null;
  const hit = new Set(hits || []);
  const miss = new Set(misses || []);
  const err = new Set(errors || []);
  const withPrice = list.filter((o) => hit.has(o));
  const withoutPrice = list.filter((o) => !hit.has(o) && miss.has(o) && !err.has(o));
  if (withoutPrice.length && withPrice.length) {
    return { withPrice, withoutPrice, noCommonDestination: false };
  }
  if (withoutPrice.length === list.length) {
    return { withPrice: [], withoutPrice, noCommonDestination: false };
  }
  if (withPrice.length === list.length) {
    return { withPrice, withoutPrice: [], noCommonDestination: true };
  }
  return null;
}

module.exports = { combineDateOptions, summarizeSearchGap, MAX_DATE_OPTIONS };
