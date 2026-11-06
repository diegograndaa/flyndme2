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
  (perOrigin || []).forEach((rows, i) => {
    for (const row of rows || []) {
      const price = Number(row?.price);
      const dep = String(row?.departureDate || "");
      const ret = String(row?.returnDate || "");
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dep) || !/^\d{4}-\d{2}-\d{2}$/.test(ret)) continue;
      if (dep === requestedDeparture && ret === requestedReturn) continue;
      if (maxFlight != null && price > maxFlight) continue;
      const key = `${dep}|${ret}`;
      if (!byPair.has(key)) byPair.set(key, new Array(origins.length).fill(null));
      const slot = byPair.get(key);
      if (!slot[i] || price < slot[i].price) slot[i] = { price, departureDate: dep, returnDate: ret };
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
        + Math.abs(dayDistance(requestedReturn, slots[0].returnDate)),
    });
  }
  out.sort((a, b) => a.distance - b.distance || a.totalCostEUR - b.totalCostEUR);
  return out.slice(0, limit);
}

module.exports = { combineDateOptions, MAX_DATE_OPTIONS };
