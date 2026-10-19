// Escenarios de la portada. Un toque rellena la búsqueda real (ciudades,
// viajeros, ida/vuelta y criterio). No pone fecha ni precio: la fecha la
// elige quien busca y el precio sale de la búsqueda.
import { addDaysISO, horizonISO } from "./helpers";

export const GROUP_STARTS = [
  { id: "friends", origins: ["MAD", "LON", "BER"], tripType: "oneway", optimizeBy: "total" },
  { id: "couple", origins: ["BCN", "LON"], tripType: "roundtrip", optimizeBy: "total" },
  { id: "sendoff", origins: ["MAD", "BCN", "VLC"], tripType: "roundtrip", optimizeBy: "total" },
  { id: "fair", origins: ["MAD", "BER"], tripType: "oneway", optimizeBy: "fairness" },
  { id: "erasmus", origins: ["MAD", "PAR", "AMS"], tripType: "oneway", optimizeBy: "total" },
  { id: "weekend", origins: ["LIS", "PAR", "ROM"], tripType: "roundtrip", optimizeBy: "total" },
];

/**
 * Estado que hay que volcar en el formulario. Conserva la fecha de ida que
 * ya hubiera. En ida y vuelta, si la vuelta falta o no es posterior, propone
 * siete días después (el mismo salto que el formulario al pasar a ida y
 * vuelta), nunca una fecha «barata» y nunca más allá del horizonte.
 */
export function applyGroupStart(start, current = {}) {
  const known = GROUP_STARTS.find((s) => s.id === start?.id) || null;
  const spec = known
    || (Array.isArray(start?.origins) && start.origins.length ? start : null);
  if (!spec) return null;
  const origins = spec.origins
    .map((c) => String(c || "").trim().toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c))
    .slice(0, 8);
  if (origins.length < 2) return null;
  const tripType = spec.tripType === "roundtrip" ? "roundtrip" : "oneway";
  const optimizeBy = spec.optimizeBy === "fairness" ? "fairness" : "total";
  const departureDate = current.departureDate || "";
  let returnDate = current.returnDate || "";
  if (tripType === "roundtrip" && departureDate && (!returnDate || returnDate <= departureDate)) {
    const next = addDaysISO(departureDate, 7);
    returnDate = next && next <= horizonISO() ? next : "";
  }
  return {
    origins,
    passengers: origins.map(() => 1),
    tripType,
    optimizeBy,
    selectedDests: [],
    departureDate,
    returnDate: tripType === "roundtrip" ? returnDate : (current.returnDate || ""),
  };
}
