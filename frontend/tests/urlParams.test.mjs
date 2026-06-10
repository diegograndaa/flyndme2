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
