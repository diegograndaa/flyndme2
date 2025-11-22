import { useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import FlightResults from "./components/FlightResults";

const API_URL =
  "https://flyndme-backend.onrender.com/api/flights/multi-origin";

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
  // Orígenes empiezan con dos campos vacíos
  const [origins, setOrigins] = useState(["", ""]);
  // Índice del campo de origen actualmente activo
  const [activeOriginIndex, setActiveOriginIndex] = useState(0);

  const [departureDate, setDepartureDate] = useState("");
  // const [nonStop, setNonStop] = useState(false);
  const [optimizeBy, setOptimizeBy] = useState("total");
  const [flights, setFlights] = useState([]);
  const [bestDestination, setBestDestination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  // Índice seguro para leer el valor que usará el filtro
  const safeActiveIndex =
    activeOriginIndex >= 0 && activeOriginIndex < origins.length
      ? activeOriginIndex
      : 0;

  const airportFilterValue = origins[safeActiveIndex] || "";
  const airportFilter = airportFilterValue.trim().toLowerCase();

  // Filtrado de la tabla según el campo activo
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
    setActiveOriginIndex(origins.length); // el nuevo campo pasa a ser el activo
  };

  const removeOrigin = (index) => {
    if (origins.length <= 1) return;
    setOrigins((prev) => {
      const copy = prev.filter((_, i) => i !== index);
      // Ajustar índice activo si hace falta
      if (activeOriginIndex >= copy.length) {
        setActiveOriginIndex(copy.length - 1 >= 0 ? copy.length - 1 : 0);
      }
      return copy;
    });
  };

  // Volver a la landing (logo arriba a la izquierda)
  const handleGoHome = () => {
    setHasStarted(false);
    setFlights([]);
    setBestDestination(null);
    setHasSearched(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // El botón de inicio solo activa la app y, si no hay fecha, propone una por defecto
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
    // Scroll suave al inicio de la pantalla de búsqueda
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

      // Opcional: al recibir resultados, bajar un poco para que se vean
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
    <div
      className="min-vh-100"
      style={{ backgroundColor: "#F3F8FF", color: "#1E293B" }}
    >
      {/* HEADER CON LOGO (clickable para volver atrás) */}
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

      {/* DOS PANTALLAS: si no ha empezado, landing; si ha empezado, buscador */}
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
                    <li>Introduce los aeropuertos de origen de cada persona.</li>
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
                      type="button"
                    >
                      Empezar a buscar vuelos
                    </button>
                    <span className="text-secondary align-self-center">
                      O escribe tus propios aeropuertos en la pantalla de
                      búsqueda 👇
                    </span>
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
                        • <strong>Casos de uso:</strong> grupos de amigos,
                        viajes de empresa, eventos internacionales.
                      </p>
                      <p className="text-secondary mb-2">
                        • <strong>Diferencial:</strong> no solo encontramos lo
                        más barato, también el destino más equilibrado para
                        todos.
                      </p>
                      <p className="text-secondary mb-0">
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

          {/* COMO FUNCIONA */}
          <section className="py-5">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <h2 className="h4 fw-semibold text-center mb-4">
                Cómo funciona FlyndMe
              </h2>
              <div className="row g-4">
                <div className="col-md-4">
                  <div className="h-100 text-center p-3 bg-white border rounded-3">
                    <div className="fs-3 mb-2">✍️</div>
                    <h3 className="h6 fw-semibold mb-2">
                      1. Indica los orígenes
                    </h3>
                    <p className="text-secondary small mb-0">
                      Añade los aeropuertos desde los que viaja cada persona.
                      Puedes mezclar ciudades y países sin problema.
                    </p>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="h-100 text-center p-3 bg-white border rounded-3">
                    <div className="fs-3 mb-2">🧮</div>
                    <h3 className="h6 fw-semibold mb-2">
                      2. Calculamos los destinos óptimos
                    </h3>
                    <p className="text-secondary small mb-0">
                      Analizamos combinaciones de vuelos para encontrar destinos
                      comunes que minimicen el coste o mejoren la equidad.
                    </p>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="h-100 text-center p-3 bg-white border rounded-3">
                    <div className="fs-3 mb-2">🤝</div>
                    <h3 className="h6 fw-semibold mb-2">
                      3. Elegís el punto de encuentro
                    </h3>
                    <p className="text-secondary small mb-0">
                      Comparad precios, equidad y enlaces directos a buscadores
                      de vuelos para cerrar la reserva en pocos clics.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* POR QUE FLYNDME */}
          <section className="py-5 bg-white border-top border-bottom">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <div className="row g-4 align-items-center">
                <div className="col-md-6">
                  <h2 className="h4 fw-semibold mb-3">Por qué FlyndMe</h2>
                  <ul className="text-secondary small mb-0">
                    <li className="mb-2">
                      <strong>Pensado para grupos distribuidos:</strong> amigos,
                      parejas a distancia, equipos remotos o estudiantes
                      Erasmus.
                    </li>
                    <li className="mb-2">
                      <strong>Más que el vuelo más barato:</strong> medimos la
                      equidad para que nadie pague muchísimo más que el resto.
                    </li>
                    <li className="mb-2">
                      <strong>Prototipo listo para producto:</strong> construido
                      con React, Node y Amadeus para integrarse en motores de
                      búsqueda de vuelos reales.
                    </li>
                    <li className="mb-0">
                      <strong>Transparente:</strong> ves el coste por origen,
                      medias por persona y resumen comparado entre destinos.
                    </li>
                  </ul>
                </div>
                <div className="col-md-6">
                  <div
                    className="p-3 border rounded-3"
                    style={{ backgroundColor: "#F3F8FF" }}
                  >
                    <p className="small text-secondary mb-2">Ejemplo rápido:</p>
                    <p className="small mb-2">
                      <strong>Orígenes:</strong> Madrid y Barcelona
                      <br />
                      <strong>Fecha:</strong> un fin de semana dentro de un mes
                    </p>
                    <p className="small mb-2">
                      FlyndMe podría recomendar{" "}
                      <strong>Lisboa</strong> como destino óptimo porque
                      combina:
                    </p>
                    <ul className="small text-secondary mb-0">
                      <li>Precio total más bajo para el grupo.</li>
                      <li>
                        Diferencia razonable entre quien más y quien menos paga.
                      </li>
                      <li>
                        Enlaces directos a Skyscanner, Kiwi y Google Flights.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* INTEGRACIONES */}
          <section className="py-4">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <div className="row align-items-center g-3">
                <div className="col-md-4">
                  <h2 className="h6 fw-semibold mb-2">
                    Diseñado para integrarse con buscadores de vuelos
                  </h2>
                  <p className="text-secondary small mb-0">
                    FlyndMe no sustituye a los grandes buscadores. Les añade una
                    capa de inteligencia para grupos que viven en ciudades
                    distintas.
                  </p>
                </div>
                <div className="col-md-8">
                  <div className="d-flex flex-wrap gap-2">
                    <span className="badge bg-white border text-secondary">
                      Google Flights
                    </span>
                    <span className="badge bg-white border text-secondary">
                      Skyscanner
                    </span>
                    <span className="badge bg-white border text-secondary">
                      Kiwi.com
                    </span>
                    <span className="badge bg-white border text-secondary">
                      Amadeus API
                    </span>
                    <span className="badge bg-white border text-secondary">
                      Otros motores de vuelo
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* PARA QUIEN ES */}
          <section className="py-5 bg-white border-top">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <h2 className="h4 fw-semibold text-center mb-4">
                ¿Para quién es FlyndMe?
              </h2>
              <div className="row g-4">
                <div className="col-md-3 col-6">
                  <div className="h-100 text-center p-3 border rounded-3">
                    <div className="fs-3 mb-1">👥</div>
                    <p className="small mb-0">
                      Grupos de amigos que viven en ciudades distintas.
                    </p>
                  </div>
                </div>
                <div className="col-md-3 col-6">
                  <div className="h-100 text-center p-3 border rounded-3">
                    <div className="fs-3 mb-1">💼</div>
                    <p className="small mb-0">
                      Equipos remotos que se reúnen unas pocas veces al año.
                    </p>
                  </div>
                </div>
                <div className="col-md-3 col-6">
                  <div className="h-100 text-center p-3 border rounded-3">
                    <div className="fs-3 mb-1">🎓</div>
                    <p className="small mb-0">
                      Estudiantes Erasmus o internacionales que planean
                      escapadas.
                    </p>
                  </div>
                </div>
                <div className="col-md-3 col-6">
                  <div className="h-100 text-center p-3 border rounded-3">
                    <div className="fs-3 mb-1">🏟️</div>
                    <p className="small mb-0">
                      Eventos, congresos o encuentros en un punto intermedio.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* FOOTER LANDING */}
          <footer className="py-4 border-top">
            <div className="container" style={{ maxWidth: "1100px" }}>
              <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start gap-2">
                <div className="small text-secondary">
                  <div className="fw-semibold">FlyndMe · MVP 2025</div>
                  <div>
                    Construido con React, Vite, Node.js, Express y la API de
                    Amadeus.
                  </div>
                </div>
                <div className="small text-secondary text-sm-end">
                  <div>
                    Proyecto personal orientado a integraciones con motores de
                    vuelos.
                  </div>
                  <div>
                    Ideal como concepto para Skyscanner, Kiwi o Google Flights.
                  </div>
                </div>
              </div>
            </div>
          </footer>
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
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm mt-1"
                            onClick={addOrigin}
                          >
                            + Añadir origen
                          </button>
                        </div>

                        {/* Fecha + opciones */}
                        <div className="row g-3 mb-3">
                          <div className="col-md-6">
                            <label className="form-label fw-semibold">
                              Fecha de salida
                            </label>
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
                          <small className="text-secondary">
                            Actualmente estamos priorizando la {optimizeLabel}.
                          </small>
                        </div>

                        {/* Error */}
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
                          <h2 className="h6 mb-2">Aeropuertos disponibles</h2>
                          <p className="text-secondary small mb-2">
                            El listado se filtra según el campo de origen que
                            tengas activo. Haz clic en una fila para rellenarlo.
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
                                    onClick={() =>
                                      handleClickSuggestion(a.code)
                                    }
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
                      color: "#1E293B",
                      borderWidth: "2px",
                    }}
                  >
                    <div className="card-body d-flex flex-column flex-md-row justify-content-between align-items-start gap-3">
                      <div>
                        <p className="text-uppercase text-secondary mb-1">
                          Mejor destino según{" "}
                          {optimizeBy === "fairness"
                            ? "equidad de precio"
                            : "precio total"}
                        </p>
                        <h2 className="h4 mb-1">
                          {bestDestination.destination}
                        </h2>
                        <p className="mb-1">
                          Coste medio por persona:{" "}
                          <strong>
                            {bestDestination.averageCostPerTraveler.toFixed(2)}{" "}
                            EUR
                          </strong>
                        </p>
                        <p className="mb-0">
                          Coste total del grupo:{" "}
                          <strong>
                            {bestDestination.totalCostEUR.toFixed(2)} EUR
                          </strong>
                        </p>
                      </div>
                      <div className="text-md-end">
                        <p className="mb-1">
                          Equidad (0-100):{" "}
                          <strong>{bestDestination.fairnessScore}</strong>
                        </p>
                        <p className="mb-0 text-secondary">
                          Diferencia entre quien más y quien menos paga:{" "}
                          <strong>
                            {bestDestination.priceSpread.toFixed(2)} EUR
                          </strong>
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* LISTADO DETALLADO DE DESTINOS */}
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

              {/* PIE */}
              <footer className="mt-5 pt-3 border-top border-secondary">
                <p className="text-secondary small mb-1">
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

