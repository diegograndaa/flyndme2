// Viajeros por ciudad de salida, en el mismo orden que la lista de ciudades sin
// repetir (cleanOrigins). Las filas vacías no cuentan y una ciudad que aparece
// en varias filas suma sus viajeros: indexar `passengers` con el índice de la
// lista deduplicada desalineaba los números (fila vacía o ciudad repetida).
export const MAX_PAX_PER_ORIGIN = 9;
// Mismo tope que /multi-origin (TOTAL_PAX_CAP). Por encima la búsqueda se rechaza.
export const MAX_TOTAL_PAX = 16;

/** Suma de viajeros de las filas con ciudad. Una fila vacía no cuenta. */
export function totalPax(origins = [], passengers = []) {
  return (origins || []).reduce((sum, o, i) => {
    if (!String(o || "").trim()) return sum;
    return sum + Math.max(1, Math.floor(Number(passengers?.[i])) || 1);
  }, 0);
}

const upperTrim = (o) => String(o || "").trim().toUpperCase();

// `toCode` convierte lo escrito en cada fila en el código de ciudad: tiene que
// ser el MISMO criterio con el que se construye cleanOrigins.
export function paxByOrigin(origins = [], passengers = [], toCode = upperTrim) {
  const order = [];
  const sum = new Map();
  (origins || []).forEach((o, i) => {
    const code = toCode(o);
    if (!code) return;
    const p = Math.max(1, Math.floor(Number(passengers?.[i])) || 1);
    if (!sum.has(code)) { order.push(code); sum.set(code, 0); }
    sum.set(code, sum.get(code) + p);
  });
  return order.map((origin) => ({ origin, passengers: sum.get(origin) }));
}
