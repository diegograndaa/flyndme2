// Lectura de listas guardadas en localStorage que nunca rompe la app: si el
// valor no es JSON, no es un array o trae entradas con otra forma (datos de
// versiones antiguas, extensiones, usuarios que lo editan…), se descarta en
// vez de llegar al render (antes un `null` dejaba la app en blanco).
export function readStoredList(key, isValid = () => true, storage) {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage;
    const parsed = JSON.parse(s?.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === "object" && isValid(x)) : [];
  } catch {
    return [];
  }
}

export const isFavoriteEntry = (f) => typeof f.code === "string" && /^[A-Z]{3}$/.test(f.code);
export const isRecentSearchEntry = (r) =>
  Array.isArray(r.origins) && r.origins.length > 0 && r.origins.every((o) => typeof o === "string") &&
  typeof r.departureDate === "string";
