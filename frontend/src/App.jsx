// App.jsx (reemplaza tu archivo completo por este)
//
// Cambios principales:
// 1) Header: usa tu SVG real desde /public (y queda listo también para favicon vía index.html).
// 2) Hero azul: más limpio tipo “producto”, precios con formato EUR, KPIs más compactos, chips por origen.
// 3) CTA principal claro, secundarios ordenados.
// 4) Imagen del destino con fallback robusto (evita rotura visual).

import React from "react";
import { useEffect, useMemo, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./App.css";
import FlightResults from "./components/FlightResults";
import { LoadingOverlay } from "./components/SearchUX";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "") ||
  "https://flyndme-backend.onrender.com";

const API_URL = `${API_BASE}/api/flights/multi-origin`;

const AVAILABLE_AIRPORTS = [
  { code: "MAD", city: "Madrid", country: "España" },
  { code: "BCN", city: "Barcelona", country: "España" },
  { code: "LON", city: "Londres", country: "Reino Unido" },
  { code: "PAR", city: "París", country: "Francia" },
  { code: "ROM", city: "Roma", country: "Italia" },
  { code: "MIL", city: "Milán", country: "Italia" },
  { code: "BER", city: "Berlín", country: "Alemania" },
  { code: "AMS", city: "Ámsterdam", country: "Países Bajos" },
  { code: "LIS", city: "Lisboa", country: "Portugal" },
  { code: "DUB", city: "Dublín", country: "Irlanda" },
];

function getBaseUrl() {
  return import.meta.env.BASE_URL || "/";
}

function normalizeDestCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/\b[A-Z]{3}\b/);
  return match ? match[0] : raw.slice(0, 3);
}

function getDestinationLocalImage(destCode) {
  const code = normalizeDestCode(destCode);
  return `${getBaseUrl()}destinations/${code}.jpg`;
}

function getPlaceholderImage() {
  return `${getBaseUrl()}destinations/placeholder.jpg`;
}

function formatDateEs(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatEur(value, decimals = 0) {
  const n = typeof value === "number" && !Number.isNaN(value) ? value : Number(value || 0);
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch (_) {
    return `${n.toFixed(decimals)} €`;
  }
}

/* SKYSCANNER (CÓDIGO DE CIUDAD) */
function toSkyscannerDate(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  return String(yyyyMmDd).replaceAll("-", "");
}

function normalizeIataForSkyscanner(code) {
  return String(code || "").trim().toLowerCase();
}

function buildSkyscannerUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = normalizeIataForSkyscanner(origin);
  const to = normalizeIataForSkyscanner(destination);

  const dep = toSkyscannerDate(departureDate);
  const ret = tripType === "roundtrip" ? toSkyscannerDate(returnDate) : "";

  if (!from || !to || !dep) return "";

  const base = "https://www.skyscanner.es/transport/flights";
  const path =
    tripType === "roundtrip" && ret ? `${base}/${from}/${to}/${dep}/${ret}/` : `${base}/${from}/${to}/${dep}/`;

  const params = new URLSearchParams({
    adultsv2: "1",
    cabinclass: "economy",
    rtn: tripType === "roundtrip" ? "1" : "0",
  });

  return `${path}?${params.toString()}`;
}

async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error?.message || "Error desconocido" };
  }
  componentDidCatch(error, info) {
    console.error("[UI ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="alert alert-danger mb-0">
          <div className="fw-semibold">Ha ocurrido un error al mostrar las alternativas.</div>
          <div className="small mt-1">{this.state.errorMsg}</div>
          <div className="small mt-2">
            Abre la consola del navegador (F12) y revisa el error exacto. Si me lo pegas, lo corregimos.
          </div>
          <button type="button" className="btn btn-outline-light btn-sm mt-3" onClick={this.props.onReset}>
            Volver a la búsqueda
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* LANDING SIMPLIFICADA, ESTILO SKYSCANNER */
function Landing({ onStart }) {
  return (
    <>
      <section
        className="py-5"
        style={{
          background:
            "radial-gradient(1200px 400px at 20% 10%, rgba(59,130,246,0.20) 0%, rgba(243,248,255,1) 55%), radial-gradient(900px 400px at 90% 0%, rgba(11,94,215,0.12) 0%, rgba(243,248,255,1) 60%)",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <div className="container" style={{ maxWidth: "1100px" }}>
          <div className="row g-4 align-items-center">
            <div className="col-lg-7">
              <div
                className="text-uppercase"
                style={{
                  fontSize: 12,
                  letterSpacing: 0.6,
                  color: "#64748B",
                  fontWeight: 700,
                }}
              >
                FlyndMe
              </div>

              <h1 className="display-5 fw-bold mb-3" style={{ color: "#0F172A" }}>
                Encuentra el mejor destino para quedar
              </h1>

              <p className="lead mb-4" style={{ color: "#475569" }}>
                Introduce varios orígenes y te devolvemos el destino común óptimo: el más barato para el grupo o el más
                equilibrado entre viajeros.
              </p>

              <div className="d-flex flex-wrap gap-2">
                <button
                  className="btn btn-primary btn-lg"
                  style={{
                    backgroundColor: "#3B82F6",
                    borderColor: "#3B82F6",
                    boxShadow: "0 12px 28px rgba(59,130,246,0.25)",
                  }}
                  onClick={onStart}
                  type="button"
                >
                  Empezar a buscar
                </button>

                <a href="#como-funciona" className="btn btn-outline-secondary btn-lg" style={{ borderColor: "#CBD5E1" }}>
                  Ver cómo funciona
                </a>
              </div>

              <div className="mt-4 d-flex flex-wrap gap-2">
                {["Multi origen", "Mejor precio total", "Opción más equilibrada", "Presupuesto por persona"].map(
                  (t) => (
                    <span
                      key={t}
                      className="badge text-bg-light"
                      style={{
                        border: "1px solid #E2E8F0",
                        padding: "10px 12px",
                        color: "#0F172A",
                      }}
                    >
                      {t}
                    </span>
                  )
                )}
              </div>
            </div>

            <div className="col-lg-5">
              <div
                className="card border-0"
                style={{
                  borderRadius: 16,
                  overflow: "hidden",
                  boxShadow: "0 18px 45px rgba(2,6,23,0.08)",
                }}
              >
                <div
                  className="card-body p-4"
                  style={{
                    background: "white",
                    border: "1px solid #E2E8F0",
                  }}
                >
                  <div className="fw-bold mb-2" style={{ color: "#0F172A" }}>
                    Cómo lo usamos en la vida real
                  </div>

                  <div className="small" style={{ color: "#475569" }}>
                    {[
                      "Un grupo vive en ciudades distintas y quiere quedar un fin de semana.",
                      "FlyndMe calcula destinos posibles y elige el óptimo según tu criterio.",
                      "Abres Skyscanner por origen para reservar (FlyndMe no vende billetes).",
                    ].map((line) => (
                      <div key={line} className="d-flex gap-2 mb-2">
                        <div
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            backgroundColor: "#3B82F6",
                            marginTop: 6,
                            flex: "0 0 auto",
                          }}
                        />
                        <div>{line}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid #E2E8F0" }}>
                    <div className="d-flex justify-content-between align-items-center">
                      <div className="small" style={{ color: "#64748B" }}>
                        Fuente de precios
                      </div>
                      <div className="small fw-semibold" style={{ color: "#0F172A" }}>
                        Amadeus API
                      </div>
                    </div>
                    <div className="d-flex justify-content-between align-items-center mt-1">
                      <div className="small" style={{ color: "#64748B" }}>
                        Tiempo típico
                      </div>
                      <div className="small fw-semibold" style={{ color: "#0F172A" }}>
                        5 a 10 s
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 small" style={{ color: "#64748B", textAlign: "center" }}>
                Prototipo funcional con React + Node + Amadeus
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="py-5">
        <div className="container" style={{ maxWidth: "1100px" }}>
          <div className="d-flex align-items-end justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h2 className="h3 fw-bold mb-1" style={{ color: "#0F172A" }}>
                Preguntas frecuentes
              </h2>
              <div style={{ color: "#64748B" }}>Lo esencial, sin ruido.</div>
            </div>
          </div>

          <div className="row g-3">
            {[
              {
                q: "¿Qué significa “equidad”?",
                a: "Es una puntuación (0 a 100) que mide lo parecidos que son los precios entre viajeros. Más alto significa que el grupo paga de forma más similar.",
              },
              {
                q: "¿Cómo funciona el presupuesto máximo?",
                a: "Filtra destinos donde la media por persona no supera el límite. Si no hay destinos dentro de ese máximo, no se muestra ninguno.",
              },
              {
                q: "¿FlyndMe vende billetes?",
                a: "No. FlyndMe decide el destino. La reserva se hace en buscadores externos como Skyscanner o Google Flights.",
              },
              {
                q: "¿Qué hace distinto a FlyndMe?",
                a: "Además del precio total del grupo, puedes priorizar el destino más justo para todos.",
              },
            ].map((item) => (
              <div key={item.q} className="col-md-6">
                <div
                  className="p-4 bg-white"
                  style={{
                    border: "1px solid #E2E8F0",
                    borderRadius: 14,
                    boxShadow: "0 10px 24px rgba(2,6,23,0.04)",
                  }}
                >
                  <div className="fw-semibold mb-2" style={{ color: "#0F172A" }}>
                    {item.q}
                  </div>
                  <div className="small" style={{ color: "#475569" }}>
                    {item.a}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 d-flex justify-content-center">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              style={{
                backgroundColor: "#3B82F6",
                borderColor: "#3B82F6",
                boxShadow: "0 12px 28px rgba(59,130,246,0.22)",
              }}
              onClick={onStart}
            >
              Empezar a buscar
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function App() {
  const [origins, setOrigins] = useState(["", ""]);
  const [activeOriginIndex, setActiveOriginIndex] = useState(0);

  const [tripType, setTripType] = useState("oneway");
  const [dateMode, setDateMode] = useState("exact");
  const flexDays = 3;

  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");

  const [optimizeBy, setOptimizeBy] = useState("total");
  const [uiCriterion, setUiCriterion] = useState("total");

  const [flights, setFlights] = useState([]);
  const [bestDestination, setBestDestination] = useState(null);

  const [bestByCriterion, setBestByCriterion] = useState({ total: null, fairness: null });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [hasSearched, setHasSearched] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const [showSearchPanel, setShowSearchPanel] = useState(true);
  const [showComplementary, setShowComplementary] = useState(false);
  const [showBestDetails, setShowBestDetails] = useState(false);

  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [maxBudgetPerTraveler, setMaxBudgetPerTraveler] = useState(150);

  const [shareStatus, setShareStatus] = useState("");

  const BUDGET_MIN = 20;
  const BUDGET_MAX = 600;
  const BUDGET_STEP = 5;

  useEffect(() => {
    let timer;
    const ping = async () => {
      try {
        await fetch(`${API_BASE}/api/ping`, { cache: "no-store" });
      } catch (_) {}
    };

    ping();
    timer = setInterval(ping, 8 * 60 * 1000);

    return () => clearInterval(timer);
  }, []);

  const safeActiveIndex =
    activeOriginIndex >= 0 && activeOriginIndex < origins.length ? activeOriginIndex : 0;

  const airportFilterValue = origins[safeActiveIndex] || "";
  const airportFilter = airportFilterValue.trim().toLowerCase();

  const filteredAirports = AVAILABLE_AIRPORTS.filter((a) => {
    if (!airportFilter) return true;
    return (
      a.code.toLowerCase().includes(airportFilter) ||
      a.city.toLowerCase().includes(airportFilter) ||
      a.country.toLowerCase().includes(airportFilter)
    );
  });

  const handleClickSuggestion = (code) => {
    setOrigins((prev) => {
      const copy = [...prev];
      const emptyIndex = copy.findIndex((v) => !v.trim());
      if (emptyIndex !== -1) {
        copy[emptyIndex] = code;
        return copy;
      }
      if (!copy.includes(code)) {
        copy.push(code);
        return copy;
      }
      return copy;
    });
  };

  const handleOriginChange = (index, value) => {
    const newOrigins = [...origins];
    newOrigins[index] = value.toUpperCase();
    setOrigins(newOrigins);
  };

  const addOrigin = () => {
    setOrigins((prev) => [...prev, ""]);
    setActiveOriginIndex(origins.length);
  };

  const removeOrigin = (index) => {
    if (origins.length <= 1) return;
    setOrigins((prev) => {
      const copy = prev.filter((_, i) => i !== index);
      if (activeOriginIndex >= copy.length) {
        setActiveOriginIndex(copy.length - 1 >= 0 ? copy.length - 1 : 0);
      }
      return copy;
    });
  };

  const resetToSearch = () => {
    setShowSearchPanel(true);
    setShowComplementary(false);
    setShowBestDetails(false);
    setShareStatus("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleGoHome = () => {
    setHasStarted(false);
    setFlights([]);
    setBestDestination(null);
    setBestByCriterion({ total: null, fairness: null });
    setHasSearched(false);
    setError("");
    setShowSearchPanel(true);
    setShowComplementary(false);
    setShowBestDetails(false);
    setShareStatus("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadDemo = () => {
    setHasStarted(true);
    setShowSearchPanel(true);
    setShowComplementary(false);
    setShowBestDetails(false);

    if (!departureDate) {
      const today = new Date();
      const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      const yyyy = in30.getFullYear();
      const mm = String(in30.getMonth() + 1).padStart(2, "0");
      const dd = String(in30.getDate()).padStart(2, "0");
      setDepartureDate(`${yyyy}-${mm}-${dd}`);

      if (tripType === "roundtrip" && !returnDate) {
        const ret = new Date(in30.getTime() + 3 * 24 * 60 * 60 * 1000);
        const ryyyy = ret.getFullYear();
        const rmm = String(ret.getMonth() + 1).padStart(2, "0");
        const rdd = String(ret.getDate()).padStart(2, "0");
        setReturnDate(`${ryyyy}-${rmm}-${rdd}`);
      }
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const normalizeNumber = (v) => Number(v || 0);

  const computeBestDestinationFromFlights = (flightsArr, mode) => {
    if (!Array.isArray(flightsArr) || flightsArr.length === 0) return null;

    const safeNumber = (v) => (typeof v === "number" && !Number.isNaN(v) ? v : null);

    const getTotal = (f) => safeNumber(f.totalCostEUR) ?? null;
    const getFairness = (f) => safeNumber(f.fairnessScore) ?? null;
    const getAvg = (f) => safeNumber(f.averageCostPerTraveler) ?? null;
    const getSpread = (f) => safeNumber(f.priceSpread) ?? null;
    const getDest = (f) => f.destination || null;

    let best = flightsArr[0];

    for (const f of flightsArr) {
      if (mode === "fairness") {
        const fa = getFairness(f);
        const fb = getFairness(best);
        const ta = getTotal(f);
        const tb = getTotal(best);

        if (fa !== null && fb !== null) {
          if (fa > fb) best = f;
          else if (fa === fb && ta !== null && tb !== null && ta < tb) best = f;
        } else if (ta !== null && tb !== null && ta < tb) {
          best = f;
        }
      } else {
        const ta = getTotal(f);
        const tb = getTotal(best);
        if (ta !== null && tb !== null && ta < tb) best = f;
      }
    }

    return {
      destination: getDest(best) || "Destino",
      totalCostEUR: getTotal(best) ?? 0,
      averageCostPerTraveler: getAvg(best) ?? 0,
      fairnessScore: getFairness(best) ?? 0,
      priceSpread: getSpread(best) ?? 0,
      bestDate: best.bestDate || departureDate || "",
      bestReturnDate: best.bestReturnDate || (tripType === "roundtrip" ? returnDate : null),
      flights: Array.isArray(best.flights) ? best.flights : null,
    };
  };

  const rankFlights = (flightsArr, mode) => {
    const safe = Array.isArray(flightsArr) ? [...flightsArr] : [];
    const num = (v) => (typeof v === "number" && !Number.isNaN(v) ? v : null);

    if (mode === "fairness") {
      safe.sort((a, b) => {
        const fa = num(a?.fairnessScore);
        const fb = num(b?.fairnessScore);
        const ta = num(a?.totalCostEUR);
        const tb = num(b?.totalCostEUR);

        if (fa !== null && fb !== null && fa !== fb) return fb - fa;
        if (ta !== null && tb !== null && ta !== tb) return ta - tb;
        return 0;
      });
      return safe;
    }

    safe.sort((a, b) => {
      const ta = num(a?.totalCostEUR);
      const tb = num(b?.totalCostEUR);
      if (ta !== null && tb !== null && ta !== tb) return ta - tb;
      return 0;
    });
    return safe;
  };

  const fairnessLabel = (score) => {
    const s = Number(score || 0);
    if (s >= 85) return "muy equilibrado";
    if (s >= 65) return "bastante equilibrado";
    if (s >= 45) return "algo desigual";
    return "desigual";
  };

  const travelerCount = useMemo(() => {
    const n = (origins || []).map((o) => String(o || "").trim()).filter(Boolean).length;
    return n || 0;
  }, [origins]);

  const hasResults = useMemo(() => {
    return hasSearched && !loading && !error && bestDestination && Array.isArray(flights) && flights.length > 0;
  }, [hasSearched, loading, error, bestDestination, flights]);

  const clampBudget = (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return BUDGET_MIN;
    return Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, n));
  };

  const bestBreakdownFlights = useMemo(() => {
    if (!bestDestination) return [];
    if (Array.isArray(bestDestination.flights) && bestDestination.flights.length) return bestDestination.flights;

    const dest = bestDestination.destination;
    const match = Array.isArray(flights) ? flights.find((f) => String(f?.destination || "") === String(dest || "")) : null;
    if (match && Array.isArray(match.flights)) return match.flights;
    return [];
  }, [bestDestination, flights]);

  const cleanedOrigins = useMemo(() => {
    return (origins || []).map((o) => String(o || "").trim().toUpperCase()).filter(Boolean);
  }, [origins]);

  const bestExplanation = useMemo(() => {
    if (!Array.isArray(flights) || flights.length < 2 || !bestDestination) return "";

    const mode = uiCriterion;
    const ranked = rankFlights(flights, mode);
    if (ranked.length < 2) return "";

    const best = ranked[0];
    const second = ranked[1];

    const bestCode = normalizeDestCode(best?.destination || bestDestination?.destination);
    const secondCode = normalizeDestCode(second?.destination);

    if (!secondCode) return "";

    const bestTotal = normalizeNumber(best?.totalCostEUR);
    const secondTotal = normalizeNumber(second?.totalCostEUR);
    const bestFair = normalizeNumber(best?.fairnessScore);
    const secondFair = normalizeNumber(second?.fairnessScore);

    if (mode === "total") {
      const diff = secondTotal - bestTotal;
      if (diff > 0.5) return `Es aproximadamente ${diff.toFixed(0)} € más barato que ${secondCode}.`;
      return `Es la opción más barata frente a ${secondCode} por muy poca diferencia.`;
    }

    const fairDiff = bestFair - secondFair;
    const totalDiff = bestTotal - secondTotal;

    if (fairDiff >= 1 && Math.abs(totalDiff) <= 10) {
      return `Tiene +${fairDiff.toFixed(0)} puntos de equilibrio frente a ${secondCode} y un precio muy similar.`;
    }
    if (fairDiff >= 1 && totalDiff <= 0) {
      return `Tiene +${fairDiff.toFixed(0)} puntos de equilibrio frente a ${secondCode} y además es más barato.`;
    }
    if (fairDiff >= 1 && totalDiff > 0) {
      return `Tiene +${fairDiff.toFixed(0)} puntos de equilibrio frente a ${secondCode}, a cambio de unos ${totalDiff.toFixed(
        0
      )} € más.`;
    }
    return `Es la opción más equilibrada frente a ${secondCode}.`;
  }, [flights, bestDestination, uiCriterion]);

  const openAlternatives = () => {
    setShowComplementary(true);
    setShowBestDetails(false);
    setTimeout(() => {
      const el = document.getElementById("alternatives-panel");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const openBestDetails_toggle = () => {
    setShowBestDetails(true);
    setShowComplementary(false);
    setTimeout(() => {
      const el = document.getElementById("best-details-panel");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const primarySkyscannerAction = () => {
    if (!bestDestination) return;
    const dep = bestDestination.bestDate || departureDate;
    const dest = bestDestination.destination;

    if (!cleanedOrigins.length || !dep || !dest) {
      openBestDetails_toggle();
      return;
    }

    if (cleanedOrigins.length === 1) {
      const url = buildSkyscannerUrl({
        origin: cleanedOrigins[0],
        destination: dest,
        departureDate: dep,
        returnDate,
        tripType,
      });
      if (url) window.open(url, "_blank", "noreferrer");
      return;
    }

    openBestDetails_toggle();
  };

  const buildShareText = () => {
    if (!bestDestination) return "";

    const destCode = normalizeDestCode(bestDestination.destination);
    const dep = bestDestination.bestDate || departureDate;

    const lines = [];
    lines.push(`FlyndMe · Destino recomendado: ${destCode}`);
    lines.push(
      `Total grupo: ${normalizeNumber(bestDestination.totalCostEUR).toFixed(2)} € · Media: ${normalizeNumber(
        bestDestination.averageCostPerTraveler
      ).toFixed(2)} €`
    );
    lines.push(
      `Equilibrio: ${normalizeNumber(bestDestination.fairnessScore).toFixed(0)}/100 · Dif. máx: ${normalizeNumber(
        bestDestination.priceSpread
      ).toFixed(2)} €`
    );

    if (tripType === "roundtrip") lines.push(`Fechas: ${dep} -> ${returnDate}`);
    else lines.push(`Fecha: ${dep}`);

    if (Array.isArray(bestBreakdownFlights) && bestBreakdownFlights.length > 0) {
      const byOrigin = bestBreakdownFlights
        .map((f) => {
          const o = String(f?.origin || "").toUpperCase();
          const p = typeof f?.price === "number" ? `${f.price.toFixed(0)} €` : "sin datos";
          return `${o}: ${p}`;
        })
        .join(" · ");
      lines.push(`Por origen: ${byOrigin}`);
    } else if (cleanedOrigins.length) {
      lines.push(`Orígenes: ${cleanedOrigins.join(", ")}`);
    }

    lines.push("Enlaces de reserva: abre FlyndMe y usa 'Ver vuelos en Skyscanner'.");
    return lines.join("\n");
  };

  const handleShare = async () => {
    setShareStatus("");
    const text = buildShareText();
    if (!text) return;

    const ok = await copyToClipboard(text);
    setShareStatus(ok ? "ok" : "fail");
    setTimeout(() => setShareStatus(""), 2500);
  };

  const handleToggleCriterion = (mode) => {
    if (mode !== "total" && mode !== "fairness") return;
    setUiCriterion(mode);

    const next = bestByCriterion?.[mode] || null;
    if (next) {
      setBestDestination(next);
      setShowBestDetails(false);
      setShowComplementary(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setHasSearched(true);
    setShareStatus("");

    setFlights([]);
    setBestDestination(null);
    setBestByCriterion({ total: null, fairness: null });

    setShowComplementary(false);
    setShowBestDetails(false);

    const o = cleanedOrigins;

    if (!o.length) {
      setError("Introduce al menos un aeropuerto de origen.");
      setShowSearchPanel(true);
      return;
    }

    if (!departureDate) {
      setError("Selecciona una fecha de salida.");
      setShowSearchPanel(true);
      return;
    }

    if (tripType === "roundtrip") {
      if (!returnDate) {
        setError("Selecciona una fecha de vuelta.");
        setShowSearchPanel(true);
        return;
      }
      if (returnDate <= departureDate) {
        setError("La fecha de vuelta debe ser posterior a la de salida.");
        setShowSearchPanel(true);
        return;
      }
    }

    if (budgetEnabled) {
      const n = Number(maxBudgetPerTraveler);
      if (Number.isNaN(n) || n <= 0) {
        setError("El presupuesto máximo debe ser un número mayor que 0.");
        setShowSearchPanel(true);
        return;
      }
    }

    setLoading(true);

    try {
      const body = {
        origins: o,
        departureDate,
        optimizeBy,
        tripType,
        dateMode,
        flexDays: dateMode === "flex" ? flexDays : 0,
      };

      if (tripType === "roundtrip") body.returnDate = returnDate;
      if (budgetEnabled) body.maxBudgetPerTraveler = Number(maxBudgetPerTraveler);

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || "Error al buscar vuelos.");
      }

      const data = await res.json();
      const flightsArr = Array.isArray(data.flights) ? data.flights : [];
      setFlights(flightsArr);

      const bestTotal = computeBestDestinationFromFlights(flightsArr, "total") || data.bestDestination || null;
      const bestFair = computeBestDestinationFromFlights(flightsArr, "fairness");

      const map = { total: bestTotal, fairness: bestFair };
      setBestByCriterion(map);

      const initial = map[uiCriterion] || map.total || data.bestDestination || null;
      setBestDestination(initial);

      if (!flightsArr.length || !initial) {
        setError(
          budgetEnabled
            ? "No se han encontrado resultados con ese presupuesto. Prueba a subir el máximo o quitar el filtro."
            : "No se han encontrado resultados para esos orígenes y fechas."
        );
        setShowSearchPanel(true);
        return;
      }

      setShowSearchPanel(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error(err);
      setError(err.message || "Error inesperado al buscar vuelos.");
      setShowSearchPanel(true);
    } finally {
      setLoading(false);
    }
  };

  const optimizeLabel = optimizeBy === "fairness" ? "equidad de precio entre el grupo" : "precio total del grupo";

  const heroDestCode = bestDestination ? normalizeDestCode(bestDestination.destination) : "";
  const heroImage = bestDestination ? getDestinationLocalImage(bestDestination.destination) : "";

  return (
    <div className="min-vh-100" style={{ backgroundColor: "#F3F8FF", color: "#1E293B" }}>
      <LoadingOverlay loading={loading} />

      <header className="bg-white border-bottom">
        <div className="container" style={{ maxWidth: "1100px" }}>
          <div className="d-flex align-items-center py-3" onClick={handleGoHome} style={{ cursor: "pointer" }}>
            <img
              src={`${getBaseUrl()}logo-flyndme.svg`}
              alt="FlyndMe"
              height={32}
              style={{ marginRight: 10, display: "block" }}
              onError={(e) => {
                // si fallara el svg, no rompas el header
                e.currentTarget.style.display = "none";
              }}
            />
            <div className="d-flex flex-column" style={{ lineHeight: 1.05 }}>
              <span className="fw-semibold">FlyndMe</span>
              <span className="small text-secondary">Meet smarter, fly fair</span>
            </div>
          </div>
        </div>
      </header>

      {!hasStarted ? (
        <Landing onStart={loadDemo} />
      ) : (
        <main className="py-4">
          <div className="container" style={{ maxWidth: "960px" }}>
            {hasResults && !showSearchPanel ? (
              <>
                {/* HERO RESULTADO PRINCIPAL */}
                {/* RESULTADO PRINCIPAL */}
<section className="mb-3">
  <div className="card border-0 fm-hero">
    <div className="card-body p-4 p-md-5">
      <div className="row g-4 align-items-stretch">
        {/* LEFT */}
        <div className="col-md-7">
          <div className="d-flex flex-column justify-content-between h-100">
            <div>
              {/* header row */}
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                <div className="fm-hero-kicker">RECOMENDACIÓN PARA EL GRUPO</div>

                {/* TOGGLE UI CRITERIO */}
                <div className="btn-group btn-group-sm" role="group">
                  <button
                    type="button"
                    className={`btn ${uiCriterion === "total" ? "btn-light" : "btn-outline-light"}`}
                    onClick={() => handleToggleCriterion("total")}
                  >
                    Mejor precio total
                  </button>
                  <button
                    type="button"
                    className={`btn ${uiCriterion === "fairness" ? "btn-light" : "btn-outline-light"}`}
                    onClick={() => handleToggleCriterion("fairness")}
                  >
                    Más equilibrado
                  </button>
                </div>
              </div>

              {/* destination + tags */}
              <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                <h2 className="fm-hero-dest mb-0">{bestDestination.destination}</h2>

                <span className="fm-chip">
                  {tripType === "roundtrip" ? "Ida y vuelta" : "Solo ida"}
                </span>

                <span className="fm-chip">
                  {dateMode === "flex"
                    ? `${formatDateEs(bestDestination.bestDate || departureDate) || (bestDestination.bestDate || departureDate)} (±${flexDays} días)`
                    : formatDateEs(departureDate) || departureDate}
                </span>
              </div>

              <div className="fm-hero-sub mb-3">
                {uiCriterion === "fairness"
                  ? "Esta es la opción más equilibrada para que todos paguen de forma similar."
                  : "Esta es la opción más barata para el grupo con los criterios actuales."}
                {budgetEnabled ? (
                  <>
                    {" "}Presupuesto activado: máximo{" "}
                    <strong>{Number(maxBudgetPerTraveler).toFixed(0)} EUR</strong> por persona.
                  </>
                ) : null}
              </div>

              {/* origins */}
              {cleanedOrigins?.length > 0 && (
                <div className="mb-3">
                  <div className="fm-hero-mini-title">Orígenes del grupo</div>
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    {cleanedOrigins.map((o) => (
                      <span key={o} className="fm-pill-origin">{o}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* WHY THIS DEST */}
              {bestExplanation && (
                <div className="fm-insight mb-3">
                  <div className="fm-insight-badge">✓</div>
                  <div>
                    <div className="fm-insight-title">Por qué este destino</div>
                    <div className="fm-insight-text">
                      {uiCriterion === "total"
                        ? `✔️ ${normalizeDestCode(bestDestination.destination)} es la opción más barata para el grupo. ${bestExplanation}`
                        : `⚖️ ${normalizeDestCode(bestDestination.destination)} es la opción más equilibrada para el grupo. ${bestExplanation}`}
                    </div>
                  </div>
                </div>
              )}

              {/* PRICE */}
              <div className="mb-3">
                <div className="fm-hero-mini-title">Coste total estimado del grupo</div>

                <div className="d-flex align-items-end gap-2 flex-wrap">
                  <div className="fm-price">
                    {normalizeNumber(bestDestination.totalCostEUR).toFixed(2)} €
                  </div>
                  <div className="fm-price-sub">
                    {travelerCount > 0
                      ? `para ${travelerCount} viajero${travelerCount > 1 ? "s" : ""}`
                      : "para el grupo"}
                  </div>
                </div>

                <div className="fm-price-note mt-1">
                  Media por persona:{" "}
                  <strong>{normalizeNumber(bestDestination.averageCostPerTraveler).toFixed(2)} €</strong>
                </div>
              </div>

              {/* Breakdown */}
              {Array.isArray(bestBreakdownFlights) && bestBreakdownFlights.length > 0 && (
                <div className="mb-3">
                  <div className="fm-hero-mini-title">Coste por origen</div>
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    {bestBreakdownFlights.map((f, i) => (
                      <span key={i} className="fm-breakdown">
                        <strong>{String(f.origin || "").toUpperCase()}</strong>
                        {" "}→{" "}
                        <strong>{normalizeDestCode(bestDestination.destination)}</strong>
                        {" "}·{" "}
                        <strong>
                          {typeof f.price === "number" ? `${f.price.toFixed(0)} €` : "sin datos"}
                        </strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metrics */}
              <div className="row g-2 mt-1">
                <div className="col-12 col-lg-6">
                  <div className="fm-metric">
                    <div className="fm-metric-title">Diferencia máxima</div>
                    <div className="fm-metric-value">
                      {normalizeNumber(bestDestination.priceSpread).toFixed(2)} €
                    </div>
                    <div className="fm-metric-sub">
                      La mayor diferencia de precio dentro del grupo.
                    </div>
                  </div>
                </div>

                <div className="col-12 col-lg-6">
                  <div className="fm-metric">
                    <div className="fm-metric-title">Equidad entre viajeros</div>
                    <div className="d-flex align-items-center justify-content-between gap-2">
                      <div className="fm-metric-value">
                        {normalizeNumber(bestDestination.fairnessScore).toFixed(0)}/100
                      </div>
                      <div className="fm-metric-tag">
                        {fairnessLabel(bestDestination.fairnessScore)}
                      </div>
                    </div>

                    {/* visual bar */}
                    <div className="fm-bar mt-2">
                      <div
                        className="fm-bar-fill"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, normalizeNumber(bestDestination.fairnessScore))
                          )}%`,
                        }}
                      />
                    </div>

                    <div className="fm-metric-sub mt-2">
                      Cuanto más alto, más parecido paga cada viajero.
                    </div>
                  </div>
                </div>
              </div>

              {/* “smart engine” line */}
              <div className="fm-engine mt-3">
                FlyndMe ha analizado{" "}
                <strong>{Array.isArray(flights) ? flights.length : 0}</strong>{" "}
                destinos posibles con tus criterios para recomendarte esta opción.
              </div>

              {/* CTA row */}
              <div className="d-flex flex-wrap gap-2 mt-4">
                {/* Primary */}
                <button
                  type="button"
                  className="btn btn-light fw-semibold fm-cta-primary"
                  onClick={primarySkyscannerAction}
                >
                  Ver vuelos en Skyscanner
                </button>

                {/* Secondary */}
                <button
                  type="button"
                  className="btn btn-outline-light fm-cta-secondary"
                  onClick={handleShare}
                >
                  Compartir
                </button>

                <button
                  type="button"
                  className="btn btn-outline-light fm-cta-secondary"
                  onClick={openAlternatives}
                >
                  Ver otros destinos
                </button>

                {/* Tertiary */}
                <button
                  type="button"
                  className="btn btn-link text-white text-decoration-none fm-cta-tertiary"
                  onClick={resetToSearch}
                >
                  Cambiar búsqueda
                </button>

                {shareStatus === "ok" && <div className="fm-toast">Copiado</div>}
                {shareStatus === "fail" && <div className="fm-toast">No se pudo copiar</div>}
              </div>

              {/* Next step */}
              <div className="fm-nextstep mt-3">
                Siguiente paso: abre Skyscanner y reserva cada origen por separado.
              </div>

              <div className="fm-disclaimer mt-2">
                Precios estimados con la API de Amadeus. Pueden variar al reservar.
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="col-md-5">
          <div className="fm-hero-image">
            <img
              src={getDestinationLocalImage(bestDestination.destination)}
              alt={`Foto de ${normalizeDestCode(bestDestination.destination)}`}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              loading="lazy"
              onError={(e) => {
                e.currentTarget.src = getPlaceholderImage();
              }}
            />

            <div className="fm-hero-image-overlay" />

            <div className="fm-hero-image-label">
              <div className="fm-hero-image-dest">
                {normalizeDestCode(bestDestination.destination)}
              </div>
              <div className="fm-hero-image-sub">
                Imagen orientativa del destino
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>


                <section className="mb-4">
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <button type="button" className="btn btn-outline-secondary" onClick={handleGoHome}>
                      Volver a la landing
                    </button>
                  </div>

                  <div className="text-secondary small mt-2">
                    Las opciones avanzadas aparecen debajo para mantener el foco en el destino recomendado.
                  </div>
                </section>

                {showBestDetails && (
                  <section id="best-details-panel" className="mb-4">
                    <div className="card bg-white border" style={{ borderColor: "#D0D8E5" }}>
                      <div className="card-body">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <h3 className="h6 fw-semibold mb-0">Vuelos y detalles del destino recomendado</h3>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setShowBestDetails(false)}
                          >
                            Ocultar
                          </button>
                        </div>

                        <div className="row g-3">
                          <div className="col-md-6">
                            <div className="p-3 rounded-3 border">
                              <div className="text-secondary small">Destino</div>
                              <div className="fw-semibold">{heroDestCode}</div>
                            </div>
                          </div>

                          <div className="col-md-6">
                            <div className="p-3 rounded-3 border">
                              <div className="text-secondary small">Fechas</div>
                              <div className="fw-semibold">
                                {dateMode === "flex"
                                  ? `Flexible (±${flexDays} días). Mejor salida: ${
                                      formatDateEs(bestDestination.bestDate || departureDate) ||
                                      (bestDestination.bestDate || departureDate)
                                    }`
                                  : `Salida: ${formatDateEs(departureDate) || departureDate}`}
                                {tripType === "roundtrip" ? ` | Vuelta: ${formatDateEs(returnDate) || returnDate}` : ""}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="text-secondary small mb-2">Abrir en Skyscanner por origen</div>

                          {(() => {
                            const dep = bestDestination?.bestDate || departureDate;
                            const dest = bestDestination?.destination;

                            const o = (origins || [])
                              .map((x) => String(x || "").trim().toUpperCase())
                              .filter(Boolean);

                            if (!o.length || !dest || !dep) {
                              return <div className="text-secondary small">No hay datos suficientes para generar enlaces.</div>;
                            }

                            return (
                              <div className="d-flex flex-wrap gap-2">
                                {o.map((origin) => {
                                  const url = buildSkyscannerUrl({
                                    origin,
                                    destination: dest,
                                    departureDate: dep,
                                    returnDate,
                                    tripType,
                                  });

                                  return (
                                    <a
                                      key={origin}
                                      href={url || "#"}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`btn btn-primary btn-sm ${url ? "" : "disabled"}`}
                                      style={{ backgroundColor: "#3B82F6", borderColor: "#3B82F6" }}
                                      onClick={(e) => {
                                        if (!url) e.preventDefault();
                                      }}
                                    >
                                      Ver vuelos {origin} → {heroDestCode}
                                    </a>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>

                        <div className="text-secondary small mt-2">
                          Skyscanner abre un enlace por origen (no existe un enlace único multi origen).
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <section id="alternatives-panel" className="mb-4">
                  {showComplementary ? (
                    <div className="card bg-white border" style={{ borderColor: "#D0D8E5" }}>
                      <div className="card-body">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <h3 className="h6 fw-semibold mb-0">Otros destinos (alternativas)</h3>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setShowComplementary(false)}
                          >
                            Ocultar
                          </button>
                        </div>

                        {Array.isArray(flights) && flights.length > 0 ? (
                          <ErrorBoundary onReset={resetToSearch}>
                            <FlightResults
                              flights={flights}
                              optimizeBy={optimizeBy}
                              hasSearched={hasSearched}
                              loading={loading}
                              error={error}
                              origins={origins}
                              bestDestination={bestDestination}
                              flexRange={dateMode === "flex" ? flexDays : null}
                              departureDate={departureDate}
                              tripType={tripType}
                              returnDate={returnDate}
                              budgetEnabled={budgetEnabled}
                              maxBudgetPerTraveler={maxBudgetPerTraveler}
                            />
                          </ErrorBoundary>
                        ) : (
                          <div className="alert alert-warning py-2 mb-0">No hay alternativas disponibles para mostrar.</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-secondary small">Alternativas ocultas para priorizar el destino recomendado.</div>
                  )}
                </section>
              </>
            ) : (
              /* PANEL DE BÚSQUEDA */
              <div className="fm-card mb-4">
                <div className="fm-card-body">
                  <div className="fm-row">
                    <div>
                      <div className="mb-3">
                        <h2 className="fm-title">Planifica la búsqueda</h2>
                        <p className="fm-subtitle">
                          Añade los aeropuertos del grupo y elige fechas. Luego te damos el mejor destino común.
                        </p>
                      </div>

                      <form onSubmit={handleSubmit}>
                        <div className="fm-section">
                          <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                            <div>
                              <div className="fw-semibold">Aeropuertos de origen</div>
                              <div className="small fm-muted">
                                Consejo: haz clic en la lista de la derecha para autocompletar el campo activo.
                              </div>
                            </div>
                          </div>

                          <div className="mt-3">
                            {origins.map((origin, index) => (
                              <div key={index} className="fm-origin-row mb-2">
                                <div className="fm-origin-badge">Viajero {index + 1}</div>

                                <input
                                  type="text"
                                  className="form-control text-uppercase"
                                  placeholder="Ej: MAD, BCN, LON..."
                                  value={origin}
                                  onChange={(e) => handleOriginChange(index, e.target.value)}
                                  onFocus={() => setActiveOriginIndex(index)}
                                  disabled={loading}
                                />

                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={() => removeOrigin(index)}
                                  disabled={origins.length <= 1 || loading}
                                  title="Eliminar origen"
                                >
                                  X
                                </button>
                              </div>
                            ))}

                            <div className="fm-origin-actions">
                              <button type="button" className="fm-linklike" onClick={addOrigin} disabled={loading}>
                                + Añadir origen
                              </button>

                              <span className="small fm-muted">Origen activo: Viajero {safeActiveIndex + 1}</span>
                            </div>
                          </div>
                        </div>

                        <div className="fm-section">
                          <div className="fw-semibold mb-2">Tipo de viaje</div>
                          <div className="fm-pill-group">
                            <button
                              type="button"
                              className={`btn fm-pill ${
                                tripType === "oneway" ? "btn-light fm-pill-active" : "btn-outline-secondary"
                              }`}
                              onClick={() => setTripType("oneway")}
                              disabled={loading}
                            >
                              Solo ida
                            </button>

                            <button
                              type="button"
                              className={`btn fm-pill ${
                                tripType === "roundtrip" ? "btn-light fm-pill-active" : "btn-outline-secondary"
                              }`}
                              onClick={() => setTripType("roundtrip")}
                              disabled={loading}
                            >
                              Ida y vuelta
                            </button>
                          </div>

                          <div className="fm-divider" />

                          <div className="fw-semibold mb-2">Fechas</div>
                          <div className="fm-pill-group">
                            <button
                              type="button"
                              className={`btn fm-pill ${
                                dateMode === "exact" ? "btn-light fm-pill-active" : "btn-outline-secondary"
                              }`}
                              onClick={() => setDateMode("exact")}
                              disabled={loading}
                            >
                              Concretas
                            </button>

                            <button
                              type="button"
                              className={`btn fm-pill ${
                                dateMode === "flex" ? "btn-light fm-pill-active" : "btn-outline-secondary"
                              }`}
                              onClick={() => setDateMode("flex")}
                              disabled={loading}
                            >
                              Flexibles (±{flexDays} días)
                            </button>
                          </div>

                          {dateMode === "flex" && (
                            <div className="small fm-muted mt-2">
                              Buscamos el mejor resultado dentro de {2 * flexDays + 1} fechas posibles.
                            </div>
                          )}

                          <div className="row g-3 mt-2">
                            <div className="col-md-6">
                              <label className="form-label fw-semibold">Salida</label>
                              <input
                                type="date"
                                className="form-control"
                                value={departureDate}
                                onChange={(e) => setDepartureDate(e.target.value)}
                                disabled={loading}
                              />
                            </div>

                            {tripType === "roundtrip" && (
                              <div className="col-md-6">
                                <label className="form-label fw-semibold">Vuelta</label>
                                <input
                                  type="date"
                                  className="form-control"
                                  value={returnDate}
                                  onChange={(e) => setReturnDate(e.target.value)}
                                  disabled={loading}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="fm-section">
                          <div className="d-flex justify-content-between align-items-center gap-2">
                            <div>
                              <div className="fw-semibold">Presupuesto máximo por persona</div>
                              <div className="small fm-muted">
                                {budgetEnabled
                                  ? `Filtramos por media por persona hasta ${Number(maxBudgetPerTraveler).toFixed(0)} EUR.`
                                  : "Sin límite. Actívalo si quieres descartar destinos caros."}
                              </div>
                            </div>

                            <div className="form-check form-switch">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="budgetSwitch"
                                checked={budgetEnabled}
                                onChange={(e) => setBudgetEnabled(e.target.checked)}
                                disabled={loading}
                              />
                              <label className="form-check-label small" htmlFor="budgetSwitch">
                                {budgetEnabled ? "Activado" : "Sin límite"}
                              </label>
                            </div>
                          </div>

                          {budgetEnabled && (
                            <div className="fm-budget-box">
                              <div className="d-flex align-items-center gap-2">
                                <input
                                  type="range"
                                  className="form-range"
                                  min={BUDGET_MIN}
                                  max={BUDGET_MAX}
                                  step={BUDGET_STEP}
                                  value={maxBudgetPerTraveler}
                                  onChange={(e) => setMaxBudgetPerTraveler(clampBudget(e.target.value))}
                                  disabled={loading}
                                />

                                <div style={{ width: 130 }}>
                                  <div className="input-group input-group-sm">
                                    <input
                                      type="number"
                                      className="form-control"
                                      min={BUDGET_MIN}
                                      max={BUDGET_MAX}
                                      step={BUDGET_STEP}
                                      value={maxBudgetPerTraveler}
                                      onChange={(e) => setMaxBudgetPerTraveler(clampBudget(e.target.value))}
                                      disabled={loading}
                                    />
                                    <span className="input-group-text">EUR</span>
                                  </div>
                                </div>
                              </div>

                              <div className="d-flex justify-content-between small fm-muted mt-1">
                                <span>{BUDGET_MIN} EUR</span>
                                <span>{BUDGET_MAX} EUR</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="fm-section">
                          <div className="fw-semibold mb-2">Optimizar por</div>
                          <div className="fm-pill-group">
                            <button
                              type="button"
                              className={`btn fm-pill ${
                                optimizeBy === "total" ? "btn-light fm-pill-active" : "btn-outline-secondary"
                              }`}
                              onClick={() => {
                                setOptimizeBy("total");
                                setUiCriterion("total");
                              }}
                              disabled={loading}
                            >
                              Precio total del grupo
                            </button>

                            <button
                              type="button"
                              className={`btn fm-pill ${
                                optimizeBy === "fairness" ? "btn-light fm-pill-active" : "btn-outline-secondary"
                              }`}
                              onClick={() => {
                                setOptimizeBy("fairness");
                                setUiCriterion("fairness");
                              }}
                              disabled={loading}
                            >
                              Equidad entre viajeros
                            </button>
                          </div>

                          <div className="small fm-muted mt-2">Actualmente estamos priorizando la {optimizeLabel}.</div>
                        </div>

                        {error && <div className="alert alert-danger py-2 mt-3 mb-0">{error}</div>}

                        <div className="mt-3">
                          <button type="submit" className="btn btn-primary w-100 fm-cta" disabled={loading}>
                            Buscar destinos comunes
                          </button>

                          <div className="fm-cta-help">
                            <span>Tiempo estimado: 5 a 10 s</span>
                            <span>Precios estimados con Amadeus</span>
                          </div>
                        </div>
                      </form>
                    </div>

                    <aside className="fm-right-card">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <div className="fw-semibold">Aeropuertos disponibles</div>
                          <div className="small fm-muted">Filtra según el campo activo. Haz clic para rellenarlo.</div>
                        </div>
                        <div className="small fm-muted">Activo: Viajero {safeActiveIndex + 1}</div>
                      </div>

                      <div className="fm-list">
                        {filteredAirports.map((a) => (
                          <div
                            key={a.code}
                            className="fm-airport-item"
                            onClick={() => !loading && handleClickSuggestion(a.code)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleClickSuggestion(a.code);
                            }}
                          >
                            <div className="fm-airport-left">
                              <div className="fm-airport-code">{a.code}</div>
                              <div className="fm-airport-city">{a.city}</div>
                            </div>
                            <div className="fm-airport-country">{a.country}</div>
                          </div>
                        ))}

                        {filteredAirports.length === 0 && (
                          <div className="text-center small fm-muted py-3">No hay aeropuertos que coincidan.</div>
                        )}
                      </div>

                      <div className="small fm-muted mt-2">Consejo: cambia de campo y la lista se adapta.</div>
                    </aside>
                  </div>
                </div>
              </div>
            )}

            <footer className="mt-5 pt-3 border-top border-secondary">
              <p className="text-secondary small mb-1">
                FlyndMe es un prototipo funcional construido con React, Vite, Node.js, Express y la API de Amadeus.
              </p>
            </footer>
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
