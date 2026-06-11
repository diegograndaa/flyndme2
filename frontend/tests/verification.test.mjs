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
    verificationStatus: "skipped",
    flights: [
      { origin: "MAD", price: 120.5, passengers: 2, offer: { tp: {} } },
      { origin: "LON", price: 89.99, offer: { tp: {} } },
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

test("mergeVerification: añade campos verified* sin tocar los precios originales", () => {
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
  assert.equal(merged.verificationSource, "serpapi");
  assert.equal(merged.priceChangePct, 7.5);
  assert.equal(merged.verifiedTotalCostEUR, 452.0);
  assert.equal(merged.verifiedAveragePerTraveler, 150.67);
  assert.equal(merged.verifiedPriceSpread, 60);
  assert.equal(merged.verifiedFairnessScore, 72);
  // Precios originales intactos (regla: NUNCA cambiar el precio mostrado)
  assert.equal(merged.totalCostEUR, 420.5);
  assert.equal(merged.flights[0].price, 120.5);
  assert.equal(merged.flights[1].price, 89.99);
  // Per-origin: verifiedPrice y total verificado SIEMPRE bajo verified*
  assert.equal(merged.flights[0].verifiedPrice, 130);
  assert.equal(merged.flights[0].verifiedTotalForOrigin, 260);
  assert.equal(merged.flights[1].verifiedPrice, 96);
  assert.equal(merged.flights[1].verifiedTotalForOrigin, 96);
  // El orden de los legs no cambia y el original no se muta
  assert.equal(merged.flights[0].origin, "MAD");
  assert.equal(dest.verificationStatus, "skipped");
  assert.equal(dest.flights[0].verifiedPrice, undefined);
});

test("mergeVerification: respuesta sin legs o destino nulo no rompe", () => {
  const dest = makeDest();
  const merged = mergeVerification(dest, { verificationStatus: "verified", verifiedAt: "x" });
  assert.equal(merged.verificationStatus, "verified");
  assert.deepEqual(merged.flights, dest.flights);
  assert.equal(mergeVerification(null, { verificationStatus: "verified" }), null);
  assert.equal(mergeVerification(dest, null), dest);
});
