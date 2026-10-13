// Lista corta de destinos «que suelen ser más baratos».
// Las tarifas que entran aquí NO se enseñan: solo eligen qué ciudades
// consultar después con la fecha real del grupo. Sin un precio de caché
// para CADA origen, el destino no entra. Si no quedan al menos `minCommon`,
// se devuelve null y la búsqueda sigue con las 24 ciudades habituales.

const IATA = /^[A-Z]{3}$/;

function codeOf(value) {
  const code = String(value || "").trim().toUpperCase();
  return IATA.test(code) ? code : "";
}

/**
 * Mapa de /v1/prices/cheap: { data: { BCN: { "0": { price } } } }.
 * También acepta el mapa interior. Se queda el mínimo positivo de cada ciudad.
 * @returns {{ destination: string, price: number }[]}
 */
function rowsFromCheapPayload(body) {
  if (!body || typeof body !== "object") return [];
  const map = body.data && typeof body.data === "object" && !Array.isArray(body.data)
    ? body.data
    : body;
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const out = [];
  for (const [raw, stops] of Object.entries(map)) {
    const destination = codeOf(raw);
    if (!destination || !stops || typeof stops !== "object") continue;
    let price = Infinity;
    for (const row of Object.values(stops)) {
      const p = Number(row && row.price);
      if (Number.isFinite(p) && p > 0 && p < price) price = p;
    }
    if (price < Infinity) out.push({ destination, price });
  }
  return out;
}

/**
 * @param {{ origins: string[], byOrigin: Record<string, {destination: string, price: number}[]>, allow: Iterable<string>, limit?: number, minCommon?: number }} input
 * @returns {string[]|null} códigos ordenados de más barato a más caro (suma), o null
 */
function pickCheaperDestinations({ origins, byOrigin, allow, limit = 12, minCommon = 6 } = {}) {
  const originList = [];
  for (const raw of origins || []) {
    const code = codeOf(raw);
    if (code && !originList.includes(code)) originList.push(code);
  }
  if (!originList.length) return null;
  const allowSet = allow instanceof Set ? allow : new Set(allow || []);
  const skip = new Set(originList);
  const maps = originList.map((origin) => {
    const prices = new Map();
    for (const row of (byOrigin && byOrigin[origin]) || []) {
      const destination = codeOf(row && row.destination);
      const price = Number(row && row.price);
      if (!destination || skip.has(destination) || !allowSet.has(destination)) continue;
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!prices.has(destination) || price < prices.get(destination)) prices.set(destination, price);
    }
    return prices;
  });

  const common = [];
  for (const [destination, price] of maps[0]) {
    let sum = price;
    let ok = true;
    for (let i = 1; i < maps.length; i++) {
      if (!maps[i].has(destination)) { ok = false; break; }
      sum += maps[i].get(destination);
    }
    if (ok) common.push({ destination, sum });
  }
  if (common.length < minCommon) return null;
  common.sort((a, b) => a.sum - b.sum || (a.destination < b.destination ? -1 : 1));
  const cap = Math.max(1, Math.floor(Number(limit)) || 12);
  return common.slice(0, cap).map((row) => row.destination);
}

module.exports = { rowsFromCheapPayload, pickCheaperDestinations };
