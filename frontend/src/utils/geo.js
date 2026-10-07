// ─── geo ─────────────────────────────────────────────────────────────────────
// Coordenadas de ciudades (lon, lat) y distancias ortodrómicas. Lo usan el mapa
// de rutas y el radar del hero. Solo geometría: nada de precios.

// ── City coordinates (lon, lat) for European destinations ────────────────────
export const CITY_COORDS = {
  MAD: [-3.70, 40.42], BCN: [2.17, 41.39], AGP: [-4.42, 36.72],
  PMI: [2.74, 39.55], TFS: [-16.57, 28.04], LON: [-0.12, 51.51],
  VLC: [-0.38, 39.47], SVQ: [-5.98, 37.39], BIO: [-2.93, 43.26],
  ALC: [-0.49, 38.35],
  EDI: [-3.19, 55.95], PAR: [2.35, 48.86], MRS: [5.37, 43.30],
  NCE: [7.26, 43.71], ROM: [12.50, 41.90], MIL: [9.19, 45.46],
  NAP: [14.27, 40.85], BER: [13.40, 52.52], MUC: [11.58, 48.14],
  FRA: [8.68, 50.11], AMS: [4.90, 52.37], LIS: [-9.14, 38.74],
  OPO: [-8.61, 41.15], DUB: [-6.26, 53.35], BRU: [4.35, 50.85],
  GVA: [6.14, 46.20], ZRH: [8.54, 47.38], VIE: [16.37, 48.21],
  PRG: [14.42, 50.08], WAW: [21.01, 52.23], KRK: [19.94, 50.06],
  BUD: [19.04, 47.50], OTP: [26.10, 44.43], SOF: [23.32, 42.70],
  BEG: [20.47, 44.79], ZAG: [15.98, 45.81], DBV: [18.09, 42.65],
  SPU: [16.44, 43.51], TIA: [19.82, 41.33], CPH: [12.57, 55.68],
  HEL: [24.94, 60.17], OSL: [10.75, 59.91], STO: [18.07, 59.33],
  TLL: [24.75, 59.44], RIX: [24.11, 56.95], VNO: [25.28, 54.69],
  ATH: [23.73, 37.98], SKG: [22.95, 40.63], RHO: [28.23, 36.43],
  IST: [28.98, 41.01], MLA: [14.51, 35.90], RAK: [-8.00, 31.63],
  CMN: [-7.59, 33.57], TLV: [34.79, 32.08],
};

const EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Distancia ortodrómica (haversine) en km entre dos códigos, o null. */
export function distanceKm(fromCode, toCode) {
  const a = CITY_COORDS[fromCode];
  const b = CITY_COORDS[toCode];
  if (!a || !b) return null;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(2 * EARTH_KM * Math.asin(Math.sqrt(h)));
}

/**
 * Tiempo de vuelo directo ESTIMADO por distancia (crucero ~800 km/h + 30 min
 * de rodaje, despegue y aproximación), redondeado a 5 min. Es una
 * aproximación para ilustrar, no un horario: la UI lo marca siempre con "~".
 */
export function estimatedFlightMinutes(km) {
  if (!Number.isFinite(km) || km <= 0) return null;
  return Math.max(5, Math.round(((km / 800) * 60 + 30) / 5) * 5);
}
