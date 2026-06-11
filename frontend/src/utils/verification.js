// ─── Capa 2: verificación de precio del ganador ──────────────────────────────
// Lógica pura (sin React, sin DOM) para la llamada en segundo plano a
// POST /api/flights/verify, que re-tarifica el destino ganador contra Google
// Flights (SerpAPI). Vive en utils/ para poder testearla con node --test.
//
// Flujo: el frontend pinta los resultados de /multi-origin al instante con
// verificationStatus "skipped" (badge "precio orientativo") y, cuando llega la
// verificación, mergea los campos verified* para que VerificationBadge pase a
// ✓ verde o ↑/↓. Nunca se re-ordenan resultados ni se cambian precios mostrados.

// ¿Procede verificar este destino? Solo si el backend lo dejó en "skipped" y
// trae vuelos. Con resultados parciales, solo si TODOS los legs traen offer
// completo (un parcial puede venir sin offers y el payload saldría cojo).
export function shouldVerify(dest, { partial = false } = {}) {
  if (!dest || dest.verificationStatus !== "skipped") return false;
  if (!Array.isArray(dest.flights) || dest.flights.length === 0) return false;
  if (partial && !dest.flights.every((f) => f && f.offer)) return false;
  return true;
}

// Construye el payload de POST /api/flights/verify a partir del destino ganador
// y de las fechas de la búsqueda. IMPORTANTE: cuando hubo date-fallback (fecha
// vecina), se manda la fecha REAL del vuelo — de ahí el orden de preferencia
// offer.tp.* → flightDate/flightReturnDate → fecha de la búsqueda.
export function buildVerifyPayload(dest, { departureDate, returnDate, tripType } = {}) {
  const searchReturn = tripType === "roundtrip" ? (returnDate || null) : null;
  return {
    destination: dest.destination,
    totalCostEUR: dest.totalCostEUR,
    legs: (dest.flights || []).map((f) => ({
      origin: f.origin,
      price: f.price,
      passengers: f.passengers || 1,
      departureDate: f.offer?.tp?.departureDate ?? f.flightDate ?? departureDate,
      returnDate: f.offer?.tp?.returnDate ?? f.flightReturnDate ?? searchReturn,
      nonStop: f.offer?.tp?.nonStop ?? false,
      dateFallback: f.dateFallback === true,
    })),
  };
}

// Campos de nivel destino que el endpoint puede devolver y que se mergean tal
// cual. Todo lo demás de la respuesta se ignora: jamás se pisan los precios
// originales (totalCostEUR, averageCostPerTraveler, price...).
const DEST_VERIFY_FIELDS = [
  "verificationStatus",
  "verificationSource",
  "verifiedAt",
  "priceChangePct",
  "verifiedTotalCostEUR",
  "verifiedAveragePerTraveler",
  "verifiedPriceSpread",
  "verifiedFairnessScore",
];

// Devuelve una copia del destino con los campos de verificación mergeados.
// Por origen (dentro de flights) solo se AÑADEN campos verified*: el total
// verificado se guarda como verifiedTotalForOrigin aunque la respuesta lo
// llame totalForOrigin, para no pisar el valor original del leg.
export function mergeVerification(dest, verification) {
  if (!dest || !verification) return dest;

  const merged = { ...dest };
  for (const key of DEST_VERIFY_FIELDS) {
    if (verification[key] !== undefined) merged[key] = verification[key];
  }

  const vLegs = Array.isArray(verification.flights)
    ? verification.flights
    : Array.isArray(verification.legs) ? verification.legs : [];
  if (vLegs.length && Array.isArray(dest.flights)) {
    const byOrigin = new Map(
      vLegs
        .filter((l) => l && l.origin)
        .map((l) => [String(l.origin).toUpperCase(), l])
    );
    merged.flights = dest.flights.map((f) => {
      const v = byOrigin.get(String(f?.origin || "").toUpperCase());
      if (!v) return f;
      const nf = { ...f };
      if (v.verifiedPrice !== undefined) nf.verifiedPrice = v.verifiedPrice;
      const vTotal = v.verifiedTotalForOrigin ?? v.totalForOrigin;
      if (vTotal !== undefined) nf.verifiedTotalForOrigin = vTotal;
      return nf;
    });
  }

  return merged;
}
