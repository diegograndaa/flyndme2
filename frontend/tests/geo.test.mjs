// Tests de frontend/src/utils/geo.js (distancias del radar del hero y el mapa).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CITY_COORDS, distanceKm, estimatedFlightMinutes } from "../src/utils/geo.js";

test("geo: distancia ortodrómica real y simétrica", () => {
  const madPar = distanceKm("MAD", "PAR");
  assert.ok(madPar > 1030 && madPar < 1080, `MAD-PAR fuera de rango: ${madPar}`);
  assert.equal(distanceKm("PAR", "MAD"), madPar);
  const lonAms = distanceKm("LON", "AMS");
  assert.ok(lonAms > 330 && lonAms < 380, `LON-AMS fuera de rango: ${lonAms}`);
});

test("geo: códigos desconocidos → null (nunca una distancia inventada)", () => {
  assert.equal(distanceKm("MAD", "XXX"), null);
  assert.equal(distanceKm(undefined, "PAR"), null);
});

test("geo: tiempo de vuelo estimado en múltiplos de 5 min y null sin distancia", () => {
  assert.equal(estimatedFlightMinutes(1053), 110); // 1053/800 h + 30 min ≈ 109 → 110
  for (const km of [150, 280, 900, 2400]) assert.equal(estimatedFlightMinutes(km) % 5, 0);
  assert.equal(estimatedFlightMinutes(0), null);
  assert.equal(estimatedFlightMinutes(NaN), null);
});

test("geo: coordenadas (lon, lat) plausibles para Europa", () => {
  for (const [code, [lon, lat]] of Object.entries(CITY_COORDS)) {
    assert.match(code, /^[A-Z]{3}$/);
    // De las Azores al lado europeo de los Urales, y de Canarias a Svalbard.
    assert.ok(lon > -33 && lon < 62 && lat > 26 && lat < 81, `${code} fuera de Europa: ${lon},${lat}`);
  }
});
