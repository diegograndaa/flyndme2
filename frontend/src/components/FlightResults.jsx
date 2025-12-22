import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";

/**
 * ✅ Imágenes locales:
 * frontend/public/destinations/<CODE>.jpg
 * Ej: /destinations/LIS.jpg
 *
 * ✅ Importante:
 * Para que funcione en GitHub Pages u otros deploys con subpath,
 * usamos import.meta.env.BASE_URL.
 */

function getBaseUrl() {
  return import.meta.env.BASE_URL || "/";
}

function normalizeDestCode(value) {
  // Extrae un código IATA (3 letras) aunque te llegue "LON - Londres" o "London (LON)"
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/\b[A-Z]{3}\b/);
  return match ? match[0] : raw.slice(0, 3);
}

function getDestinationImageUrl(destCode) {
  const code = normalizeDestCode(destCode);
  return `${getBaseUrl()}destinations/${code}.jpg`;
}

function getPlaceholderImageUrl() {
  return `${getBaseUrl()}destinations/placeholder.jpg`;
}

function getFairnessStyle(score) {
  if (score >= 85) return { color: "#16A34A", fontWeight: "600" };
  if (score >= 65) return { color: "#3B82F6", fontWeight: "600" };
  if (score >= 45) return { color: "#FACC15", fontWeight: "600" };
  return { color: "#DC2626", fontWeight: "600" };
}

function buildBookingLinks(origin, destination, depDate, retDate) {
  const safeOrigin = encodeURIComponent(origin);
  const safeDest = encodeURIComponent(destination);

  const hasDep = Boolean(depDate);
  const hasRet = Boolean(retDate);

  const depCompact = hasDep ? String(depDate).replace(/-/g, "") : "";
  const retCompact = hasRet ? String(retDate).replace(/-/g, "") : "";

  const skyscanner =
    hasDep && hasRet
      ? `https://www.skyscanner.es/transporte/vuelos/${safeOrigin}/${safeDest}/${depCompact}/${retCompact}/`
      : hasDep
      ? `https://www.skyscanner.es/transporte/vuelos/${safeOrigin}/${safeDest}/${depCompact}/`
      : `https://www.skyscanner.es/transporte/vuelos/${safeOrigin}/${safeDest}/`;

  const kiwi =
    hasDep && hasRet
      ? `https://www.kiwi.com/es/search/results/${safeOrigin}/${safeDest}/${depDate}/${retDate}/`
      : hasDep
      ? `https://www.kiwi.com/es/search/results/${safeOrigin}/${safeDest}/${depDate}/`
      : `https://www.kiwi.com/es/search/results/${safeOrigin}/${safeDest}/`;

  const queryText =
    hasDep && hasRet
      ? `Vuelos de ${origin} a ${destination} del ${depDate} al ${retDate}`
      : hasDep
      ? `Vuelos de ${origin} a ${destination} el ${depDate}`
      : `Vuelos de ${origin} a ${destination}`;

  const google = `https://www.google.com/travel/flights?q=${encodeURIComponent(
    queryText
  )}`;

  return { skyscanner, kiwi, google };
}

function buildVotingText(flights) {
  const safeFlights = Array.isArray(flights) ? flights : [];
  let text = "📊 Opciones para el viaje:\n\n";

  safeFlights.slice(0, 5).forEach((dest, i) => {
    const avg =
      typeof dest.averageCostPerTraveler === "number"
        ? dest.averageCostPerTraveler
        : 0;
    text += `${i + 1}) ${dest.destination} · ${avg.toFixed(0)} € por persona\n`;
  });

  text += "\nVotad con un numero -> 1, 2 o 3";
  return text;
}

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
    if (aCo2 !== bCo2) better = aCo2 < bCo2 ? destA : destB;
    else better = destA.totalCostEUR <= destB.totalCostEUR ? destA : destB;
  } else {
    if (destA.totalCostEUR !== destB.totalCostEUR) {
      better = destA.totalCostEUR < destB.totalCostEUR ? destA : destB;
    } else {
      better = destA.fairnessScore >= destB.fairnessScore ? destA : destB;
    }
  }

  if (!better) return "";
  const other = better === destA ? destB : destA;

  const diffPerPerson =
    (better.averageCostPerTraveler || 0) - (other.averageCostPerTraveler || 0);

  let line = `Para este grupo, ${better.destination} parece una opcion mas interesante que ${other.destination}`;

  if (optimizeBy === "fairness") {
    line += ` porque tiene una equidad mayor (${Number(better.fairnessScore).toFixed(
      1
    )} frente a ${Number(other.fairnessScore).toFixed(1)}).`;
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
      const absDiff = Math.abs(diffPerPerson);
      line += ` porque es mas barata por persona (aprox. ${absDiff.toFixed(
        0
      )} € de diferencia).`;
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
  tripType = "oneway",
  returnDate = "",
  budgetEnabled = false,
  maxBudgetPerTraveler = null,
}) {
  const resultsRef = useRef(null);
  const [surpriseDest, setSurpriseDest] = useState(null);
  const [compareSelection, setCompareSelection] = useState([]);
  const [sortBy, setSortBy] = useState("default");
  const [openIndex, setOpenIndex] = useState(null);

  if (loading || error) return null;

  const safeFlights = Array.isArray(flights) ? flights : [];
  const hasResults = safeFlights.length > 0;

  if (!hasResults && hasSearched) {
    return (
      <section className="mt-4">
        <p className="text-center text-secondary">
          No se han encontrado destinos donde todos podais volar con los criterios
          seleccionados.
        </p>
        {budgetEnabled && (
          <p className="text-center text-secondary small mb-0">
            Presupuesto activo: max{" "}
            {Number(maxBudgetPerTraveler || 0).toFixed(0)} EUR por persona. Prueba
            a subirlo o quitar el filtro.
          </p>
        )}
      </section>
    );
  }

  if (!hasResults) return null;

  let sortedFlights = [...safeFlights];

  if (sortBy !== "default") {
    sortedFlights.sort((a, b) => {
      switch (sortBy) {
        case "priceAsc":
          return (a.totalCostEUR || 0) - (b.totalCostEUR || 0);
        case "priceDesc":
          return (b.totalCostEUR || 0) - (a.totalCostEUR || 0);
        case "perPerson":
          return (a.averageCostPerTraveler || 0) - (b.averageCostPerTraveler || 0);
        case "fairness":
          return (b.fairnessScore || 0) - (a.fairnessScore || 0);
        case "co2": {
          const aCo2 = typeof a.approxCo2Score === "number" ? a.approxCo2Score : Infinity;
          const bCo2 = typeof b.approxCo2Score === "number" ? b.approxCo2Score : Infinity;
          return aCo2 - bCo2;
        }
        default:
          return 0;
      }
    });
  }

  const top3 = sortedFlights.slice(0, 3);
  const primaryDest = bestDestination || sortedFlights[0];
  const primaryFlights = Array.isArray(primaryDest?.flights) ? primaryDest.flights : [];

  let googleMapsUrl = null;
  if (primaryDest && origins.length > 0) {
    const parts = [
      ...origins.map((o) => encodeURIComponent(`${o} airport`)),
      encodeURIComponent(`${primaryDest.destination} airport`),
    ];
    googleMapsUrl = `https://www.google.com/maps/dir/${parts.join("/")}`;
  }

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
      alert("No se pudo generar la imagen. Prueba a hacer una captura manual.");
    }
  };

  const handleSurprise = () => {
    if (!safeFlights.length) return;
    const pool = safeFlights.slice(0, Math.min(5, safeFlights.length));
    const random = pool[Math.floor(Math.random() * pool.length)];
    setSurpriseDest(random);
  };

  const toggleCompare = (destinationCode) => {
    setCompareSelection((prev) => {
      if (prev.includes(destinationCode)) return prev.filter((d) => d !== destinationCode);
      if (prev.length >= 4) {
        alert("Solo puedes comparar hasta 4 destinos a la vez.");
        return prev;
      }
      return [...prev, destinationCode];
    });
  };

  const selectedForCompare = safeFlights.filter((dest) =>
    compareSelection.includes(dest.destination)
  );

  const fairnessTop = safeFlights.slice(0, Math.min(5, safeFlights.length));
  const toggleOpen = (index) => setOpenIndex((prev) => (prev === index ? null : index));

  const mainDate = primaryDest?.bestDate || departureDate || "";
  const mainReturn =
    primaryDest?.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");

  return (
    <section className="mt-4" ref={resultsRef}>
      {budgetEnabled && (
        <div className="alert alert-warning py-2">
          Presupuesto activo: max{" "}
          <strong>{Number(maxBudgetPerTraveler || 0).toFixed(0)} EUR</strong> por
          persona (filtrado por media por persona).
        </div>
      )}

      {primaryDest && (
        <div
          className="card mb-4"
          style={{ backgroundColor: "#FFFFFF", borderColor: "#D0D8E5", color: "#1E293B" }}
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
                  <strong>Fechas:</strong> {mainDate ? mainDate : "N/A"}
                  {tripType === "roundtrip" && mainReturn ? ` → ${mainReturn}` : ""}
                  {typeof flexRange === "number" && flexRange > 0 ? ` (flex ±${flexRange})` : ""}
                </p>

                <div className="d-flex flex-wrap gap-2 mb-2">
                  {primaryFlights.map((f, i) => (
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
                      {typeof f.price === "number" ? `${f.price.toFixed(0)} €` : "sin datos"}
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

      <div className="card mb-4" style={{ backgroundColor: "#FFFFFF", borderColor: "#D0D8E5", color: "#1E293B" }}>
        <div className="card-body">
          <h2 className="h5 mb-3">Top 3 destinos para el grupo</h2>
          <p className="text-secondary small mb-3">Ordenados por {currentOrderLabel}.</p>

          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
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
                        <span className="badge ms-2" style={{ backgroundColor: "#3B82F6", color: "#FFFFFF" }}>
                          Destino principal
                        </span>
                      )}

                      {(dest.bestDate || dest.bestReturnDate) && (
                        <div className="text-secondary small mt-1">
                          {dest.bestDate ? `Fecha: ${dest.bestDate}` : ""}
                          {tripType === "roundtrip" && dest.bestReturnDate ? ` → ${dest.bestReturnDate}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="text-end">{Number(dest.averageCostPerTraveler || 0).toFixed(2)} EUR</td>
                    <td className="text-end">{Number(dest.totalCostEUR || 0).toFixed(2)} EUR</td>
                    <td className="text-end">
                      <span style={getFairnessStyle(Number(dest.fairnessScore || 0))}>
                        {Number(dest.fairnessScore || 0).toFixed(1)} / 100
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {budgetEnabled && (
            <div className="text-secondary small mt-2">
              Presupuesto activo: max {Number(maxBudgetPerTraveler || 0).toFixed(0)} EUR por persona.
            </div>
          )}
        </div>
      </div>

      {fairnessTop.length > 0 && (
        <div className="card mb-4" style={{ backgroundColor: "#FFFFFF", borderColor: "#D0D8E5", color: "#1E293B" }}>
          <div className="card-body">
            <h2 className="h6 mb-3">Comparativa de equidad entre destinos (top 5)</h2>
            {fairnessTop.map((dest, index) => (
              <div key={index} className="mb-2">
                <div className="d-flex justify-content-between mb-1 small">
                  <span>{dest.destination}</span>
                  <span>{Number(dest.fairnessScore || 0).toFixed(1)} / 100</span>
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
                      width: `${Math.max(0, Math.min(100, Number(dest.fairnessScore || 0)))}%`,
                      height: "100%",
                      borderRadius: "999px",
                      backgroundColor:
                        Number(dest.fairnessScore || 0) >= 85
                          ? "#16A34A"
                          : Number(dest.fairnessScore || 0) >= 65
                          ? "#3B82F6"
                          : Number(dest.fairnessScore || 0) >= 45
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

      <div className="mb-3 d-flex flex-wrap gap-2">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            const text = buildVotingText(safeFlights);
            navigator.clipboard.writeText(text);
            alert("Texto copiado. Pegalo en tu grupo para que voten.");
          }}
        >
          📤 Compartir resultados al grupo
        </button>

        <button className="btn btn-outline-secondary btn-sm" onClick={handleSaveAsImage}>
          💾 Guardar resultados como imagen
        </button>

        <button className="btn btn-outline-success btn-sm" onClick={handleSurprise}>
          🎲 Elegir destino sorpresa
        </button>
      </div>

      {surpriseDest && (
        <div className="alert alert-info py-2">
          <strong>Destino sorpresa sugerido:</strong> {surpriseDest.destination} ·{" "}
          {Number(surpriseDest.averageCostPerTraveler || 0).toFixed(0)} € por persona
        </div>
      )}

      <div className="mb-3">
        <p className="text-secondary small mb-1">
          Selecciona hasta <strong>4 destinos</strong> para compararlos cara a cara.
        </p>
        {selectedForCompare.length === 0 && (
          <p className="text-secondary small mb-0">
            Marca la casilla "Comparar" en las tarjetas de destino para ver la comparativa.
          </p>
        )}
        {selectedForCompare.length === 1 && (
          <p className="text-secondary small mb-0">
            Has seleccionado <strong>{selectedForCompare[0].destination}</strong>. Selecciona otro para comparar.
          </p>
        )}
        {selectedForCompare.length > 1 && (
          <p className="text-secondary small mb-0">
            Estan seleccionados: {selectedForCompare.map((d) => d.destination).join(", ")}.
          </p>
        )}
      </div>

      {selectedForCompare.length >= 2 && (
        <div className="card mb-4" style={{ backgroundColor: "#FFFFFF", borderColor: "#3B82F6", color: "#1E293B" }}>
          <div className="card-body">
            <h2 className="h6 mb-3">Comparativa cara a cara</h2>

            <div className="table-responsive mb-3">
              <table className="table table-sm align-middle mb-0">
                <thead style={{ backgroundColor: "#EBF2FF" }}>
                  <tr>
                    <th>Metrica</th>
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
                        {Number(dest.averageCostPerTraveler || 0).toFixed(2)} EUR
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Coste total del grupo</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        {Number(dest.totalCostEUR || 0).toFixed(2)} EUR
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Equidad</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        <span style={getFairnessStyle(Number(dest.fairnessScore || 0))}>
                          {Number(dest.fairnessScore || 0).toFixed(1)} / 100
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Diferencia max dentro del grupo</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        {typeof dest.priceSpread === "number" ? `${dest.priceSpread.toFixed(2)} EUR` : "N/A"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>CO2 aproximado (indice interno)</td>
                    {selectedForCompare.map((dest) => (
                      <td key={dest.destination} className="text-end">
                        {typeof dest.approxCo2Score === "number" ? dest.approxCo2Score.toFixed(2) : "N/A"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-secondary small mb-2">
              <strong>Detalle por origen:</strong> cuanto pagaria cada viajero en cada destino seleccionado.
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
                        const df = Array.isArray(dest.flights) ? dest.flights : [];
                        const flight = df.find((f) => f.origin === originCode);
                        return (
                          <td key={dest.destination} className="text-end">
                            {flight && typeof flight.price === "number" ? `${flight.price.toFixed(2)} EUR` : "N/A"}
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
                {describeComparison(selectedForCompare[0], selectedForCompare[1], optimizeBy)}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3">
        <h2 className="h5 mb-2 mb-sm-0">
          Detalle destino a destino, ordenado por {currentOrderLabel}
        </h2>

        <div className="d-flex align-items-center gap-2">
          <label className="form-label small mb-0" htmlFor="sortBySelect">
            Ordenar por:
          </label>
          <select
            id="sortBySelect"
            className="form-select form-select-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="default">Criterio principal del grupo</option>
            <option value="priceAsc">Precio total (mas barato primero)</option>
            <option value="priceDesc">Precio total (mas caro primero)</option>
            <option value="perPerson">Precio medio por persona</option>
            <option value="fairness">Mayor equidad del grupo</option>
            <option value="co2">Menor CO2 aproximado</option>
          </select>
        </div>
      </div>

      {sortedFlights.map((dest, index) => {
        const isBest = index === 0;
        const isCo2Mode = optimizeBy === "co2";
        const destFlights = Array.isArray(dest.flights) ? dest.flights : [];
        const travelDate = dest.bestDate || departureDate || "";
        const travelReturn =
          dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");

        const isSelectedForCompare = compareSelection.includes(dest.destination);
        const isOpen = openIndex === index;

        const imgUrl = getDestinationImageUrl(dest.destination);

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
              <div className="row g-3 align-items-start">
                <div className="col-12 col-md-4">
                  <div
                    style={{
                      width: "100%",
                      height: 120,
                      borderRadius: 12,
                      overflow: "hidden",
                      border: "1px solid #D0D8E5",
                      position: "relative",
                      backgroundColor: "#F8FAFC",
                    }}
                  >
                    <img
                      src={imgUrl}
                      alt={`Foto de ${normalizeDestCode(dest.destination)}`}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = getPlaceholderImageUrl();
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.28) 100%)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 10,
                        bottom: 8,
                        right: 10,
                        fontSize: 12,
                        color: "#fff",
                        opacity: 0.95,
                        textShadow: "0 2px 8px rgba(0,0,0,0.35)",
                      }}
                    >
                      {normalizeDestCode(dest.destination)}
                    </div>
                  </div>
                </div>

                <div className="col-12 col-md-8">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <div
                      className="me-3 flex-grow-1"
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleOpen(index)}
                    >
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <h3 className="h5 mb-0">{dest.destination}</h3>
                        {isBest && (
                          <span
                            className="badge"
                            style={{ backgroundColor: "#3B82F6", color: "#FFFFFF" }}
                          >
                            {isCo2Mode
                              ? "Destino con menos CO2 aproximado"
                              : "Mejor destino para el grupo"}
                          </span>
                        )}
                      </div>

                      <p className="text-secondary mb-1 small">
                        Media por viajero:{" "}
                        <strong>{Number(dest.averageCostPerTraveler || 0).toFixed(2)} EUR</strong> ·{" "}
                        Coste total: <strong>{Number(dest.totalCostEUR || 0).toFixed(2)} EUR</strong>
                        {budgetEnabled && (
                          <>
                            {" "}
                            · Presupuesto max:{" "}
                            <strong>{Number(maxBudgetPerTraveler || 0).toFixed(0)} EUR</strong>
                          </>
                        )}
                      </p>

                      <p className="text-secondary mb-1 small">
                        Equidad:{" "}
                        <span style={getFairnessStyle(Number(dest.fairnessScore || 0))}>
                          {Number(dest.fairnessScore || 0).toFixed(1)} / 100
                        </span>
                        {typeof dest.approxCo2Score === "number" && (
                          <>
                            {" "}
                            · CO2 aproximado: <strong>{dest.approxCo2Score.toFixed(2)}</strong>
                          </>
                        )}
                      </p>

                      {(travelDate || travelReturn) && (
                        <p className="text-secondary mb-0 small">
                          Fecha: {travelDate || "N/A"}
                          {tripType === "roundtrip" && travelReturn ? ` → ${travelReturn}` : ""}
                          {typeof flexRange === "number" && flexRange > 0 ? ` (flex ±${flexRange})` : ""}
                        </p>
                      )}
                    </div>

                    <div className="text-end">
                      <div className="fw-bold fs-5">{Number(dest.totalCostEUR || 0).toFixed(2)} EUR</div>
                      <small className="text-secondary d-block mb-1">Coste total del grupo</small>

                      <div className="form-check d-inline-flex align-items-center justify-content-end">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`compare-${index}`}
                          checked={isSelectedForCompare}
                          onChange={() => toggleCompare(dest.destination)}
                        />
                        <label className="form-check-label small ms-1" htmlFor={`compare-${index}`}>
                          Comparar
                        </label>
                      </div>

                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 d-block mt-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOpen(index);
                        }}
                      >
                        {isOpen ? "Ocultar detalles ▲" : "Ver detalles ▼"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {isOpen && (
                <>
                  <p className="mb-2 text-secondary">Detalle por origen:</p>

                  <ul className="list-group list-group-flush">
                    {destFlights.map((flight, i) => {
                      const { skyscanner, kiwi, google } = buildBookingLinks(
                        flight.origin,
                        dest.destination,
                        travelDate,
                        tripType === "roundtrip" ? travelReturn : ""
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
                              <span className="text-warning">{flight.error || "Sin datos"}</span>
                            )}
                          </div>

                          <div className="mt-2 d-flex flex-wrap gap-2">
                            <a href={skyscanner} target="_blank" rel="noreferrer" className="btn btn-outline-primary btn-sm">
                              Ver en Skyscanner
                            </a>

                            <a href={kiwi} target="_blank" rel="noreferrer" className="btn btn-outline-secondary btn-sm">
                              Ver en Kiwi
                            </a>

                            <a href={google} target="_blank" rel="noreferrer" className="btn btn-outline-dark btn-sm">
                              Ver en Google Flights
                            </a>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default FlightResults;
