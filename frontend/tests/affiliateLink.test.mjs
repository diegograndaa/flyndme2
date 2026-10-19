// «Reservar» → Aviasales con el marker de afiliado. Solo se aceptan enlaces
// https de Aviasales; con varios viajeros de una ciudad, se busca para todos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { affiliateLinkForAdults } from "../src/utils/affiliateLink.js";

const ONE_WAY = "https://www.aviasales.com/search/MAD2311LIS1?t=FR123&marker=738121";
const ROUND = "https://www.aviasales.com/search/MAD2311LIS25111?marker=738121";

test("con 1 viajero el enlace queda igual (marker incluido)", () => {
  assert.equal(affiliateLinkForAdults(ONE_WAY, 1), ONE_WAY);
});

test("con varios viajeros cambia la cifra de pasajeros y conserva el marker", () => {
  const out = affiliateLinkForAdults(ONE_WAY, 3);
  assert.ok(out.startsWith("https://www.aviasales.com/search/MAD2311LIS3?"), out);
  assert.ok(out.includes("marker=738121"), out);
  assert.ok(out.includes("t=FR123"), out);
});

test("ida y vuelta: la fecha de vuelta no se toca", () => {
  const out = affiliateLinkForAdults(ROUND, 2);
  assert.ok(out.startsWith("https://www.aviasales.com/search/MAD2311LIS25112?"), out);
});

test("viajeros fuera de rango se acotan a 1-9", () => {
  assert.ok(affiliateLinkForAdults(ONE_WAY, 0).includes("/search/MAD2311LIS1?"));
  assert.ok(affiliateLinkForAdults(ONE_WAY, 14).includes("/search/MAD2311LIS9?"));
  assert.ok(affiliateLinkForAdults(ONE_WAY, "x").includes("/search/MAD2311LIS1?"));
});

test("un enlace que no es https de Aviasales no se usa", () => {
  assert.equal(affiliateLinkForAdults("", 1), "");
  assert.equal(affiliateLinkForAdults(undefined, 1), "");
  assert.equal(affiliateLinkForAdults("http://www.aviasales.com/search/MAD2311LIS1", 1), "");
  assert.equal(affiliateLinkForAdults("https://evil.example/search/MAD2311LIS1", 1), "");
  assert.equal(affiliateLinkForAdults("https://aviasales.com.evil.example/x", 1), "");
  assert.equal(affiliateLinkForAdults("https://aviasales.co.evil/search/MAD2311LIS1", 1), "");
  assert.equal(affiliateLinkForAdults("javascript:alert(1)", 1), "");
});

test("una ruta que no es de búsqueda se deja como viene", () => {
  const other = "https://www.aviasales.com/?marker=738121";
  assert.equal(affiliateLinkForAdults(other, 3), other);
});
