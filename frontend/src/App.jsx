import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import "./styles/bootstrap-custom.scss";
import "./App.css";
import "./styles/theme-stitch.css";
import FlightResults from "./components/FlightResults";
import { SearchProgress } from "./components/SearchUX";

// Lazy-load heavy visual components (map SVG + chart) for smaller initial bundle
const DestinationMap = React.lazy(() => import("./components/DestinationMap"));
const CompareChart  = React.lazy(() => import("./components/CompareChart"));
import { useI18n } from "./i18n/useI18n";
import {
  getBaseUrl, normalizeCode, cityOf, destLabel,
  formatEur, formatDate, weekdayOf, todayISO, copyText,
  countryFlag, scrollBehavior
} from "./utils/helpers";
import { convertPrice, pickBest, buildResultsCsv, FX_SYMBOLS } from "./utils/resultsLogic";
import { parseSearchLinkParams } from "./utils/urlParams";
import { track } from "./utils/analytics";
import { shouldVerify, buildVerifyPayload, mergeVerification } from "./utils/verification";
import { ResultsSkeleton, ScrollProgressBar, KeyboardShortcutsOverlay, Breadcrumb, AnimatedStat } from "./components/UiBits";
import SearchPage from "./components/SearchPage";
import WinnerCard from "./components/WinnerCard";
import Landing from "./components/Landing";
import { ThemeToggle, ScrollToTopBtn, LangSelector, Toast, SearchSkeleton } from "./components/ChromeBits";
import { CostSplitCard, PlanYourTripCTA, ResultsShareLink, TopDestinationsPodium } from "./components/ResultsPanels";
import { useTheme, useFavorites, useA11yPrefs, useBackendStatus } from "./hooks/useAppHooks";
import { useFocusTrap } from "./hooks/useFocusTrap";
import { getCityImage } from "./utils/cityImages";
import { Heart, X, Clock, Plane, Download, Wallet, Map as MapIcon, BarChart3, List } from "lucide-react";

// ─── API ──────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "")
  || "https://flyndme-backend.onrender.com";

const API_URL = `${API_BASE}/api/flights/multi-origin`;

// ─── Fairness label (i18n-dependent) ────────────────────────────────────────

// ─── Theme (dark mode) ──────────────────────────────────────────────────────

// ─── Scroll to top button ──────────────────────────────────────────────────

// ─── Language selector ───────────────────────────────────────────────────────

// ─── Toast notification ──────────────────────────────────────────────────────

// ─── Favorites (localStorage) ───────────────────────────────────────────────

// ─── CSV export ─────────────────────────────────────────────────────────────

function exportResultsCSV(flights, origins, currency) {
  const csv = buildResultsCsv(flights, origins);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flyndme-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Friendly error display ─────────────────────────────────────────────────


// ─── Loading tips carousel ──────────────────────────────────────────────────

// ─── Search skeleton (loading state) ────────────────────────────────────────

// ─── Animated price counter ─────────────────────────────────────────────────

// ─── Results skeleton ────────────────────────────────────────────────────────


// ─── Top 3 destinations podium ─────────────────────────────────────────────────

// ─── Airline logo helper ──────────────────────────────────────────────────────

// ─── Cost split calculator ────────────────────────────────────────────────────

// ─── Plan Your Trip CTA ──────────────────────────────────────────────────────

// ─── Search History Panel ─────────────────────────────────────────────────

// ─── Reduced Motion + High Contrast accessibility hook ────────────────────

// ─── Destination Image Banner ─────────────────────────────────────────────

// ─── Results Share Link (Round 29) ────────────────────────────────────────

// ─── Scroll Progress Bar ──────────────────────────────────────────────────


// ─── Backend connection status ─────────────────────────────────────────────────

// ─── Error boundary ───────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e?.message || "Error" }; }
  componentDidCatch(e, i) { console.error("[UI]", e, i); }
  render() {
    if (this.state.err) return (
      <div className="alert alert-danger">
        <strong>{this.props.renderingLabel || "Rendering error."}</strong> {this.state.err}
        <button className="btn btn-sm btn-outline-danger ms-3" onClick={() => this.setState({ err: null })}>
          {this.props.retryLabel || "Retry"}
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Date validation warnings (real-time) ───────────────────────────────────

// ─── FAQ accordion item ─────────────────────────────────────────────────────

// ─── Landing ──────────────────────────────────────────────────────────────────

// ─── Animated mini-demo for landing ──────────────────────────────────────────

// ─── Breadcrumb ──────────────────────────────────────────────────────────────

// ─── Keyboard shortcuts overlay ──────────────────────────────────────────────



// ─── Approximate distances for price-per-km ─────────────────────────────────


// ─── Search form ──────────────────────────────────────────────────────────────

// ─── Winner card ──────────────────────────────────────────────────────────────

// ─── Search params summary (results page) ────────────────────────────────────

const SearchParamsSummary = React.memo(function SearchParamsSummary({
  origins, departureDate, returnDate, tripType, flexEnabled, flexDays,
  cabinClass, directOnly, budgetEnabled, maxBudget, currency,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const tags = [
    tripType === "roundtrip" ? t("search.roundtrip") : t("search.oneway"),
    departureDate && formatDate(departureDate),
    tripType === "roundtrip" && returnDate && `→ ${formatDate(returnDate)}`,
    flexEnabled && `±${flexDays}d`,
    cabinClass !== "ECONOMY" && (cabinClass === "BUSINESS" ? t("search.cabinBusiness") : t("search.cabinPremium")),
    directOnly && t("search.directOnly"),
    budgetEnabled && t("search.budgetHintOn", { amount: formatEur(maxBudget) }),
  ].filter(Boolean);

  return (
    <div className="fm-search-summary">
      <button type="button" className="fm-search-summary-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <div className="fm-search-summary-origins">
          {origins.map(o => (
            <span key={o} className="fm-search-summary-chip">{countryFlag(o)} {o}</span>
          ))}
        </div>
        <span className={`fm-search-summary-chevron${open ? " fm-search-summary-chevron--open" : ""}`} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="fm-search-summary-tags">
          {tags.map((tag, i) => (
            <span key={i} className="fm-search-summary-tag">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Destination category tags ───────────────────────────────────────────────

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { t } = useI18n();
  const { resolved: themeResolved, toggle: toggleTheme } = useTheme();
  const { favs, toggle: toggleFav, isFav } = useFavorites();
  const backendStatus = useBackendStatus(API_BASE);
  const { reducedMotion, highContrast } = useA11yPrefs();

  // Set a11y attributes on root
  useEffect(() => {
    document.documentElement.setAttribute("data-reduced-motion", reducedMotion ? "true" : "false");
    document.documentElement.setAttribute("data-high-contrast", highContrast ? "true" : "false");
  }, [reducedMotion, highContrast]);

  // View: 'landing' | 'search' | 'results'
  const [view, setViewRaw] = useState("landing");

  // Ref con la vista actual: la usan setView (prev sin updater) y el manejador
  // de teclado (closure registrado una sola vez).
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  // ── Browser history support (back/forward buttons) ──────────────────────
  const skipHistoryPush = useRef(false);

  // Nota: el pushState vive FUERA del updater de React. Un updater debe ser
  // puro; con StrictMode (dev) se ejecuta dos veces y duplicaba entradas de
  // historial (el botón atrás necesitaba dos pulsaciones por vista).
  // Landing y búsqueda fusionadas: "search" = home con scroll al formulario
  useEffect(() => {
    if (view === "search") {
      const id = setTimeout(() => {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        document.querySelector(".sf-form")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }, 80);
      return () => clearTimeout(id);
    }
  }, [view]);

  const setView = useCallback((newView) => {
    if (viewRef.current !== newView && !skipHistoryPush.current) {
      window.history.pushState({ view: newView }, "", `#${newView}`);
    }
    skipHistoryPush.current = false;
    setViewRaw(newView);
  }, []);

  useEffect(() => {
    // Set initial state
    window.history.replaceState({ view: "landing" }, "", window.location.pathname + window.location.search);

    const onPopState = (e) => {
      const target = e.state?.view || "landing";
      skipHistoryPush.current = true;
      setView(target);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabContentRef = useRef(null);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  // Los paneles se leen vía refs: el listener se registra una sola vez y un
  // closure sobre el estado quedaría congelado en su valor inicial (bug: Escape
  // nunca cerraba los paneles porque "veía" showShortcuts/showFavPanel = false).
  const showShortcutsRef = useRef(false);
  const showFavPanelRef  = useRef(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore if user is typing in an input
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Escape: close panels first, then go back
      if (e.key === "Escape") {
        if (showShortcutsRef.current) { setShowShortcuts(false); return; }
        if (showFavPanelRef.current) { setShowFavPanel(false); return; }
        const cur = viewRef.current;
        if (cur === "results") setView("search");
        else if (cur === "search") setView("landing");
      }
      // ? = show shortcuts
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        setShowShortcuts(v => !v); return;
      }
      // H = go home
      if (e.key.toLowerCase() === "h") { setView("landing"); return; }
      // S = go to search
      if (e.key.toLowerCase() === "s") { setView("search"); return; }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search params
  const [origins,       setOrigins]       = useState([""]);
  const [tripType,      setTripType]      = useState("oneway");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate,    setReturnDate]    = useState("");
  const [optimizeBy,    setOptimizeBy]    = useState("total");
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [maxBudget,     setMaxBudget]     = useState(200);
  const [flexEnabled,   setFlexEnabled]   = useState(false);
  const [flexDays,      setFlexDays]      = useState(3);
  const [selectedDests, setSelectedDests] = useState([]); // empty = all defaults
  const [passengers,    setPassengers]    = useState([1]); // passengers per origin
  const [directOnly,    setDirectOnly]    = useState(false);
  const [cabinClass,    setCabinClass]    = useState("ECONOMY");
  const [currency,      setCurrency]      = useState("EUR");

  // Results
  const [flights,         setFlights]         = useState([]);
  const [partialResults,  setPartialResults]  = useState(false);
  const [bestByCriterion, setBestByCriterion] = useState({ total: null, fairness: null });
  const [uiCriterion,     setUiCriterion]     = useState("total");
  const [showAlt,         setShowAlt]         = useState(false);

  // UI state
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [toast,       setToast]       = useState(null); // { message, type }
  const [showFavPanel, setShowFavPanel] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Mantener las refs del manejador de teclado al día (ver efecto de atajos)
  useEffect(() => { showShortcutsRef.current = showShortcuts; }, [showShortcuts]);
  useEffect(() => { showFavPanelRef.current = showFavPanel; }, [showFavPanel]);
  // Focus-trap del panel de favoritos (a11y): el foco entra al abrir, Tab
  // cicla dentro, Escape cierra y el foco vuelve al botón ❤️ del header.
  const favPanelTrapRef = useFocusTrap(showFavPanel, () => setShowFavPanel(false));

  // Last search best price (for comparison)
  const [lastBestPrice, setLastBestPrice] = useState(() => {
    try { return Number(localStorage.getItem("flyndme_last_best") || 0); } catch { return 0; }
  });

  // Search duration (seconds)
  const [searchDuration, setSearchDuration] = useState(0);
  const searchStartRef = useRef(0);

  // Capa 2 de verificación (POST /api/flights/verify): generación de búsqueda
  // para descartar respuestas tardías + AbortController de la petición en vuelo.
  const searchGenRef = useRef(0);
  const verifyAbortRef = useRef(null);

  // ── Recent searches (localStorage) ────────────────────────────────────────
  const RECENT_KEY = "flyndme_recent";
  const MAX_RECENT = 5;

  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
  });

  const saveRecentSearch = useCallback((params) => {
    setRecentSearches((prev) => {
      const entry = {
        origins: params.origins,
        tripType: params.tripType,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        ts: Date.now(),
      };
      // De-duplicate by origins+date combo
      const key = `${entry.origins.join(",")}_${entry.departureDate}_${entry.tripType}`;
      const filtered = prev.filter((r) => `${r.origins.join(",")}_${r.departureDate}_${r.tripType}` !== key);
      const updated = [entry, ...filtered].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch { /* quota */ }
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try { localStorage.removeItem(RECENT_KEY); } catch { /* */ }
  }, []);

  const loadRecentSearch = useCallback((entry) => {
    setOrigins(entry.origins);
    setTripType(entry.tripType);
    setDepartureDate(entry.departureDate);
    if (entry.returnDate) setReturnDate(entry.returnDate);
  }, []);

  // ── Auto-save search draft to localStorage ────────────────────────────
  const DRAFT_KEY = "flyndme_draft";

  // Restore draft on mount
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft && draft.origins?.length) {
        setOrigins(draft.origins);
        if (draft.tripType) setTripType(draft.tripType);
        if (draft.departureDate) setDepartureDate(draft.departureDate);
        if (draft.returnDate) setReturnDate(draft.returnDate);
        if (draft.passengers) setPassengers(draft.passengers);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save draft on change (debounced)
  useEffect(() => {
    const tid = setTimeout(() => {
      try {
        const hasInput = origins.some(o => o.trim());
        if (hasInput) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ origins, tripType, departureDate, returnDate, passengers }));
        }
      } catch { /* quota */ }
    }, 500);
    return () => clearTimeout(tid);
  }, [origins, tripType, departureDate, returnDate, passengers]);

  // Clear draft on successful search
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
  }, []);

  // ── PWA: Register service worker ────────────────────────────────────────
  useEffect(() => {
    // Solo en producción: en dev el SW cacheaba módulos de Vite y rompía la app
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // ── PWA: Install prompt ─────────────────────────────────────────────────
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") trackEvent("pwa_install");
    setInstallPrompt(null);
    setShowInstallBanner(false);
  };

  // Keep Render backend alive (free tier sleeps)
  useEffect(() => {
    const ping = () => fetch(`${API_BASE}/api/ping`, { cache: "no-store" }).catch(() => {});
    ping();
    const quick1 = setTimeout(ping, 3000);
    const quick2 = setTimeout(ping, 8000);
    const interval = setInterval(ping, 8 * 60 * 1000);
    return () => { clearTimeout(quick1); clearTimeout(quick2); clearInterval(interval); };
  }, []);

  // Load shared results from URL (?share=ID)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");
    if (!shareId) return;

    setLoading(true);
    fetch(`${API_BASE}/api/share/${shareId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Share not found");
        return res.json();
      })
      .then((data) => {
        const { results, searchParams } = data;
        if (results?.flights?.length) {
          setFlights(results.flights);
          setBestByCriterion(results.bestByCriterion || {
            total: pickBest(results.flights, "total"),
            fairness: pickBest(results.flights, "fairness"),
          });
        }
        if (searchParams) {
          if (searchParams.origins?.length) setOrigins(searchParams.origins);
          if (searchParams.departureDate) setDepartureDate(searchParams.departureDate);
          if (searchParams.returnDate) setReturnDate(searchParams.returnDate);
          if (searchParams.tripType) setTripType(searchParams.tripType);
          if (searchParams.optimizeBy) setOptimizeBy(searchParams.optimizeBy);
          if (searchParams.uiCriterion) setUiCriterion(searchParams.uiCriterion);
        }
        setView("results");
        document.title = "FlyndMe - Shared Results";
        // Clean URL without reload
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => {
        setToast({ message: t("share.expired"), type: "error" });
        window.history.replaceState({}, "", window.location.pathname);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load search params from URL (from copy-search-link) ────────────────
  useEffect(() => {
    // Validación centralizada en utils/urlParams.js: una URL manipulada ya no
    // puede inyectar estado inválido (cabina/fechas/divisa fuera de rango).
    const parsed = parseSearchLinkParams(window.location.search);
    if (!parsed) return; // sin orígenes válidos o es un share link
    setOrigins(parsed.origins);
    setPassengers(parsed.origins.map(() => 1));
    if (parsed.departureDate) setDepartureDate(parsed.departureDate);
    if (parsed.returnDate) setReturnDate(parsed.returnDate);
    if (parsed.tripType) setTripType(parsed.tripType);
    if (parsed.optimizeBy) setOptimizeBy(parsed.optimizeBy);
    if (parsed.directOnly) setDirectOnly(true);
    if (parsed.cabinClass) setCabinClass(parsed.cabinClass);
    if (parsed.currency) setCurrency(parsed.currency);
    setView("search");
    window.history.replaceState({}, "", window.location.pathname);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bestDestination = bestByCriterion[uiCriterion] || bestByCriterion.total || null;

  // ── Dynamic document title per view ────────────────────────────────────
  useEffect(() => {
    const titles = {
      landing: "FlyndMe — Find the cheapest place to meet your group",
      search: "FlyndMe — Search flights",
      results: bestDestination
        ? `FlyndMe — ${cityOf(normalizeCode(bestDestination.destination)) || bestDestination.destination} · ${formatEur(bestDestination.averageCostPerTraveler, 0)}/pp`
        : "FlyndMe — Results",
    };
    document.title = titles[view] || titles.landing;
  }, [view, bestDestination]);

  const cleanOrigins = useMemo(
    () => [...new Set(origins.map((o) => String(o || "").trim().toUpperCase()).filter(Boolean))],
    [origins]
  );

  // ── Compute best for each criterion ────────────────────────────────────────

  // ── Handle criterion toggle ─────────────────────────────────────────────────

  // No cierra el panel "Otras opciones": la lista sigue al criterio único y
  // se reordena en vivo (antes setShowAlt(false) lo plegaba al cambiar).
  const handleCriterion = (mode) => {
    setUiCriterion(mode);
  };

  // ── Share (generates a shareable link) ──────────────────────────────────────

  const handleShare = async () => {
    if (!bestDestination || !flights.length) return;
    setShareStatus("saving");

    try {
      // Save results to backend
      const res = await fetch(`${API_BASE}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: { flights, bestByCriterion },
          searchParams: {
            origins: cleanOrigins,
            departureDate,
            returnDate,
            tripType,
            optimizeBy,
            uiCriterion,
          },
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      const { id } = await res.json();
      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${id}`;

      // Copy the link
      const ok = await copyText(shareUrl);
      if (ok) {
        setShareStatus("ok");
        setToast({ message: t("share.linkCopied"), type: "success" });
        trackEvent("share_link", { destination: normalizeCode(bestDestination.destination) });
      } else {
        // Fallback: copy text summary
        const bd = bestDestination;
        const code = normalizeCode(bd.destination);
        const lines = [
          t("share.title", { dest: destLabel(code) }),
          t("share.totalAvg", { total: formatEur(bd.totalCostEUR, 2), avg: formatEur(bd.averageCostPerTraveler, 2) }),
          `🔗 ${shareUrl}`,
        ];
        await copyText(lines.join("\n"));
        setShareStatus("ok");
        setToast({ message: t("share.linkCopied"), type: "success" });
      }
    } catch {
      // Fallback to old text-only share
      const bd = bestDestination;
      const code = normalizeCode(bd.destination);
      const lines = [
        t("share.title", { dest: destLabel(code) }),
        t("share.totalAvg", { total: formatEur(bd.totalCostEUR, 2), avg: formatEur(bd.averageCostPerTraveler, 2) }),
        t("share.fairness", { score: (bd.fairnessScore ?? 0).toFixed(0) }),
        t("share.date", { date: `${bd.bestDate || departureDate}${tripType === "roundtrip" ? ` → ${bd.bestReturnDate || returnDate}` : ""}` }),
      ];
      if (Array.isArray(bd.flights) && bd.flights.length) {
        lines.push(t("share.perOrigin", { details: bd.flights.map((f) => `${f.origin}: ${formatEur(f.price, 0)}`).join(" · ") }));
      }
      const ok = await copyText(lines.join("\n"));
      setShareStatus(ok ? "ok" : "fail");
      setToast({ message: ok ? t("results.copied") : t("results.copyFailed"), type: ok ? "success" : "error" });
    }
    setTimeout(() => setShareStatus(""), 3000);
  };

  // ── WhatsApp share ─────────────────────────────────────────────────────────

  const handleShareWhatsApp = async () => {
    if (!bestDestination) return;
    const bd = bestDestination;
    const code = normalizeCode(bd.destination);
    const destName = destLabel(code);

    // Try to get a share link first
    let shareUrl = "";
    try {
      const res = await fetch(`${API_BASE}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: { flights, bestByCriterion },
          searchParams: { origins: cleanOrigins, departureDate, returnDate, tripType, optimizeBy, uiCriterion },
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        shareUrl = `${window.location.origin}${window.location.pathname}?share=${id}`;
      }
    } catch { /* fallback without link */ }

    const lines = [
      `✈ *FlyndMe* — ${destName}`,
      `${t("results.groupTotal")}: ${formatEur(bd.totalCostEUR, 0)} · ${formatEur(bd.averageCostPerTraveler, 0)}/${t("results.avgPerPerson").toLowerCase()}`,
    ];
    if (Array.isArray(bd.flights) && bd.flights.length) {
      lines.push(bd.flights.map((f) => `${f.origin}: ${formatEur(f.price, 0)}`).join(" · "));
    }
    // Use OG endpoint for rich social previews (WhatsApp, Telegram, Twitter)
    if (shareUrl) {
      const shareId = shareUrl.split("share=")[1];
      const ogUrl = `${API_BASE}/api/share/${shareId}/og`;
      lines.push(`\n🔗 ${ogUrl}`);
    }

    const waUrl = `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(waUrl, "_blank");
    trackEvent("share_whatsapp", { destination: code });
  };

  const handleShareTelegram = () => {
    if (!bestDestination) return;
    const code = normalizeCode(bestDestination.destination);
    const destName = destLabel(code);
    const text = `✈ FlyndMe — ${destName}\n${t("results.groupTotal")}: ${formatEur(bestDestination.totalCostEUR, 0)} · ${formatEur(bestDestination.averageCostPerTraveler, 0)}/${t("results.avgPerPerson").toLowerCase()}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
    trackEvent("share_telegram", { destination: code });
  };

  const handleShareEmail = () => {
    if (!bestDestination) return;
    const code = normalizeCode(bestDestination.destination);
    const destName = destLabel(code);
    const subject = `FlyndMe — ${t("results.eyebrow")}: ${destName}`;
    const body = [
      `✈ ${destName}`,
      `${t("results.groupTotal")}: ${formatEur(bestDestination.totalCostEUR, 0)}`,
      `${t("results.avgPerPerson")}: ${formatEur(bestDestination.averageCostPerTraveler, 0)}`,
      "",
      window.location.href,
    ].join("\n");
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    trackEvent("share_email", { destination: code });
  };

  // ── Copy search params as URL ─────────────────────────────────────────────

  const handleCopySearchLink = () => {
    const params = new URLSearchParams();
    cleanOrigins.forEach(o => params.append("o", o));
    if (departureDate) params.set("dep", departureDate);
    if (tripType === "roundtrip" && returnDate) params.set("ret", returnDate);
    params.set("trip", tripType);
    if (optimizeBy !== "total") params.set("opt", optimizeBy);
    if (directOnly) params.set("direct", "1");
    if (cabinClass !== "ECONOMY") params.set("cabin", cabinClass);
    if (currency !== "EUR") params.set("cur", currency);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    copyText(url);
    setToast({ message: t("share.searchLinkCopied"), type: "success" });
  };

  // ── Native Web Share API (mobile) ──────────────────────────────────────────

  const handleShareNative = async () => {
    if (!bestDestination || !navigator.share) return;
    const code = normalizeCode(bestDestination.destination);
    const destName = destLabel(code);
    try {
      await navigator.share({
        title: `FlyndMe — ${destName}`,
        text: `✈ ${destName}\n${t("results.groupTotal")}: ${formatEur(bestDestination.totalCostEUR, 0)}\n${t("results.avgPerPerson")}: ${formatEur(bestDestination.averageCostPerTraveler, 0)}`,
        url: window.location.href,
      });
      trackEvent("share_native", { destination: code });
    } catch { /* user cancelled */ }
  };

  // ── Analítica (Vercel Web Analytics, ver utils/analytics.js) ──────────────
  // trackEvent es un alias fino sobre track() para no tocar las ~7 llamadas ya
  // existentes (shares, pwa_install, search_complete).

  function trackEvent(event, data = {}) {
    track(event, data);
  }

  // ── Ensure backend is awake before searching ─────────────────────────────────

  async function ensureBackendAwake() {
    const PING_URL = `${API_BASE}/api/ping`;
    const MAX_WAKE = 15;           // up to 15 attempts = ~60 s
    const WAKE_DELAY = 4000;

    for (let i = 0; i < MAX_WAKE; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(PING_URL, { cache: "no-store", signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) return true;    // backend is alive
      } catch { /* network error or timeout — keep trying */ }
      await new Promise((r) => setTimeout(r, WAKE_DELAY));
    }
    return false;                    // gave up
  }

  // ── Verificación de precio del ganador (capa 2, en segundo plano) ──────────
  // Tras pintar resultados, re-tarifica el destino ganador contra
  // POST /api/flights/verify (SerpAPI, 5-20 s). Sin spinners ni UI nueva: el
  // único cambio visual es que VerificationBadge pasa de "orientativo" a ✓/↑/↓.
  // Fallo SIEMPRE silencioso: si la petición falla o responde "skipped", el
  // badge "precio orientativo" se queda como está.

  const applyVerification = (destCode, verification) => {
    const code = normalizeCode(destCode);
    const upd = (d) =>
      d && normalizeCode(d.destination) === code ? mergeVerification(d, verification) : d;
    // Mismo destino en la lista y en bestByCriterion: solo se añaden campos
    // verified*; ni se re-ordena ni cambian los precios mostrados.
    setFlights((prev) => prev.map(upd));
    setBestByCriterion((prev) => ({ ...prev, total: upd(prev.total), fairness: upd(prev.fairness) }));
  };

  const verifyWinnerPrice = (winner, gen, searchCtx) => {
    if (!shouldVerify(winner, { partial: searchCtx.partial })) return;
    const payload = buildVerifyPayload(winner, searchCtx);
    const controller = new AbortController();
    verifyAbortRef.current = controller;
    fetch(`${API_BASE}/api/flights/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || searchGenRef.current !== gen) return; // búsqueda nueva: descartar
        if (!data.verificationStatus || data.verificationStatus === "skipped") return;
        applyVerification(winner.destination, data);
      })
      .catch(() => { /* silencioso: el badge "orientativo" ya cubre este estado */ });
  };

  // ── Submit (with automatic retry for Render cold-starts) ────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!cleanOrigins.length) { setError(t("errors.noOrigin")); return; }
    if (!departureDate)        { setError(t("errors.noDeparture")); return; }
    if (tripType === "roundtrip") {
      if (!returnDate)               { setError(t("errors.noReturn")); return; }
      if (returnDate <= departureDate) { setError(t("errors.returnBeforeDep")); return; }
    }

    trackEvent("search", { origins: cleanOrigins.length, tripType, optimizeBy });

    setFlights([]);
    setBestByCriterion({ total: null, fairness: null });
    setShowAlt(false);
    setLoading(true);
    setSearchDuration(0);
    searchStartRef.current = Date.now();
    // Nueva búsqueda: invalida cualquier verificación en vuelo de la anterior
    searchGenRef.current += 1;
    verifyAbortRef.current?.abort();
    verifyAbortRef.current = null;
    clearDraft();

    try {
      // Step 1: wake backend if needed (ping is lightweight)
      const awake = await ensureBackendAwake();
      if (!awake) {
        setError(t("errors.serverWaking"));
        return;
      }

      // Step 2: actual search (backend is now warm)
      // Backend does all pax math (totals, fairness, share/OG) — see chore: backend hardening commit.
      const paxForReq = cleanOrigins.map((_, i) => Math.max(1, Math.min(9, Number(passengers[i]) || 1)));
      const body = {
        origins: cleanOrigins,
        passengers: paxForReq,
        departureDate,
        tripType,
        optimizeBy,
        dateMode: flexEnabled ? "flex" : "exact",
        flexDays: flexEnabled ? flexDays : 0,
        ...(tripType === "roundtrip" && { returnDate }),
        ...(budgetEnabled && { maxBudgetPerTraveler: maxBudget }),
        ...(selectedDests.length > 0 && { destinations: selectedDests }),
        ...(directOnly && { nonStop: true }),
        ...(cabinClass !== "ECONOMY" && { travelClass: cabinClass }),
      };

      const MAX_RETRIES = 3;
      const RETRY_DELAY = 3000;
      let lastErr = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45000);

          const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (res.status === 503 && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
            continue;
          }

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || data.error || `Error ${res.status}`);
          }

          const data = await res.json();
          const arr  = Array.isArray(data.flights) ? data.flights : [];

          if (!arr.length) {
            setError(budgetEnabled ? t("errors.noBudgetResults") : t("errors.noResults"));
            return;
          }

          // Backend now returns totals + per-flight passengers/totalForOrigin
          // already scaled by pax — no frontend post-processing needed.
          const adjusted = arr;

          setFlights(adjusted);
          setPartialResults(Boolean(data.partial));
          setBestByCriterion({ total: pickBest(adjusted, "total"), fairness: pickBest(adjusted, "fairness") });
          setUiCriterion(optimizeBy);
          // Preload top destination images for smoother results UX
          adjusted.slice(0, 6).forEach((d) => {
            const img = new Image();
            img.src = getCityImage(normalizeCode(d.destination), getBaseUrl(), { w: 1200, h: 500 });
          });

          setView("results");
          document.title = "FlyndMe - Flight Results";
          window.scrollTo({ top: 0, behavior: scrollBehavior() });
          // Record search duration
          if (searchStartRef.current) {
            setSearchDuration(((Date.now() - searchStartRef.current) / 1000).toFixed(1));
          }
          saveRecentSearch({ origins: cleanOrigins, tripType, departureDate, returnDate });
          // Save best price for next-search comparison
          const bestTotal = pickBest(adjusted, "total");
          if (bestTotal?.averageCostPerTraveler) {
            try { localStorage.setItem("flyndme_last_best", String(bestTotal.averageCostPerTraveler)); } catch {}
            setLastBestPrice(bestTotal.averageCostPerTraveler);
          }
          trackEvent("search_complete", {
            origins: cleanOrigins.length,
            results: arr.length,
            flexEnabled,
            tripType,
            winner: arr[0]?.destination,
          });
          // Capa 2: verificación asíncrona del ganador mostrado (una sola vez
          // por búsqueda; la generación descarta respuestas tardías).
          const winner = optimizeBy === "fairness" ? pickBest(adjusted, "fairness") : bestTotal;
          verifyWinnerPrice(winner, searchGenRef.current, {
            departureDate,
            returnDate,
            tripType,
            partial: Boolean(data.partial),
          });
          return;
        } catch (err) {
          lastErr = err;
          const isTransient = err instanceof TypeError || err.name === "AbortError";
          if (isTransient && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
            continue;
          }
          if (!isTransient) break;
        }
      }

      setError(lastErr?.message || t("errors.unexpected"));
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      {/* Skip to content (a11y) */}
      <a href="#main-content" className="skip-link">{t("a11y.skipToContent")}</a>

      {/* Header */}
      <header className="app-header">
        <div className="container d-flex align-items-center justify-content-between" style={{ maxWidth: 1080 }}>
          <div className="app-logo" onClick={() => { setView("landing"); setFlights([]); setBestByCriterion({ total: null, fairness: null }); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView("landing"); } }}>
            <img src={`${getBaseUrl()}logo-flyndme.svg`} alt="FlyndMe" height={28}
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <span className="app-logo-name">FlyndMe</span>
            <span className="app-logo-sub">{t("header.tagline")}</span>
            <span className={`fm-backend-dot fm-backend-dot--${backendStatus}`} title={backendStatus === "online" ? t("header.serverOnline") : backendStatus === "offline" ? t("header.serverWaking") : ""} />
          </div>
          <div className="d-flex align-items-center gap-2">
            {favs.length > 0 && (
              <button type="button" className="fm-fav-header-btn" onClick={() => setShowFavPanel((v) => !v)}
                title={t("favorites.title")} aria-label={`${t("favorites.title")} (${favs.length})`}
                aria-expanded={showFavPanel}>
                <Heart size={16} fill="currentColor" aria-hidden="true" /> <span className="fm-fav-header-count">{favs.length}</span>
              </button>
            )}
            <ThemeToggle resolved={themeResolved} toggle={toggleTheme} />
            <LangSelector />
            {view === "results" && (
              <button type="button" className="btn btn-sm btn-outline-secondary fm-header-newsearch"
                onClick={() => { setView("search"); setShowAlt(false); }}>
                {t("header.newSearch")}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Favorites panel */}
      {showFavPanel && (
        <>
          <div className="fm-fav-overlay" onClick={() => setShowFavPanel(false)} />
          <div className="fm-fav-panel" ref={favPanelTrapRef} role="dialog" aria-modal="true" aria-label={t("favorites.title")}>
            <div className="fm-fav-panel-header">
              <span className="fm-fav-panel-title">{t("favorites.title")}</span>
              <button type="button" className="fm-fav-panel-close" onClick={() => setShowFavPanel(false)} aria-label={t("a11y.close")}><X size={18} aria-hidden="true" /></button>
            </div>
            {favs.length === 0 ? (
              <div className="fm-fav-panel-empty">{t("favorites.empty")}</div>
            ) : (
              <div className="fm-fav-panel-list">
                {favs.map((f) => (
                  <div key={f.code} className="fm-fav-panel-item">
                    <span className="fm-fav-panel-flag">{countryFlag(f.code)}</span>
                    <div className="fm-fav-panel-info">
                      <span className="fm-fav-panel-code">{f.code}</span>
                      <span className="fm-fav-panel-city">{f.city}</span>
                    </div>
                    <span className="fm-fav-panel-price">{formatEur(f.price, 0)}/pp</span>
                    <button type="button" className="fm-fav-panel-remove" aria-label={t("favorites.remove", { city: f.city || f.code })}
                      onClick={() => toggleFav({ destination: f.code, averageCostPerTraveler: f.price })} aria-label={t("a11y.close")}><X size={14} aria-hidden="true" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Loading bar */}
      <SearchProgress loading={loading} />

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}

      {/* Keyboard shortcuts overlay */}
      <KeyboardShortcutsOverlay show={showShortcuts} onClose={() => setShowShortcuts(false)} t={t} />

      {/* Live region (a11y): anuncia la llegada de resultados y la verificación
          asíncrona del precio del ganador (el badge cambia sin recargar). */}
      <div className="sr-only" role="status" aria-live="polite">
        {view === "results" && bestDestination
          ? [
              t("a11y.resultsAnnounce", {
                n: flights.length,
                dest: cityOf(normalizeCode(bestDestination.destination)) || normalizeCode(bestDestination.destination),
                price: formatEur(bestDestination.averageCostPerTraveler, 0),
              }),
              (bestDestination.verificationStatus === "verified" || bestDestination.verificationStatus === "changed")
                ? t("a11y.priceVerified")
                : "",
            ].join(" ").trim()
          : ""}
      </div>

      {/* Views */}
      <div id="main-content" tabIndex={-1}>
      {(view === "landing" || view === "search") && (
        <div className="view-enter" key="home">
          <Landing searchForm={
            <SearchPage
              origins={origins}           setOrigins={setOrigins}
              tripType={tripType}         setTripType={setTripType}
              departureDate={departureDate} setDepartureDate={setDepartureDate}
              returnDate={returnDate}     setReturnDate={setReturnDate}
              optimizeBy={optimizeBy}     setOptimizeBy={setOptimizeBy}
              budgetEnabled={budgetEnabled} setBudgetEnabled={setBudgetEnabled}
              maxBudget={maxBudget}       setMaxBudget={setMaxBudget}
              flexEnabled={flexEnabled}   setFlexEnabled={setFlexEnabled}
              flexDays={flexDays}         setFlexDays={setFlexDays}
              selectedDests={selectedDests} setSelectedDests={setSelectedDests}
              passengers={passengers}     setPassengers={setPassengers}
              directOnly={directOnly}     setDirectOnly={setDirectOnly}
              cabinClass={cabinClass}     setCabinClass={setCabinClass}
              currency={currency}         setCurrency={setCurrency}
              loading={loading}           error={error}
              onSubmit={handleSubmit}
              recentSearches={recentSearches}
              onLoadRecent={loadRecentSearch}
              onClearRecent={clearRecentSearches}
            />
          } />
        </div>
      )}

      {/* Loading skeleton */}
      {loading && view === "search" && (
        <div className="view-enter" key="skeleton">
          <SearchSkeleton origins={cleanOrigins} />
        </div>
      )}

      {/* Results loading skeleton */}
      {loading && view === "results" && !bestDestination && (
        <div className="container py-4 view-enter" key="results-skeleton" style={{ maxWidth: 1080 }}>
          <ResultsSkeleton />
        </div>
      )}

      {view === "results" && bestDestination && (
        <main className="container py-4 view-enter" key="results" style={{ maxWidth: 1080 }}>
          {/* h1 solo para lectores de pantalla: la vista no tiene heading visible */}
          <h1 className="sr-only">
            {t("results.eyebrow")}: {cityOf(normalizeCode(bestDestination.destination)) || normalizeCode(bestDestination.destination)}
          </h1>
          <Breadcrumb current="results" onNavigate={(k) => { setView(k); if (k !== "results") setShowAlt(false); }} />

          {/* Aviso de resultados parciales (la búsqueda agotó su presupuesto de tiempo) */}
          {partialResults && (
            <div className="alert alert-warning py-2 mb-3" role="status">
              <Clock size={14} aria-hidden="true" /> {t("results.partialNotice")}
            </div>
          )}

          {/* Search params summary (collapsible) */}
          <SearchParamsSummary
            origins={cleanOrigins}
            departureDate={departureDate}
            returnDate={returnDate}
            tripType={tripType}
            flexEnabled={flexEnabled}
            flexDays={flexDays}
            cabinClass={cabinClass}
            directOnly={directOnly}
            budgetEnabled={budgetEnabled}
            maxBudget={maxBudget}
            currency={currency}
          />

          {/* Sticky results mini-bar */}
          <div className="fm-sticky-bar">
            <div className="fm-sticky-inner">
              <span className="fm-sticky-dest"><Plane size={14} aria-hidden="true" /> {cityOf(normalizeCode(bestDestination.destination)) || normalizeCode(bestDestination.destination)}</span>
              <span className="fm-sticky-price">{currency === "EUR" ? formatEur(bestDestination.averageCostPerTraveler, 0) : convertPrice(bestDestination.averageCostPerTraveler, currency)}/pp</span>
              <span className="fm-sticky-origins">{cleanOrigins.join(" · ")}</span>
              <div className="fm-currency-switcher" role="group" aria-label={t("search.currencyLabel")}>
                {["EUR", "GBP", "USD"].map(c => (
                  <button key={c} type="button"
                    className={`fm-currency-btn${currency === c ? " fm-currency-btn--active" : ""}`}
                    aria-label={c} aria-pressed={currency === c}
                    onClick={() => setCurrency(c)}>
                    {FX_SYMBOLS[c]}
                  </button>
                ))}
              </div>
              <button type="button" className="fm-sticky-btn" onClick={() => setView("search")}>{t("results.changeSearch")}</button>
            </div>
          </div>

          <WinnerCard
            dest={bestDestination}
            origins={cleanOrigins}
            tripType={tripType}
            returnDate={returnDate}
            departureDate={departureDate}
            uiCriterion={uiCriterion}
            onChangeCriterion={handleCriterion}
            flightsCount={flights.length}
            allFlights={flights}
            lastBestPrice={lastBestPrice}
            onShare={handleShare}
            onShareWhatsApp={handleShareWhatsApp}
            onShareTelegram={handleShareTelegram}
            onShareEmail={handleShareEmail}
            onShareNative={handleShareNative}
            onCopySearchLink={handleCopySearchLink}
            shareStatus={shareStatus}
            onViewAlternatives={() => setShowAlt((v) => v ? false : "list")}
            onChangeSearch={() => setView("search")}
            currency={currency}
            searchBadges={[
              cabinClass !== "ECONOMY" && (cabinClass === "BUSINESS" ? t("search.cabinBusiness") : t("search.cabinPremium")),
              directOnly && t("search.directOnly"),
              flexEnabled && `± ${flexDays} ${t("search.flexDaysUnit")}`,
              tripType === "roundtrip" && t("search.roundtrip"),
            ].filter(Boolean)}
            isFav={isFav(bestDestination.destination)}
            onToggleFav={() => toggleFav(bestDestination)}
          />

          {/* ── CORE: Top 3 destinations podium ── */}
          <TopDestinationsPodium flights={flights} currency={currency} onSelect={(dest) => {
            const idx = flights.findIndex(f => f.destination === dest.destination);
            if (idx >= 0) {
              setBestByCriterion(prev => ({ ...prev, [uiCriterion]: dest }));
            }
          }} />

          {/* ── CORE: Stats bar ── */}
          <div className="fm-stats-bar view-enter">
            <span className="fm-stats-item">
              <AnimatedStat value={flights.length} /> {t("results.destsAnalyzed")}
            </span>
            <span className="fm-stats-sep" aria-hidden="true">·</span>
            <span className="fm-stats-item">
              <AnimatedStat value={cleanOrigins.length} /> {t("results.originsUsed")}
            </span>
            <span className="fm-stats-sep" aria-hidden="true">·</span>
            <span className="fm-stats-item">
              <AnimatedStat value={flights.length * cleanOrigins.length} /> {t("results.routesCompared")}
            </span>
            {searchDuration > 0 && (
              <>
                <span className="fm-stats-sep" aria-hidden="true">·</span>
                <span className="fm-stats-item fm-stats-item--time">
                  <Clock size={13} aria-hidden="true" /> {searchDuration}s
                </span>
              </>
            )}
            <button type="button" className="fm-stats-export" onClick={() => exportResultsCSV(flights, cleanOrigins, currency)} title={t("results.exportCSV")}>
              <Download size={14} aria-hidden="true" /> CSV
            </button>
          </div>


          {/* ── Group savings vs the most expensive option ── */}
          {flights.length >= 2 && (() => {
            const maxTotal = Math.max(...flights.map(f => f.totalCostEUR || 0));
            const saved = maxTotal - bestDestination.totalCostEUR;
            if (saved > 10) return (
              <div className="fm-group-savings view-enter">
                <span className="fm-group-savings-icon"><Wallet size={16} aria-hidden="true" /></span>
                <span>{t("results.groupSavings", { amount: currency === "EUR" ? formatEur(saved, 0) : convertPrice(saved, currency) })}</span>
              </div>
            );
            return null;
          })()}

          {/* ── Cost split between travelers ── */}
          <CostSplitCard bestDest={bestDestination} origins={cleanOrigins} currency={currency} t={t} />

          {/* ── Share results with the group ── */}
          <ResultsShareLink origins={cleanOrigins} departureDate={departureDate} returnDate={returnDate} tripType={tripType} t={t} />

          {/* ── Booking CTA ── */}
          <PlanYourTripCTA destCode={normalizeCode(bestDestination.destination)} departureDate={bestDestination.bestDate || departureDate} returnDate={bestDestination.bestReturnDate || (tripType === "roundtrip" ? returnDate : "")} t={t} />

          {/* JSON-LD structured data for SEO */}
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TravelAction",
            "name": `Group flight to ${cityOf(normalizeCode(bestDestination.destination)) || bestDestination.destination}`,
            "description": `Cheapest group flight destination from ${cleanOrigins.join(", ")}`,
            "result": {
              "@type": "Flight",
              "arrivalAirport": { "@type": "Airport", "iataCode": normalizeCode(bestDestination.destination) },
              "offers": { "@type": "Offer", "price": bestDestination.averageCostPerTraveler?.toFixed(2), "priceCurrency": "EUR" }
            }
          }) }} />

          {/* Visual tabs: Map & Compare */}
          {flights.length > 1 && (
            <div className="rv-tabs mt-4" ref={tabContentRef}>
              <button type="button"
                className={`rv-tab${showAlt === "map" ? " rv-tab--active" : ""}`}
                aria-expanded={showAlt === "map"} aria-controls="rv-panel-map"
                onClick={() => { setShowAlt(showAlt === "map" ? false : "map"); setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }), 100); }}>
                <MapIcon size={15} aria-hidden="true" /> {t("results.showMap")}
              </button>
              <button type="button"
                className={`rv-tab${showAlt === "compare" ? " rv-tab--active" : ""}`}
                aria-expanded={showAlt === "compare"} aria-controls="rv-panel-compare"
                onClick={() => { setShowAlt(showAlt === "compare" ? false : "compare"); setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }), 100); }}>
                <BarChart3 size={15} aria-hidden="true" /> {t("results.showCompare")}
              </button>
              <button type="button"
                className={`rv-tab${showAlt === "list" ? " rv-tab--active" : ""}`}
                aria-expanded={showAlt === "list"} aria-controls="rv-panel-list"
                onClick={() => { setShowAlt(showAlt === "list" ? false : "list"); setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }), 100); }}>
                <List size={15} aria-hidden="true" /> {t("results.otherOptions")} <span className="rv-tab-badge">{flights.length - 1}</span>
              </button>
            </div>
          )}

          {showAlt === "map" && flights.length > 1 && (
            <div className="mt-3 view-enter" id="rv-panel-map">
              <ErrorBoundary renderingLabel={t("errors.rendering")} retryLabel={t("errors.retry")}>
                <Suspense fallback={<div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>}>
                  <DestinationMap flights={flights} bestDestination={bestDestination} origins={cleanOrigins} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}

          {showAlt === "compare" && flights.length > 1 && (
            <div className="mt-3 view-enter" id="rv-panel-compare">
              <ErrorBoundary renderingLabel={t("errors.rendering")} retryLabel={t("errors.retry")}>
                <Suspense fallback={<div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>}>
                  <CompareChart flights={flights} bestDestination={bestDestination} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}

          {showAlt === "list" && flights.length > 1 && (
            <div className="mt-4" id="rv-panel-list">
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                <h2 className="h5 fw-bold mb-0" style={{ color: "var(--navy)" }}>{t("results.otherOptions")}</h2>
                <div className="d-flex align-items-center gap-2">
                  {/* La lista sigue al criterio único (toggle de la WinnerCard):
                      antes había aquí dos controles de orden que se pisaban. */}
                  <span className="small" style={{ color: "var(--slate-700)" }}>
                    {uiCriterion === "fairness" ? t("results.sortedByFairness") : t("results.sortedByPrice")}
                  </span>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowAlt(false)}>{t("results.hide")}</button>
                </div>
              </div>
              <ErrorBoundary renderingLabel={t("errors.rendering")} retryLabel={t("errors.retry")}>
                <FlightResults
                  flights={flights}
                  optimizeBy={uiCriterion}
                  bestDestination={bestDestination}
                  origins={cleanOrigins}
                  departureDate={departureDate}
                  returnDate={returnDate}
                  tripType={tripType}
                  budgetEnabled={budgetEnabled}
                  maxBudgetPerTraveler={maxBudget}
                />
              </ErrorBoundary>
            </div>
          )}


          {/* Quick re-search: try nearby dates */}
          <div className="fm-quick-research view-enter">
            <span className="fm-quick-research-label">{t("results.tryNearbyDates")}</span>
            <div className="fm-quick-research-btns">
              {[-1, 1, -2, 2].map((offset) => {
                const d = new Date((departureDate || todayISO()) + "T00:00:00");
                d.setDate(d.getDate() + offset);
                const iso = d.toISOString().slice(0, 10);
                const label = `${offset > 0 ? "+" : ""}${offset}d · ${weekdayOf(iso)}`;
                return (
                  <button key={offset} type="button" className="fm-quick-research-btn"
                    onClick={() => {
                      setDepartureDate(iso);
                      if (tripType === "roundtrip" && returnDate) {
                        const r = new Date(returnDate + "T00:00:00");
                        r.setDate(r.getDate() + offset);
                        setReturnDate(r.toISOString().slice(0, 10));
                      }
                      setView("search");
                      setTimeout(() => {
                        document.querySelector(".sf-form form")?.requestSubmit?.();
                      }, 200);
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      )}
      </div>{/* /main-content */}

      {/* Scroll progress bar */}
      <ScrollProgressBar />

      {/* Scroll to top */}
      <ScrollToTopBtn />

      {/* PWA Install banner */}
      {showInstallBanner && installPrompt && (
        <div className="pwa-banner">
          <div className="container d-flex align-items-center justify-content-between" style={{ maxWidth: 1080 }}>
            <span className="pwa-banner-text">
              <strong>FlyndMe</strong> — {t("pwa.installHint")}
            </span>
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-light fw-semibold" onClick={handleInstall}>
                {t("pwa.install")}
              </button>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowInstallBanner(false)} aria-label={t("a11y.close")}><X size={16} aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="container" style={{ maxWidth: 1080 }}>
          <div className="app-footer-inner">
            <span className="app-footer-brand">{t("footerBrand")}</span>
            <span className="app-footer-tagline">{t("footerTagline")}</span>
            <nav className="app-footer-links">
              {/* Botones, no <a> sin href: los anchors sin href no reciben foco de teclado */}
              <button type="button" className="app-footer-link" onClick={() => { setView("landing"); window.scrollTo(0, 0); }}>{t("footerHow")}</button>
              <button type="button" className="app-footer-link" onClick={() => { setView("landing"); setTimeout(() => { const el = document.querySelector(".lp-faq"); if (el) el.scrollIntoView({ behavior: scrollBehavior() }); }, 100); }}>{t("footerFaq")}</button>
              <a className="app-footer-link" href="mailto:hello@flyndme.com">{t("footerContact")}</a>
            </nav>
            <span className="app-footer-copy">{t("footerCopy")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
