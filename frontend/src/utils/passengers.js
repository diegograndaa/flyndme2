// Viajeros por ciudad de salida, en el mismo orden que la lista de ciudades sin
// repetir (cleanOrigins). Las filas vacías no cuentan y una ciudad que aparece
// en varias filas suma sus viajeros: indexar `passengers` con el índice de la
// lista deduplicada desalineaba los números (fila vacía o ciudad repetida).
export const MAX_PAX_PER_ORIGIN = 9;

export function paxByOrigin(origins = [], passengers = []) {
  const order = [];
  const sum = new Map();
  (origins || []).forEach((o, i) => {
    const code = String(o || "").trim().toUpperCase();
    if (!code) return;
    const p = Math.max(1, Math.floor(Number(passengers?.[i])) || 1);
    if (!sum.has(code)) { order.push(code); sum.set(code, 0); }
    sum.set(code, sum.get(code) + p);
  });
  return order.map((origin) => ({ origin, passengers: sum.get(origin) }));
}
