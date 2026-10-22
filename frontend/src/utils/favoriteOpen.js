// Abrir un destino guardado. Si esa búsqueda sigue en pantalla, se muestra.
// Si no, se vuelve a pedir ese destino con las ciudades y las fechas con las
// que se guardó. Sin eso no hay detalles que enseñar: no se inventan.

const CABINS = new Set(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]);

export function normalizeFavoriteSearch(raw) {
  if (!raw || typeof raw !== "object") return null;
  const origins = [];
  for (const item of (Array.isArray(raw.origins) ? raw.origins : []).slice(0, 8)) {
    const code = String(item || "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && !origins.includes(code)) origins.push(code);
  }
  const departureDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.departureDate || "")) ? raw.departureDate : "";
  if (!origins.length || !departureDate) return null;
  const tripType = raw.tripType === "roundtrip" ? "roundtrip" : "oneway";
  const passengers = origins.map((_, i) => {
    const n = Math.floor(Number(Array.isArray(raw.passengers) ? raw.passengers[i] : 1));
    return Number.isFinite(n) ? Math.min(9, Math.max(1, n)) : 1;
  });
  const cabin = String(raw.cabinClass || raw.travelClass || "").toUpperCase();
  const flex = Math.floor(Number(raw.flexDays));
  const budget = Number(raw.maxBudget ?? raw.maxBudgetPerTraveler);
  return {
    origins,
    passengers,
    tripType,
    departureDate,
    returnDate: tripType === "roundtrip" && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.returnDate || "")) ? raw.returnDate : "",
    flexDays: Number.isFinite(flex) && flex >= 0 && flex <= 7 ? flex : 0,
    maxBudget: Number.isFinite(budget) && budget >= 0 && budget <= 100000 ? Math.round(budget) : 0,
    directOnly: raw.directOnly === true || raw.nonStop === true,
    cabinClass: CABINS.has(cabin) ? cabin : "ECONOMY",
  };
}

export function sameFavoriteSearch(a, b) {
  const left = normalizeFavoriteSearch(a);
  const right = normalizeFavoriteSearch(b);
  if (!left && !right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * select: el destino ya está en los resultados de esta búsqueda.
 * search: hay ciudades y fecha para pedir solo ese destino.
 * unavailable: no hay con qué buscar; no se fabrican vuelos.
 */
export function favoriteOpenPlan({ code, search, flights, activeSearch, form }) {
  const dest = String(code || "").trim().toUpperCase();
  const saved = normalizeFavoriteSearch(search);
  const active = normalizeFavoriteSearch(activeSearch);
  const inList = /^[A-Z]{3}$/.test(dest) && (flights || []).some((f) => String(f?.destination || "").trim().toUpperCase() === dest);
  if (inList && (!saved || sameFavoriteSearch(saved, active))) return { action: "select", code: dest };
  const next = saved || normalizeFavoriteSearch(form);
  if (next) return { action: "search", code: dest, search: next };
  return { action: "unavailable", code: dest };
}
