import { useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

const API_URL = "https://flyndme-backend.onrender.com/api/flights/multi-origin";

import FlightResults from "./components/FlightResults";

const AVAILABLE_AIRPORTS = [
  { code: "MAD", city: "Madrid", country: "España" },
  { code: "BCN", city: "Barcelona", country: "España" },
  { code: "LON", city: "Londres", country: "Reino Unido" },
  { code: "PAR", city: "París", country: "Francia" },
  { code: "ROM", city: "Roma", country: "Italia" },
  { code: "MIL", city: "Milán", country: "Italia" },
  { code: "LIS", city: "Lisboa", country: "Portugal" },
  { code: "AMS", city: "Ámsterdam", country: "Países Bajos" },
  { code: "BRU", city: "Bruselas", country: "Bélgica" },
  { code: "BER", city: "Berlín", country: "Alemania" },
  { code: "MUC", city: "Múnich", country: "Alemania" },
  { code: "VIE", city: "Viena", country: "Austria" },
  { code: "ZRH", city: "Zúrich", country: "Suiza" },
  { code: "CPH", city: "Copenhague", country: "Dinamarca" },
  { code: "OSL", city: "Oslo", country: "Noruega" },
  { code: "STO", city: "Estocolmo", country: "Suecia" },
  { code: "DUB", city: "Dublín", country: "Irlanda" },
  { code: "ATH", city: "Atenas", country: "Grecia" },
  { code: "IST", city: "Estambul", country: "Turquía" },
  { code: "PRG", city: "Praga", country: "Chequia" },
  { code: "BUD", city: "Budapest", country: "Hungría" },
  { code: "WAW", city: "Varsovia", country: "Polonia" },
  { code: "HEL", city: "Helsinki", country: "Finlandia" },
  { code: "EDI", city: "Edimburgo", country: "Reino Unido" },
  { code: "MAN", city: "Mánchester", country: "Reino Unido" },
  { code: "GLA", city: "Glasgow", country: "Reino Unido" },
  { code: "NCE", city: "Niza", country: "Francia" },
  { code: "LYS", city: "Lyon", country: "Francia" },
  { code: "MAR", city: "Marsella", country: "Francia" },
  { code: "BCN", city: "Barcelona", country: "España" },
  { code: "SVQ", city: "Sevilla", country: "España" },
  { code: "AGP", city: "Málaga", country: "España" },
  { code: "PMI", city: "Palma de Mallorca", country: "España" },
  { code: "IBZ", city: "Ibiza", country: "España" },
  { code: "TFS", city: "Tenerife Sur", country: "España" },
  { code: "LPA", city: "Gran Canaria", country: "España" },
  { code: "FAO", city: "Faro", country: "Portugal" },
  { code: "OPO", city: "Oporto", country: "Portugal" },
  { code: "MXP", city: "Milán Malpensa", country: "Italia" },
  { code: "LIN", city: "Milán Linate", country: "Italia" },
  { code: "NAP", city: "Nápoles", country: "Italia" },
  { code: "FLR", city: "Florencia", country: "Italia" },
  { code: "PSA", city: "Pisa", country: "Italia" },
];

function App() {
  const [origins, setOrigins] = useState(["MAD", "BCN"]);
  const [activeOriginIndex, setActiveOriginIndex] = useState(0);

  const [departureDate, setDepartureDate] = useState("");
  const [optimizeBy, setOptimizeBy] = useState("total");
  const [flights, setFlights] = useState([]);
  const [bestDestination, setBestDestination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

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
      }
      return copy;
    });
  };

  const handleOriginChange = (index, value) => {
    const newOrigins = [...origins];
    newOrigins[index] = value.toUpperCase();
    setOrigins(newOrigins);
    setActiveOriginIndex(index);
  };

  const addOrigin = () => {
    if (origins.length >= 4) return;
    setOrigins([...origins, ""]);
    setActiveOriginIndex(origins.length);
  };

  const removeOrigin = (index) => {
    if (origins.length <= 1) return;

    const newOrigins = origins.filter((_, i) => i !== index);
    setOrigins(newOrigins);

    if (activeOriginIndex >= newOrigins.length) {
      setActiveOriginIndex(newOrigins.length - 1);
    }
  };

  const loadDemo = () => {
    setOrigins(["MAD", "BCN", "LON"]);
    setDepartureDate("2025-12-22");
    setOptimizeBy("total");
    setHasStarted(true);
    setHasSearched(false);
    setFlights([]);
    setBestDestination(null);
    setError("");
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
        const errData = await res.json().catch(() => null);
        console.error("Error en respuesta backend", errData);
        throw new Error(
          errData?.message ||
            errData?.error ||
            "No se pudo obtener resultados. Inténtalo de nuevo."
        );
      }

      const data = await res.json();

      if (!data || !data.flights || !data.bestDestination) {
        throw new Error(
          "El backend no ha devuelto resultados válidos. Revisa la configuración."
        );
      }

      setFlights(data.flights);
      setBestDestination(data.bestDestination);
    } catch (err) {
      console.error(err);
      setError(
        err.message ||
          "Ha ocurrido un error al buscar vuelos. Inténtalo de nuevo."
      );
    } finally {
      setLoading(false);
    }
  };

  const titleOptimizeText =
    optimizeBy === "fairness"
      ? "equidad de precio entre el grupo"
      : "precio total del grupo";

  return (
    <div
      className="min-vh-100"
      style={{ backgroundColor: "#F3F8FF", color: "#1E293B" }}
    >
      <header className="bg-white border-bottom">
        <nav className="navbar">
          <div className="container" style={{ maxWidth: "1100px" }}>
            <a href="#" className="navbar-brand d-flex align-items-center gap-2">
              <span
                className="rounded-circle d-inline-flex align-items-center justify-content-center fw-semibold"
                style={{
                  width: "32px",
                  height: "32px",
                  fontSize: "1.1rem",
                  backgroundColor: "#1D4ED8",
                  color: "white",
                }}
              >
                F
              </span>
              <span className="fw-semibold">FlyndMe</span>
            </a>
          </div>
        </nav>
      </header>

      {!hasStarted ? (
        <>
          {/* HERO / LANDING */}
          <section className="py-5 border-bottom border-secondary">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <div className="row align-items-center g-4">
                <div className="col-md-7">
                  <h1 className="display-5 fw-bold mb-3">
                    FlyndMe · El punto de encuentro perfecto
                  </h1>
                  <p className="lead mb-3 text-secondary">
                    Tres amigos, tres ciudades, un solo destino. FlyndMe
                    calcula en segundos a qué ciudad es más barato o más justo
                    que vuele todo el grupo.
                  </p>
                  <ul className="text-secondary mb-3">
                    <li>
                      Introduce los aeropuertos de origen de cada persona.
                    </li>
                    <li>
                      Elegimos los mejores destinos comunes según tu criterio.
                    </li>
                    <li>
                      Compara por precio total o por justicia entre viajeros.
                    </li>
                  </ul>
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      className="btn btn-primary btn-lg"
                      style={{
                        backgroundColor: "#3B82F6",
                        borderColor: "#3B82F6",
                      }}
                      onClick={loadDemo}
                    >
                      Empezar a buscar vuelos
                    </button>
                    <button
                      className="btn btn-outline-secondary"
                      onClick={() => setHasStarted(true)}
                    >
                      Escribir mis propios aeropuertos
                    </button>
                  </div>
                </div>

                <div className="col-md-5">
                  <div
                    className="card border-0 shadow-sm"
                    style={{ borderRadius: "18px" }}
                  >
                    <div className="card-body">
                      <h2 className="h5 fw-semibold mb-3">
                        Pensado como producto real
                      </h2>
                      <p className="mb-2 small text-secondary">
                        • <strong>Casos de uso:</strong> grupos de amigos,
                        viajes de empresa, eventos internacionales.
                      </p>
                      <p className="mb-2 small text-secondary">
                        • <strong>Diferencial:</strong> no solo encontramos lo
                        más barato, también el destino más equilibrado para
                        todos.
                      </p>
                      <p className="mb-0 small text-secondary">
                        • <strong>Integrable:</strong> este prototipo está
                        pensado para conectarse con motores de búsqueda de
                        vuelos como Google Flights, Skyscanner o Kiwi.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* MAIN APP */}
          <main className="py-4">
            <div className="container" style={{ maxWidth: "960px" }}>
              {/* FORMULARIO PRINCIPAL */}
              <div
                className="card bg-white border mb-4"
                style={{ borderColor: "#D0D8E5" }}
              >
                <div className="card-body">
                  <div className="row g-4">
                    {/* Columna izquierda: formulario */}
                    <div className="col-md-8">
                      <form onSubmit={handleSubmit}>
                        {/* Orígenes */}
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
                              />
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => removeOrigin(index)}
                                disabled={origins.length <= 1}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          {origins.length < 4 && (
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm mt-1"
                              onClick={addOrigin}
                            >
                              + Añadir origen
                            </button>
                          )}
                          <p className="text-secondary small mt-2 mb-0">
                            Truco: puedes escribir directamente abreviaturas
                            como MAD, BCN, LON o hacer clic en la tabla de la
                            derecha.
                          </p>
                        </div>

                        {/* Fecha de salida y directos */}
                        <div className="mb-3">
                          <label className="form-label fw-semibold">
                            Fecha de salida
                          </label>
                          <div className="row g-3 align-items-center">
                            <div className="col-md-6">
                              <input
                                type="date"
                                className="form-control"
                                value={departureDate}
                                onChange={(e) =>
                                  setDepartureDate(e.target.value)
                                }
                              />
                            </div>
                          </div>
                        </div>

                        {/* Optimización */}
                        <div className="mb-3">
                          <label className="form-label fw-semibold">
                            Optimizar por
                          </label>
                          <div className="d-flex flex-wrap gap-3">
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="optimizeBy"
                                id="optTotal"
                                value="total"
                                checked={optimizeBy === "total"}
                                onChange={(e) =>
                                  setOptimizeBy(e.target.value)
                                }
                              />
                              <label
                                className="form-check-label"
                                htmlFor="optTotal"
                              >
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
                                onChange={(e) =>
                                  setOptimizeBy(e.target.value)
                                }
                              />
                              <label
                                className="form-check-label"
                                htmlFor="optFairness"
                              >
                                Equidad entre viajeros
                              </label>
                            </div>
                          </div>
                          <p className="text-secondary small mt-2 mb-0">
                            Actualmente estamos priorizando la{" "}
                            <strong>{titleOptimizeText}</strong>.
                          </p>
                        </div>

                        {/* Mensajes de error */}
                        {error && (
                          <div className="alert alert-danger py-2">
                            {error}
                          </div>
                        )}

                        {/* Botón */}
                        <div className="d-grid">
                          <button
                            type="submit"
                            className="btn btn-primary btn-lg"
                            style={{
                              backgroundColor: "#3B82F6",
                              borderColor: "#3B82F6",
                            }}
                            disabled={loading}
                          >
                            {loading
                              ? "Buscando destinos..."
                              : "Buscar destinos comunes"}
                          </button>
                        </div>
                      </form>
                    </div>

                    {/* Columna derecha: tabla de aeropuertos */}
                    <div className="col-md-4">
                      <div className="card h-100 border-0">
                        <div className="card-body p-3">
                          <h2 className="h6 mb-2">
                            Aeropuertos disponibles
                          </h2>
                          <p className="text-secondary small mb-2">
                            El listado se filtra según el campo de origen que
                            tengas activo. Haz clic en una fila para rellenarlo.
                          </p>

                          <div
                            className="table-responsive"
                            style={{
                              maxHeight: "260px",
                              overflowY: "auto",
                            }}
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
                                    onClick={() =>
                                      handleClickSuggestion(a.code)
                                    }
                                  >
                                    <td className="text-uppercase fw-semibold">
                                      {a.code}
                                    </td>
                                    <td>{a.city}</td>
                                    <td className="text-end text-secondary small">
                                      {a.country}
                                    </td>
                                  </tr>
                                ))}
                                {filteredAirports.length === 0 && (
                                  <tr>
                                    <td
                                      colSpan={3}
                                      className="text-center text-secondary small"
                                    >
                                      No hay aeropuertos que coincidan.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          <p className="text-secondary small mt-2 mb-0">
                            Consejo: puedes ir cambiando de campo de origen y la
                            tabla se adaptará a lo que escribas en ese campo.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RESUMEN DEL MEJOR DESTINO */}
              {!loading && !error && bestDestination && (
                <section className="mb-4">
                  <div
                    className="card"
                    style={{
                      backgroundColor: "#EBF2FF",
                      borderColor: "#3B82F6",
                    }}
                  >
                    <div className="card-body">
                      <h2 className="h5 mb-3">
                        Mejor destino común para el grupo
                      </h2>
                      <p className="mb-2">
                        <strong>
                          {bestDestination.destination.city} (
                          {bestDestination.destination.code})
                        </strong>{" "}
                        parece el mejor punto de encuentro para vuestro grupo.
                      </p>
                      <p className="mb-2 text-secondary small">
                        Hemos tenido en cuenta el criterio seleccionado:
                        <strong> {titleOptimizeText}</strong>.
                      </p>
                      <p className="mb-0 text-secondary small">
                        En la tabla de abajo puedes ver el detalle de vuelos
                        por persona.
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {/* RESULTADOS DE VUELOS */}
              <section className="mb-5">
                <h2 className="h5 mb-3">
                  Resultados de vuelos por destino y viajero
                </h2>
                <FlightResults
                  flights={flights}
                  loading={loading}
                  error={error}
                  hasSearched={hasSearched}
                />
              </section>

              {/* PIE DE EXPLICACIÓN */}
              <footer className="pb-4 pt-2 border-top border-light">
                <p className="text-secondary small mb-1">
                  FlyndMe es un experimento de producto que explora cómo ayudar
                  a grupos de personas en ciudades distintas a encontrar el
                  mejor punto de encuentro.
                </p>
                <p className="text-secondary small mb-0">
                  FlyndMe es un prototipo funcional construido con React, Vite,
                  Node.js, Express y la API de Amadeus. Está pensado como
                  concepto de producto para motores de búsqueda de vuelos que
                  quieran ofrecer opciones de encuentro inteligente para grupos.
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
