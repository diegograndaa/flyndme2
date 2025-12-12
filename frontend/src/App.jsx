import { useEffect, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
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

function App() {
  const [origins, setOrigins] = useState(["", ""]);
  const [activeOriginIndex, setActiveOriginIndex] = useState(0);

  const [departureDate, setDepartureDate] = useState("");
  const [optimizeBy, setOptimizeBy] = useState("total");
  const [flights, setFlights] = useState([]);
  const [bestDestination, setBestDestination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

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

  const handleGoHome = () => {
    setHasStarted(false);
    setFlights([]);
    setBestDestination(null);
    setHasSearched(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadDemo = () => {
    setHasStarted(true);
    if (!departureDate) {
      const today = new Date();
      const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      const yyyy = in30.getFullYear();
      const mm = String(in30.getMonth() + 1).padStart(2, "0");
      const dd = String(in30.getDate()).padStart(2, "0");
      setDepartureDate(`${yyyy}-${mm}-${dd}`);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setHasSearched(true);
    setFlights([]);
    setBestDestination(null);

    const cleanedOrigins = origins
      .map((o) => o.trim().toUpperCase())
      .filter(Boolean);

    if (!cleanedOrigins.length) {
      setError("Introduce al menos un aeropuerto de origen.");
      return;
    }
    if (!departureDate) {
      setError("Selecciona una fecha de salida.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origins: cleanedOrigins,
          departureDate,
          optimizeBy,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error al buscar vuelos.");
      }

      const data = await res.json();
      setFlights(data.flights || []);
      setBestDestination(data.bestDestination || null);

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error(err);
      setError(err.message || "Error inesperado al buscar vuelos.");
    } finally {
      setLoading(false);
    }
  };

  const optimizeLabel =
    optimizeBy === "fairness"
      ? "equidad de precio entre el grupo"
      : "precio total del grupo";

  return (
    <div className="min-vh-100" style={{ backgroundColor: "#F3F8FF", color: "#1E293B" }}>
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
          {/* Tu landing intacta */}
          {/* ... no cambio nada aquí ... */}
          <section className="py-5 border-bottom border-secondary">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <div className="row align-items-center g-4">
                <div className="col-md-7">
                  <h1 className="display-5 fw-bold mb-3">
                    FlyndMe · El punto de encuentro perfecto
                  </h1>
                  <p className="lead mb-3 text-secondary">
                    Tres amigos, tres ciudades, un solo destino. FlyndMe calcula en segundos a qué ciudad es más barato o más justo que vuele todo el grupo.
                  </p>
                  <ul className="text-secondary mb-3">
                    <li>Introduce los aeropuertos de origen de cada persona.</li>
                    <li>Elegimos los mejores destinos comunes según tu criterio.</li>
                    <li>Compara por precio total o por justicia entre viajeros.</li>
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
                    <span className="text-secondary align-self-center">
                      O escribe tus propios aeropuertos en la pantalla de búsqueda 👇
                    </span>
                  </div>
                </div>
                <div className="col-md-5">
                  <div className="card bg-white border" style={{ borderColor: "#D0D8E5" }}>
                    <div className="card-body">
                      <h2 className="h5 mb-3">Pensado como producto real</h2>
                      <p className="text-secondary mb-2">
                        • <strong>Casos de uso:</strong> grupos de amigos, viajes de empresa, eventos internacionales.
                      </p>
                      <p className="text-secondary mb-2">
                        • <strong>Diferencial:</strong> no solo encontramos lo más barato, también el destino más equilibrado para todos.
                      </p>
                      <p className="text-secondary mb-0">
                        • <strong>Integrable:</strong> este prototipo está pensado para conectarse con motores de búsqueda de vuelos como Google Flights, Skyscanner o Kiwi.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* El resto de tu landing sigue igual, no lo repito para no hacer el mensaje infinito */}
          {/* Si quieres, pega tu landing completa aquí tal cual estaba, no afecta al UX de búsqueda */}
        </>
      ) : (
        <>
          <main className="py-4">
            <div className="container" style={{ maxWidth: "960px" }}>
              <div className="card bg-white border mb-4" style={{ borderColor: "#D0D8E5" }}>
                <div className="card-body">
                  <div className="row g-4">
                    <div className="col-md-8">
                      <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                          <label className="form-label fw-semibold">
                            Aeropuertos de origen
                          </label>
                          {origins.map((origin, index) => (
                            <div key={index} className="d-flex align-items-center gap-2 mb-2">
                              <input
                                type="text"
                                className="form-control text-uppercase"
                                placeholder="Ej: MAD, BCN, LON..."
                                value={origin}
                                onChange={(e) => handleOriginChange(index, e.target.value)}
                                onFocus={() => setActiveOriginIndex(index)}
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

                        <div className="row g-3 mb-3">
                          <div className="col-md-6">
                            <label className="form-label fw-semibold">
                              Fecha de salida
                            </label>
                            <input
                              type="date"
                              className="form-control"
                              value={departureDate}
                              onChange={(e) => setDepartureDate(e.target.value)}
                              disabled={loading}
                            />
                          </div>
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
                            El listado se filtra según el campo de origen que tengas activo. Haz clic en una fila para rellenarlo.
                          </p>

                          <div className="table-responsive" style={{ maxHeight: "260px", overflowY: "auto" }}>
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
                                    <td className="text-end text-secondary small">{a.country}</td>
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
                            Consejo: puedes ir cambiando de campo de origen y la tabla se adaptará a lo que escribas en ese campo.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {!loading && !error && bestDestination && (
                <section className="mb-4">
                  <div
                    className="card"
                    style={{
                      backgroundColor: "#EBF2FF",
                      borderColor: "#3B82F6",
                      color: "#1E293B",
                      borderWidth: "2px",
                    }}
                  >
                    <div className="card-body d-flex flex-column flex-md-row justify-content-between align-items-start gap-3">
                      <div>
                        <p className="text-uppercase text-secondary mb-1">
                          Mejor destino según{" "}
                          {optimizeBy === "fairness" ? "equidad de precio" : "precio total"}
                        </p>
                        <h2 className="h4 mb-1">{bestDestination.destination}</h2>
                        <p className="mb-1">
                          Coste medio por persona:{" "}
                          <strong>{bestDestination.averageCostPerTraveler.toFixed(2)} EUR</strong>
                        </p>
                        <p className="mb-0">
                          Coste total del grupo:{" "}
                          <strong>{bestDestination.totalCostEUR.toFixed(2)} EUR</strong>
                        </p>
                      </div>
                      <div className="text-md-end">
                        <p className="mb-1">
                          Equidad (0-100): <strong>{bestDestination.fairnessScore}</strong>
                        </p>
                        <p className="mb-0 text-secondary">
                          Diferencia entre quien más y quien menos paga:{" "}
                          <strong>{bestDestination.priceSpread.toFixed(2)} EUR</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              <FlightResults
                flights={flights}
                optimizeBy={optimizeBy}
                hasSearched={hasSearched}
                loading={loading}
                error={error}
                origins={origins}
                bestDestination={bestDestination}
                flexRange={null}
                departureDate={departureDate}
              />

              <footer className="mt-5 pt-3 border-top border-secondary">
                <p className="text-secondary small mb-1">
                  FlyndMe es un prototipo funcional construido con React, Vite, Node.js, Express y la API de Amadeus. Está pensado como concepto de producto para motores de búsqueda de vuelos.
                </p>
              </footer>
            </div>
          </main>
        </>
      )}
    </div>
  );
}

export default App;
