// ─── Airport data ─────────────────────────────────────────────────────────────

export const AIRPORTS = [
  { code: "MAD", city: "Madrid",     country: "Spain" },
  { code: "BCN", city: "Barcelona",  country: "Spain" },
  { code: "LON", city: "London",     country: "United Kingdom" },
  { code: "PAR", city: "Paris",      country: "France" },
  { code: "ROM", city: "Rome",       country: "Italy" },
  { code: "MIL", city: "Milan",      country: "Italy" },
  { code: "BER", city: "Berlin",     country: "Germany" },
  { code: "AMS", city: "Amsterdam",  country: "Netherlands" },
  { code: "LIS", city: "Lisbon",     country: "Portugal" },
  { code: "DUB", city: "Dublin",     country: "Ireland" },
  { code: "VIE", city: "Vienna",     country: "Austria" },
  { code: "BRU", city: "Brussels",   country: "Belgium" },
  { code: "PRG", city: "Prague",     country: "Czechia" },
  { code: "WAW", city: "Warsaw",     country: "Poland" },
  { code: "ATH", city: "Athens",     country: "Greece" },
  { code: "CPH", city: "Copenhagen", country: "Denmark" },
  { code: "HEL", city: "Helsinki",   country: "Finland" },
  { code: "ZRH", city: "Zurich",     country: "Switzerland" },
  { code: "OSL", city: "Oslo",       country: "Norway" },
  { code: "BUD", city: "Budapest",   country: "Hungary" },
  { code: "IST", city: "Istanbul",   country: "Turkey" },
];

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

export function buildSkyscannerUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = String(origin || "").toLowerCase();
  const to   = String(destination || "").toLowerCase();
  const dep  = String(departureDate || "").replace(/-/g, "");
  const ret  = tripType === "roundtrip" ? String(returnDate || "").replace(/-/g, "") : "";
  if (!from || !to || !dep) return "";
  const base = "https://www.skyscanner.es/transport/flights";
  const path = ret ? `${base}/${from}/${to}/${dep}/${ret}/` : `${base}/${from}/${to}/${dep}/`;
  const params = new URLSearchParams({ adultsv2: "1", cabinclass: "economy", rtn: ret ? "1" : "0" });
  return `${path}?${params}`;
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
