// Tests de la lógica pura extraída de App.jsx (utils/resultsLogic.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertPrice, approxDistKm, pickBest, sortByCriterion, buildResultsCsv, AIRPORT_COORDS,
} from "../src/utils/resultsLogic.js";

test("convertPrice: convierte con tasas estáticas y símbolo correcto", () => {
  assert.equal(convertPrice(100, "EUR"), "€100");
  assert.equal(convertPrice(100, "GBP"), "£86");
  assert.equal(convertPrice(100, "USD"), "$109");
  assert.equal(convertPrice(100, "XXX"), "€100"); // moneda desconocida → EUR
});

test("approxDistKm: distancias plausibles y null si falta aeropuerto", () => {
  const madBcn = approxDistKm("MAD", "BCN");
  assert.ok(madBcn > 400 && madBcn < 600, `MAD-BCN ≈ 500km, fue ${madBcn}`);
  const madIst = approxDistKm("MAD", "IST");
  assert.ok(madIst > 2500 && madIst < 3200, `MAD-IST ≈ 2700km, fue ${madIst}`);
  assert.equal(approxDistKm("MAD", "ZZZ"), null);
  assert.equal(approxDistKm("MAD", "MAD"), 0);
});

test("AIRPORT_COORDS: lat/lon en rangos válidos", () => {
  for (const [code, [lat, lon]] of Object.entries(AIRPORT_COORDS)) {
    assert.ok(lat > 25 && lat < 65, `lat fuera de rango en ${code}`);
    assert.ok(lon > -20 && lon < 40, `lon fuera de rango en ${code}`);
  }
});

const RESULTS = [
  { destination: "ROM", totalCostEUR: 300, fairnessScore: 80, averageCostPerTraveler: 150, flights: [{ origin: "MAD", price: 100 }, { origin: "LON", price: 200 }] },
  { destination: "LIS", totalCostEUR: 250, fairnessScore: 60, averageCostPerTraveler: 125, flights: [{ origin: "MAD", price: 50 }, { origin: "LON", price: 200 }] },
  { destination: "PAR", totalCostEUR: 400, fairnessScore: 80, averageCostPerTraveler: 200, flights: [{ origin: "MAD", price: 190 }, { origin: "LON", price: 210 }] },
];

test("pickBest: por total elige el más barato", () => {
  assert.equal(pickBest(RESULTS, "total").destination, "LIS");
});

test("pickBest: por fairness elige mayor score, empate → más barato", () => {
  // ROM y PAR empatan a 80; ROM es más barato
  assert.equal(pickBest(RESULTS, "fairness").destination, "ROM");
});

test("pickBest: null con lista vacía o ausente", () => {
  assert.equal(pickBest([], "total"), null);
  assert.equal(pickBest(null, "total"), null);
});

test("sortByCriterion: por total ordena coste ascendente", () => {
  const codes = sortByCriterion(RESULTS, "total").map((d) => d.destination);
  assert.deepEqual(codes, ["LIS", "ROM", "PAR"]);
});

test("sortByCriterion: por fairness ordena score desc, empate → más barato", () => {
  // ROM y PAR empatan a 80; ROM (300) va antes que PAR (400)
  const codes = sortByCriterion(RESULTS, "fairness").map((d) => d.destination);
  assert.deepEqual(codes, ["ROM", "PAR", "LIS"]);
});

test("sortByCriterion: coherente con pickBest (el primero es el ganador)", () => {
  for (const mode of ["total", "fairness"]) {
    assert.equal(sortByCriterion(RESULTS, mode)[0].destination, pickBest(RESULTS, mode).destination);
  }
});

test("sortByCriterion: no muta la lista original y tolera vacío/ausente", () => {
  const copy = [...RESULTS];
  sortByCriterion(RESULTS, "total");
  assert.deepEqual(RESULTS, copy);
  assert.deepEqual(sortByCriterion([], "total"), []);
  assert.deepEqual(sortByCriterion(null, "fairness"), []);
});

test("buildResultsCsv: cabecera, filas y precios por origen", () => {
  const csv = buildResultsCsv(RESULTS, ["MAD", "LON"]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 4); // cabecera + 3 destinos
  assert.ok(lines[0].includes('"MAD price"'));
  assert.ok(lines[1].includes('"ROM"'));
  assert.ok(lines[1].includes('"Rome"'));
  assert.ok(lines[1].includes('"100.00"'));
  assert.ok(lines[1].includes('"200.00"'));
});

test("buildResultsCsv: escapa comillas dobles (RFC 4180)", () => {
  const csv = buildResultsCsv(
    [{ destination: 'X"Y', totalCostEUR: 1, fairnessScore: 1, averageCostPerTraveler: 1, flights: [] }],
    []
  );
  const firstCell = csv.split("\n")[1].split(",")[0];
  assert.equal(firstCell, '"X""Y"'); // comilla interna duplicada según RFC 4180
});

test("buildResultsCsv: tolera flights/datos ausentes", () => {
  const csv = buildResultsCsv([{ destination: "ROM" }], ["MAD"]);
  assert.ok(csv.split("\n").length === 2);
  assert.ok(csv.includes('"ROM"'));
});
