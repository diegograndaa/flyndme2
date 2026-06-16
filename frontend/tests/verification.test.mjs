// Tests de la lógica pura de la capa 2 de verificación (utils/verification.js):
// payload de POST /api/flights/verify, condición de disparo y merge de la
// respuesta sin pisar precios originales.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldVerify, buildVerifyPayload, mergeVerification,
} from "../src/utils/verification.js";

const SEARCH_RT = { departureDate: "2026-07-10", returnDate: "2026-07-14", tripType: "roundtrip" };
const SEARCH_OW = { departureDate: "2026-07-10", returnDate: "", tripType: "oneway" };

function makeDest(overrides = {}) {
  return {
    destination: "ROM",
    totalCostEUR: 420.5,
    averageCostPerTraveler: 140.17,
    priceSpread: 30.51,
    fairnessScore: 80,
    verificationStatus: "skipped",
    flights: [
      { origin: "MAD", price: 120.5, passengers: 2, totalForOrigin: 241, offer: { tp: {} } },
      { origin: "LON", price: 89.99, totalForOrigin: 89.99, offer: { tp: {} } },
    ],
    ...overrides,
  };
}

// ── buildVerifyPayload ───────────────────────────────────────────────────────

test("buildVerifyPayload: caso normal — fechas de la búsqueda y defaults", () => {
  const p = buildVerifyPayload(makeDest(), SEARCH_RT);
  assert.equal(p.destination, "ROM");
  assert.equal(p.totalCostEUR, 420.5);
  assert.equal(p.legs.length, 2);
  assert.deepEqual(p.legs[0], {
    origin: "MAD",
    price: 120.5,
    passengers: 2,
    departureDate: "2026-07-10",
    returnDate: "2026-07-14",
    nonStop: false,
    dateFallback: false,
  });
  // passengers ausente → 1; nonStop ausente → false
  assert.equal(p.legs[1].passengers, 1);
  assert.equal(p.legs[1].nonStop, false);
});

test("buildVerifyPayload: date-fallback manda la fecha REAL del vuelo", () => {
  const dest = makeDest({
    flights: [
      {
        origin: "MAD", price: 100, passengers: 1, dateFallback: true,
        offer: { tp: { departureDate: "2026-07-11", returnDate: "2026-07-15", nonStop: true } },
      },
      // Sin offer.tp pero con flightDate/flightReturnDate → también fecha real
      {
        origin: "LON", price: 80, dateFallback: true,
        flightDate: "2026-07-09", flightReturnDate: "2026-07-13",
      },
    ],
  });
  const p = buildVerifyPayload(dest, SEARCH_RT);
  assert.equal(p.legs[0].departureDate, "2026-07-11"); // tp gana a la búsqueda
  assert.equal(p.legs[0].returnDate, "2026-07-15");
  assert.equal(p.legs[0].nonStop, true);
  assert.equal(p.legs[0].dateFallback, true);
  assert.equal(p.legs[1].departureDate, "2026-07-09"); // flightDate gana a la búsqueda
  assert.equal(p.legs[1].returnDate, "2026-07-13");
  assert.equal(p.legs[1].dateFallback, true);
});

test("buildVerifyPayload: aeropuertos reales de tp se incluyen en el leg", () => {
  const dest = makeDest({
    flights: [
      {
        origin: "MAD", price: 100, passengers: 1,
        offer: { tp: { originAirport: "MAD", destinationAirport: "FCO" } },
      },
      {
        origin: "LON", price: 80,
        offer: { tp: { originAirport: "LGW", destinationAirport: "CIA" } },
      },
    ],
  });
  const p = buildVerifyPayload(dest, SEARCH_RT);
  assert.equal(p.legs[0].originAirport, "MAD");
  assert.equal(p.legs[0].destinationAirport, "FCO");
  assert.equal(p.legs[1].originAirport, "LGW");
  assert.equal(p.legs[1].destinationAirport, "CIA");
});

test("buildVerifyPayload: sin aeropuertos en tp las claves NO aparecen", () => {
  // Offers antiguos: tp vacío, tp solo con uno de los dos campos, o sin offer
  const dest = makeDest({
    flights: [
      { origin: "MAD", price: 100, offer: { tp: {} } },
      { origin: "LON", price: 80, offer: { tp: { originAirport: "LGW" } } },
      { origin: "BCN", price: 60 },
    ],
  });
  const p = buildVerifyPayload(dest, SEARCH_RT);
  assert.equal("originAirport" in p.legs[0], false);
  assert.equal("destinationAirport" in p.legs[0], false);
  // Solo se incluye la clave presente; la ausente se omite
  assert.equal(p.legs[1].originAirport, "LGW");
  assert.equal("destinationAirport" in p.legs[1], false);
  assert.equal("originAirport" in p.legs[2], false);
  assert.equal("destinationAirport" in p.legs[2], false);
});

test("buildVerifyPayload: roundtrip usa returnDate de la búsqueda; oneway → null", () => {
  const rt = buildVerifyPayload(makeDest(), SEARCH_RT);
  assert.equal(rt.legs[0].returnDate, "2026-07-14");

  const ow = buildVerifyPayload(makeDest(), SEARCH_OW);
  assert.equal(ow.legs[0].returnDate, null);
  assert.equal(ow.legs[1].returnDate, null);

  // oneway con returnDate residual en el estado de búsqueda → sigue siendo null
  const owDirty = buildVerifyPayload(makeDest(), { ...SEARCH_OW, returnDate: "2026-07-14" });
  assert.equal(owDirty.legs[0].returnDate, null);
});

// ── shouldVerify ─────────────────────────────────────────────────────────────

test("shouldVerify: solo con status skipped y flights presentes", () => {
  assert.equal(shouldVerify(makeDest()), true);
  assert.equal(shouldVerify(null), false);
  assert.equal(shouldVerify(makeDest({ verificationStatus: "verified" })), false);
  assert.equal(shouldVerify(makeDest({ verificationStatus: undefined })), false);
  assert.equal(shouldVerify(makeDest({ flights: [] })), false);
  assert.equal(shouldVerify(makeDest({ flights: undefined })), false);
});

test("shouldVerify: con partial exige offers completos en todos los legs", () => {
  const complete = makeDest();
  assert.equal(shouldVerify(complete, { partial: true }), true);
  const incomplete = makeDest({
    flights: [{ origin: "MAD", price: 100, offer: { tp: {} } }, { origin: "LON", price: 80 }],
  });
  assert.equal(shouldVerify(incomplete, { partial: true }), false);
  assert.equal(shouldVerify(incomplete, { partial: false }), true);
});

// ── mergeVerification ────────────────────────────────────────────────────────

test("mergeVerification: status 'changed' PROMOCIONA el precio verificado a mostrado", () => {
  const dest = makeDest();
  const merged = mergeVerification(dest, {
    verificationStatus: "changed",
    verificationSource: "serpapi",
    verifiedAt: "2026-06-11T10:00:00Z",
    priceChangePct: 7.5,
    verifiedTotalCostEUR: 452.0,
    verifiedAveragePerTraveler: 150.67,
    verifiedPriceSpread: 60,
    verifiedFairnessScore: 72,
    flights: [
      { origin: "MAD", verifiedPrice: 130, totalForOrigin: 260 },
      { origin: "LON", verifiedPrice: 96, verifiedTotalForOrigin: 96 },
    ],
  });

  assert.equal(merged.verificationStatus, "changed");
  assert.equal(merged.priceChangePct, 7.5);
  // verified* se conservan
  assert.equal(merged.verifiedTotalCostEUR, 452.0);
  assert.equal(merged.verifiedAveragePerTraveler, 150.67);
  // PROMOCIÓN: el precio mostrado pasa a ser el verificado (precio real)
  assert.equal(merged.totalCostEUR, 452.0);
  assert.equal(merged.averageCostPerTraveler, 150.67);
  assert.equal(merged.priceSpread, 60);
  assert.equal(merged.fairnessScore, 72);
  // El orientativo previo queda guardado en cached* (para el "antes")
  assert.equal(merged.cachedTotalCostEUR, 420.5);
  assert.equal(merged.cachedAveragePerTraveler, 140.17);
  assert.equal(merged.cachedPriceSpread, 30.51);
  assert.equal(merged.cachedFairnessScore, 80);
  // Per-origin: price promocionado, orientativo guardado en cachedPrice
  assert.equal(merged.flights[0].price, 130);
  assert.equal(merged.flights[0].cachedPrice, 120.5);
  assert.equal(merged.flights[0].totalForOrigin, 260);
  assert.equal(merged.flights[0].cachedTotalForOrigin, 241);
  assert.equal(merged.flights[1].price, 96);
  assert.equal(merged.flights[1].cachedPrice, 89.99);
  assert.equal(merged.flights[1].verifiedPrice, 96);
  // El orden no cambia y el ORIGINAL no se muta
  assert.equal(merged.flights[0].origin, "MAD");
  assert.equal(dest.totalCostEUR, 420.5);
  assert.equal(dest.averageCostPerTraveler, 140.17);
  assert.equal(dest.flights[0].price, 120.5);
  assert.equal(dest.flights[0].cachedPrice, undefined);
});

test("mergeVerification: status 'partial' NO promociona (mezcla ≠ verificado)", () => {
  const dest = makeDest();
  const merged = mergeVerification(dest, {
    verificationStatus: "partial",
    priceChangePct: 4,
    verifiedTotalCostEUR: 430,
    verifiedAveragePerTraveler: 143.3,
    flights: [
      { origin: "MAD", verifiedPrice: 130, totalForOrigin: 260 },
      { origin: "LON", verifiedPrice: null }, // este leg no se pudo verificar
    ],
  });
  // verified* se registran, pero el precio MOSTRADO no se toca
  assert.equal(merged.verifiedTotalCostEUR, 430);
  assert.equal(merged.totalCostEUR, 420.5);
  assert.equal(merged.averageCostPerTraveler, 140.17);
  assert.equal(merged.flights[0].price, 120.5);
  assert.equal(merged.flights[1].price, 89.99);
  // verifiedPrice por leg sí se guarda; cached* NO se crea (no hubo promoción)
  assert.equal(merged.flights[0].verifiedPrice, 130);
  assert.equal("cachedPrice" in merged.flights[0], false);
  assert.equal("cachedTotalCostEUR" in merged, false);
});

test("mergeVerification: status 'verified' (precio igual) también promociona", () => {
  const merged = mergeVerification(makeDest(), {
    verificationStatus: "verified",
    verifiedTotalCostEUR: 421,
    verifiedAveragePerTraveler: 140.33,
    flights: [{ origin: "MAD", verifiedPrice: 120.7 }, { origin: "LON", verifiedPrice: 90 }],
  });
  assert.equal(merged.totalCostEUR, 421);
  assert.equal(merged.cachedTotalCostEUR, 420.5);
  assert.equal(merged.flights[0].price, 120.7);
});

test("mergeVerification: respuesta sin legs ni agregados o destino nulo no rompe", () => {
  const dest = makeDest();
  const merged = mergeVerification(dest, { verificationStatus: "verified", verifiedAt: "x" });
  assert.equal(merged.verificationStatus, "verified");
  // Sin agregados verificados no hay nada que promocionar → precio intacto
  assert.equal(merged.totalCostEUR, 420.5);
  assert.deepEqual(merged.flights, dest.flights);
  assert.equal(mergeVerification(null, { verificationStatus: "verified" }), null);
  assert.equal(mergeVerification(dest, null), dest);
});
