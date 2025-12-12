import { useEffect, useState } from "react";

/**
 * Overlay de carga con mensajes progresivos
 */
export function LoadingOverlay({ loading }) {
  const messages = [
    "Conectando con aerolíneas…",
    "Comparando precios desde tus ciudades…",
    "Calculando el destino más equilibrado…",
    "Ordenando los mejores resultados…",
    "Casi listo…",
  ];

  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!loading) return;

    setStep(0);
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % messages.length);
    }, 1400);

    return () => clearInterval(interval);
  }, [loading]);

  if (!loading) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 20,
          width: "90%",
          maxWidth: 420,
          boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div
            className="spinner-border"
            role="status"
            style={{ width: 22, height: 22 }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
              Analizando destinos…
            </div>
            <div style={{ marginTop: 4, color: "#555" }}>
              {messages[step]}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "#777" }}>
              Estamos comparando múltiples orígenes para encontrar el destino más conveniente para todos.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Botón de búsqueda con estado de carga
 */
export function SearchButton({ loading, children }) {
  return (
    <button
      type="submit"
      className="btn btn-primary btn-lg"
      style={{ backgroundColor: "#3B82F6", borderColor: "#3B82F6" }}
      disabled={loading}
    >
      {loading ? "Analizando destinos…" : children}
    </button>
  );
}
