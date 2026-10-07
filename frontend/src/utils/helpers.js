// ─── Airport data ─────────────────────────────────────────────────────────────

export const AIRPORTS = [
  // ── Western Europe ──
  { code: "MAD", city: "Madrid",              country: "Spain" },
  { code: "BCN", city: "Barcelona",           country: "Spain" },
  { code: "AGP", city: "Malaga",              country: "Spain" },
  { code: "PMI", city: "Palma de Mallorca",   country: "Spain" },
  { code: "TFS", city: "Tenerife",            country: "Spain" },
  { code: "VLC", city: "Valencia",            country: "Spain" },
  { code: "SVQ", city: "Seville",             country: "Spain" },
  { code: "BIO", city: "Bilbao",              country: "Spain" },
  { code: "ALC", city: "Alicante",            country: "Spain" },
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
// The flight API accepts city codes (LON, PAR, etc.) and searches all airports.
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

// ── Búsqueda de aeropuertos (autocompletado) ─────────────────────────────────
// Nombres en español y variantes habituales: quien escribe "Londres", "Múnich"
// o "Praga" debe encontrar su ciudad aunque el catálogo esté en inglés.
const AIRPORT_ALIASES = {
  AGP: ["Málaga"], PMI: ["Palma", "Mallorca"], TFS: ["Tenerife Sur"],
  VLC: ["València"], SVQ: ["Sevilla"], BIO: ["Bilbo"], ALC: ["Alacant"],
  LON: ["Londres"], EDI: ["Edimburgo"], PAR: ["París"], MRS: ["Marsella"],
  NCE: ["Niza"], ROM: ["Roma"], MIL: ["Milán", "Milano"], NAP: ["Nápoles", "Napoli"],
  BER: ["Berlín"], MUC: ["Múnich", "München"], FRA: ["Fráncfort"], AMS: ["Ámsterdam"],
  LIS: ["Lisboa"], OPO: ["Oporto"], DUB: ["Dublín"], BRU: ["Bruselas"],
  GVA: ["Ginebra"], ZRH: ["Zúrich"], VIE: ["Viena", "Wien"], PRG: ["Praga", "Praha"],
  WAW: ["Varsovia"], KRK: ["Cracovia", "Kraków"], OTP: ["Bucarest"], SOF: ["Sofía"],
  BEG: ["Belgrado"], CPH: ["Copenhague"], STO: ["Estocolmo"], TLL: ["Tallin"],
  VNO: ["Vilna"], ATH: ["Atenas"], SKG: ["Salónica", "Tesalónica"], RHO: ["Rodas"],
  IST: ["Estambul"], RAK: ["Marrakech", "Marrakesh"], TLV: ["Tel Aviv-Yafo"],
};
const COUNTRY_ALIASES = {
  Spain: ["España"], "United Kingdom": ["Reino Unido", "UK", "Inglaterra", "Escocia"],
  France: ["Francia"], Italy: ["Italia"], Germany: ["Alemania"],
  Netherlands: ["Países Bajos", "Holanda"], Ireland: ["Irlanda"], Belgium: ["Bélgica"],
  Switzerland: ["Suiza"], Czechia: ["Chequia", "República Checa"], Poland: ["Polonia"],
  Hungary: ["Hungría"], Romania: ["Rumanía"], Croatia: ["Croacia"], Denmark: ["Dinamarca"],
  Finland: ["Finlandia"], Norway: ["Noruega"], Sweden: ["Suecia"], Latvia: ["Letonia"],
  Lithuania: ["Lituania"], Greece: ["Grecia"], Turkey: ["Turquía"], Morocco: ["Marruecos"],
};

// Minúsculas y sin acentos ("MÚNICH" → "munich")
export function foldText(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Salidas más habituales: se proponen al enfocar un origen vacío.
export const POPULAR_ORIGINS = ["MAD", "BCN", "LON", "PAR", "BER", "ROM", "AMS", "LIS"];

/**
 * Aeropuertos que encajan con lo escrito, mejor coincidencia primero:
 * código exacto > nombre exacto > código empieza por > nombre empieza por >
 * alguna palabra del nombre empieza por > contiene (≥3 letras) > país.
 * Devuelve copias de AIRPORTS con `alias` cuando el acierto vino de un nombre
 * alternativo (para enseñar "London · Londres").
 */
export function searchAirports(query, { exclude = [], limit = 6 } = {}) {
  const q = foldText(query);
  if (!q) return [];
  const ex = new Set(exclude.map((c) => String(c).toUpperCase()));
  const hits = [];
  for (const a of AIRPORTS) {
    if (ex.has(a.code)) continue;
    const code = a.code.toLowerCase();
    const names = [a.city, ...(AIRPORT_ALIASES[a.code] || [])];
    const folded = names.map(foldText);
    const countries = [a.country, ...(COUNTRY_ALIASES[a.country] || [])].map(foldText);
    const rank = (test) => folded.findIndex(test);
    let score = -1;
    let via = -1;
    if (code === q) score = 0;
    else if ((via = rank((n) => n === q)) >= 0) score = 1;
    else if (code.startsWith(q)) score = 2;
    else if ((via = rank((n) => n.startsWith(q))) >= 0) score = 3;
    else if ((via = rank((n) => n.split(/[\s-]+/).some((w) => w.startsWith(q)))) >= 0) score = 4;
    else if (q.length >= 3 && (via = rank((n) => n.includes(q))) >= 0) score = 5;
    else if (q.length >= 2 && countries.some((c) => c.startsWith(q))) score = 6;
    if (score < 0) continue;
    hits.push({ a: via > 0 ? { ...a, alias: names[via] } : a, score });
  }
  return hits.sort((x, y) => x.score - y.score).slice(0, limit).map((h) => h.a);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function getBaseUrl() {
  // Optional chaining: fuera de Vite (tests con node, SSR) import.meta.env
  // no existe y el acceso directo lanzaba TypeError.
  return import.meta.env?.BASE_URL || "/";
}

export function normalizeCode(v) {
  const raw = String(v || "").trim().toUpperCase();
  const m   = raw.match(/\b[A-Z]{3}\b/);
  return m ? m[0] : raw.slice(0, 3);
}

// Idioma en el que se muestran los nombres de ciudad y país. Lo fija el
// proveedor de i18n; por defecto inglés (tests / SSR).
let cityLang = "en";
export function setCityLang(lang) { cityLang = lang === "es" ? "es" : "en"; }

// Nombres en español de las ciudades que cambian respecto al listado (inglés).
const CITY_ES = {
  AGP: "Málaga", SVQ: "Sevilla", LON: "Londres", EDI: "Edimburgo", PAR: "París", MRS: "Marsella",
  NCE: "Niza", ROM: "Roma", MIL: "Milán", NAP: "Nápoles", BER: "Berlín",
  MUC: "Múnich", FRA: "Fráncfort", AMS: "Ámsterdam", LIS: "Lisboa", OPO: "Oporto",
  DUB: "Dublín", BRU: "Bruselas", GVA: "Ginebra", ZRH: "Zúrich", VIE: "Viena",
  PRG: "Praga", WAW: "Varsovia", KRK: "Cracovia", OTP: "Bucarest", SOF: "Sofía",
  BEG: "Belgrado", CPH: "Copenhague", STO: "Estocolmo", TLL: "Tallin", VNO: "Vilna",
  ATH: "Atenas", SKG: "Salónica", RHO: "Rodas", IST: "Estambul",
};

// Nombre de la ciudad en el idioma de la interfaz ("Milán", "Roma", "Lisboa"
// en español); si no hay traducción, el nombre del listado.
export function cityOf(code, lang = cityLang) {
  const c = normalizeCode(code);
  const a = AIRPORT_MAP[c];
  if (!a) return "";
  return (lang === "es" && CITY_ES[c]) || a.city;
}

export function countryOf(code, lang = cityLang) {
  const a = AIRPORT_MAP[normalizeCode(code)];
  if (!a) return "";
  return (lang === "es" && COUNTRY_ALIASES[a.country]?.[0]) || a.country;
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

export function weekdayOf(s) {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}

export function todayISO() {
  return new Date().toISOString().split("T")[0];
}

// Skyscanner affiliate ID — set via VITE_SKYSCANNER_AFFILIATE_ID env var
const SKYSCANNER_AFFILIATE_ID = (typeof import.meta !== "undefined" && import.meta.env?.VITE_SKYSCANNER_AFFILIATE_ID) || "";

export function buildSkyscannerUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = String(origin || "").toLowerCase();
  const to   = String(destination || "").toLowerCase();
  // Formato canónico de Skyscanner: yymmdd (260915), no yyyymmdd.
  const dep  = String(departureDate || "").replace(/-/g, "").slice(2);
  const ret  = tripType === "roundtrip" ? String(returnDate || "").replace(/-/g, "").slice(2) : "";
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

// Comportamiento de scroll respetando prefers-reduced-motion (a11y):
// los scrollTo/scrollIntoView "smooth" de JS ignoran la media query de CSS.
export function scrollBehavior() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth";
  } catch { return "auto"; }
}

// Tonos con contraste AA (≥4.5:1) como texto pequeño. Devuelve variables CSS
// (--fair-* en App.css) para que el modo oscuro aclare los tonos sin tocar JS;
// el fallback hex es el valor del tema claro.
export function fairnessColor(s) {
  if (s >= 85) return "var(--fair-high, #15803D)";
  if (s >= 65) return "var(--fair-mid, #1F7A5C)";
  if (s >= 45) return "var(--fair-low, #B45309)";
  return "var(--fair-bad, #DC2626)";
}

// Country → flag emoji (ISO 3166-1 alpha-2 code → regional indicators)
const COUNTRY_FLAGS = {
  "Spain": "🇪🇸", "United Kingdom": "🇬🇧", "France": "🇫🇷", "Italy": "🇮🇹",
  "Germany": "🇩🇪", "Netherlands": "🇳🇱", "Portugal": "🇵🇹", "Austria": "🇦🇹",
  "Belgium": "🇧🇪", "Czechia": "🇨🇿", "Poland": "🇵🇱", "Greece": "🇬🇷",
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

// Destination quick-info (timezone offset from UTC, language tip)
const DEST_INFO = {
  MAD: { tz: "+1", lang: "ES" }, BCN: { tz: "+1", lang: "ES/CA" }, AGP: { tz: "+1", lang: "ES" },
  PMI: { tz: "+1", lang: "ES/CA" }, TFS: { tz: "+0", lang: "ES" },
  VLC: { tz: "+1", lang: "ES/CA" }, SVQ: { tz: "+1", lang: "ES" }, BIO: { tz: "+1", lang: "ES/EU" },
  ALC: { tz: "+1", lang: "ES/CA" },
  LON: { tz: "+0", lang: "EN" }, EDI: { tz: "+0", lang: "EN" },
  PAR: { tz: "+1", lang: "FR" }, MRS: { tz: "+1", lang: "FR" }, NCE: { tz: "+1", lang: "FR" },
  ROM: { tz: "+1", lang: "IT" }, MIL: { tz: "+1", lang: "IT" }, NAP: { tz: "+1", lang: "IT" },
  BER: { tz: "+1", lang: "DE" }, MUC: { tz: "+1", lang: "DE" }, FRA: { tz: "+1", lang: "DE" },
  AMS: { tz: "+1", lang: "NL/EN" }, LIS: { tz: "+0", lang: "PT" }, OPO: { tz: "+0", lang: "PT" },
  VIE: { tz: "+1", lang: "DE" }, PRG: { tz: "+1", lang: "CS" }, ATH: { tz: "+2", lang: "EL" },
  CPH: { tz: "+1", lang: "DA" }, BUD: { tz: "+1", lang: "HU" }, DUB: { tz: "+0", lang: "EN" },
  BRU: { tz: "+1", lang: "FR/NL" }, WAW: { tz: "+1", lang: "PL" },
  OSL: { tz: "+1", lang: "NO" }, HEL: { tz: "+2", lang: "FI" }, STO: { tz: "+1", lang: "SV" },
  KRK: { tz: "+1", lang: "PL" }, BEG: { tz: "+1", lang: "SR" },
  OTP: { tz: "+2", lang: "RO" }, SOF: { tz: "+2", lang: "BG" },
  IST: { tz: "+3", lang: "TR" }, RAK: { tz: "+1", lang: "AR/FR" },
  DBV: { tz: "+1", lang: "HR" }, SPU: { tz: "+1", lang: "HR" },
  MLA: { tz: "+1", lang: "EN/MT" }, TIA: { tz: "+1", lang: "SQ" },
  TLV: { tz: "+2", lang: "HE/EN" }, RHO: { tz: "+2", lang: "EL" },
  TLL: { tz: "+2", lang: "ET" }, RIX: { tz: "+2", lang: "LV" }, VNO: { tz: "+2", lang: "LT" },
  SKG: { tz: "+2", lang: "EL" }, GVA: { tz: "+1", lang: "FR" }, ZRH: { tz: "+1", lang: "DE" },
};
export function destQuickInfo(code) {
  return DEST_INFO[code] || null;
}
