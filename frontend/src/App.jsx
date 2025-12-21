import React from "react";
import { useEffect, useMemo, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js"; // ✅ IMPORTANTE para que funcione el accordion (collapse)
import FlightResults from "./components/FlightResults";
import { LoadingOverlay, SearchButton } from "./components/SearchUX";

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

// ✅ NUEVO: imágenes por destino (para resultado)
const DESTINATION_META = {
  LON: { label: "London", query: "london,city,skyline" },
  PAR: { label: "Paris", query: "paris,eiffel,city" },
  AMS: { label: "Amsterdam", query: "amsterdam,canals,city" },
  ROM: { label: "Rome", query: "rome,colosseum,city" },
  BCN: { label: "Barcelona", query: "barcelona,sagrada,familia,city" },
  BER: { label: "Berlin", query: "berlin,city" },
  LIS: { label: "Lisbon", query: "lisbon,city" },
  DUB: { label: "Dublin", query: "dublin,city" },
  MIL: { label: "Milan", query: "milan,duomo,city" },
  VIE: { label: "Vienna", query: "vienna,city" },
};

function getDestinationImageUrl(destCode, seed = "") {
  const code = String(destCode || "").trim().toUpperCase();
  const meta = DESTINATION_META[code];
  const query = meta?.query || `${code},city`;
  const sig = `${code}-${seed || "default"}`;

  // Imagen dinámica desde Unsplash (sin API key)
  return `https://source.unsplash.com/1200x675/?${encodeURIComponent(
    query
  )}&sig=${encodeURIComponent(sig)}`;
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

  // tipo de viaje y modo fechas
  const [tripType, setTripType] = useState("oneway"); // "oneway" | "roundtrip"
  const [dateMode, setDateMode] = useState("exact"); // "exact" | "flex"
  const flexDays = 3;

  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");

  const [optimizeBy, setOptimizeBy] = useState("total");

  const [flights, setFlights] = useState([]);
  const [bestDestination, setBestDestination] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [hasSearched, setHasSearched] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const [showSearchPanel, setShowSearchPanel] = useState(true);
  const [showComplementary, setShowComplementary] = useState(false);
  const [showBestDetails, setShowBestDetails] = useState(false);

  // ✅ NUEVO: Presupuesto máximo por persona
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [maxBudgetPerTraveler, setMaxBudgetPerTraveler] = useState(150);

  // límites y pasos del slider (ajústalos si quieres)
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleGoHome = () => {
    setHasStarted(false);
    setFlights([]);
    setBestDestination(null);
    setHasSearched(false);
    setError("");
    setShowSearchPanel(true);
    setShowComplementary(false);
    setShowBestDetails(false);
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
    };
  };

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setHasSearched(true);

    setFlights([]);
    setBestDestination(null);

    setShowComplementary(false);
    setShowBestDetails(false);

    const cleanedOrigins = origins
      .map((o) => o.trim().toUpperCase())
      .filter(Boolean);

    if (!cleanedOrigins.length) {
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

    // Validación presupuesto
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
        origins: cleanedOrigins,
        departureDate,
        optimizeBy,
        tripType,
        dateMode,
        flexDays: dateMode === "flex" ? flexDays : 0,
      };

      if (tripType === "roundtrip") body.returnDate = returnDate;

      // ✅ Enviar presupuesto solo si está activado
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

      const best =
        data.bestDestination ||
        computeBestDestinationFromFlights(flightsArr, optimizeBy);
      setBestDestination(best);

      if (!flightsArr.length || !best) {
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

  const normalizeNumber = (v) => Number(v || 0);

  const clampBudget = (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return BUDGET_MIN;
    return Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, n));
  };

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
          {/* LANDING PRINCIPAL */}
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

          {/* FAQS */}
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
                      {/* ✅ NUEVO: layout con imagen a la derecha */}
                      <div className="row g-3 align-items-stretch">
                        <div className="col-md-7">
                          <div className="d-flex flex-column justify-content-between h-100">
                            <div>
                              <div
                                className="text-uppercase"
                                style={{
                                  opacity: 0.9,
                                  fontSize: 12,
                                  letterSpacing: 0.4,
                                }}
                              >
                                Mejor destino según{" "}
                                {optimizeBy === "fairness"
                                  ? "equidad"
                                  : "precio total"}
                              </div>

                              <h2 className="display-6 fw-bold mt-2 mb-3">
                                {bestDestination.destination}
                              </h2>

                              <div className="d-flex flex-wrap gap-2">
                                <span className="badge bg-light text-dark">
                                  Coste total:{" "}
                                  {normalizeNumber(
                                    bestDestination.totalCostEUR
                                  ).toFixed(2)}{" "}
                                  EUR
                                </span>
                                <span className="badge bg-light text-dark">
                                  Media por persona:{" "}
                                  {normalizeNumber(
                                    bestDestination.averageCostPerTraveler
                                  ).toFixed(2)}{" "}
                                  EUR
                                </span>
                                <span className="badge bg-light text-dark">
                                  Equidad:{" "}
                                  {normalizeNumber(
                                    bestDestination.fairnessScore
                                  ).toFixed(0)}
                                  /100
                                </span>
                                <span className="badge bg-light text-dark">
                                  Diferencia máx.:{" "}
                                  {normalizeNumber(
                                    bestDestination.priceSpread
                                  ).toFixed(2)}{" "}
                                  EUR
                                </span>

                                {budgetEnabled && (
                                  <span className="badge bg-warning text-dark">
                                    Presupuesto máx/persona:{" "}
                                    {Number(maxBudgetPerTraveler).toFixed(0)} EUR
                                  </span>
                                )}
                              </div>

                              <div className="mt-3 small" style={{ opacity: 0.95 }}>
                                <div>
                                  <strong>Viaje:</strong>{" "}
                                  {tripType === "roundtrip"
                                    ? "Ida y vuelta"
                                    : "Solo ida"}
                                </div>
                                <div>
                                  <strong>Fechas:</strong>{" "}
                                  {dateMode === "flex"
                                    ? `Flexibles (±${flexDays} días). Mejor fecha: ${
                                        bestDestination.bestDate || departureDate
                                      }`
                                    : `Concretas (${departureDate}${
                                        tripType === "roundtrip"
                                          ? ` → ${returnDate}`
                                          : ""
                                      })`}
                                </div>
                              </div>
                            </div>

                            <div className="d-flex flex-wrap gap-2 mt-3">
                              <button
                                type="button"
                                className="btn btn-light fw-semibold"
                                onClick={resetToSearch}
                              >
                                Cambiar búsqueda
                              </button>

                              <button
                                type="button"
                                className="btn btn-outline-light"
                                onClick={openAlternatives}
                              >
                                Ver alternativas
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* ✅ NUEVO: imagen destino */}
                        <div className="col-md-5">
                          <div
                            className="h-100"
                            style={{
                              borderRadius: 16,
                              overflow: "hidden",
                              border: "1px solid rgba(255,255,255,0.25)",
                              position: "relative",
                              minHeight: 220,
                            }}
                          >
                            <img
                              src={getDestinationImageUrl(
                                bestDestination.destination,
                                bestDestination.bestDate || departureDate || ""
                              )}
                              alt={`Foto de ${bestDestination.destination}`}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                              loading="lazy"
                            />
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                background:
                                  "linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.35) 100%)",
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
                      {/* ✅ FIN NUEVO layout */}
                    </div>
                  </div>
                </section>

                <section className="mb-4">
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={openBestDetails}
                    >
                      Ver detalles del mejor destino
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={resetToSearch}
                    >
                      Nueva búsqueda
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={handleGoHome}
                    >
                      Volver a la landing
                    </button>
                  </div>

                  <div className="text-secondary small mt-2">
                    Las opciones avanzadas quedan debajo para mantener el foco en el
                    destino recomendado.
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
                            Detalles del mejor destino (complementario)
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
                              <div className="text-secondary small">Mejor fecha</div>
                              <div className="fw-semibold">
                                {bestDestination.bestDate || departureDate}
                                {tripType === "roundtrip" &&
                                (bestDestination.bestReturnDate || returnDate)
                                  ? ` → ${
                                      bestDestination.bestReturnDate || returnDate
                                    }`
                                  : ""}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="text-secondary small mt-3">
                          Ya puedes abrir links de buscadores con la mejor fecha
                          seleccionada automáticamente.
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
                            Alternativas (complementario)
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

                        {/* SOLO IDA vs IDA Y VUELTA */}
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

                        {/* FECHAS EXACTAS vs FLEX */}
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

                        {/* ✅ PRESUPUESTO */}
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
                                onChange={(e) => setOptimizeBy(e.target.value)}
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
                                onChange={(e) => setOptimizeBy(e.target.value)}
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
