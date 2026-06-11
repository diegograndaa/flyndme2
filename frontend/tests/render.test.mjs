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

test("render: WinnerCard extraída renderiza con fixture verificado", async () => {
  const { default: WinnerCard } = await import("../src/components/WinnerCard.jsx");
  const noop = () => {};
  const html = renderWithI18n(React.createElement(WinnerCard, {
    dest: FIXTURE_DEST,
    origins: ["MAD", "LON"],
    cleanOrigins: ["MAD", "LON"],
    departureDate: "2026-09-15",
    returnDate: "",
    tripType: "oneway",
    currency: "EUR",
    optimizeBy: "total",
    uiCriterion: "total",
    searchDuration: 3.2,
    lastBestPrice: 0,
    searchBadges: [],
    shareStatus: "",
    onViewAlternatives: noop, onShare: noop, onShareWhatsApp: noop,
    onShareTelegram: noop, onShareEmail: noop, onShareNative: noop,
    onCopySearchLink: noop, onChangeSearch: noop,
    onToggleFav: noop, isFav: () => false,
  }));
  assert.ok(html.length > 2000, `HTML corto: ${html.length}`);
  assert.ok(html.includes("Rome") || html.includes("ROM"));
});

test("render: Landing extraída renderiza con CTAs", async () => {
  const { default: Landing } = await import("../src/components/Landing.jsx");
  const html = renderWithI18n(React.createElement(Landing, {
    onStart: () => {}, onStartWithRoute: () => {},
  }));
  assert.ok(html.length > 2000, `HTML corto: ${html.length}`);
});

test("render: ChromeBits y ResultsPanels extraídos", async () => {
  const { ThemeToggle, ScrollToTopBtn, LangSelector, Toast, LoadingTips, SearchSkeleton } = await import("../src/components/ChromeBits.jsx");
  const { CostSplitCard, PlanYourTripCTA, SearchHistoryPanel, DestImageBanner, ResultsShareLink, TopDestinationsPodium } = await import("../src/components/ResultsPanels.jsx");
  const t = (k) => k;
  const noop = () => {};
  // Shell
  assert.ok(renderWithI18n(React.createElement(ThemeToggle, { resolved: "light", toggle: noop })).length > 10);
  assert.equal(renderWithI18n(React.createElement(ScrollToTopBtn)), ""); // oculto sin scroll
  assert.ok(renderWithI18n(React.createElement(LangSelector)).length > 10);
  assert.ok(renderWithI18n(React.createElement(Toast, { message: "hola", onDone: noop })).includes("hola"));
  assert.ok(renderWithI18n(React.createElement(LoadingTips)).length > 10);
  assert.ok(renderWithI18n(React.createElement(SearchSkeleton, { origins: ["MAD"] })).length > 100);
  // Paneles de resultados
  assert.ok(renderWithI18n(React.createElement(CostSplitCard, { bestDest: FIXTURE_DEST, origins: ["MAD", "LON"], currency: "EUR", t })).length > 100);
  assert.ok(renderWithI18n(React.createElement(PlanYourTripCTA, { destCode: "ROM", departureDate: "2026-09-15", returnDate: "", t })).length > 50);
  assert.ok(renderWithI18n(React.createElement(SearchHistoryPanel, { searches: [{ origins: ["MAD"], departureDate: "2026-09-15", tripType: "oneway", ts: Date.now() }], onLoad: noop, onClear: noop, t })).length > 50);
  assert.ok(renderWithI18n(React.createElement(DestImageBanner, { destCode: "ROM" })).length > 50);
  assert.ok(renderWithI18n(React.createElement(ResultsShareLink, { origins: ["MAD"], departureDate: "2026-09-15", returnDate: "", tripType: "oneway", t })).length > 50);
  // El podio necesita al menos 3 destinos
  const podium = [FIXTURE_DEST, { ...FIXTURE_DEST, destination: "LIS" }, { ...FIXTURE_DEST, destination: "PAR" }];
  assert.ok(renderWithI18n(React.createElement(TopDestinationsPodium, { flights: podium, currency: "EUR", onSelect: noop })).length > 50);
});

test("render: ThemeToggle expone aria-pressed según el tema resuelto", async () => {
  const { ThemeToggle } = await import("../src/components/ChromeBits.jsx");
  const noop = () => {};
  const light = renderWithI18n(React.createElement(ThemeToggle, { resolved: "light", toggle: noop }));
  const dark = renderWithI18n(React.createElement(ThemeToggle, { resolved: "dark", toggle: noop }));
  assert.ok(light.includes('aria-pressed="false"'), "claro: aria-pressed=false");
  assert.ok(dark.includes('aria-pressed="true"'), "oscuro: aria-pressed=true");
});

test("hooks: useFavorites evalúa isFav con favoritos guardados (regresión import roto)", async () => {
  // Con favoritos en localStorage, isFav ejecuta normalizeCode durante el
  // render; sin el import en useAppHooks.js lanzaba ReferenceError (solo se
  // manifestaba en runtime al tocar favoritos, no en el render sin favoritos).
  localStorage.setItem("flyndme_favorites", JSON.stringify([{ code: "MAD", city: "Madrid", price: 100, ts: Date.now() }]));
  try {
    const { useFavorites } = await import("../src/hooks/useAppHooks.js");
    function Probe() {
      const { isFav } = useFavorites();
      return React.createElement("span", null, isFav("mad") ? "fav" : "no-fav");
    }
    const html = renderToString(React.createElement(Probe));
    assert.ok(html.includes("fav"), `isFav debería ser true: ${html}`);
  } finally {
    localStorage.removeItem("flyndme_favorites");
  }
});
