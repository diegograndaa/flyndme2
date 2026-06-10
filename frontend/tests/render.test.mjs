// Smoke tests de render con react-dom/server: detectan ReferenceError/TypeError
// en el cuerpo de los componentes (lo que el parser no puede ver). Los efectos
// no corren en SSR — esto valida el render inicial, no la interactividad.
import "./_domStubs.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { renderToString } = await import("react-dom/server");
const React = (await import("react")).default;
const { I18nProvider } = await import("../src/i18n/useI18n.jsx");

function renderWithI18n(element) {
  return renderToString(React.createElement(I18nProvider, null, element));
}

test("render: App completa (vista landing) renderiza sin lanzar", async () => {
  const { default: App } = await import("../src/App.jsx");
  const html = renderWithI18n(React.createElement(App));
  assert.ok(html.includes("FlyndMe"), "el HTML debe contener la marca");
  assert.ok(html.length > 5000, `HTML sospechosamente corto: ${html.length}`);
});

const FIXTURE_DEST = {
  destination: "ROM",
  bestDate: "2026-09-15",
  bestReturnDate: null,
  totalCostEUR: 300,
  averageCostPerTraveler: 150,
  fairnessScore: 82.5,
  priceSpread: 40,
  totalPassengers: 2,
  verificationStatus: "verified",
  verifiedAt: new Date().toISOString(),
  priceChangePct: 0,
  flights: [
    { origin: "MAD", price: 130, passengers: 1, totalForOrigin: 130, offer: { itineraries: [{ duration: "PT2H30M", segments: [{ departure: { iataCode: "MAD", at: "2026-09-15T08:30:00" }, arrival: { iataCode: "FCO", at: "2026-09-15T11:00:00" }, carrierCode: "IB", duration: "PT2H30M", numberOfStops: 0 }] }] } },
    { origin: "LON", price: 170, passengers: 1, totalForOrigin: 170, offer: { itineraries: [{ duration: "PT2H50M", segments: [{ departure: { iataCode: "LHR", at: "2026-09-15T09:00:00" }, arrival: { iataCode: "FCO", at: "2026-09-15T11:50:00" }, carrierCode: "BA", duration: "PT2H50M", numberOfStops: 0 }] }] } },
  ],
};

test("render: FlightResults con datos de fixture", async () => {
  const { default: FlightResults } = await import("../src/components/FlightResults.jsx");
  const html = renderWithI18n(React.createElement(FlightResults, {
    flights: [FIXTURE_DEST, { ...FIXTURE_DEST, destination: "LIS", totalCostEUR: 280 }],
    bestDestination: FIXTURE_DEST,
    origins: ["MAD", "LON"],
    departureDate: "2026-09-15",
    tripType: "oneway",
  }));
  assert.ok(html.includes("LIS") || html.includes("Lisbon"));
});

test("render: FlightResults vacío muestra estado vacío", async () => {
  const { default: FlightResults } = await import("../src/components/FlightResults.jsx");
  const html = renderWithI18n(React.createElement(FlightResults, { flights: [], origins: [] }));
  assert.ok(html.length > 50);
});

test("render: VerificationBadge en todos los estados", async () => {
  const { default: VerificationBadge } = await import("../src/components/VerificationBadge.jsx");
  for (const status of ["verified", "changed", "partial", "failed", "timeout"]) {
    const html = renderWithI18n(React.createElement(VerificationBadge, {
      dest: { verificationStatus: status, priceChangePct: 7, verifiedAt: new Date().toISOString() },
    }));
    assert.ok(html.length > 10, `badge vacío para ${status}`);
  }
  // Sin estado → no renderiza nada
  const empty = renderWithI18n(React.createElement(VerificationBadge, { dest: {} }));
  assert.equal(empty, "");
});

test("render: UiBits (skeleton, breadcrumb, error, shortcuts)", async () => {
  const { ResultsSkeleton, Breadcrumb, FriendlyError, KeyboardShortcutsOverlay } = await import("../src/components/UiBits.jsx");
  assert.ok(renderWithI18n(React.createElement(ResultsSkeleton)).includes("fm-skel"));
  assert.ok(renderWithI18n(React.createElement(Breadcrumb, { current: "search", onNavigate: () => {} })).includes("fm-breadcrumb"));
  assert.ok(renderWithI18n(React.createElement(FriendlyError, { message: "boom", onRetry: () => {} })).includes("boom"));
  const t = (k) => k;
  assert.ok(renderWithI18n(React.createElement(KeyboardShortcutsOverlay, { show: true, onClose: () => {}, t })).includes("kbd"));
});

test("render: CompareChart y DestinationMap con fixtures", async () => {
  const { default: CompareChart } = await import("../src/components/CompareChart.jsx");
  const { default: DestinationMap } = await import("../src/components/DestinationMap.jsx");
  const flights = [FIXTURE_DEST, { ...FIXTURE_DEST, destination: "LIS", totalCostEUR: 280, fairnessScore: 60 }];
  assert.ok(renderWithI18n(React.createElement(CompareChart, { flights, bestDestination: FIXTURE_DEST })).includes("svg"));
  assert.ok(renderWithI18n(React.createElement(DestinationMap, { flights, bestDestination: FIXTURE_DEST, origins: ["MAD", "LON"] })).includes("svg"));
});

test("render: SearchPage extraída renderiza con props completas", async () => {
  const { default: SearchPage } = await import("../src/components/SearchPage.jsx");
  const noop = () => {};
  const html = renderWithI18n(React.createElement(SearchPage, {
    origins: ["MAD", ""], setOrigins: noop,
    tripType: "roundtrip", setTripType: noop,
    departureDate: "2026-09-15", setDepartureDate: noop,
    returnDate: "2026-09-20", setReturnDate: noop,
    optimizeBy: "total", setOptimizeBy: noop,
    budgetEnabled: true, setBudgetEnabled: noop,
    maxBudget: 200, setMaxBudget: noop,
    flexEnabled: true, setFlexEnabled: noop,
    flexDays: 3, setFlexDays: noop,
    selectedDests: ["ROM"], setSelectedDests: noop,
    passengers: [2, 1], setPassengers: noop,
    directOnly: false, setDirectOnly: noop,
    cabinClass: "ECONOMY", setCabinClass: noop,
    currency: "EUR", setCurrency: noop,
    loading: false, error: "", onSubmit: noop,
    recentSearches: [], onLoadRecent: noop, onClearRecent: noop,
    favs: [], onToggleFav: noop, isFav: () => false,
  }));
  assert.ok(html.length > 2000, `HTML corto: ${html.length}`);
  assert.ok(html.includes("MAD"));
});
