// Coherencia entre el backend y el frontend: cada destino que puede devolver la
// búsqueda (DEFAULT_DESTINATION_TIERS en backend/routes/flights.js) tiene que
// poder pintarse bien: foto, coordenadas del mapa, nombre y bandera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flightsSrc = readFileSync(new URL("../../backend/routes/flights.js", import.meta.url), "utf8");
const tiersBlock = flightsSrc.match(/const DEFAULT_DESTINATION_TIERS = \[([\s\S]*?)\n\];/);
const DESTS = [...(tiersBlock?.[1] || "").matchAll(/"([A-Z]{3})"/g)].map((m) => m[1]);

test("catálogo: se leen los destinos del backend", () => {
  assert.ok(DESTS.length >= 20, `destinos leídos: ${DESTS.length}`);
});

test("catálogo: cada destino del backend tiene foto, coordenadas, nombre y bandera", async () => {
  const { getCityImageUrl } = await import("../src/utils/cityImages.js");
  const { CITY_COORDS } = await import("../src/utils/geo.js");
  const { AIRPORT_MAP, cityOf, countryFlag } = await import("../src/utils/helpers.js");
  const missing = [];
  for (const code of DESTS) {
    if (!getCityImageUrl(code)) missing.push(`${code}: foto`);
    if (!CITY_COORDS[code]) missing.push(`${code}: coordenadas`);
    if (!AIRPORT_MAP[code]) missing.push(`${code}: catálogo`);
    if (!cityOf(code) || cityOf(code) === code) missing.push(`${code}: nombre`);
    if (!countryFlag(code)) missing.push(`${code}: bandera`);
  }
  assert.deepEqual(missing, []);
});

test("catálogo: las ciudades de siempre conservan su foto; un aeropuerto nuevo no se inventa", async () => {
  const { getCityImageUrl, getCityImage } = await import("../src/utils/cityImages.js");
  const { CURATED_CODES } = await import("../src/utils/helpers.js");
  const missing = CURATED_CODES.filter((code) => !getCityImageUrl(code));
  assert.deepEqual(missing, []);
  assert.match(getCityImageUrl("ALC"), /photo-1552057031-5071f53c5757/);
  assert.match(getCityImageUrl("VLC"), /photo-1577990432593-6bf35f43beed/);
  assert.match(getCityImageUrl("SVQ"), /photo-1634010405255-2ce3fdd0946d/);
  assert.match(getCityImageUrl("BIO"), /photo-1663844234274-7089dd2d8243/);
  assert.match(getCityImageUrl("OVD"), /commons\.wikimedia\.org\/wiki\/Special:FilePath\/Vistageneraldeoviedo/);
  assert.equal(getCityImage("OVD", "/base/"), getCityImageUrl("OVD"));
});

test("catálogo: cada aeropuerto tiene una foto real y ninguna es un avión o un mapa", async () => {
  const { getCityImageUrl } = await import("../src/utils/cityImages.js");
  const { CITY_WIKI_PHOTOS } = await import("../src/utils/cityWikiPhotos.js");
  const { AIRPORTS, CURATED_CODES, SEARCH_POOL } = await import("../src/utils/helpers.js");
  const missing = AIRPORTS.filter((a) => !getCityImageUrl(a.code)).map((a) => a.code);
  assert.deepEqual(missing, []);
  for (const code of CURATED_CODES) {
    assert.match(getCityImageUrl(code), /^https:\/\/images\.unsplash\.com\//, code);
  }
  assert.match(decodeURIComponent(getCityImageUrl("SZG")), /Salzburg/);
  assert.match(decodeURIComponent(getCityImageUrl("LHR")), /London/);
  assert.match(decodeURIComponent(getCityImageUrl("SOT")), /Sodankyl/);
  assert.match(decodeURIComponent(getCityImageUrl("KAU")), /Kauhava Church/);
  assert.match(decodeURIComponent(getCityImageUrl("BOO")), /Bodø/);
  assert.match(decodeURIComponent(getCityImageUrl("URS")), /Курск/);
  assert.match(decodeURIComponent(getCityImageUrl("ZAO")), /Cahors/);
  assert.match(decodeURIComponent(getCityImageUrl("NIT")), /Niort/);
  assert.match(decodeURIComponent(getCityImageUrl("ERD")), /Berdyansk/);
  const banned = /cessna|airbus|boeing|\bf-16\b|\bf-15\b|су-30|nasa firms|\.svg|\.tif|\.tiff|locator map|coat of arms/i;
  const bad = Object.entries(CITY_WIKI_PHOTOS)
    .filter(([, url]) => banned.test(decodeURIComponent(url)))
    .map(([code]) => code);
  assert.deepEqual(bad, []);
  assert.equal(SEARCH_POOL.includes("OVD"), false);
  assert.equal(Object.keys(CITY_WIKI_PHOTOS).length, AIRPORTS.length - CURATED_CODES.length);
});

test("catálogo: Asturias y el resto de Europa se pueden elegir, sin cambiar la búsqueda habitual", async () => {
  const { searchAirports, resolveOriginCode, AIRPORT_MAP, countryFlag, SEARCH_POOL, cityOf } = await import("../src/utils/helpers.js");
  const { CITY_COORDS } = await import("../src/utils/geo.js");
  const { AIRPORT_COORDS } = await import("../src/utils/resultsLogic.js");
  const { domesticCodes } = await import("../src/utils/resultFilters.js");
  assert.equal(searchAirports("asturias")[0].code, "OVD");
  assert.equal(searchAirports("oviedo")[0].code, "OVD");
  assert.equal(resolveOriginCode("Avilés"), "OVD");
  assert.equal(AIRPORT_MAP.OVD.city, "Asturias");
  assert.equal(AIRPORT_MAP.OVD.country, "Spain");
  assert.equal(countryFlag("OVD"), "🇪🇸");
  assert.ok(CITY_COORDS.OVD[0] < -5 && CITY_COORDS.OVD[0] > -7, "lon de Asturias");
  assert.ok(CITY_COORDS.OVD[1] > 43 && CITY_COORDS.OVD[1] < 44, "lat de Asturias");
  assert.ok(Math.abs(AIRPORT_COORDS.OVD[0] - CITY_COORDS.OVD[1]) < 0.02);
  assert.equal(SEARCH_POOL.includes("OVD"), false);
  for (const code of ["LPA", "TFN", "ACE", "FUE", "GMZ", "SCQ", "KBP", "LHR", "CDG"]) {
    assert.ok(AIRPORT_MAP[code], code);
    assert.ok(countryFlag(code), `${code} bandera`);
  }
  assert.equal(AIRPORT_MAP.OVB, undefined);
  const spain = domesticCodes("Spain", ["MAD"]);
  assert.ok(spain.includes("OVD") && spain.includes("LPA"));
  assert.equal(spain.includes("MAD"), false);
  assert.equal(cityOf("OVD"), "Asturias");
  assert.equal(cityOf("LHR"), "London Heathrow");
});

test("cityImages: URL de Unsplash con tamaño y respaldo local para códigos sin foto", async () => {
  const { getCityImageUrl, getCityImage } = await import("../src/utils/cityImages.js");
  const u = getCityImageUrl("par", { w: 320, h: 200 });
  assert.match(u, /^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?w=320&h=200&fit=crop/);
  assert.equal(getCityImageUrl("ZZZ"), null);
  assert.equal(getCityImageUrl(undefined), null);
  assert.equal(getCityImage("ZZZ", "/base/"), "/base/destinations/ZZZ.jpg");
  assert.equal(getCityImage("PAR"), getCityImageUrl("PAR"));
});

test("foldText: minúsculas, sin acentos y sin espacios en los extremos", async () => {
  const { foldText } = await import("../src/utils/helpers.js");
  assert.equal(foldText("  MÚNICH "), "munich");
  assert.equal(foldText("Kraków"), "krakow");
  assert.equal(foldText("València"), "valencia");
  assert.equal(foldText(null), "");
  assert.equal(foldText(undefined), "");
});

test("scrollBehavior: 'auto' con movimiento reducido o sin matchMedia, 'smooth' si no", async () => {
  const { scrollBehavior } = await import("../src/utils/helpers.js");
  const saved = globalThis.window;
  try {
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    assert.equal(scrollBehavior(), "auto");
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.equal(scrollBehavior(), "smooth");
    globalThis.window = {};
    assert.equal(scrollBehavior(), "smooth");
    globalThis.window = { matchMedia: () => { throw new Error("x"); } };
    assert.equal(scrollBehavior(), "auto");
  } finally {
    globalThis.window = saved;
  }
});

test("tapHaptic: vibra si el navegador lo soporta y nunca lanza", async () => {
  const { tapHaptic } = await import("../src/utils/haptics.js");
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const calls = [];
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { vibrate: (ms) => calls.push(ms) } });
    tapHaptic(); tapHaptic(25);
    assert.deepEqual(calls, [10, 25]);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    assert.doesNotThrow(() => tapHaptic());
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { vibrate: () => { throw new Error("x"); } } });
    assert.doesNotThrow(() => tapHaptic());
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved); else delete globalThis.navigator;
  }
});

test("analytics.track: nunca lanza, aunque las props sean raras", async () => {
  const { track } = await import("../src/utils/analytics.js");
  const circ = {}; circ.self = circ;
  assert.doesNotThrow(() => track("evento", { a: 1, b: null, c: undefined, d: { x: 1 }, e: circ }));
  assert.doesNotThrow(() => track("evento"));
});

test("catálogo: cada ciudad de salida del formulario tiene coordenadas (mapa) y bandera", async () => {
  const { AIRPORTS, countryFlag } = await import("../src/utils/helpers.js");
  const { CITY_COORDS } = await import("../src/utils/geo.js");
  const { AIRPORT_COORDS } = await import("../src/utils/resultsLogic.js");
  const missing = [];
  for (const { code } of AIRPORTS) {
    if (!CITY_COORDS[code]) missing.push(`${code}: CITY_COORDS`);
    if (!AIRPORT_COORDS[code]) missing.push(`${code}: AIRPORT_COORDS`);
    if (!countryFlag(code)) missing.push(`${code}: bandera`);
  }
  assert.deepEqual(missing, []);
});
