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

test("render: DeparturesBoard lista los destinos y marca el de la tarjeta", async () => {
  const { DeparturesBoard } = await import("../src/components/BoardPanels.jsx");
  const html = renderWithI18n(React.createElement(DeparturesBoard, {
    flights: [FIXTURE_DEST, { ...FIXTURE_DEST, destination: "LIS", totalCostEUR: 280, averageCostPerTraveler: 140 }],
    current: FIXTURE_DEST,
    criterion: "total",
    currency: "EUR",
    origins: ["MAD", "LON"],
    onSelect: () => {},
  }));
  assert.ok(html.includes("LIS") || html.includes("Lisbon"));
  assert.ok(html.includes("dep-row--current"), "el destino de la tarjeta va marcado");
  // Miniatura de foto en cada alternativa + una barra por viajero con SU color
  assert.equal((html.match(/class="dep-thumb"/g) || []).length, 2);
  assert.equal((html.match(/class="pay-row trav-c1"/g) || []).length, 2, "MAD lleva el color 1 en las dos filas");
  assert.equal((html.match(/class="pay-row trav-c2"/g) || []).length, 2, "LON lleva el color 2 en las dos filas");
  // La equidad ya no se comunica en negativo (ni "Unequal" ni "Desigual")
  assert.ok(!/Unequal|Desigual/i.test(html), "sin etiquetas de equidad en negativo");
});

test("render: el comparador marca «Mejor» según el criterio, no según la tarjeta", async () => {
  const { default: CompareChart } = await import("../src/components/CompareChart.jsx");
  const cheap = { ...FIXTURE_DEST, destination: "LIS", totalCostEUR: 280, averageCostPerTraveler: 140, fairnessScore: 50 };
  const picked = { ...FIXTURE_DEST, destination: "ROM", totalCostEUR: 300, averageCostPerTraveler: 150, fairnessScore: 82.5 };
  // El usuario ha puesto ROM en su tarjeta; el más barato sigue siendo LIS
  const html = renderWithI18n(React.createElement(CompareChart, {
    flights: [picked, cheap], bestDestination: picked, criterion: "total", origins: ["MAD", "LON"],
  }));
  const rows = html.split('<li class="cmp-row').slice(1);
  assert.equal(rows.length, 2);
  const lis = rows.find((r) => r.includes(">LIS<"));
  const rom = rows.find((r) => r.includes(">ROM<"));
  assert.ok(lis.includes("cmp-best") && !lis.includes("cmp-selected"), "★ Mejor en el más barato");
  assert.ok(rom.includes("cmp-selected") && !rom.includes("cmp-best"), "el elegido lleva «En tu tarjeta», no ★");
  // Con criterio de equidad, el mejor es el más parejo
  const fair = renderWithI18n(React.createElement(CompareChart, {
    flights: [picked, cheap], bestDestination: cheap, criterion: "fairness", origins: ["MAD", "LON"],
  }));
  const romFair = fair.split('<li class="cmp-row').slice(1).find((r) => r.includes(">ROM<"));
  assert.ok(romFair.includes("cmp-best"));
});

test("render: el mapa de la portada dibuja las ciudades del formulario", async () => {
  const { default: HeroMap } = await import("../src/components/HeroMap.jsx");
  // Sin ciudades: ejemplo etiquetado como tal
  const example = renderWithI18n(React.createElement(HeroMap, { origins: [] }));
  assert.ok(example.includes("hm--example"));
  for (const c of ["MAD", "LON", "BER"]) assert.ok(example.includes(`>${c}</text>`), `ejemplo con ${c}`);
  // Con Lisboa y Palma: esas dos, y NO el ejemplo
  const live = renderWithI18n(React.createElement(HeroMap, { origins: ["LIS", "PMI", "", "LISB"] }));
  assert.ok(live.includes("hm--live"));
  assert.ok(live.includes(">LIS</text>") && live.includes(">PMI</text>"));
  assert.ok(!live.includes(">MAD</text>") && !live.includes(">BER</text>"), "sin las ciudades de ejemplo");
  assert.equal((live.match(/class="hm-hit"/g) || []).length, 2, "una diana por ciudad real");
  // Honestidad: el punto de encuentro es un candidato (¿…?), nunca uno de los orígenes, y sin precios
  assert.ok(/>¿[A-Z]{3}\?<\/text>/.test(live));
  assert.ok(!live.includes(">¿LIS?<") && !/[€£$]\d/.test(live));
});

test("render: DeparturesBoard con un solo destino no pinta nada", async () => {
  const { DeparturesBoard } = await import("../src/components/BoardPanels.jsx");
  const html = renderWithI18n(React.createElement(DeparturesBoard, { flights: [FIXTURE_DEST], current: FIXTURE_DEST }));
  assert.equal(html, "");
});

test("render: VerificationBadge en todos los estados", async () => {
  const { default: VerificationBadge } = await import("../src/components/VerificationBadge.jsx");
  for (const status of ["verified", "changed", "partial", "failed", "timeout"]) {
    const html = renderWithI18n(React.createElement(VerificationBadge, {
      dest: { verificationStatus: status, priceChangePct: 7, verifiedAt: new Date().toISOString() },
    }));
    assert.ok(html.length > 10, `badge vacío para ${status}`);
  }
  // El detalle (precio anterior) va como texto, en la divisa elegida
  const changed = renderWithI18n(React.createElement(VerificationBadge, {
    dest: { verificationStatus: "changed", priceChangePct: -10, cachedAveragePerTraveler: 100 },
    currency: "USD",
  }));
  assert.match(changed, /class="sr-only"/);
  assert.match(changed, /\$\d+/);
  assert.doesNotMatch(changed, /aria-label=/);
  // Sin estado → no renderiza nada
  const empty = renderWithI18n(React.createElement(VerificationBadge, { dest: {} }));
  assert.equal(empty, "");
});

test("render: UiBits (skeleton, error, shortcuts)", async () => {
  const { ResultsSkeleton, FriendlyError, KeyboardShortcutsOverlay } = await import("../src/components/UiBits.jsx");
  assert.ok(renderWithI18n(React.createElement(ResultsSkeleton)).includes("fm-skel"));
  assert.ok(renderWithI18n(React.createElement(FriendlyError, { message: "boom", onRetry: () => {} })).includes("boom"));
  const t = (k) => k;
  assert.ok(renderWithI18n(React.createElement(KeyboardShortcutsOverlay, { show: true, onClose: () => {}, t })).includes("kbd"));
});

test("render: CompareChart y DestinationMap con fixtures", async () => {
  const { default: CompareChart } = await import("../src/components/CompareChart.jsx");
  const { default: DestinationMap } = await import("../src/components/DestinationMap.jsx");
  const flights = [FIXTURE_DEST, { ...FIXTURE_DEST, destination: "LIS", totalCostEUR: 280, fairnessScore: 60 }];
  assert.ok(renderWithI18n(React.createElement(CompareChart, { flights, bestDestination: FIXTURE_DEST })).includes("cmp-row"));
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
    recentSearches: [{ origins: ["MAD", "LON"], departureDate: "2026-11-15", tripType: "oneway", flexDays: 2, maxBudget: 150 }],
    onLoadRecent: noop, onClearRecent: noop,
    favs: [], onToggleFav: noop, isFav: () => false,
  }));
  assert.ok(html.length > 2000, `HTML corto: ${html.length}`);
  assert.ok(html.includes("MAD"));
  assert.ok(html.includes("±2d"), "la reciente enseña el margen de fechas");
  assert.ok(html.includes("150"), "la reciente enseña el tope");
  assert.ok(html.includes("sf-summary-dest"), "el resumen enseña que hay destinos elegidos");
  assert.ok(html.includes("Destinations to compare"), "el nombre accesible dice que son destinos");
  assert.match(html, /sf-summary-dest[\s\S]*ROM/);
  assert.ok(html.includes("×2"), "la fila de Madrid enseña sus 2 viajeros");
  const ordered = renderWithI18n(React.createElement(SearchPage, {
    origins: ["MAD", "LON"], setOrigins: noop,
    tripType: "roundtrip", setTripType: noop,
    departureDate: "2026-11-20", setDepartureDate: noop,
    returnDate: "2026-11-15", setReturnDate: noop,
    optimizeBy: "total", setOptimizeBy: noop,
    budgetEnabled: false, setBudgetEnabled: noop,
    maxBudget: 200, setMaxBudget: noop,
    flexEnabled: false, setFlexEnabled: noop,
    flexDays: 3, setFlexDays: noop,
    selectedDests: [], setSelectedDests: noop,
    passengers: [1, 1], setPassengers: noop,
    directOnly: false, setDirectOnly: noop,
    cabinClass: "ECONOMY", setCabinClass: noop,
    currency: "EUR", setCurrency: noop,
    loading: false, error: "", onSubmit: noop,
    recentSearches: [], onLoadRecent: noop, onClearRecent: noop,
    favs: [], onToggleFav: noop, isFav: () => false,
  }));
  assert.ok(ordered.includes("sf-date-warn--error"), "avisa si la vuelta no es posterior");
  assert.ok(ordered.includes("later return") || ordered.includes("vuelta posterior"));
  const many = renderWithI18n(React.createElement(SearchPage, {
    origins: ["MAD"], setOrigins: noop,
    tripType: "oneway", setTripType: noop,
    departureDate: "2026-11-15", setDepartureDate: noop,
    returnDate: "", setReturnDate: noop,
    optimizeBy: "total", setOptimizeBy: noop,
    budgetEnabled: false, setBudgetEnabled: noop,
    maxBudget: 200, setMaxBudget: noop,
    flexEnabled: false, setFlexEnabled: noop,
    flexDays: 3, setFlexDays: noop,
    selectedDests: ["ROM", "LIS", "PAR", "VIE"], setSelectedDests: noop,
    passengers: [1], setPassengers: noop,
    directOnly: false, setDirectOnly: noop,
    cabinClass: "ECONOMY", setCabinClass: noop,
    currency: "EUR", setCurrency: noop,
    loading: false, error: "", onSubmit: noop,
    recentSearches: [], onLoadRecent: noop, onClearRecent: noop,
    favs: [], onToggleFav: noop, isFav: () => false,
  }));
  assert.ok(many.includes("4 destinations selected"));
  assert.ok(!many.includes("sf-summary-dest\">ROM"), "con más de tres no se listan los códigos");
  const all = renderWithI18n(React.createElement(SearchPage, {
    origins: ["MAD"], setOrigins: noop,
    tripType: "oneway", setTripType: noop,
    departureDate: "2026-11-15", setDepartureDate: noop,
    returnDate: "", setReturnDate: noop,
    optimizeBy: "total", setOptimizeBy: noop,
    budgetEnabled: false, setBudgetEnabled: noop,
    maxBudget: 200, setMaxBudget: noop,
    flexEnabled: false, setFlexEnabled: noop,
    flexDays: 3, setFlexDays: noop,
    selectedDests: [], setSelectedDests: noop,
    passengers: [1], setPassengers: noop,
    directOnly: false, setDirectOnly: noop,
    cabinClass: "ECONOMY", setCabinClass: noop,
    currency: "EUR", setCurrency: noop,
    loading: false, error: "", onSubmit: noop,
    recentSearches: [], onLoadRecent: noop, onClearRecent: noop,
    favs: [], onToggleFav: noop, isFav: () => false,
  }));
  assert.ok(!all.includes("sf-summary-dest"), "sin filtro no hay chip de destinos");
  const dup = renderWithI18n(React.createElement(SearchPage, {
    origins: ["MAD", "MAD"], setOrigins: noop,
    tripType: "oneway", setTripType: noop,
    departureDate: "2026-11-15", setDepartureDate: noop,
    returnDate: "", setReturnDate: noop,
    optimizeBy: "total", setOptimizeBy: noop,
    budgetEnabled: false, setBudgetEnabled: noop,
    maxBudget: 200, setMaxBudget: noop,
    flexEnabled: false, setFlexEnabled: noop,
    flexDays: 3, setFlexDays: noop,
    selectedDests: [], setSelectedDests: noop,
    passengers: [1, 3], setPassengers: noop,
    directOnly: false, setDirectOnly: noop,
    cabinClass: "ECONOMY", setCabinClass: noop,
    currency: "EUR", setCurrency: noop,
    loading: false, error: "", onSubmit: noop,
    recentSearches: [], onLoadRecent: noop, onClearRecent: noop,
    favs: [], onToggleFav: noop, isFav: () => false,
  }));
  assert.ok(dup.includes("×3"), "la segunda ciudad igual enseña sus propios viajeros");
  assert.equal((dup.match(/class="sf-summary-pax"/g) || []).length, 1, "la primera fila, con 1 viajero, no lleva ×");
});

test("render: con 16 viajeros no se puede sumar otro; por encima se avisa", async () => {
  const { default: SearchPage } = await import("../src/components/SearchPage.jsx");
  const noop = () => {};
  const base = {
    tripType: "oneway", setTripType: noop,
    departureDate: "2026-11-15", setDepartureDate: noop,
    returnDate: "", setReturnDate: noop,
    optimizeBy: "total", setOptimizeBy: noop,
    budgetEnabled: false, setBudgetEnabled: noop,
    maxBudget: 200, setMaxBudget: noop,
    flexEnabled: false, setFlexEnabled: noop,
    flexDays: 3, setFlexDays: noop,
    selectedDests: [], setSelectedDests: noop,
    directOnly: false, setDirectOnly: noop,
    cabinClass: "ECONOMY", setCabinClass: noop,
    currency: "EUR", setCurrency: noop,
    loading: false, error: "", onSubmit: noop,
    recentSearches: [], onLoadRecent: noop, onClearRecent: noop,
    favs: [], onToggleFav: noop, isFav: () => false,
  };
  const full = renderWithI18n(React.createElement(SearchPage, {
    ...base,
    origins: ["MAD", "LON", "BER", "PAR", "LIS", "ROM", "BCN", "VIE"], setOrigins: noop,
    passengers: [2, 2, 2, 2, 2, 2, 2, 2], setPassengers: noop,
  }));
  const increases = full.match(/One traveler more from this city/g) || [];
  assert.equal(increases.length, 8);
  assert.equal((full.match(/aria-label="One traveler more from this city" disabled/g) || []).length, 8);
  assert.ok(!full.includes("most we can search"), "16 viajeros caben: no es un error");
  const over = renderWithI18n(React.createElement(SearchPage, {
    ...base,
    origins: ["MAD", "LON"], setOrigins: noop,
    passengers: [9, 8], setPassengers: noop,
  }));
  assert.ok(over.includes("most we can search"), "por encima de 16 se avisa antes de buscar");
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

test("render: instrumentos de cabina (odómetro, ILS, conmutadores)", async () => {
  const { Odometer } = await import("../src/components/Odometer.jsx");
  const { WhoPaysStrip } = await import("../src/components/WinnerCard.jsx");
  const { default: WinnerCard } = await import("../src/components/WinnerCard.jsx");
  // Odómetro: el texto accesible es SIEMPRE el valor real (las cintas arrancan
  // en 0 en el primer frame de cliente y suben hasta él)
  const odo = renderWithI18n(React.createElement(Odometer, { value: "€104" }));
  assert.ok(odo.includes('class="odo-sr">€104<'), "texto accesible con el valor real");
  assert.equal((odo.match(/class="odo-d"/g) || []).length, 3, "una cinta por dígito");
  assert.ok(odo.includes('aria-hidden="true">€<'), "el símbolo no es una cinta");
  // ILS: un diamante por origen, eje en la media, sin torre hasta tocar
  const ils = renderWithI18n(React.createElement(WhoPaysStrip, { dest: FIXTURE_DEST, currency: "EUR" }));
  assert.equal((ils.match(/wc-ils-diamond/g) || []).length, 2);
  assert.ok(ils.includes("translateX(-42.00%)") && ils.includes("translateX(42.00%)"), "MAD por debajo y LON por encima de la media");
  assert.ok(!ils.includes('class="wc-twr'), "la torre solo aparece al tocar una fila");
  // Conmutadores: criterio con micro-LED y ruta pulsable (cerrada) con estrobo
  const noop = () => {};
  const card = renderWithI18n(React.createElement(WinnerCard, {
    dest: FIXTURE_DEST, origins: ["MAD", "LON"], departureDate: "2026-09-15", tripType: "oneway",
    currency: "EUR", uiCriterion: "total", onChangeCriterion: noop, flightsCount: 2,
  }));
  assert.equal((card.match(/class="fm-led"/g) || []).length, 2);
  assert.ok(card.includes('aria-expanded="false"') && card.includes("wc-strobe"));
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
  const { CostSplitCard, PlanYourTripCTA } = await import("../src/components/ResultsPanels.jsx");
  const { ZoneHead, Notice } = await import("../src/components/BoardPanels.jsx");
  const { OfflineStrip, UpdateBanner, InstallBanner } = await import("../src/components/PwaBits.jsx");
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
  // El enlace de hoteles lleva el número real de viajeros (Booking abre con 2 si no)
  const plan = renderWithI18n(React.createElement(PlanYourTripCTA, { destCode: "ROM", departureDate: "2026-09-15", returnDate: "2026-09-18", travelers: 5, t }));
  assert.match(plan, /group_adults=5/);
  assert.doesNotMatch(renderWithI18n(React.createElement(PlanYourTripCTA, { destCode: "ROM", departureDate: "2026-09-15", t })), /group_adults/);
  // Zonas de resultados y avisos en línea
  assert.ok(renderWithI18n(React.createElement(ZoneHead, { id: "z", num: "01", title: "Decisión final", variant: "decision" })).includes("fm-zone-head--decision"));
  const notice = renderWithI18n(React.createElement(Notice, { variant: "next", tag: "Siguiente paso", text: "Plan", actionLabel: "Crear", onAction: noop }));
  assert.ok(notice.includes("fm-notice--next") && notice.includes("Crear"));
  // Avisos de la PWA
  assert.ok(renderWithI18n(React.createElement(OfflineStrip)).includes("fm-offline"));
  assert.ok(renderWithI18n(React.createElement(UpdateBanner, { onUpdate: noop, onDismiss: noop })).includes("fm-pwa-card--update"));
  const ios = renderWithI18n(React.createElement(InstallBanner, { mode: "ios", onInstall: noop, onDismiss: noop }));
  assert.ok(ios.includes("fm-pwa-card--install") && !ios.includes("fm-pwa-card-cta"), "en iOS no hay botón de instalar");
});

test("render: ThemeToggle expone aria-pressed según el tema resuelto", async () => {
  const { ThemeToggle } = await import("../src/components/ChromeBits.jsx");
  const noop = () => {};
  const light = renderWithI18n(React.createElement(ThemeToggle, { resolved: "light", toggle: noop }));
  const dark = renderWithI18n(React.createElement(ThemeToggle, { resolved: "dark", toggle: noop }));
  assert.ok(light.includes('aria-pressed="false"'), "claro: aria-pressed=false");
  assert.ok(dark.includes('aria-pressed="true"'), "oscuro: aria-pressed=true");
});

test("render: la suma de la tarjeta no enseña una cuenta que no cuadra al redondear", async () => {
  const { default: WinnerCard } = await import("../src/components/WinnerCard.jsx");
  const noop = () => {};
  const base = {
    origins: ["MAD", "LON"], cleanOrigins: ["MAD", "LON"],
    departureDate: "2026-09-15", tripType: "oneway", uiCriterion: "total",
    onChangeCriterion: noop,
  };
  const cents = {
    ...FIXTURE_DEST,
    totalCostEUR: 21.2,
    flights: [
      { origin: "MAD", price: 10.6, passengers: 1, totalForOrigin: 10.6 },
      { origin: "LON", price: 10.6, passengers: 1, totalForOrigin: 10.6 },
    ],
  };
  const hidden = renderWithI18n(React.createElement(WinnerCard, { ...base, dest: cents, currency: "EUR" }));
  assert.ok(!hidden.includes("wc-total-sum"), "€11 + €11 = €21 no se pinta");
  const shown = renderWithI18n(React.createElement(WinnerCard, { ...base, dest: FIXTURE_DEST, currency: "EUR" }));
  assert.ok(shown.includes("wc-total-sum"), "130 + 170 = 300 sí se pinta");
  const gbp = renderWithI18n(React.createElement(WinnerCard, {
    ...base,
    currency: "GBP",
    dest: {
      ...FIXTURE_DEST,
      totalCostEUR: 20,
      flights: [
        { origin: "MAD", price: 10, passengers: 1, totalForOrigin: 10 },
        { origin: "LON", price: 10, passengers: 1, totalForOrigin: 10 },
      ],
    },
  }));
  assert.ok(!gbp.includes("wc-total-sum"), "£9 + £9 = £17 no se pinta");
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

test("toastDuration: 2,5 s los avisos cortos, más los largos, tope 8 s", async () => {
  const { toastDuration } = await import("../src/components/ChromeBits.jsx");
  assert.equal(toastDuration("¡Copiado!"), 2500);
  assert.ok(toastDuration("x".repeat(100)) > 5000);
  assert.equal(toastDuration("x".repeat(400)), 8000);
  assert.equal(toastDuration(undefined), 2500);
});
