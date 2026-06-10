// Tests de la lógica pura de frontend/src/utils/helpers.js.
// Corren con node --test sin dependencias (no requieren Vite ni navegador).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AIRPORTS, AIRPORT_MAP, MULTI_AIRPORT, airportName, getBaseUrl,
  normalizeCode, cityOf, destLabel, formatEur, formatDate, weekdayOf,
  todayISO, buildSkyscannerUrl, buildGoogleFlightsUrl, fairnessColor,
  countryFlag, destQuickInfo,
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
  assert.ok(formatEur(null).includes("0"));
  assert.ok(formatEur("85").includes("85")); // strings numéricos
});

test("formatDate / weekdayOf: fechas válidas e inválidas", () => {
  assert.ok(formatDate("2026-09-15").includes("2026"));
  assert.equal(formatDate(""), "");
  assert.equal(formatDate("garbage"), "garbage"); // passthrough si no parsea
  assert.ok(weekdayOf("2026-09-15").length >= 2);
  assert.equal(weekdayOf(""), "");
});

test("todayISO devuelve YYYY-MM-DD", () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test("buildSkyscannerUrl: estructura, fechas y oneway/roundtrip", () => {
  const ow = buildSkyscannerUrl({ origin: "MAD", destination: "ROM", departureDate: "2026-09-15", tripType: "oneway" });
  assert.ok(ow.startsWith("https://www.skyscanner.es/transport/flights/mad/rom/20260915/"));
  assert.ok(ow.includes("rtn=0"));

  const rt = buildSkyscannerUrl({ origin: "MAD", destination: "ROM", departureDate: "2026-09-15", returnDate: "2026-09-20", tripType: "roundtrip" });
  assert.ok(rt.includes("/20260915/20260920/"));
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

test("fairnessColor: umbrales coherentes (verde alto, rojo bajo)", () => {
  assert.equal(fairnessColor(90), "#16A34A");
  assert.equal(fairnessColor(70), "#0062E3");
  assert.equal(fairnessColor(50), "#D97706");
  assert.equal(fairnessColor(10), "#DC2626");
});

test("countryFlag / destQuickInfo / airportName", () => {
  assert.equal(countryFlag("MAD"), "🇪🇸");
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
