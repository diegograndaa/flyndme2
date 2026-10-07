// Tests del parser de parámetros de búsqueda en URL (utils/urlParams.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearchLinkParams } from "../src/utils/urlParams.js";

test("urlParams: enlace completo válido", () => {
  const p = parseSearchLinkParams("?o=MAD&o=LON&dep=2026-09-15&ret=2026-09-20&trip=roundtrip&opt=fairness&direct=1&cabin=business&cur=gbp");
  assert.deepEqual(p.origins, ["MAD", "LON"]);
  assert.equal(p.departureDate, "2026-09-15");
  assert.equal(p.returnDate, "2026-09-20");
  assert.equal(p.tripType, "roundtrip");
  assert.equal(p.optimizeBy, "fairness");
  assert.equal(p.directOnly, true);
  assert.equal(p.cabinClass, "BUSINESS");
  assert.equal(p.currency, "GBP");
});

test("urlParams: sin orígenes válidos → null", () => {
  assert.equal(parseSearchLinkParams(""), null);
  assert.equal(parseSearchLinkParams("?dep=2026-09-15"), null);
  assert.equal(parseSearchLinkParams("?o=LONDON&o=12"), null); // no son IATA
});

test("urlParams: share links se ignoran (otro flujo)", () => {
  assert.equal(parseSearchLinkParams("?share=abc123&o=MAD"), null);
});

test("urlParams: valores inválidos se descartan sin romper los válidos", () => {
  const p = parseSearchLinkParams("?o=mad&dep=15-09-2026&trip=banana&opt=x&cabin=FOO&cur=BTC");
  assert.deepEqual(p.origins, ["MAD"]);
  assert.equal(p.departureDate, undefined);
  assert.equal(p.tripType, undefined);
  assert.equal(p.optimizeBy, undefined);
  assert.equal(p.cabinClass, undefined);
  assert.equal(p.currency, undefined);
});

test("urlParams: orígenes se normalizan y los no-IATA se filtran", () => {
  const p = parseSearchLinkParams("?o=%20mad%20&o=Lon&o=XXXX&o=B2N");
  assert.deepEqual(p.origins, ["MAD", "LON"]);
});

test("urlParams: direct solo acepta '1'", () => {
  assert.equal(parseSearchLinkParams("?o=MAD&direct=true").directOnly, undefined);
  assert.equal(parseSearchLinkParams("?o=MAD&direct=1").directOnly, true);
});

test("urlParams: como mucho 8 orígenes (el tope del backend)", async () => {
  const { parseSearchLinkParams, MAX_LINK_ORIGINS } = await import("../src/utils/urlParams.js");
  const q = "?" + ["MAD", "LON", "BER", "PAR", "ROM", "AMS", "MIL", "LIS", "DUB", "VIE", "PRG"].map((c) => `o=${c}`).join("&");
  const r = parseSearchLinkParams(q);
  assert.equal(r.origins.length, MAX_LINK_ORIGINS);
  assert.deepEqual(r.origins.slice(0, 2), ["MAD", "LON"]);
});

test("urlParams: fechas que no existen en el calendario se descartan", async () => {
  const { parseSearchLinkParams } = await import("../src/utils/urlParams.js");
  for (const bad of ["2026-13-45", "2026-02-30", "2026-00-10", "2026-04-31"]) {
    assert.equal(parseSearchLinkParams(`?o=MAD&dep=${bad}`).departureDate, undefined, bad);
  }
  assert.equal(parseSearchLinkParams("?o=MAD&dep=2028-02-29").departureDate, "2028-02-29", "bisiesto válido");
});

test("urlParams: una vuelta igual o anterior a la ida se descarta", async () => {
  const { parseSearchLinkParams } = await import("../src/utils/urlParams.js");
  assert.equal(parseSearchLinkParams("?o=MAD&dep=2026-12-10&ret=2026-12-05&trip=roundtrip").returnDate, undefined);
  assert.equal(parseSearchLinkParams("?o=MAD&dep=2026-12-10&ret=2026-12-10&trip=roundtrip").returnDate, undefined);
  assert.equal(parseSearchLinkParams("?o=MAD&dep=2026-12-10&ret=2026-12-14&trip=roundtrip").returnDate, "2026-12-14");
  assert.equal(parseSearchLinkParams("?o=MAD&ret=2026-12-14").returnDate, "2026-12-14", "sin ida no se puede comparar");
});
