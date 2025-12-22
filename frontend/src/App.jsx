import React from "react";
import { useEffect, useMemo, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import FlightResults from "./components/FlightResults";
import { LoadingOverlay, SearchButton } from "./components/SearchUX";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "") ||
  "https://flyndme-backend.onrender.com";

const API_URL = `${API_BASE}/api/flights/multi-origin`;

const DESTINATION_CODE_MAP = {
  Paris: "PAR",
  London: "LON",
  Rome: "ROM",
  Barcelona: "BCN",
  Berlin: "BER",
  Milan: "MIL",
  Lisbon: "LIS",
  Amsterdam: "AMS",
  Dublin: "DUB",
  Vienna: "VIE",
};

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

/* SKYSCANNER (CÓDIGO DE CIUDAD) */
function toSkyscannerDate(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  return String(yyyyMmDd).replaceAll("-", "");
}

function normalizeIataForSkyscanner(code) {
  return String(code || "").trim().toLowerCase();
}

function buildSkyscannerUrl({
  origin,
  destination,
  departureDate,
  returnDate,
  tripType,
}) {
  const from = normalizeIataForSkyscanner(origin);
  const to = normalizeIataForSkyscanner(destination);

  const dep = toSkyscannerDate(departureDate);
  const ret = tripType === "roundtrip" ? toSkyscannerDate(returnDate) : "";

  if (!from || !to || !dep) return "";

  const base = "https://www.skyscanner.es/transport/flights";
  const path =
    tripType === "roundtrip" && ret
      ? `${base}/${from}/${to}/${dep}/${ret}/`
      : `${base}/${from}/${to}/${dep}/`;

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
          <div className="fw-semibold">
            Ha ocurrido un error al mostrar las alternativas.
          </div>
          <div className="small mt-1">{this.state.errorMsg}</div>
          <div className="small mt-2">
            Abre la consola del navegador (F12) y revisa el error exacto. Si me
            lo pegas, lo corregimos.
          </div>
          <button
            type="button"
            className="btn btn-outline-light btn-sm mt-3"
            onClick={this.props.onReset}
          >
            Volver a la búsqueda
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [origins, setOrigins] = useState(["", ""]);
  const [activeOriginIndex, setActiveOriginIndex] = useState(0);

  const [tripType, setTripType] = useState("oneway"); // "oneway" | "roundtrip"
  const [dateMode, setDateMode] = useState("exact"); // "exact" | "flex"
  const flexDays = 3;

  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");

  // "total" | "fairness"
  // Se usa para la búsqueda al backend
  const [optimizeBy, setOptimizeBy] = useState("total");

  // UI toggle post-búsqueda (no rehace fetch)
  const [uiCriterion, setUiCriterion] = useState("total");

  const [flights, setFlights] = useState([]);
  const [bestDestination, setBestDestination] = useState(null);

  // Guardamos best calculado para ambos criterios, así el toggle es instantáneo
  const [bestByCriterion, setBestByCriterion] = useState({
    total: null,
    fairness: null,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [hasSearched, setHasSearched] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const [showSearchPanel, setShowSearchPanel] = useState(true);
  const [showComplementary, setShowComplementary] = useState(false);
  const [showBestDetails, setShowBestDetails] = useState(false);

  // Presupuesto
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [maxBudgetPerTraveler, setMaxBudgetPerTraveler] = useState(150);

  // UX feedback
  const [shareStatus, setShareStatus] = useState(""); // "" | "ok" | "fail"

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
    activeOriginIndex >= 0 && activeOriginIndex < origins.length
      ? activeOriginIndex
      : 0;

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

    const safeNumber = (v) =>
      typeof v === "number" && !Number.isNaN(v) ? v : null;

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
      bestReturnDate:
        best.bestReturnDate || (tripType === "roundtrip" ? returnDate : null),
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

        if (fa !== null && fb !== null && fa !== fb) return fb - fa; // desc
        if (ta !== null && tb !== null && ta !== tb) return ta - tb; // asc
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
    const n = (origins || [])
      .map((o) => String(o || "").trim())
      .filter(Boolean).length;
    return n || 0;
  }, [origins]);

  const hasResults = useMemo(() => {
    return (
      hasSearched &&
      !loading &&
      !error &&
      bestDestination &&
      Array.isArray(flights) &&
      flights.length > 0
    );
  }, [hasSearched, loading, error, bestDestination, flights]);

  const clampBudget = (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return BUDGET_MIN;
    return Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, n));
  };

  // Intentamos sacar desglose por origen sin romper nada
  const bestBreakdownFlights = useMemo(() => {
    if (!bestDestination) return [];
    if (Array.isArray(bestDestination.flights) && bestDestination.flights.length) {
      return bestDestination.flights;
    }
    const dest = bestDestination.destination;
    const match = Array.isArray(flights)
      ? flights.find((f) => String(f?.destination || "") === String(dest || ""))
      : null;
    if (match && Array.isArray(match.flights)) return match.flights;
    return [];
  }, [bestDestination, flights]);

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
      if (diff > 0.5) {
        return `Es aproximadamente ${diff.toFixed(0)} € más barato que ${secondCode}.`;
      }
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

  const openBestDetails = () => {
    setShowBestDetails(true);
    setShowComplementary(false);
    setTimeout(() => {
      const el = document.getElementById("best-details-panel");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const cleanedOrigins = useMemo(() => {
    return (origins || [])
      .map((o) => String(o || "").trim().toUpperCase())
      .filter(Boolean);
  }, [origins]);

  const primarySkyscannerAction = () => {
    // Si hay un solo origen, abrimos directamente. Si hay varios, mostramos panel por origen.
    if (!bestDestination) return;
    const dep = bestDestination.bestDate || departureDate;
    const dest = bestDestination.destination;

    if (!cleanedOrigins.length || !dep || !dest) {
      openBestDetails();
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

    openBestDetails();
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

    if (tripType === "roundtrip") {
      lines.push(`Fechas: ${dep} -> ${returnDate}`);
    } else {
      lines.push(`Fecha: ${dep}`);
    }

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
        optimizeBy, // criterio usado en backend
        tripType,
        dateMode,
        flexDays: dateMode === "flex" ? flexDays : 0,
      };

      if (tripType === "roundtrip") body.returnDate = returnDate;

      if (budgetEnabled) {
        body.maxBudgetPerTraveler = Number(maxBudgetPerTraveler);
      }

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.message || errData.error || "Error al buscar vuelos."
        );
      }

      const data = await res.json();

      const flightsArr = Array.isArray(data.flights) ? data.flights : [];
      setFlights(flightsArr);

      // Calculamos best para ambos criterios con los mismos resultados
      const bestTotal =
        computeBestDestinationFromFlights(flightsArr, "total") ||
        data.bestDestination ||
        null;

      const bestFair = computeBestDestinationFromFlights(flightsArr, "fairness");

      const map = {
        total: bestTotal,
        fairness: bestFair,
      };

      setBestByCriterion(map);

      // Destino mostrado: el del toggle UI (por defecto total)
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

  const optimizeLabel =
    optimizeBy === "fairness"
      ? "equidad de precio entre el grupo"
      : "precio total del grupo";

  return (
    <div
      className="min-vh-100"
      style={{ backgroundColor: "#F3F8FF", color: "#1E293B" }}
    >
      <LoadingOverlay loading={loading} />

      <header className="bg-white border-bottom">
        <div className="container" style={{ maxWidth: "1100px" }}>
          <div
            className="d-flex align-items-center py-3"
            onClick={handleGoHome}
            style={{ cursor: "pointer" }}
          >
            <div
              className="rounded-circle d-flex align-items-center justify-content-center me-2"
              style={{
                width: 32,
                height: 32,
                backgroundColor: "#3B82F6",
                color: "white",
                fontWeight: 600,
                fontSize: "1.1rem",
              }}
            >
              F
            </div>
            <span className="fw-semibold">FlyndMe</span>
          </div>
        </div>
      </header>

      {!hasStarted ? (
        <>
          <section className="py-5 border-bottom border-secondary">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <div className="row align-items-center g-4">
                <div className="col-md-7">
                  <h1 className="display-5 fw-bold mb-3">
                    FlyndMe · El punto de encuentro perfecto
                  </h1>
                  <p className="lead mb-3 text-secondary">
                    Tres amigos, tres ciudades, un solo destino. FlyndMe calcula en
                    segundos a qué ciudad es más barato o más justo que vuele todo
                    el grupo.
                  </p>
                  <ul className="text-secondary mb-3">
                    <li>Introduce los aeropuertos de origen de cada persona.</li>
                    <li>Elegimos los mejores destinos comunes según tu criterio.</li>
                    <li>
                      Puedes elegir: ida o ida y vuelta, fechas flexibles o exactas,
                      y presupuesto máximo por persona.
                    </li>
                  </ul>
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      className="btn btn-primary btn-lg"
                      style={{ backgroundColor: "#3B82F6", borderColor: "#3B82F6" }}
                      onClick={loadDemo}
                      type="button"
                    >
                      Empezar a buscar vuelos
                    </button>
                  </div>
                </div>

                <div className="col-md-5">
                  <div
                    className="card bg-white border"
                    style={{ borderColor: "#D0D8E5" }}
                  >
                    <div className="card-body">
                      <h2 className="h5 mb-3">Pensado como producto real</h2>
                      <p className="text-secondary mb-2">
                        • <strong>Casos de uso:</strong> grupos de amigos, viajes de
                        empresa, eventos internacionales.
                      </p>
                      <p className="text-secondary mb-2">
                        • <strong>Diferencial:</strong> no solo encontramos lo más
                        barato, también el destino más equilibrado para todos.
                      </p>
                      <p className="text-secondary mb-0">
                        • <strong>Integrable:</strong> listo para conectarse con
                        Google Flights, Skyscanner o Kiwi.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="py-5">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <h2 className="h3 fw-bold mb-3">Preguntas frecuentes</h2>
              <p className="text-secondary mb-4">
                Todo lo que necesitas saber antes de buscar el mejor destino para tu grupo.
              </p>

              <div className="accordion" id="flyndmeFaq">
                <div className="accordion-item">
                  <h2 className="accordion-header" id="faqHead1">
                    <button
                      className="accordion-button"
                      type="button"
                      data-bs-toggle="collapse"
                      data-bs-target="#faq1"
                      aria-expanded="true"
                      aria-controls="faq1"
                    >
                      ¿Cómo funciona FlyndMe?
                    </button>
                  </h2>
                  <div
                    id="faq1"
                    className="accordion-collapse collapse show"
                    aria-labelledby="faqHead1"
                    data-bs-parent="#flyndmeFaq"
                  >
                    <div className="accordion-body text-secondary">
                      Introduces los aeropuertos de origen del grupo y una fecha. FlyndMe
                      compara precios y propone destinos donde todos pueden volar.
                    </div>
                  </div>
                </div>

                <div className="accordion-item">
                  <h2 className="accordion-header" id="faqHead2">
                    <button
                      className="accordion-button collapsed"
                      type="button"
                      data-bs-toggle="collapse"
                      data-bs-target="#faq2"
                      aria-expanded="false"
                      aria-controls="faq2"
                    >
                      ¿Qué significa “equidad”?
                    </button>
                  </h2>
                  <div
                    id="faq2"
                    className="accordion-collapse collapse"
                    aria-labelledby="faqHead2"
                    data-bs-parent="#flyndmeFaq"
                  >
                    <div className="accordion-body text-secondary">
                      Es una puntuación que mide lo parecidos que son los precios entre viajeros.
                      Cuanto más alta, más justo es el destino para el grupo.
                    </div>
                  </div>
                </div>

                <div className="accordion-item">
                  <h2 className="accordion-header" id="faqHead3">
                    <button
                      className="accordion-button collapsed"
                      type="button"
                      data-bs-toggle="collapse"
                      data-bs-target="#faq3"
                      aria-expanded="false"
                      aria-controls="faq3"
                    >
                      ¿Cómo funciona el presupuesto máximo?
                    </button>
                  </h2>
                  <div
                    id="faq3"
                    className="accordion-collapse collapse"
                    aria-labelledby="faqHead3"
                    data-bs-parent="#flyndmeFaq"
                  >
                    <div className="accordion-body text-secondary">
                      Solo se muestran destinos donde la <strong>media por persona</strong> no supera el
                      presupuesto indicado. Si no hay destinos dentro de ese límite, no se muestra ninguno.
                    </div>
                  </div>
                </div>

                <div className="accordion-item">
                  <h2 className="accordion-header" id="faqHead4">
                    <button
                      className="accordion-button collapsed"
                      type="button"
                      data-bs-toggle="collapse"
                      data-bs-target="#faq4"
                      aria-expanded="false"
                      aria-controls="faq4"
                    >
                      ¿FlyndMe vende billetes?
                    </button>
                  </h2>
                  <div
                    id="faq4"
                    className="accordion-collapse collapse"
                    aria-labelledby="faqHead4"
                    data-bs-parent="#flyndmeFaq"
                  >
                    <div className="accordion-body text-secondary">
                      No. FlyndMe te ayuda a decidir el destino. La reserva se hace en buscadores externos
                      como Skyscanner o Google Flights.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <main className="py-4">
          <div className="container" style={{ maxWidth: "960px" }}>
            {hasResults && !showSearchPanel ? (
              <>
                <section className="mb-3">
                  <div
                    className="card border-0"
                    style={{
                      backgroundColor: "#0B5ED7",
                      color: "white",
                      boxShadow: "0 18px 40px rgba(11,94,215,0.25)",
                    }}
                  >
                    <div className="card-body p-4 p-md-5">
                      <div className="row g-4 align-items-stretch">
                        <div className="col-md-7">
                          <div className="d-flex flex-column justify-content-between h-100">
                            <div>
                              <div
                                className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                                style={{ marginBottom: 10 }}
                              >
                                <div
                                  className="text-uppercase"
                                  style={{
                                    opacity: 0.9,
                                    fontSize: 12,
                                    letterSpacing: 0.4,
                                  }}
                                >
                                  Recomendación para el grupo
                                </div>

                                {/* TOGGLE UI CRITERIO (SIN NUEVA BÚSQUEDA) */}
                                <div className="btn-group btn-group-sm" role="group">
                                  <button
                                    type="button"
                                    className={`btn ${
                                      uiCriterion === "total"
                                        ? "btn-light"
                                        : "btn-outline-light"
                                    }`}
                                    onClick={() => handleToggleCriterion("total")}
                                  >
                                    Mejor precio total
                                  </button>
                                  <button
                                    type="button"
                                    className={`btn ${
                                      uiCriterion === "fairness"
                                        ? "btn-light"
                                        : "btn-outline-light"
                                    }`}
                                    onClick={() => handleToggleCriterion("fairness")}
                                  >
                                    Más equilibrado
                                  </button>
                                </div>
                              </div>

                              <h2 className="display-6 fw-bold mt-1 mb-2">
                                {bestDestination.destination}
                              </h2>

                              <div className="small mb-2" style={{ opacity: 0.95 }}>
                                Basado en{" "}
                                <strong>
                                  {uiCriterion === "fairness"
                                    ? "equilibrio entre viajeros"
                                    : "precio total del grupo"}
                                </strong>
                                {budgetEnabled ? (
                                  <>
                                    {" "}
                                    y con presupuesto máximo de{" "}
                                    <strong>
                                      {Number(maxBudgetPerTraveler).toFixed(0)} EUR
                                    </strong>{" "}
                                    por persona.
                                  </>
                                ) : (
                                  "."
                                )}
                              </div>

                              {/* POR QUÉ ESTE DESTINO */}
                              {bestExplanation && (
                                <div
                                  className="small mb-3"
                                  style={{
                                    background: "rgba(255,255,255,0.14)",
                                    border: "1px solid rgba(255,255,255,0.18)",
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    opacity: 0.98,
                                  }}
                                >
                                  <span className="fw-semibold">Por qué este destino:</span>{" "}
                                  {bestExplanation}
                                </div>
                              )}

                              <div className="mb-3">
                                <div
                                  className="fw-semibold"
                                  style={{ fontSize: 12, opacity: 0.95 }}
                                >
                                  Precio total estimado
                                </div>

                                <div className="d-flex align-items-end gap-2 flex-wrap">
                                  <div
                                    className="fw-bold"
                                    style={{ fontSize: 44, lineHeight: 1 }}
                                  >
                                    {normalizeNumber(bestDestination.totalCostEUR).toFixed(2)} €
                                  </div>

                                  <div
                                    className="small"
                                    style={{ opacity: 0.95, paddingBottom: 8 }}
                                  >
                                    {travelerCount > 0
                                      ? `para ${travelerCount} viajero${travelerCount > 1 ? "s" : ""}`
                                      : "para el grupo"}
                                  </div>
                                </div>
                              </div>

                              {Array.isArray(bestBreakdownFlights) &&
                                bestBreakdownFlights.length > 0 && (
                                  <div className="mb-3">
                                    <div
                                      className="fw-semibold"
                                      style={{ fontSize: 12, opacity: 0.95 }}
                                    >
                                      Coste por origen
                                    </div>

                                    <div className="d-flex flex-wrap gap-2 mt-2">
                                      {bestBreakdownFlights.map((f, i) => (
                                        <span
                                          key={i}
                                          className="badge bg-light text-dark"
                                          style={{
                                            border: "1px solid rgba(255,255,255,0.35)",
                                            padding: "8px 10px",
                                          }}
                                        >
                                          <span className="fw-semibold">
                                            {String(f.origin || "").toUpperCase()}
                                          </span>{" "}
                                          →{" "}
                                          <span className="fw-semibold">
                                            {bestDestination.destination}
                                          </span>{" "}
                                          <span style={{ opacity: 0.85 }}>·</span>{" "}
                                          <span className="fw-semibold">
                                            {typeof f.price === "number"
                                              ? `${f.price.toFixed(0)} €`
                                              : "sin datos"}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              <div className="row g-2 mt-1">
                                <div className="col-12 col-lg-6">
                                  <div
                                    className="p-3 rounded-3"
                                    style={{
                                      background: "rgba(255,255,255,0.12)",
                                      border: "1px solid rgba(255,255,255,0.18)",
                                    }}
                                  >
                                    <div className="small" style={{ opacity: 0.9 }}>
                                      Media por persona
                                    </div>
                                    <div className="fw-bold">
                                      {normalizeNumber(
                                        bestDestination.averageCostPerTraveler
                                      ).toFixed(2)}{" "}
                                      €
                                    </div>
                                  </div>
                                </div>

                                <div className="col-12 col-lg-6">
                                  <div
                                    className="p-3 rounded-3"
                                    style={{
                                      background: "rgba(255,255,255,0.12)",
                                      border: "1px solid rgba(255,255,255,0.18)",
                                    }}
                                  >
                                    <div className="small" style={{ opacity: 0.9 }}>
                                      Diferencia máxima entre viajeros
                                    </div>
                                    <div className="fw-bold">
                                      {normalizeNumber(bestDestination.priceSpread).toFixed(2)}{" "}
                                      €
                                    </div>
                                  </div>
                                </div>

                                <div className="col-12">
                                  <div
                                    className="p-3 rounded-3"
                                    style={{
                                      background: "rgba(255,255,255,0.12)",
                                      border: "1px solid rgba(255,255,255,0.18)",
                                    }}
                                  >
                                    <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                                      <div>
                                        <div className="small" style={{ opacity: 0.9 }}>
                                          Equilibrio entre viajeros
                                        </div>
                                        <div className="fw-bold">
                                          {normalizeNumber(bestDestination.fairnessScore).toFixed(0)}
                                          /100{" "}
                                          <span className="fw-normal" style={{ opacity: 0.95 }}>
                                            ({fairnessLabel(bestDestination.fairnessScore)})
                                          </span>
                                        </div>
                                        <div className="small" style={{ opacity: 0.9 }}>
                                          Cuanto más alto, más parecido paga cada viajero.
                                        </div>
                                      </div>

                                      <div className="small" style={{ opacity: 0.95 }}>
                                        <div>
                                          <strong>Viaje:</strong>{" "}
                                          {tripType === "roundtrip"
                                            ? "ida y vuelta"
                                            : "solo ida"}
                                        </div>
                                        <div>
                                          <strong>Salida:</strong>{" "}
                                          {dateMode === "flex"
                                            ? `flexible (±${flexDays} días), mejor fecha: ${
                                                formatDateEs(
                                                  bestDestination.bestDate || departureDate
                                                ) ||
                                                (bestDestination.bestDate || departureDate)
                                              }`
                                            : formatDateEs(departureDate) || departureDate}
                                        </div>

                                        {tripType === "roundtrip" && (
                                          <div>
                                            <strong>Vuelta:</strong>{" "}
                                            {formatDateEs(returnDate) || returnDate}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="small mt-3" style={{ opacity: 0.9 }}>
                                Precios estimados con la API de Amadeus. Pueden variar al reservar.
                              </div>
                            </div>

                            {/* CTAs: principal claro + secundarios */}
                            <div className="d-flex flex-wrap gap-2 mt-4">
                              <button
                                type="button"
                                className="btn btn-light fw-semibold"
                                onClick={primarySkyscannerAction}
                              >
                                Ver vuelos en Skyscanner
                              </button>

                              <button
                                type="button"
                                className="btn btn-outline-light"
                                onClick={openAlternatives}
                              >
                                Ver otros destinos
                              </button>

                              <button
                                type="button"
                                className="btn btn-outline-light"
                                onClick={handleShare}
                              >
                                Compartir
                              </button>

                              <button
                                type="button"
                                className="btn btn-link text-white text-decoration-none"
                                onClick={resetToSearch}
                                style={{ opacity: 0.95 }}
                              >
                                Cambiar búsqueda
                              </button>

                              {shareStatus === "ok" && (
                                <div className="small" style={{ opacity: 0.95, paddingTop: 8 }}>
                                  Copiado
                                </div>
                              )}
                              {shareStatus === "fail" && (
                                <div className="small" style={{ opacity: 0.95, paddingTop: 8 }}>
                                  No se pudo copiar
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="col-md-5">
                          <div
                            className="h-100"
                            style={{
                              borderRadius: 16,
                              overflow: "hidden",
                              border: "1px solid rgba(255,255,255,0.25)",
                              position: "relative",
                              minHeight: 240,
                              backgroundColor: "rgba(255,255,255,0.10)",
                            }}
                          >
                            <img
                              src={getDestinationLocalImage(bestDestination.destination)}
                              alt={`Foto de ${normalizeDestCode(bestDestination.destination)}`}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.src = getPlaceholderImage();
                              }}
                            />

                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                background:
                                  "linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.40) 100%)",
                              }}
                            />

                            <div
                              style={{
                                position: "absolute",
                                left: 12,
                                bottom: 10,
                                right: 12,
                                fontSize: 12,
                                opacity: 0.95,
                              }}
                            >
                              Imagen orientativa del destino
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="mb-4">
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={handleGoHome}
                    >
                      Volver a la landing
                    </button>
                  </div>

                  <div className="text-secondary small mt-2">
                    Las opciones avanzadas aparecen debajo para mantener el foco en el destino recomendado.
                  </div>
                </section>

                {showBestDetails && (
                  <section id="best-details-panel" className="mb-4">
                    <div
                      className="card bg-white border"
                      style={{ borderColor: "#D0D8E5" }}
                    >
                      <div className="card-body">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <h3 className="h6 fw-semibold mb-0">
                            Vuelos y detalles del destino recomendado
                          </h3>
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
                              <div className="fw-semibold">
                                {bestDestination.destination}
                              </div>
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
                                {tripType === "roundtrip"
                                  ? ` | Vuelta: ${formatDateEs(returnDate) || returnDate}`
                                  : ""}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="text-secondary small mb-2">
                            Abrir en Skyscanner por origen
                          </div>

                          {(() => {
                            const dep = bestDestination?.bestDate || departureDate;
                            const dest = bestDestination?.destination;

                            const o = (origins || [])
                              .map((x) => String(x || "").trim().toUpperCase())
                              .filter(Boolean);

                            if (!o.length || !dest || !dep) {
                              return (
                                <div className="text-secondary small">
                                  No hay datos suficientes para generar enlaces.
                                </div>
                              );
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
                                      className={`btn btn-primary btn-sm ${
                                        url ? "" : "disabled"
                                      }`}
                                      style={{
                                        backgroundColor: "#3B82F6",
                                        borderColor: "#3B82F6",
                                      }}
                                      onClick={(e) => {
                                        if (!url) e.preventDefault();
                                      }}
                                    >
                                      Ver vuelos {origin} → {normalizeDestCode(dest)}
                                    </a>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>

                        <div className="text-secondary small mt-2">
                          Skyscanner abre un enlace por origen (no existe un enlace único multi-origen).
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <section id="alternatives-panel" className="mb-4">
                  {showComplementary ? (
                    <div
                      className="card bg-white border"
                      style={{ borderColor: "#D0D8E5" }}
                    >
                      <div className="card-body">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <h3 className="h6 fw-semibold mb-0">
                            Otros destinos (alternativas)
                          </h3>
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
                          <div className="alert alert-warning py-2 mb-0">
                            No hay alternativas disponibles para mostrar.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-secondary small">
                      Alternativas ocultas para priorizar el destino recomendado.
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div
                className="card bg-white border mb-4"
                style={{ borderColor: "#D0D8E5" }}
              >
                <div className="card-body">
                  <div className="row g-4">
                    <div className="col-md-8">
                      <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                          <label className="form-label fw-semibold">
                            Aeropuertos de origen
                          </label>

                          {origins.map((origin, index) => (
                            <div
                              key={index}
                              className="d-flex align-items-center gap-2 mb-2"
                            >
                              <input
                                type="text"
                                className="form-control text-uppercase"
                                placeholder="Ej: MAD, BCN, LON..."
                                value={origin}
                                onChange={(e) =>
                                  handleOriginChange(index, e.target.value)
                                }
                                onFocus={() => setActiveOriginIndex(index)}
                                disabled={loading}
                              />
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => removeOrigin(index)}
                                disabled={origins.length <= 1 || loading}
                              >
                                ✕
                              </button>
                            </div>
                          ))}

                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm mt-1"
                            onClick={addOrigin}
                            disabled={loading}
                          >
                            + Añadir origen
                          </button>
                        </div>

                        <div className="mb-3">
                          <label className="form-label fw-semibold">
                            Tipo de viaje
                          </label>
                          <div className="d-flex flex-wrap gap-3">
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="tripType"
                                id="tripOneWay"
                                value="oneway"
                                checked={tripType === "oneway"}
                                onChange={() => setTripType("oneway")}
                                disabled={loading}
                              />
                              <label
                                className="form-check-label"
                                htmlFor="tripOneWay"
                              >
                                Solo ida
                              </label>
                            </div>

                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="tripType"
                                id="tripRound"
                                value="roundtrip"
                                checked={tripType === "roundtrip"}
                                onChange={() => setTripType("roundtrip")}
                                disabled={loading}
                              />
                              <label
                                className="form-check-label"
                                htmlFor="tripRound"
                              >
                                Ida y vuelta
                              </label>
                            </div>
                          </div>
                        </div>

                        <div className="mb-3">
                          <label className="form-label fw-semibold">Fechas</label>
                          <div className="d-flex flex-wrap gap-3">
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="dateMode"
                                id="dateExact"
                                value="exact"
                                checked={dateMode === "exact"}
                                onChange={() => setDateMode("exact")}
                                disabled={loading}
                              />
                              <label
                                className="form-check-label"
                                htmlFor="dateExact"
                              >
                                Concretas
                              </label>
                            </div>

                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="dateMode"
                                id="dateFlex"
                                value="flex"
                                checked={dateMode === "flex"}
                                onChange={() => setDateMode("flex")}
                                disabled={loading}
                              />
                              <label
                                className="form-check-label"
                                htmlFor="dateFlex"
                              >
                                Flexibles (±{flexDays} días)
                              </label>
                            </div>
                          </div>

                          {dateMode === "flex" && (
                            <div className="text-secondary small mt-1">
                              Buscamos el mejor resultado dentro de{" "}
                              {2 * flexDays + 1} fechas posibles.
                            </div>
                          )}
                        </div>

                        <div className="row g-3 mb-3">
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

                        <div className="mb-3">
                          <div className="d-flex justify-content-between align-items-center">
                            <label className="form-label fw-semibold mb-0">
                              Presupuesto máximo por persona
                            </label>
                            <div className="form-check form-switch">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="budgetSwitch"
                                checked={budgetEnabled}
                                onChange={(e) => setBudgetEnabled(e.target.checked)}
                                disabled={loading}
                              />
                              <label
                                className="form-check-label small"
                                htmlFor="budgetSwitch"
                              >
                                {budgetEnabled ? "Activado" : "Sin límite"}
                              </label>
                            </div>
                          </div>

                          {budgetEnabled && (
                            <div className="mt-2">
                              <div className="d-flex align-items-center gap-2">
                                <input
                                  type="range"
                                  className="form-range"
                                  min={BUDGET_MIN}
                                  max={BUDGET_MAX}
                                  step={BUDGET_STEP}
                                  value={maxBudgetPerTraveler}
                                  onChange={(e) =>
                                    setMaxBudgetPerTraveler(
                                      clampBudget(e.target.value)
                                    )
                                  }
                                  disabled={loading}
                                />
                                <div style={{ width: 120 }}>
                                  <div className="input-group input-group-sm">
                                    <input
                                      type="number"
                                      className="form-control"
                                      min={BUDGET_MIN}
                                      max={BUDGET_MAX}
                                      step={BUDGET_STEP}
                                      value={maxBudgetPerTraveler}
                                      onChange={(e) =>
                                        setMaxBudgetPerTraveler(
                                          clampBudget(e.target.value)
                                        )
                                      }
                                      disabled={loading}
                                    />
                                    <span className="input-group-text">EUR</span>
                                  </div>
                                </div>
                              </div>

                              <div className="d-flex justify-content-between text-secondary small mt-1">
                                <span>{BUDGET_MIN} EUR</span>
                                <span>{BUDGET_MAX} EUR</span>
                              </div>

                              <div className="text-secondary small mt-1">
                                Filtramos destinos cuya <strong>media por persona</strong> supere{" "}
                                <strong>{Number(maxBudgetPerTraveler).toFixed(0)} EUR</strong>.
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mb-3">
                          <label className="form-label fw-semibold">Optimizar por</label>
                          <div className="d-flex flex-wrap gap-3">
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="optimizeBy"
                                id="optTotal"
                                value="total"
                                checked={optimizeBy === "total"}
                                onChange={(e) => {
                                  setOptimizeBy(e.target.value);
                                  setUiCriterion(e.target.value);
                                }}
                                disabled={loading}
                              />
                              <label className="form-check-label" htmlFor="optTotal">
                                Precio total del grupo
                              </label>
                            </div>

                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="optimizeBy"
                                id="optFairness"
                                value="fairness"
                                checked={optimizeBy === "fairness"}
                                onChange={(e) => {
                                  setOptimizeBy(e.target.value);
                                  setUiCriterion(e.target.value);
                                }}
                                disabled={loading}
                              />
                              <label className="form-check-label" htmlFor="optFairness">
                                Equidad entre viajeros
                              </label>
                            </div>
                          </div>

                          <small className="text-secondary">
                            Actualmente estamos priorizando la {optimizeLabel}.
                          </small>
                        </div>

                        {error && <div className="alert alert-danger py-2">{error}</div>}

                        <div className="d-grid">
                          <SearchButton loading={loading}>
                            Buscar destinos comunes
                          </SearchButton>
                        </div>
                      </form>
                    </div>

                    <div className="col-md-4">
                      <div className="card h-100 border-0">
                        <div className="card-body p-3">
                          <h2 className="h6 mb-2">Aeropuertos disponibles</h2>
                          <p className="text-secondary small mb-2">
                            El listado se filtra según el campo activo. Haz clic para rellenarlo.
                          </p>

                          <div
                            className="table-responsive"
                            style={{ maxHeight: "260px", overflowY: "auto" }}
                          >
                            <table className="table table-sm mb-0">
                              <thead>
                                <tr>
                                  <th style={{ width: "70px" }}>Código</th>
                                  <th>Ciudad</th>
                                  <th className="text-end">País</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredAirports.map((a) => (
                                  <tr
                                    key={a.code}
                                    style={{ cursor: "pointer" }}
                                    onClick={() => !loading && handleClickSuggestion(a.code)}
                                  >
                                    <td className="fw-semibold">{a.code}</td>
                                    <td>{a.city}</td>
                                    <td className="text-end text-secondary small">
                                      {a.country}
                                    </td>
                                  </tr>
                                ))}
                                {filteredAirports.length === 0 && (
                                  <tr>
                                    <td colSpan={3} className="text-center text-secondary small">
                                      No hay aeropuertos que coincidan.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          <p className="text-secondary small mt-2 mb-0">
                            Consejo: cambia de campo y la tabla se adapta.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <footer className="mt-5 pt-3 border-top border-secondary">
              <p className="text-secondary small mb-1">
                FlyndMe es un prototipo funcional construido con React, Vite,
                Node.js, Express y la API de Amadeus.
              </p>
            </footer>
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
