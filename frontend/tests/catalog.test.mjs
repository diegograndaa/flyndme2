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
