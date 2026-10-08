// Tests de la lógica pura de frontend/src/utils/helpers.js.
// Corren con node --test sin dependencias (no requieren Vite ni navegador).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AIRPORTS, AIRPORT_MAP, MULTI_AIRPORT, airportName, getBaseUrl,
  normalizeCode, cityOf, destLabel, formatEur, formatDate, weekdayOf,
  todayISO, buildSkyscannerUrl, buildGoogleFlightsUrl, fairnessColor,
  countryFlag, destQuickInfo, setCityLang, countryOf,
} from "../src/utils/helpers.js";

test("AIRPORTS: códigos IATA únicos y válidos", () => {
  const codes = AIRPORTS.map((a) => a.code);
  assert.equal(new Set(codes).size, codes.length, "códigos duplicados");
  for (const c of codes) assert.match(c, /^[A-Z]{3}$/);
  for (const a of AIRPORTS) {
    assert.ok(a.city && a.country, `aeropuerto incompleto: ${a.code}`);
  }
});

test("AIRPORT_MAP es consistente con AIRPORTS", () => {
  assert.equal(Object.keys(AIRPORT_MAP).length, AIRPORTS.length);
  assert.equal(AIRPORT_MAP.MAD.city, "Madrid");
});

test("normalizeCode: extrae y normaliza códigos IATA", () => {
  assert.equal(normalizeCode("mad"), "MAD");
  assert.equal(normalizeCode("  bcn  "), "BCN");
  assert.equal(normalizeCode("MAD · Madrid"), "MAD");
  assert.equal(normalizeCode(""), "");
  assert.equal(normalizeCode(null), "");
  assert.equal(normalizeCode("LONDON"), "LON"); // recorte a 3 si no hay match exacto
});

test("cityOf / destLabel", () => {
  assert.equal(cityOf("MAD"), "Madrid");
  assert.equal(cityOf("ZZZ"), "");
  // El fallback de normalizeCode recorta a 3 chars: "madrid…" → "MAD" → Madrid (por diseño)
  assert.equal(cityOf("madrid-no-existe"), "Madrid");
  assert.equal(destLabel("LIS"), "LIS · Lisbon");
  assert.equal(destLabel("XXX"), "XXX"); // desconocido → solo código
});

test("formatEur: formatea con y sin decimales", () => {
  assert.ok(formatEur(123).includes("123"));
  assert.ok(formatEur(123).includes("€"));
  assert.ok(formatEur(99.4, 2).includes("99.40"));
  // Sin dato no se inventa «€0»: se muestra «—» (un 0 real sí es «€0»)
  assert.equal(formatEur(null), "—");
  assert.equal(formatEur(undefined), "—");
  assert.equal(formatEur("abc"), "—");
  assert.ok(formatEur(0).includes("0"));
  assert.ok(formatEur("85").includes("85")); // strings numéricos
});

test("formatDate / weekdayOf: fechas válidas e inválidas", () => {
  assert.ok(formatDate("2026-09-15").includes("2026"));
  assert.equal(formatDate(""), "");
  assert.equal(formatDate("garbage"), "garbage"); // passthrough si no parsea
  assert.ok(weekdayOf("2026-09-15").length >= 2);
  assert.equal(weekdayOf(""), "");
});

test("formatDate / weekdayOf: en el idioma de la interfaz", () => {
  setCityLang("es");
  try {
    assert.equal(formatDate("2026-11-15"), "15 nov 2026");
    assert.equal(weekdayOf("2026-11-15"), "dom");
  } finally { setCityLang("en"); }
  assert.equal(formatDate("2026-11-15"), "15 Nov 2026");
  assert.equal(weekdayOf("2026-11-15"), "Sun");
});

test("todayISO devuelve YYYY-MM-DD", () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test("buildSkyscannerUrl: estructura, fechas y oneway/roundtrip", () => {
  // Formato canónico de Skyscanner: yymmdd
  const ow = buildSkyscannerUrl({ origin: "MAD", destination: "ROM", departureDate: "2026-09-15", tripType: "oneway" });
  assert.ok(ow.startsWith("https://www.skyscanner.es/transport/flights/mad/rom/260915/"));
  assert.ok(ow.includes("rtn=0"));

  const rt = buildSkyscannerUrl({ origin: "MAD", destination: "ROM", departureDate: "2026-09-15", returnDate: "2026-09-20", tripType: "roundtrip" });
  assert.ok(rt.includes("/260915/260920/"));
  assert.ok(rt.includes("rtn=1"));

  // Sin datos imprescindibles → cadena vacía (no URL rota)
  assert.equal(buildSkyscannerUrl({ origin: "", destination: "ROM", departureDate: "2026-09-15" }), "");
  assert.equal(buildSkyscannerUrl({ origin: "MAD", destination: "ROM", departureDate: "" }), "");
});

test("buildGoogleFlightsUrl: estructura básica", () => {
  const u = buildGoogleFlightsUrl({ origin: "mad", destination: "rom", departureDate: "2026-09-15", tripType: "oneway" });
  assert.ok(u.includes("MAD"));
  assert.ok(u.includes("ROM"));
  assert.ok(u.includes("2026-09-15"));
  assert.equal(buildGoogleFlightsUrl({ origin: "", destination: "ROM", departureDate: "x" }), "");
});

test("fairnessColor: umbrales coherentes vía tokens (verde alto, rojo bajo)", () => {
  // Devuelve var(--fair-*) con fallback del tema claro: el modo oscuro
  // redefine los tokens en App.css sin tocar esta lógica.
  assert.equal(fairnessColor(90), "var(--fair-high, #15803D)");
  // Paleta terminal v2 (sep-2026): el tramo medio pasa de azul a verde azulado
  assert.equal(fairnessColor(70), "var(--fair-mid, #1F7A5C)");
  assert.equal(fairnessColor(50), "var(--fair-low, #B45309)");
  assert.equal(fairnessColor(10), "var(--fair-bad, #DC2626)");
});

test("countryFlag / destQuickInfo / airportName", () => {
  assert.equal(countryFlag("MAD"), "🇪🇸");
  assert.equal(countryFlag("PRG"), "🇨🇿"); // regresión: el país del aeropuerto es "Czechia"
  assert.equal(countryFlag("XXX"), "");
  assert.equal(destQuickInfo("MAD").lang, "ES");
  assert.equal(destQuickInfo("XXX"), null);
  assert.equal(airportName("LHR"), "Heathrow");
  assert.equal(airportName("xxx"), "");
});

test("getBaseUrl no crashea fuera de Vite", () => {
  assert.equal(getBaseUrl(), "/");
});

test("MULTI_AIRPORT: todos los códigos ciudad existen en AIRPORTS", () => {
  for (const cityCode of Object.keys(MULTI_AIRPORT)) {
    assert.ok(AIRPORT_MAP[cityCode], `código ciudad ${cityCode} no está en AIRPORTS`);
  }
});

test("searchAirports: código y prefijo antes que coincidencias a mitad de palabra", async () => {
  const { searchAirports } = await import("../src/utils/helpers.js");
  const lon = searchAirports("lon").map((a) => a.code);
  assert.equal(lon[0], "LON", "LON primero");
  assert.ok(lon.indexOf("BCN") > 0, "Barce·lon·a después");
  assert.equal(searchAirports("MAD")[0].code, "MAD");
});

test("searchAirports: nombres en español, sin acentos y con alias visible", async () => {
  const { searchAirports } = await import("../src/utils/helpers.js");
  const londres = searchAirports("LONDRES");
  assert.equal(londres[0].code, "LON");
  assert.equal(londres[0].alias, "Londres");
  assert.equal(searchAirports("munich")[0].code, "MUC");
  assert.equal(searchAirports("MÚNICH")[0].code, "MUC");
  assert.equal(searchAirports("praga")[0].code, "PRG");
  assert.equal(searchAirports("mallorca")[0].code, "PMI", "palabra dentro del nombre");
  assert.equal(searchAirports("Madrid")[0].alias, undefined, "sin alias si casa el nombre del catálogo");
});

test("searchAirports: aeropuertos españoles secundarios (Valencia, Sevilla, Bilbao, Alicante)", async () => {
  const { searchAirports, cityOf, setCityLang } = await import("../src/utils/helpers.js");
  assert.equal(searchAirports("valencia")[0].code, "VLC");
  assert.equal(searchAirports("València")[0].code, "VLC");
  assert.equal(searchAirports("sevilla")[0].code, "SVQ");
  assert.equal(searchAirports("bilbao")[0].code, "BIO");
  assert.equal(searchAirports("alacant")[0].code, "ALC");
  setCityLang("es");
  try { assert.equal(cityOf("SVQ"), "Sevilla"); } finally { setCityLang("en"); }
  assert.equal(cityOf("SVQ"), "Seville");
});

test("searchAirports: país, exclusiones y límite", async () => {
  const { searchAirports, POPULAR_ORIGINS, AIRPORT_MAP } = await import("../src/utils/helpers.js");
  const es = searchAirports("españa", { limit: 10 });
  assert.ok(es.length >= 3 && es.every((a) => a.country === "Spain"));
  assert.ok(!searchAirports("mad", { exclude: ["MAD"] }).some((a) => a.code === "MAD"));
  assert.ok(searchAirports("a").length <= 6);
  assert.deepEqual(searchAirports("   "), []);
  assert.deepEqual(searchAirports("zzzz"), []);
  for (const c of POPULAR_ORIGINS) assert.ok(AIRPORT_MAP[c], `popular desconocido: ${c}`);
});

test("cityOf / countryOf: nombres en el idioma de la interfaz", () => {
  // Por defecto (inglés) no cambia nada
  assert.equal(cityOf("MIL"), "Milan");
  assert.equal(cityOf("ROM"), "Rome");
  // Explícito
  assert.equal(cityOf("MIL", "es"), "Milán");
  assert.equal(cityOf("ROM", "es"), "Roma");
  assert.equal(cityOf("LIS", "es"), "Lisboa");
  assert.equal(cityOf("MAD", "es"), "Madrid"); // sin traducción → el del listado
  assert.equal(countryOf("LON", "es"), "Reino Unido");
  assert.equal(countryOf("LON", "en"), "United Kingdom");
  // Idioma global (lo fija el proveedor de i18n)
  setCityLang("es");
  try {
    assert.equal(cityOf("MIL"), "Milán");
    assert.equal(destLabel("lis"), "LIS · Lisboa");
  } finally { setCityLang("en"); }
  assert.equal(cityOf("MIL"), "Milan");
  assert.equal(cityOf("XXX", "es"), "");
});
