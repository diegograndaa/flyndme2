// Horas del billete. La salida se lee de los dígitos que trae el proveedor
// (hora local del aeropuerto, aunque el ISO lleve desfase). La llegada de
// Travelpayouts está en UTC (…Z): pintarla con esos dígitos mentiría
// (15:10+02 y 85 min son las 16:35 en Madrid y las 15:35 en Londres, no las
// 14:35). Solo se convierte si el instante trae zona y conocemos la zona
// IANA del destino. Sin zona en el texto (el mock) se enseñan los dígitos.
// Sin zona conocida y con …Z, no hay hora de llegada.

import { AIRPORT_MAP } from "./helpers.js";
import { CITY_COORDS } from "./geo.js";

const ZONE_BY_COUNTRY = {
  Albania: "Europe/Tirane",
  Austria: "Europe/Vienna",
  Belarus: "Europe/Minsk",
  Belgium: "Europe/Brussels",
  "Bosnia and Herzegovina": "Europe/Sarajevo",
  Bulgaria: "Europe/Sofia",
  Croatia: "Europe/Zagreb",
  Cyprus: "Asia/Nicosia",
  Czechia: "Europe/Prague",
  Denmark: "Europe/Copenhagen",
  Estonia: "Europe/Tallinn",
  "Faroe Islands": "Atlantic/Faroe",
  Finland: "Europe/Helsinki",
  France: "Europe/Paris",
  Germany: "Europe/Berlin",
  Gibraltar: "Europe/Gibraltar",
  Greece: "Europe/Athens",
  Guernsey: "Europe/Guernsey",
  Hungary: "Europe/Budapest",
  Iceland: "Atlantic/Reykjavik",
  Ireland: "Europe/Dublin",
  "Isle of Man": "Europe/Isle_of_Man",
  Israel: "Asia/Jerusalem",
  Italy: "Europe/Rome",
  Jersey: "Europe/Jersey",
  Kosovo: "Europe/Belgrade",
  Latvia: "Europe/Riga",
  Lithuania: "Europe/Vilnius",
  Luxembourg: "Europe/Luxembourg",
  Malta: "Europe/Malta",
  Moldova: "Europe/Chisinau",
  Montenegro: "Europe/Podgorica",
  Morocco: "Africa/Casablanca",
  Netherlands: "Europe/Amsterdam",
  "North Macedonia": "Europe/Skopje",
  Norway: "Europe/Oslo",
  Poland: "Europe/Warsaw",
  Portugal: "Europe/Lisbon",
  Romania: "Europe/Bucharest",
  Serbia: "Europe/Belgrade",
  Slovakia: "Europe/Bratislava",
  Slovenia: "Europe/Ljubljana",
  Spain: "Europe/Madrid",
  Sweden: "Europe/Stockholm",
  Switzerland: "Europe/Zurich",
  Turkey: "Europe/Istanbul",
  Ukraine: "Europe/Kyiv",
  "United Kingdom": "Europe/London",
};

// El país no basta: Canarias, Azores, Madeira y Kaliningrado no siguen
// la hora de la capital.
const ZONE_BY_CODE = {
  ACE: "Atlantic/Canary", FUE: "Atlantic/Canary", LPA: "Atlantic/Canary",
  SPC: "Atlantic/Canary", TFN: "Atlantic/Canary", TFS: "Atlantic/Canary",
  VDE: "Atlantic/Canary", GMZ: "Atlantic/Canary",
  PDL: "Atlantic/Azores", HOR: "Atlantic/Azores", SMA: "Atlantic/Azores",
  TER: "Atlantic/Azores", FLW: "Atlantic/Azores", CVU: "Atlantic/Azores",
  SJZ: "Atlantic/Azores", PIX: "Atlantic/Azores", GRW: "Atlantic/Azores",
  FNC: "Atlantic/Madeira", PXO: "Atlantic/Madeira",
  KGD: "Europe/Kaliningrad",
};

// Nombres que sí conocemos. Un código que no está aquí se enseña tal cual:
// no se inventa una aerolínea.
const AIRLINE_NAMES = {
  UX: "Air Europa", IB: "Iberia", I2: "Iberia Express", YW: "Air Nostrum",
  VY: "Vueling", V7: "Volotea", NT: "Binter",
  FR: "Ryanair", RK: "Ryanair",
  U2: "easyJet", EC: "easyJet", DS: "easyJet",
  W6: "Wizz Air", W9: "Wizz Air", W4: "Wizz Air", "5W": "Wizz Air",
  BA: "British Airways", AF: "Air France", LH: "Lufthansa", TP: "TAP Air Portugal",
  KL: "KLM", AY: "Finnair", SK: "SAS", LX: "Swiss", OS: "Austrian",
  AZ: "ITA Airways", TK: "Turkish Airlines", A3: "Aegean", EI: "Aer Lingus",
  SN: "Brussels Airlines", EW: "Eurowings", HV: "Transavia", TO: "Transavia",
  DY: "Norwegian", D8: "Norwegian", PC: "Pegasus", LO: "LOT", BT: "airBaltic",
  QS: "Smartwings", FB: "Bulgaria Air", JU: "Air Serbia", OU: "Croatia Airlines",
  DE: "Condor", WK: "Edelweiss",
};

export function airlineName(code) {
  const c = String(code || "").trim().toUpperCase();
  return AIRLINE_NAMES[c] || "";
}

export function airportTimeZone(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  if (ZONE_BY_CODE[c]) return ZONE_BY_CODE[c];
  const country = AIRPORT_MAP[c]?.country;
  if (country === "Russia") {
    const lon = CITY_COORDS[c]?.[0];
    if (typeof lon !== "number") return null;
    if (lon < 28) return "Europe/Kaliningrad";
    if (lon < 45) return "Europe/Moscow";
    return null;
  }
  return ZONE_BY_COUNTRY[country] || null;
}

export function clockHHMM(at) {
  const m = typeof at === "string" ? /T(\d{2}:\d{2})/.exec(at) : null;
  return m ? m[1] : "";
}

function hasZone(at) {
  return typeof at === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/.test(at);
}

export function arrivalClock(at, destCode) {
  if (typeof at !== "string" || !at) return "";
  if (!hasZone(at)) return clockHHMM(at);
  const tz = airportTimeZone(destCode);
  if (!tz) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  let hh = "";
  let mm = "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    hh = parts.find((p) => p.type === "hour")?.value || "";
    mm = parts.find((p) => p.type === "minute")?.value || "";
  } catch {
    return "";
  }
  if (hh === "24") hh = "00";
  if (!/^\d{2}$/.test(hh) || !/^\d{2}$/.test(mm)) return "";
  return `${hh}:${mm}`;
}

export function durationParts(iso) {
  if (typeof iso !== "string") return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso.trim());
  if (!m) return null;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  if (!h && !min) return null;
  return { h, m: min };
}

// Escalas: si hay varios segmentos, se cuentan. Si no, el número que trae
// el proveedor (transfers). Un solo segmento sin ese número es directo.
// Vacío y sin número → null (no se dice «directo» por no saberlo).
export function legStopCount(segments, transfers) {
  const segs = Array.isArray(segments) ? segments : [];
  if (segs.length > 1) return segs.length - 1;
  if (typeof transfers === "number" && Number.isFinite(transfers) && transfers >= 0) return transfers;
  if (segs.length === 1) return 0;
  return null;
}

// Vista de un tramo. Sin segmentos no hay relojes (una escala sin aeropuertos
// intermedios no se inventa). from/to de respaldo solo si hay algún dato real.
export function legSchedule({ itinerary, transfers, from, to, airline } = {}) {
  const segments = Array.isArray(itinerary?.segments) ? itinerary.segments : [];
  const stops = legStopCount(segments, transfers);
  const duration = durationParts(itinerary?.duration || "");
  const carrier = segments[0]?.carrierCode || airline || "";
  const hasFlight = segments.length > 0 || duration != null || stops != null || !!carrier;
  if (!hasFlight) return null;
  const fromCode = segments[0]?.departure?.iataCode || from || "";
  const toCode = (segments.length ? segments[segments.length - 1]?.arrival?.iataCode : "") || to || "";
  const dep = segments.length ? clockHHMM(segments[0]?.departure?.at) : "";
  const arr = segments.length ? arrivalClock(segments[segments.length - 1]?.arrival?.at, toCode) : "";
  return { from: fromCode, to: toCode, dep, arr, stops, carrier, duration };
}
