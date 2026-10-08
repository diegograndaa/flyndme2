// Matriz de render (SSR): la tarjeta del ganador, el panel de salidas, el
// comparador y el reparto con las combinaciones que pueden darse en la app.
// Una combinación que lance desmonta la vista entera, así que aquí solo se
// exige que rendericen sin lanzar y con el texto clave presente.
import "./_domStubs.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { renderToString } = await import("react-dom/server");
const React = (await import("react")).default;
const { I18nProvider } = await import("../src/i18n/useI18n.jsx");
const render = (el) => renderToString(React.createElement(I18nProvider, null, el));

const leg = (origin, price, pax = 1, extra = {}) => ({
  origin, price, passengers: pax, totalForOrigin: price * pax,
  offer: { itineraries: [{ duration: "PT2H", segments: [{ departure: { iataCode: origin, at: "2026-12-06T08:00:00" }, arrival: { iataCode: "FCO", at: "2026-12-06T10:00:00" }, carrierCode: "IB", duration: "PT2H", numberOfStops: 0 }] }] },
  ...extra,
});
function dest({ origins, status, roundtrip, fallback, missing }) {
  const flights = origins.map((o, i) => leg(o, 80 + i * 30, i === 0 ? 2 : 1,
    fallback && i === 0 ? { dateFallback: true, flightDate: "2026-12-05", flightReturnDate: roundtrip ? "2026-12-09" : null } : {}));
  const total = flights.reduce((s, f) => s + f.totalForOrigin, 0);
  const pax = flights.reduce((s, f) => s + f.passengers, 0);
  const d = {
    destination: "ROM", bestDate: "2026-12-06", bestReturnDate: roundtrip ? "2026-12-10" : null,
    totalCostEUR: total, averageCostPerTraveler: total / pax, totalPassengers: pax,
    fairnessScore: origins.length > 1 ? 70 : 100, priceSpread: origins.length > 1 ? 60 : 0,
    verificationStatus: status, flights, ...(fallback ? { hasDateFallback: true } : {}),
  };
  if (status === "changed") Object.assign(d, { priceChangePct: 6, cachedTotalCostEUR: total - 20, verifiedAt: new Date().toISOString() });
  if (missing) { delete d.fairnessScore; delete d.priceSpread; delete d.averageCostPerTraveler; }
  return d;
}

const ORIGIN_SETS = [["MAD"], ["MAD", "LON", "BER"], ["MAD", "LON", "BER", "PAR", "AMS", "MIL", "LIS", "DUB"]];
const STATUSES = ["skipped", "verified", "changed", "partial", "failed", "timeout"];
const noop = () => {};

test("matriz WinnerCard: orígenes × estado × ida/vuelta × divisa × fecha vecina × datos ausentes", async () => {
  const { default: WinnerCard } = await import("../src/components/WinnerCard.jsx");
  let n = 0;
  for (const origins of ORIGIN_SETS) for (const status of STATUSES) for (const roundtrip of [false, true])
    for (const currency of ["EUR", "GBP", "USD"]) for (const fallback of [false, true]) for (const missing of [false, true]) {
      const d = dest({ origins, status, roundtrip, fallback, missing });
      const label = `${origins.length} orígenes, ${status}, ${roundtrip ? "i/v" : "ida"}, ${currency}, fallback=${fallback}, faltan=${missing}`;
      let html;
      assert.doesNotThrow(() => {
        html = render(React.createElement(WinnerCard, {
          dest: d, origins, tripType: roundtrip ? "roundtrip" : "oneway", departureDate: "2026-12-06", returnDate: roundtrip ? "2026-12-10" : "",
          currency, uiCriterion: "total", onChangeCriterion: noop, flightsCount: 3, onVerify: noop, verifyPhase: status === "skipped" ? null : undefined,
          onToggleWatch: noop, watched: n % 2 === 0, onToggleFav: noop,
          dateHint: n % 3 === 0 ? { text: "x", actionLabel: "y", onAction: noop } : null,
        }));
      }, label);
      const sym = { EUR: "€", GBP: "£", USD: "$" }[currency];
      assert.ok(html.includes(sym), `${label}: falta el símbolo ${sym}`);
      assert.ok(!/NaN|undefined|\[object Object\]/.test(html.replace(/<[^>]+>/g, " ")), `${label}: texto con NaN/undefined`);
      n++;
    }
  assert.equal(n, ORIGIN_SETS.length * STATUSES.length * 2 * 3 * 2 * 2);
});

test("matriz paneles: salidas, comparador y reparto con 1, 3 y 8 orígenes", async () => {
  const { DeparturesBoard } = await import("../src/components/BoardPanels.jsx");
  const { default: CompareChart } = await import("../src/components/CompareChart.jsx");
  const { CostSplitCard } = await import("../src/components/ResultsPanels.jsx");
  const { WhoPaysStrip } = await import("../src/components/WinnerCard.jsx");
  for (const origins of ORIGIN_SETS) for (const currency of ["EUR", "GBP"]) for (const missing of [false, true]) {
    const flights = ["ROM", "PAR", "LIS"].map((code, i) => ({ ...dest({ origins, status: "skipped", missing }), destination: code, totalCostEUR: 300 + i * 40 }));
    const label = `${origins.length} orígenes, ${currency}, faltan=${missing}`;
    const t = (k) => k;
    for (const [name, el] of [
      ["DeparturesBoard", React.createElement(DeparturesBoard, { flights, current: flights[0], origins, criterion: "fairness", singleOrigin: origins.length === 1, currency, savings: 80, onSelect: noop })],
      ["CompareChart", React.createElement(CompareChart, { flights, bestDestination: flights[0], singleOrigin: origins.length === 1, criterion: "total", origins, currency })],
      ["CostSplitCard", React.createElement(CostSplitCard, { bestDest: flights[0], origins, currency, t })],
      ["WhoPaysStrip", React.createElement(WhoPaysStrip, { dest: flights[0], currency, origins })],
    ]) {
      let html;
      assert.doesNotThrow(() => { html = render(el); }, `${name}: ${label}`);
      assert.ok(!/NaN|\bundefined\b|\[object Object\]/.test(html.replace(/<[^>]+>/g, " ")), `${name}: ${label}: texto con NaN/undefined`);
    }
  }
});
