// Normaliza los resultados de un enlace compartido antes de pintarlos. Los
// guarda el propio cliente (POST /api/share), así que pueden venir de versiones
// antiguas o fabricados a mano: números como texto, campos ausentes, entradas
// que no son objetos. Regla de honestidad: no se inventa nada; un destino sin
// total válido o un tramo sin precio válido se DESCARTA.
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

function normalizeLeg(l) {
  if (!l || typeof l !== "object" || typeof l.origin !== "string") return null;
  const price = num(l.price);
  if (price === undefined || price <= 0) return null;
  const passengers = Math.max(1, Math.floor(num(l.passengers) ?? 1));
  const out = { ...l, origin: l.origin.toUpperCase(), price, passengers };
  const tfo = num(l.totalForOrigin);
  out.totalForOrigin = tfo !== undefined ? tfo : Number((price * passengers).toFixed(2));
  return out;
}

export function normalizeDestination(d) {
  if (!d || typeof d !== "object" || typeof d.destination !== "string") return null;
  const totalCostEUR = num(d.totalCostEUR);
  if (totalCostEUR === undefined || totalCostEUR <= 0) return null;
  const out = { ...d, totalCostEUR };
  for (const k of ["averageCostPerTraveler", "fairnessScore", "priceSpread", "totalPassengers"]) {
    const v = num(d[k]);
    if (v === undefined) delete out[k]; else out[k] = v;
  }
  if (Array.isArray(d.flights)) out.flights = d.flights.map(normalizeLeg).filter(Boolean);
  else delete out.flights;
  return out;
}

export function normalizeSharedFlights(flights) {
  return (Array.isArray(flights) ? flights : []).map(normalizeDestination).filter(Boolean);
}
