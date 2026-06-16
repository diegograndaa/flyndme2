// ─── Capa 2: verificación de precio del ganador ──────────────────────────────
// Lógica pura (sin React, sin DOM) para la llamada en segundo plano a
// POST /api/flights/verify, que re-tarifica el destino ganador contra Google
// Flights (SerpAPI). Vive en utils/ para poder testearla con node --test.
//
// Flujo: el frontend pinta los resultados de /multi-origin al instante con
// verificationStatus "skipped" (badge "precio orientativo") y, cuando llega la
// verificación, mergea los campos verified*. Si la verificación fue COMPLETA
// (todos los legs), el precio verificado PASA A SER el precio mostrado (el
// orientativo se guarda en cached* para el "antes"); VerificationBadge pasa a
// ✓ verde o ↑/↓. Nunca se re-ordenan los resultados (solo se verifica el
// ganador, así que compararlo con las alternativas orientativas sería injusto).

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
// Si Travelpayouts expone los aeropuertos REALES del billete (offer.tp.
// originAirport/destinationAirport), se añaden al leg: Google Flights no acepta
// códigos de ciudad multi-aeropuerto (ROM, LON, PAR…). Si faltan, se OMITEN las
// claves y el backend hace fallback (tolera offers antiguos sin esos campos).
export function buildVerifyPayload(dest, { departureDate, returnDate, tripType } = {}) {
  const searchReturn = tripType === "roundtrip" ? (returnDate || null) : null;
  return {
    destination: dest.destination,
    totalCostEUR: dest.totalCostEUR,
    legs: (dest.flights || []).map((f) => {
      const leg = {
        origin: f.origin,
        price: f.price,
        passengers: f.passengers || 1,
        departureDate: f.offer?.tp?.departureDate ?? f.flightDate ?? departureDate,
        returnDate: f.offer?.tp?.returnDate ?? f.flightReturnDate ?? searchReturn,
        nonStop: f.offer?.tp?.nonStop ?? false,
        dateFallback: f.dateFallback === true,
      };
      const originAirport = f.offer?.tp?.originAirport ?? null;
      const destinationAirport = f.offer?.tp?.destinationAirport ?? null;
      if (originAirport != null) leg.originAirport = originAirport;
      if (destinationAirport != null) leg.destinationAirport = destinationAirport;
      return leg;
    }),
  };
}

// Campos de nivel destino que el endpoint puede devolver y que se mergean tal
// cual (se guardan SIEMPRE como verified*, además de promocionarse si procede).
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

// Estados en los que el backend verificó TODOS los legs contra Google Flights:
// los agregados verified* son entonces 100% precio real y se PROMOCIONAN a
// precio mostrado (el orientativo previo se guarda en cached* para enseñar el
// "antes"). En partial/failed/timeout/skipped NO se promociona nada: un total
// mezcla (parte verificado, parte caché) no puede presentarse como verificado.
const FULLY_VERIFIED = new Set(["verified", "changed"]);

// [campo mostrado, campo verificado, campo donde guardar el orientativo previo]
const PROMOTE_DEST = [
  ["totalCostEUR", "verifiedTotalCostEUR", "cachedTotalCostEUR"],
  ["averageCostPerTraveler", "verifiedAveragePerTraveler", "cachedAveragePerTraveler"],
  ["priceSpread", "verifiedPriceSpread", "cachedPriceSpread"],
  ["fairnessScore", "verifiedFairnessScore", "cachedFairnessScore"],
];

// Devuelve una copia del destino con la verificación mergeada. Los campos
// verified* se guardan SIEMPRE; además, si la verificación es COMPLETA
// (verified/changed), el precio verificado pasa a ser el precio mostrado
// (total, por viajero, spread, fairness y price/totalForOrigin de cada leg),
// conservando el orientativo en cached*. Nunca se re-ordenan los resultados.
export function mergeVerification(dest, verification) {
  if (!dest || !verification) return dest;

  const merged = { ...dest };
  for (const key of DEST_VERIFY_FIELDS) {
    if (verification[key] !== undefined) merged[key] = verification[key];
  }

  const promote = FULLY_VERIFIED.has(verification.verificationStatus);

  if (promote) {
    for (const [shown, verified, cached] of PROMOTE_DEST) {
      const v = verification[verified];
      if (Number.isFinite(v)) {
        merged[cached] = dest[shown];
        merged[shown] = v;
      }
    }
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
      // Promoción del precio del leg a mostrado (solo verificación completa).
      if (promote && Number.isFinite(v.verifiedPrice)) {
        nf.cachedPrice = f.price;
        nf.price = v.verifiedPrice;
        if (Number.isFinite(vTotal)) {
          nf.cachedTotalForOrigin = f.totalForOrigin;
          nf.totalForOrigin = vTotal;
        }
      }
      return nf;
    });
  }

  return merged;
}
