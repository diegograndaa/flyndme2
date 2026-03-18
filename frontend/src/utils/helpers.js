// ─── Airport data ─────────────────────────────────────────────────────────────

export const AIRPORTS = [
  // ── Western Europe ──
  { code: "MAD", city: "Madrid",              country: "Spain" },
  { code: "BCN", city: "Barcelona",           country: "Spain" },
  { code: "AGP", city: "Malaga",              country: "Spain" },
  { code: "PMI", city: "Palma de Mallorca",   country: "Spain" },
  { code: "TFS", city: "Tenerife",            country: "Spain" },
  { code: "LON", city: "London",              country: "United Kingdom" },
  { code: "EDI", city: "Edinburgh",           country: "United Kingdom" },
  { code: "PAR", city: "Paris",               country: "France" },
  { code: "MRS", city: "Marseille",           country: "France" },
  { code: "NCE", city: "Nice",                country: "France" },
  { code: "ROM", city: "Rome",                country: "Italy" },
  { code: "MIL", city: "Milan",               country: "Italy" },
  { code: "NAP", city: "Naples",              country: "Italy" },
  { code: "BER", city: "Berlin",              country: "Germany" },
  { code: "MUC", city: "Munich",              country: "Germany" },
  { code: "FRA", city: "Frankfurt",           country: "Germany" },
  { code: "AMS", city: "Amsterdam",           country: "Netherlands" },
  { code: "LIS", city: "Lisbon",              country: "Portugal" },
  { code: "OPO", city: "Porto",               country: "Portugal" },
  { code: "DUB", city: "Dublin",              country: "Ireland" },
  { code: "BRU", city: "Brussels",            country: "Belgium" },
  { code: "GVA", city: "Geneva",              country: "Switzerland" },
  { code: "ZRH", city: "Zurich",              country: "Switzerland" },
  // ── Central & Eastern Europe ──
  { code: "VIE", city: "Vienna",              country: "Austria" },
  { code: "PRG", city: "Prague",              country: "Czechia" },
  { code: "WAW", city: "Warsaw",              country: "Poland" },
  { code: "KRK", city: "Krakow",             country: "Poland" },
  { code: "BUD", city: "Budapest",            country: "Hungary" },
  { code: "OTP", city: "Bucharest",           country: "Romania" },
  { code: "SOF", city: "Sofia",               country: "Bulgaria" },
  { code: "BEG", city: "Belgrade",            country: "Serbia" },
  { code: "ZAG", city: "Zagreb",              country: "Croatia" },
  { code: "DBV", city: "Dubrovnik",           country: "Croatia" },
  { code: "SPU", city: "Split",               country: "Croatia" },
  { code: "TIA", city: "Tirana",              country: "Albania" },
  // ── Nordics & Baltics ──
  { code: "CPH", city: "Copenhagen",          country: "Denmark" },
  { code: "HEL", city: "Helsinki",            country: "Finland" },
  { code: "OSL", city: "Oslo",                country: "Norway" },
  { code: "STO", city: "Stockholm",           country: "Sweden" },
  { code: "TLL", city: "Tallinn",             country: "Estonia" },
  { code: "RIX", city: "Riga",                country: "Latvia" },
  { code: "VNO", city: "Vilnius",             country: "Lithuania" },
  // ── Southeast Europe & Mediterranean ──
  { code: "ATH", city: "Athens",              country: "Greece" },
  { code: "SKG", city: "Thessaloniki",        country: "Greece" },
  { code: "RHO", city: "Rhodes",              country: "Greece" },
  { code: "IST", city: "Istanbul",            country: "Turkey" },
  { code: "MLA", city: "Malta",               country: "Malta" },
  // ── North Africa & Middle East ──
  { code: "RAK", city: "Marrakech",           country: "Morocco" },
  { code: "CMN", city: "Casablanca",          country: "Morocco" },
  { code: "TLV", city: "Tel Aviv",            country: "Israel" },
];

// ── Multi-airport mapping: city codes → specific airports ───────────────────
// Amadeus accepts city codes (LON, PAR, etc.) and searches all airports.
// This map helps display which airport the result refers to.
export const MULTI_AIRPORT = {
  LON: ["LHR", "LGW", "STN", "LTN"],
  PAR: ["CDG", "ORY"],
  MIL: ["MXP", "LIN", "BGY"],
  ROM: ["FCO", "CIA"],
  BER: ["BER"],    // single since Tegel closed
  STO: ["ARN", "BMA"],
  IST: ["IST", "SAW"],
};

// Resolve a specific airport name (e.g. LHR → "Heathrow")
const AIRPORT_NAMES = {
  LHR: "Heathrow", LGW: "Gatwick", STN: "Stansted", LTN: "Luton",
  CDG: "Charles de Gaulle", ORY: "Orly",
  MXP: "Malpensa", LIN: "Linate", BGY: "Bergamo",
  FCO: "Fiumicino", CIA: "Ciampino",
  ARN: "Arlanda", BMA: "Bromma",
  SAW: "Sabiha Gökçen",
};
export function airportName(code) {
  return AIRPORT_NAMES[String(code).toUpperCase()] || "";
}

export const AIRPORT_MAP = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

// ─── Utilities ────────────────────────────────────────────────────────────────

export function getBaseUrl() {
  return import.meta.env.BASE_URL || "/";
}

export function normalizeCode(v) {
  const raw = String(v || "").trim().toUpperCase();
  const m   = raw.match(/\b[A-Z]{3}\b/);
  return m ? m[0] : raw.slice(0, 3);
}

export function cityOf(code) {
  return AIRPORT_MAP[normalizeCode(code)]?.city || "";
}

export function destLabel(code) {
  const c = cityOf(code);
  return c ? `${normalizeCode(code)} · ${c}` : normalizeCode(code);
}

export function formatEur(n, dec = 0) {
  const v = typeof n === "number" ? n : Number(n || 0);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency", currency: "EUR",
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(v);
  } catch { return `€${v.toFixed(dec)}`; }
}

export function formatDate(s) {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d)) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function todayISO() {
  return new Date().toISOString().split("T")[0];
}

// Skyscanner affiliate ID — set via VITE_SKYSCANNER_AFFILIATE_ID env var
const SKYSCANNER_AFFILIATE_ID = (typeof import.meta !== "undefined" && import.meta.env?.VITE_SKYSCANNER_AFFILIATE_ID) || "";

export function buildSkyscannerUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = String(origin || "").toLowerCase();
  const to   = String(destination || "").toLowerCase();
  const dep  = String(departureDate || "").replace(/-/g, "");
  const ret  = tripType === "roundtrip" ? String(returnDate || "").replace(/-/g, "") : "";
  if (!from || !to || !dep) return "";
  const base = "https://www.skyscanner.es/transport/flights";
  const path = ret ? `${base}/${from}/${to}/${dep}/${ret}/` : `${base}/${from}/${to}/${dep}/`;
  const params = new URLSearchParams({ adultsv2: "1", cabinclass: "economy", rtn: ret ? "1" : "0" });
  // Append affiliate tracking if configured
  if (SKYSCANNER_AFFILIATE_ID) {
    params.set("associateId", SKYSCANNER_AFFILIATE_ID);
    params.set("utm_source", "flyndme");
    params.set("utm_medium", "referral");
  }
  return `${path}?${params}`;
}

export function buildGoogleFlightsUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = String(origin || "").toUpperCase();
  const to   = String(destination || "").toUpperCase();
  const dep  = String(departureDate || "");
  if (!from || !to || !dep) return "";
  const ret = tripType === "roundtrip" && returnDate ? String(returnDate) : "";
  let url = `https://www.google.com/travel/flights?q=Flights+from+${from}+to+${to}+on+${dep}`;
  if (ret) url += `+return+${ret}`;
  return url;
}

export async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta); return ok;
  } catch { return false; }
}

export function fairnessColor(s) {
  if (s >= 85) return "#16A34A";
  if (s >= 65) return "#0062E3";
  if (s >= 45) return "#D97706";
  return "#DC2626";
}

// Country → flag emoji (ISO 3166-1 alpha-2 code → regional indicators)
const COUNTRY_FLAGS = {
  "Spain": "🇪🇸", "United Kingdom": "🇬🇧", "France": "🇫🇷", "Italy": "🇮🇹",
  "Germany": "🇩🇪", "Netherlands": "🇳🇱", "Portugal": "🇵🇹", "Austria": "🇦🇹",
  "Belgium": "🇧🇪", "Czech Republic": "🇨🇿", "Poland": "🇵🇱", "Greece": "🇬🇷",
  "Ireland": "🇮🇪", "Denmark": "🇩🇰", "Sweden": "🇸🇪", "Norway": "🇳🇴",
  "Finland": "🇫🇮", "Hungary": "🇭🇺", "Switzerland": "🇨🇭", "Croatia": "🇭🇷",
  "Romania": "🇷🇴", "Bulgaria": "🇧🇬", "Serbia": "🇷🇸", "Turkey": "🇹🇷",
  "Morocco": "🇲🇦", "Malta": "🇲🇹", "Albania": "🇦🇱", "Israel": "🇮🇱",
  "Estonia": "🇪🇪", "Latvia": "🇱🇻", "Lithuania": "🇱🇹",
};
export function countryFlag(code) {
  const ap = AIRPORT_MAP[code];
  return ap ? (COUNTRY_FLAGS[ap.country] || "") : "";
}
