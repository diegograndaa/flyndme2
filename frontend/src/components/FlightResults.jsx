import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";

function getFairnessStyle(score) {
  if (score >= 85) return { color: "#16A34A", fontWeight: "600" };
  if (score >= 65) return { color: "#3B82F6", fontWeight: "600" };
  if (score >= 45) return { color: "#FACC15", fontWeight: "600" };
  return { color: "#DC2626", fontWeight: "600" };
}

// Helper para construir links a comparadores
function buildBookingLinks(origin, destination, rawDate) {
  const safeOrigin = encodeURIComponent(origin);
  const safeDest = encodeURIComponent(destination);

  const hasDate = Boolean(rawDate);
  const safeDate = hasDate ? rawDate : "";
  const dateCompact = hasDate ? safeDate.replace(/-/g, "") : "";

  // Skyscanner
  const skyscanner = hasDate
    ? `https://www.skyscanner.es/transporte/vuelos/${safeOrigin}/${safeDest}/${dateCompact}/`
    : `https://www.skyscanner.es/transporte/vuelos/${safeOrigin}/${safeDest}/`;

  // Kiwi
  const kiwi = hasDate
    ? `https://www.kiwi.com/es/search/results/${safeOrigin}/${safeDest}/${safeDate}/`
    : `https://www.kiwi.com/es/search/results/${safeOrigin}/${safeDest}/`;

  // Google Flights: busqueda textual
  const queryText = hasDate
    ? `Vuelos de ${origin} a ${destination} el ${safeDate}`
    : `Vuelos de ${origin} a ${destination}`;

  const google = `https://www.google.com/travel/flights?q=${encodeURIComponent(
    queryText
  )}`;

  return { skyscanner, kiwi, google };
}

// Generar texto para compartir en grupo
function buildVotingText(flights) {
  let text = "📊 Opciones para el viaje:\n\n";

  flights.slice(0, 5).forEach((dest, i) => {
    text += `${i + 1}) ${dest.destination} · ${dest.averageCostPerTraveler.toFixed(
      0
    )} € por persona\n`;
  });

  text += "\nVotad con un numero -> 1, 2 o 3";
  return text;
}

// Frase resumen para comparativa cuando hay exactamente 2 destinos
function describeComparison(destA, destB, optimizeBy) {
  let better;
  if (optimizeBy === "fairness") {
    if (destA.fairnessScore !== destB.fairnessScore) {
      better = destA.fairnessScore > destB.fairnessScore ? destA : destB;
    } else {
      better = destA.totalCostEUR <= destB.totalCostEUR ? destA : destB;
    }
  } else if (optimizeBy === "co2") {
    const aCo2 = destA.approxCo2Score ?? Infinity;
    const bCo2 = destB.approxCo2Score ?? Infinity;
    if (aCo2 !== bCo2) {
      better = aCo2 < bCo2 ? destA : destB;
    } else {
      better = destA.totalCostEUR <= destB.totalCostEUR ? destA : destB;
    }
  } else {
    // total
    if (destA.totalCostEUR !== destB.totalCostEUR) {
      better = destA.totalCostEUR < destB.totalCostEUR ? destA : destB;
    } else {
      better = destA.fairnessScore >= destB.fairnessScore ? destA : destB;
    }
  }

  if (!better) return "";

  const other = better === destA ? destB : destA;

  const diffPerPerson =
    better.averageCostPerTraveler - other.averageCostPerTraveler;

  let line = `Para este grupo, ${better.destination} parece una opcion mas interesante que ${other.destination}`;

  if (optimizeBy === "fairness") {
    line += ` porque tiene una equidad mayor (${better.fairnessScore.toFixed(
      1
    )} frente a ${other.fairnessScore.toFixed(1)}).`;
  } else if (optimizeBy === "co2") {
    if (
      typeof better.approxCo2Score === "number" &&
      typeof other.approxCo2Score === "number"
    ) {
      line += ` porque implica menos CO2 aproximado (${better.approxCo2Score.toFixed(
        2
      )} frente a ${other.approxCo2Score.toFixed(2)}).`;
    } else {
      line += ` teniendo en cuenta el equilibrio entre precio y CO2 aproximado.`;
    }
  } else {
    if (diffPerPerson !== 0) {
      const cheaper = diffPerPerson < 0 ? better : other;
      const moreExpensive = cheaper === better ? other : better;
      const absDiff = Math.abs(diffPerPerson);
      line += ` porque es mas barata por persona (aprox. ${absDiff.toFixed(
        0
      )} € menos frente a ${moreExpensive.destination}).`;
    } else {
      line += ` porque equilibra mejor precio y equidad para el grupo.`;
    }
  }

  return line;
}

function FlightResults({
  flights,
  optimizeBy,
  hasSearched,
  loading,
  error,
  origins = [],
  bestDestination,
  flexRange,
  departureDate,
}) {
  const resultsRef = useRef(null);
  const [surpriseDest, setSurpriseDest] = useState(null);
  const [compareSelection, setCompareSelection] = useState([]); // destinos seleccionados para comparar
  const [sortBy, setSortBy] = useState("default"); // criterio de ordenacion

  if (loading || error) return null;

  const hasResults = flights && flights.length > 0;

  if (!hasResults && hasSearched) {
    return (
      <section className="mt-4">
        <p className="text-center text-secondary">
          No se han encontrado destinos donde todos podais volar con los
          criterios seleccionados. Prueba con menos filtros o mas flexibilidad.
        </p>
      </section>
    );
  }

  if (!hasResults) return null;

  // Copia ordenable de los destinos
  let sortedFlights = Array.isArray(flights) ? [...flights] : [];

  if (sortBy !== "default") {
    sortedFlights.sort((a, b) => {
      switch (sortBy) {
        case "priceAsc":
          return a.totalCostEUR - b.totalCostEUR;
        case "priceDesc":
          return b.totalCostEUR - a.totalCostEUR;
        case "perPerson":
          return a.averageCostPerTraveler - b.averageCostPerTraveler;
        case "fairness":
          return b.fairnessScore - a.fairnessScore;
        case "co2": {
          const aCo2 =
            typeof a.approxCo2Score === "number" ? a.approxCo2Score : Infinity;
          const bCo2 =
            typeof b.approxCo2Score === "number" ? b.approxCo2Score : Infinity;
          return aCo2 - bCo2;
        }
        default:
          return 0;
      }
    });
  }

  const top3 = sortedFlights.slice(0, 3);
  const primaryDest = bestDestination || sortedFlights[0];

  // Link rutas Google Maps
  let googleMapsUrl = null;
  if (primaryDest && origins.length > 0) {
    const parts = [
      ...origins.map((o) => encodeURIComponent(`${o} airport`)),
      encodeURIComponent(`${primaryDest.destination} airport`),
    ];
    googleMapsUrl = `https://www.google.com/maps/dir/${parts.join("/")}`;
  }

  // Mapa embebido
  let embedUrl = null;
  if (primaryDest) {
    embedUrl = `https://www.google.com/maps?q=${encodeURIComponent(
      primaryDest.destination + " airport"
    )}&output=embed`;
  }

  const optimizeText =
    optimizeBy === "fairness"
      ? "equidad y, en caso de empate, precio"
      : optimizeBy === "co2"
      ? "menos CO2 aproximado y, en caso de empate, precio"
      : "precio total y, en caso de empate, equidad";

  const currentOrderLabel =
    sortBy === "default"
      ? optimizeText
      : sortBy === "priceAsc"
      ? "precio total mas barato primero"
      : sortBy === "priceDesc"
      ? "precio total mas caro primero"
      : sortBy === "perPerson"
      ? "precio medio por persona"
      : sortBy === "fairness"
      ? "mayor equidad del grupo"
      : sortBy === "co2"
      ? "menor CO2 aproximado"
      : optimizeText;

  // Guardar resultados como imagen
  const handleSaveAsImage = async () => {
    if (!resultsRef.current) return;
    try {
      const canvas = await html2canvas(resultsRef.current);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "flyndme-resultados.png";
      link.click();
    } catch (e) {
      console.error(e);
      alert(
        "No se pudo generar la imagen de los resultados. Prueba a hacer una captura de pantalla manual."
      );
    }
  };

  // Viaje sorpresa: elige un destino aleatorio del top 5
  const handleSurprise = () => {
    if (!flights || flights.length === 0) return;
    const pool = flights.slice(0, Math.min(5, flights.length));
    const random = pool[Math.floor(Math.random() * pool.length)];
    setSurpriseDest(random);
  };

  // Gestion de seleccion para comparar (max 4)
  const toggleCompare = (destinationCode) => {
    setCompareSelection((prev) => {
      if (prev.includes(destinationCode)) {
        return prev.filter((d) => d !== destinationCode);
      }
      if (prev.length >= 4) {
        alert("Solo puedes comparar hasta 4 destinos a la vez.");
        return prev;
      }
      return [...prev, destinationCode];
    });
  };

  const fairnessTop = flights.slice(0, Math.min(5, flights.length));
  const selectedForCompare = flights.filter((dest) =>
    compareSelection.includes(dest.destination)
  );

  return (
    <section className="mt-4" ref={resultsRef}>
      {/* MAPA DEL ENCUENTRO */}
      {primaryDest && (
        <div
          className="card mb-4"
          style={{
            backgroundColor: "#FFFFFF",
            borderColor: "#D0D8E5",
            color: "#1E293B",
          }}
        >
          <div className="card-body">
            <div className="row g-3 align-items-stretch">
              <div className="col-md-6">
                <h2 className="h5 mb-2">Mapa del encuentro del grupo</h2>
                <p className="text-secondary mb-2">
                  <strong>Origenes:</strong>{" "}
                  {origins.length > 0 ? origins.join(", ") : "N/A"} →{" "}
                  <strong>Destino:</strong> {primaryDest.destination}
                </p>
                <p className="text-secondary small mb-2">
                  Visualmente: grupo repartido por Europa que converge en un
                  mismo aeropuerto.
                </p>

                <div className="d-flex flex-wrap gap-2 mb-2">
                  {primaryDest.flights.map((f, i) => (
                    <span
                      key={i}
                      className="badge rounded-pill"
                      style={{
                        backgroundColor: "#EBF2FF",
                        color: "#1E293B",
                        border: "1px solid #D0D8E5",
                      }}
                    >
                      {f.origin} → {primaryDest.destination} ·{" "}
                      {typeof f.price === "number"
                        ? `${f.price.toFixed(0)} €`
                        : "sin datos"}
                    </span>
                  ))}
                </div>

                {googleMapsUrl && (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline-primary btn-sm"
                  >
                    Abrir rutas en Google Maps
                  </a>
                )}
              </div>

              <div className="col-md-6">
                {embedUrl && (
                  <div
                    style={{
                      width: "100%",
                      height: "260px",
                      borderRadius: "12px",
                      overflow: "hidden",
                      border: "1px solid #D0D8E5",

                    }}
                  >
                    <iframe
                      title="Mapa del destino"
                      src={embedUrl}
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOP 3 */}
      <div
        className="card mb-4"
        style={{
          backgroundColor: "#FFFFFF",
          borderColor: "#D0D8E5",
          color: "#1E293B",
        }}
      >
        <div className="card-body">
          <h2 className="h5 mb-3">Top 3 destinos para el grupo</h2>
          <p className="text-secondary small mb-3">
            Ordenados por {currentOrderLabel}.
          </p>

          <div className="table-responsive">
            <table
              className="table table-sm align-middle mb-0"
              style={{
                backgroundColor: "#FFFFFF",
                color: "#1E293B",
                borderColor: "#D0D8E5",
              }}
            >
              <thead style={{ backgroundColor: "#EBF2FF" }}>
                <tr>
                  <th style={{ width: "40px" }}>#</th>
                  <th>Destino</th>
                  <th className="text-end">Media por persona</th>
                  <th className="text-end">Coste total</th>
                  <th className="text-end">Equidad</th>
                </tr>
              </thead>

              <tbody>
                {top3.map((dest, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>
                      <span className="fw-semibold">{dest.destination}</span>
                      {index === 0 && (
                        <span
                          className="badge ms-2"
                          style={{
                            backgroundColor: "#3B82F6",
                            color: "#FFFFFF",
                          }}
                        >
                          Destino principal
                        </span>
                      )}
                    </td>
                    <td className="text-end">
                      {dest.averageCostPerTraveler.toFixed(2)} EUR
                    </td>
                    <td className="text-end">
                      {dest.totalCostEUR.toFixed(2)} EUR
                    </td>
                    <td className="text-end">
                      <span style={getFairnessStyle(dest.fairnessScore)}>
                        {dest.fairnessScore.toFixed(1)} / 100
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* GRAFICO DE EQUIDAD (TOP 5) */}
      {fairnessTop.length > 0 && (
        <div
          className="card mb-4"
          style={{
            backgroundColor: "#FFFFFF",
            borderColor: "#D0D8E5",
            color: "#1E293B",
          }}
        >
          <div className="card-body">
            <h2 className="h6 mb-3">
              Comparativa de equidad entre destinos (top 5)
            </h2>
            {fairnessTop.map((dest, index) => (
              <div key={index} className="mb-2">
                <div className="d-flex justify-content-between mb-1 small">
                  <span>{dest.destination}</span>
                  <span>{dest.fairnessScore.toFixed(1)} / 100</span>
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    backgroundColor: "#E5E7EB",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, dest.fairnessScore)
                      )}%`,
                      height: "100%",
                      borderRadius: "999px",
                      backgroundColor:
                        dest.fairnessScore >= 85
                          ? "#16A34A"
                          : dest.fairnessScore >= 65
                          ? "#3B82F6"
                          : dest.fairnessScore >= 45
                          ? "#FACC15"
                          : "#DC2626",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BOTONES DE ACCION */}
      <div className="mb-3 d-flex flex-wrap gap-2">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            const text = buildVotingText(flights);
            navigator.clipboard.writeText(text);
            alert("Texto copiado. Pegalo en tu grupo para que voten.");
          }}
        >
          📤 Compartir resultados al grupo
        </button>

        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={handleSaveAsImage}
        >
          💾 Guardar resultados como imagen
        </button>

        <button
          className="btn btn-outline-success btn-sm"
          onClick={handleSurprise}
        >
          🎲 Elegir destino sorpresa
        </button>
      </div>

      {surpriseDest && (
        <div className="alert alert-info py-2">
          <strong>Destino sorpresa sugerido:</strong>{" "}
          {surpriseDest.destination} ·{" "}
          {surpriseDest.averageCostPerTraveler.toFixed(0)} € por persona
        </div>
      )}

      {/* MODO COMPARAR VARIOS DESTINOS (hasta 4) */}
      <div className="mb-3">
        <p className="text-secondary small mb-1">
          Selecciona hasta <strong>4 destinos</strong> para compararlos cara a
          cara.
        </p>
        {selectedForCompare.length === 1 && (
          <p className="text-secondary small mb-0">
            Has seleccionado{" "}
            <strong>{selectedForCompare[0].destination}</strong>. Selecciona uno
            o mas destinos para ver la comparativa.
          </p>
        )}
        {selectedForCompare.length === 0 && (
          <p className="text-secondary small mb-0">
            Marca la casilla "Comparar" en las tarjetas de destino para ver la
            comparativa.
          </p>
        )}
        {selectedForCompare.length > 1 && (
          <p className="text-secondary small mb-0">
            Estan seleccionados:{" "}
            {selectedForCompare.map((d) => d.destination).join(", ")}.
          </p>
        )}
      </div>

      {selectedForCompare.length >= 2 && (
        <div
          className="card mb-4"
          style={{
            backgroundColor: "#FFFFFF",
            borderColor: "#3B82F6",
            color: "#1E293B",
          }}
        >
          <div className="card-body">
            <h2 className="h6 mb-3">Comparativa cara a cara</h2>

            {/* Tabla de metricas por destino */}
            <div className="table-responsive mb-3">
              <table className="table table-sm align-middle mb-0">
                <thead style={{ backgroundColor: "#EBF2FF" }}>
                  <tr>
                    <th>Metrioca</th>
                    {selectedForCompare.map((dest) => (
                      <th key={dest.destination} className="text-end">
                        {dest.destination}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Media por persona</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        {dest.averageCostPerTraveler.toFixed(2)} EUR
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Coste total del grupo</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        {dest.totalCostEUR.toFixed(2)} EUR
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Equidad</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        <span style={getFairnessStyle(dest.fairnessScore)}>
                          {dest.fairnessScore.toFixed(1)} / 100
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Diferencia max dentro del grupo</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        {typeof dest.priceSpread === "number"
                          ? `${dest.priceSpread.toFixed(2)} EUR`
                          : "N/A"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>CO2 aproximado (indice interno)</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        {typeof dest.approxCo2Score === "number"
                          ? dest.approxCo2Score.toFixed(2)
                          : "N/A"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Detalle por origen */}
            <p className="text-secondary small mb-2">
              <strong>Detalle por origen:</strong> cuanto pagaria cada viajero
              en cada destino seleccionado.
            </p>

            <div className="table-responsive mb-2">
              <table className="table table-sm align-middle mb-0">
                <thead style={{ backgroundColor: "#EBF2FF" }}>
                  <tr>
                    <th>Origen</th>
                    {selectedForCompare.map((dest) => (
                      <th key={dest.destination} className="text-end">
                        {dest.destination}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {origins.map((originCode) => (
                    <tr key={originCode}>
                      <td>{originCode}</td>
                      {selectedForCompare.map((dest) => {
                        const flight = dest.flights.find(
                          (f) => f.origin === originCode
                        );
                        return (
                          <td key={dest.destination} className="text-end">
                            {flight && typeof flight.price === "number"
                              ? `${flight.price.toFixed(2)} EUR`
                              : "N/A"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedForCompare.length === 2 && (
              <p className="text-secondary small mb-0">
                {describeComparison(
                  selectedForCompare[0],
                  selectedForCompare[1],
                  optimizeBy
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* DETALLE DESTINO A DESTINO */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3">
        <h2 className="h5 mb-2 mb-sm-0">
          Detalle destino a destino, ordenado por {currentOrderLabel}
        </h2>

        <div className="d-flex align-items-center gap-2">
          <label
            className="form-label small mb-0"
            htmlFor="sortBySelect"
          >
            Ordenar por:
          </label>
          <select
            id="sortBySelect"
            className="form-select form-select-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="default">
              Criterio principal del grupo
            </option>
            <option value="priceAsc">
              Precio total (mas barato primero)
            </option>
            <option value="priceDesc">
              Precio total (mas caro primero)
            </option>
            <option value="perPerson">
              Precio medio por persona
            </option>
            <option value="fairness">
              Mayor equidad del grupo
            </option>
            <option value="co2">
              Menor CO2 aproximado
            </option>
          </select>
        </div>
      </div>

      {sortedFlights.map((dest, index) => {
        const isBest = index === 0;
        const isCo2Mode = optimizeBy === "co2";
        const travelDate = dest.bestDate || departureDate || "";

        const isSelectedForCompare = compareSelection.includes(
          dest.destination
        );

        return (
          <div
            className="card mb-3"
            key={index}
            style={{
              backgroundColor: "#FFFFFF",
              borderColor: isBest ? "#3B82F6" : "#D0D8E5",
              borderWidth: isBest ? "2px" : "1px",
              color: "#1E293B",
            }}
          >
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <h3 className="h5 mb-0">{dest.destination}</h3>
                    {isBest && (
                      <span
                        className="badge"
                        style={{
                          backgroundColor: "#3B82F6",
                          color: "#FFFFFF",
                        }}
                      >
                        {isCo2Mode
                          ? "Destino con menos CO2 aproximado"
                          : "Mejor destino para el grupo"}
                      </span>
                    )}
                  </div>

                  <p className="text-secondary mb-1 small">
                    Media por viajero:{" "}
                    <strong>
                      {dest.averageCostPerTraveler.toFixed(2)} EUR
                    </strong>{" "}
                    · Coste total:{" "}
                    <strong>{dest.totalCostEUR.toFixed(2)} EUR</strong>
                  </p>

                  <p className="text-secondary mb-1 small">
                    Equidad:{" "}
                    <span style={getFairnessStyle(dest.fairnessScore)}>
                      {dest.fairnessScore.toFixed(1)} / 100
                    </span>
                    {typeof dest.approxCo2Score === "number" && (
                      <>
                        {" "}
                        · CO2 aproximado:{" "}
                        <strong>{dest.approxCo2Score.toFixed(2)}</strong>
                      </>
                    )}
                  </p>

                  {dest.flexNote && (
                    <p className="text-secondary mb-0 small">
                      {dest.flexNote}
                    </p>
                  )}
                </div>

                <div className="text-end">
                  <div className="fw-bold fs-5">
                    {dest.totalCostEUR.toFixed(2)} EUR
                  </div>
                  <small className="text-secondary d-block mb-1">
                    Coste total del grupo
                  </small>

                  {/* Checkbox para comparar */}
                  <div className="form-check d-inline-flex align-items-center justify-content-end">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`compare-${index}`}
                      checked={isSelectedForCompare}
                      onChange={() => toggleCompare(dest.destination)}
                    />
                    <label
                      className="form-check-label small ms-1"
                      htmlFor={`compare-${index}`}
                    >
                      Comparar
                    </label>
                  </div>
                </div>
              </div>

              <p className="mb-2 text-secondary">Detalle por origen:</p>

              <ul className="list-group list-group-flush">
                {dest.flights.map((flight, i) => {
                  const { skyscanner, kiwi, google } = buildBookingLinks(
                    flight.origin,
                    dest.destination,
                    travelDate
                  );

                  return (
                    <li
                      key={i}
                      className="list-group-item"
                      style={{
                        backgroundColor: "#FFFFFF",
                        color: "#1E293B",
                        borderColor: "#D0D8E5",
                      }}
                    >
                      <div className="d-flex justify-content-between">
                        <span className="fw-semibold">{flight.origin}</span>
                        {typeof flight.price === "number" ? (
                          <span>{flight.price.toFixed(2)} EUR</span>
                        ) : (
                          <span className="text-warning">
                            {flight.error || "Sin datos"}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 d-flex flex-wrap gap-2">
                        <a
                          href={skyscanner}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline-primary btn-sm"
                        >
                          Ver en Skyscanner
                        </a>

                        <a
                          href={kiwi}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline-secondary btn-sm"
                        >
                          Ver en Kiwi
                        </a>

                        <a
                          href={google}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline-dark btn-sm"
                        >
                          Ver en Google Flights
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default FlightResults;
