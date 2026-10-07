// Duraciones alternativas para una ida y vuelta sin resultados. La caché de
// Travelpayouts tiene sobre todo escapadas cortas, así que se prueban primero
// viajes más cortos (más cerca de lo pedido antes) y luego uno más largo.
// Lógica pura, sin red.

const MAX_CANDIDATES = 4;

/**
 * @param {number} nights  noches pedidas (vuelta − ida)
 * @returns {number[]}     noches a probar, en orden, sin la pedida y ≥ 1
 */
function candidateNights(nights) {
  const n = Math.round(Number(nights));
  if (!Number.isFinite(n) || n < 1) return [];
  const out = [];
  for (let d = 1; out.length < MAX_CANDIDATES - 1 && n - d >= 1; d++) out.push(n - d);
  for (let d = 1; out.length < MAX_CANDIDATES; d++) out.push(n + d);
  return out;
}

module.exports = { candidateNights, MAX_CANDIDATES };
