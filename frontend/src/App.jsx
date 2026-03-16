import React, { useEffect, useMemo, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import FlightResults from "./components/FlightResults";
import { SearchProgress } from "./components/SearchUX";

// ─── API ──────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "")
  || "https://flyndme-backend.onrender.com";

const API_URL = `${API_BASE}/api/flights/multi-origin`;

// ─── Airport data ─────────────────────────────────────────────────────────────

const AIRPORTS = [
  { code: "MAD", city: "Madrid",     country: "España" },
  { code: "BCN", city: "Barcelona",  country: "España" },
  { code: "LON", city: "Londres",    country: "Reino Unido" },
  { code: "PAR", city: "París",      country: "Francia" },
  { code: "ROM", city: "Roma",       country: "Italia" },
  { code: "MIL", city: "Milán",      country: "Italia" },
  { code: "BER", city: "Berlín",     country: "Alemania" },
  { code: "AMS", city: "Ámsterdam",  country: "Países Bajos" },
  { code: "LIS", city: "Lisboa",     country: "Portugal" },
  { code: "DUB", city: "Dublín",     country: "Irlanda" },
  { code: "VIE", city: "Viena",      country: "Austria" },
];

const AIRPORT_MAP = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

// ─── Utilities ────────────────────────────────────────────────────────────────

function getBaseUrl() { return import.meta.env.BASE_URL || "/"; }

function normalizeCode(v) {
  const raw = String(v || "").trim().toUpperCase();
  const m   = raw.match(/\b[A-Z]{3}\b/);
  return m ? m[0] : raw.slice(0, 3);
}

function cityOf(code) {
  return AIRPORT_MAP[normalizeCode(code)]?.city || "";
}

function destLabel(code) {
  const c = cityOf(code);
  return c ? `${normalizeCode(code)} · ${c}` : normalizeCode(code);
}

function formatEur(n, dec = 0) {
  const v = typeof n === "number" ? n : Number(n || 0);
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency", currency: "EUR",
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(v);
  } catch { return `${v.toFixed(dec)} €`; }
}

function formatDate(s) {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d)) return s;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO() { return new Date().toISOString().split("T")[0]; }

function buildSkyscannerUrl({ origin, destination, departureDate, returnDate, tripType }) {
  const from = String(origin || "").toLowerCase();
  const to   = String(destination || "").toLowerCase();
  const dep  = String(departureDate || "").replace(/-/g, "");
  const ret  = tripType === "roundtrip" ? String(returnDate || "").replace(/-/g, "") : "";
  if (!from || !to || !dep) return "";
  const base = "https://www.skyscanner.es/transport/flights";
  const path = ret ? `${base}/${from}/${to}/${dep}/${ret}/` : `${base}/${from}/${to}/${dep}/`;
  const params = new URLSearchParams({ adultsv2: "1", cabinclass: "economy", rtn: ret ? "1" : "0" });
  return `${path}?${params}`;
}

function fairnessLabel(s) {
  if (s >= 85) return { text: "Muy equilibrado",      color: "#16A34A" };
  if (s >= 65) return { text: "Bastante equilibrado", color: "#3B82F6" };
  if (s >= 45) return { text: "Algo desigual",        color: "#D97706" };
  return             { text: "Desigual",               color: "#DC2626" };
}

async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta); return ok;
  } catch { return false; }
}

// ─── Error boundary ───────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e?.message || "Error" }; }
  componentDidCatch(e, i) { console.error("[UI]", e, i); }
  render() {
    if (this.state.err) return (
      <div className="alert alert-danger">
        <strong>Error al renderizar.</strong> {this.state.err}
        <button className="btn btn-sm btn-outline-danger ms-3" onClick={() => this.setState({ err: null })}>
          Reintentar
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Landing ──────────────────────────────────────────────────────────────────

function Landing({ onStart }) {
  return (
    <>
      {/* Hero */}
      <section className="lp-hero">
        <div className="container" style={{ maxWidth: 1080 }}>
          <div className="row g-5 align-items-center">
            <div className="col-lg-6">
              <span className="lp-eyebrow">FlyndMe</span>
              <h1 className="lp-h1">El punto de encuentro perfecto para tu grupo</h1>
              <p className="lp-lead">
                Introduce los aeropuertos de cada viajero y en segundos sabrás qué destino le sale más barato a todos juntos.
              </p>
              <button className="btn-fm-primary btn-lg-fm" onClick={onStart} type="button">
                Buscar destino común
              </button>
              <div className="lp-chips mt-4">
                {["Multi origen", "Mejor precio total", "Equidad entre viajeros", "Presupuesto por persona"].map((t) => (
                  <span key={t} className="lp-chip">{t}</span>
                ))}
              </div>
            </div>

            <div className="col-lg-6">
              <div className="lp-card">
                <div className="lp-card-title">¿Cómo funciona?</div>
                <ul className="lp-steps">
                  <li><span className="lp-step-num">1</span>Añade los aeropuertos de cada viajero.</li>
                  <li><span className="lp-step-num">2</span>FlyndMe busca el destino más barato para todos.</li>
                  <li><span className="lp-step-num">3</span>Abre Skyscanner para reservar desde cada origen.</li>
                </ul>
                <div className="lp-card-meta">
                  <span>Fuente · Amadeus API</span>
                  <span>Tiempo típico · 3 – 8 s</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-faq">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-faq-title">Preguntas frecuentes</h2>
          <div className="row g-3">
            {[
              { q: '¿Qué significa "equidad"?', a: "Una puntuación de 0 a 100. Cuanto más alta, más parecido paga cada viajero." },
              { q: "¿Cómo funciona el presupuesto?", a: "Filtra destinos donde la media por persona supera el límite que tú fijas." },
              { q: "¿FlyndMe vende billetes?", a: "No. FlyndMe recomienda el destino; la reserva se hace en Skyscanner u otros buscadores." },
              { q: "¿Qué tiene de especial?", a: "Busca simultáneamente desde varios aeropuertos y optimiza por precio total o equidad." },
            ].map((item) => (
              <div key={item.q} className="col-md-6">
                <div className="lp-faq-card">
                  <div className="lp-faq-q">{item.q}</div>
                  <div className="lp-faq-a">{item.a}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-5">
            <button className="btn-fm-primary btn-lg-fm" onClick={onStart} type="button">
              Empezar ahora
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

// ─── Search form ──────────────────────────────────────────────────────────────

function SearchPage({
  origins, setOrigins,
  tripType, setTripType,
  departureDate, setDepartureDate,
  returnDate, setReturnDate,
  optimizeBy, setOptimizeBy,
  budgetEnabled, setBudgetEnabled,
  maxBudget, setMaxBudget,
  loading, error,
  onSubmit,
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  const safeIdx = activeIdx >= 0 && activeIdx < origins.length ? activeIdx : 0;
  const filterVal = origins[safeIdx]?.trim().toLowerCase() || "";

  const filtered = AIRPORTS.filter((a) => {
    if (!filterVal) return true;
    return (
      a.code.toLowerCase().includes(filterVal) ||
      a.city.toLowerCase().includes(filterVal) ||
      a.country.toLowerCase().includes(filterVal)
    );
  });

  const handleClickAirport = (code) => {
    const copy = [...origins];
    if (!copy[safeIdx]?.trim()) {
      copy[safeIdx] = code;
    } else {
      const empty = copy.findIndex((v) => !v.trim());
      if (empty !== -1) copy[empty] = code;
      else if (!copy.includes(code)) copy.push(code);
    }
    setOrigins(copy);
  };

  const BUDGET_MIN = 30; const BUDGET_MAX = 800; const BUDGET_STEP = 10;

  return (
    <div className="container py-4" style={{ maxWidth: 960 }}>
      <div className="sf-grid">
        {/* ── Left: form ── */}
        <div className="sf-form fm-card">
          <h2 className="sf-title">Planifica la búsqueda</h2>
          <p className="sf-sub">Añade los aeropuertos del grupo y elige fechas.</p>

          <form onSubmit={onSubmit} noValidate>
            {/* Origins */}
            <div className="sf-section">
              <div className="sf-label">Aeropuertos de origen</div>
              {origins.map((origin, idx) => (
                <div key={idx} className="sf-origin-row">
                  <span className="sf-badge">V{idx + 1}</span>
                  <input
                    type="text"
                    className="form-control sf-input text-uppercase"
                    placeholder="Ej: MAD, LON…"
                    value={origin}
                    onChange={(e) => {
                      const copy = [...origins];
                      copy[idx] = e.target.value.toUpperCase();
                      setOrigins(copy);
                    }}
                    onFocus={() => setActiveIdx(idx)}
                    disabled={loading}
                    autoComplete="off"
                  />
                  {origins.length > 1 && (
                    <button
                      type="button"
                      className="sf-remove"
                      onClick={() => {
                        const copy = origins.filter((_, i) => i !== idx);
                        setOrigins(copy.length ? copy : [""]);
                        setActiveIdx(Math.min(safeIdx, copy.length - 1));
                      }}
                      disabled={loading}
                      title="Eliminar"
                    >✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="sf-add-btn" onClick={() => { setOrigins([...origins, ""]); setActiveIdx(origins.length); }} disabled={loading || origins.length >= 8}>
                + Añadir viajero
              </button>
            </div>

            {/* Trip type */}
            <div className="sf-section">
              <div className="sf-label">Tipo de viaje</div>
              <div className="sf-pills">
                {[["oneway", "Solo ida"], ["roundtrip", "Ida y vuelta"]].map(([v, l]) => (
                  <button key={v} type="button"
                    className={`sf-pill ${tripType === v ? "sf-pill--active" : ""}`}
                    onClick={() => setTripType(v)} disabled={loading}>{l}</button>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div className="sf-section">
              <div className="sf-label">Fechas</div>
              <div className="row g-3">
                <div className="col-sm-6">
                  <label className="sf-input-label">Salida</label>
                  <input type="date" className="form-control sf-input"
                    value={departureDate} min={todayISO()}
                    onChange={(e) => setDepartureDate(e.target.value)} disabled={loading} />
                </div>
                {tripType === "roundtrip" && (
                  <div className="col-sm-6">
                    <label className="sf-input-label">Vuelta</label>
                    <input type="date" className="form-control sf-input"
                      value={returnDate} min={departureDate || todayISO()}
                      onChange={(e) => setReturnDate(e.target.value)} disabled={loading} />
                  </div>
                )}
              </div>
            </div>

            {/* Optimize */}
            <div className="sf-section">
              <div className="sf-label">Optimizar por</div>
              <div className="sf-pills">
                {[["total", "Precio total del grupo"], ["fairness", "Equidad entre viajeros"]].map(([v, l]) => (
                  <button key={v} type="button"
                    className={`sf-pill ${optimizeBy === v ? "sf-pill--active" : ""}`}
                    onClick={() => setOptimizeBy(v)} disabled={loading}>{l}</button>
                ))}
              </div>
            </div>

            {/* Budget */}
            <div className="sf-section">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="sf-label mb-0">Presupuesto máximo por persona</div>
                  <div className="sf-hint">
                    {budgetEnabled ? `Máx. ${formatEur(maxBudget)} / persona` : "Sin límite de presupuesto"}
                  </div>
                </div>
                <div className="form-check form-switch mb-0">
                  <input className="form-check-input" type="checkbox" id="budgetSwitch"
                    checked={budgetEnabled} onChange={(e) => setBudgetEnabled(e.target.checked)} disabled={loading} />
                  <label className="form-check-label small" htmlFor="budgetSwitch">
                    {budgetEnabled ? "Activado" : "Desactivado"}
                  </label>
                </div>
              </div>
              {budgetEnabled && (
                <div className="sf-budget-box mt-3">
                  <input type="range" className="form-range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP}
                    value={maxBudget} onChange={(e) => setMaxBudget(Number(e.target.value))} disabled={loading} />
                  <div className="d-flex justify-content-between small" style={{ color: "#64748B" }}>
                    <span>{formatEur(BUDGET_MIN)}</span>
                    <strong>{formatEur(maxBudget)}</strong>
                    <span>{formatEur(BUDGET_MAX)}</span>
                  </div>
                </div>
              )}
            </div>

            {error && <div className="alert alert-danger py-2 mt-3">{error}</div>}

            <button type="submit" className="btn-fm-primary w-100 mt-3 py-3 fw-bold fs-6" disabled={loading}>
              {loading ? "Buscando…" : "Buscar destino común"}
            </button>
            <div className="sf-footnote">
              <span>Tiempo estimado: 3 – 8 s</span>
              <span>Precios vía Amadeus API</span>
            </div>
          </form>
        </div>

        {/* ── Right: airport picker ── */}
        <aside className="sf-airports fm-card">
          <div className="sf-label">Aeropuertos disponibles</div>
          <div className="sf-hint">Haz clic para rellenar el campo activo · Viajero {safeIdx + 1}</div>
          <div className="sf-airport-list">
            {filtered.map((a) => (
              <div key={a.code} className="sf-airport-item"
                onClick={() => !loading && handleClickAirport(a.code)}
                role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleClickAirport(a.code)}>
                <span className="sf-airport-code">{a.code}</span>
                <span className="sf-airport-city">{a.city}</span>
                <span className="sf-airport-country">{a.country}</span>
              </div>
            ))}
            {!filtered.length && <div className="text-center small" style={{ color: "#94A3B8", padding: "16px 0" }}>Sin coincidencias</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Winner card ──────────────────────────────────────────────────────────────

function WinnerCard({
  dest, origins, tripType, returnDate,
  uiCriterion, onChangeCriterion,
  flightsCount, onShare, shareStatus,
  onViewAlternatives, onChangeSearch,
}) {
  if (!dest) return null;

  const code      = normalizeCode(dest.destination);
  const city      = cityOf(code);
  const imgUrl    = `${getBaseUrl()}destinations/${code}.jpg`;
  const fairness  = fairnessLabel(dest.fairnessScore ?? 0);
  const dep       = dest.bestDate || "";
  const ret       = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");

  const cleanOrigins = (origins || []).map((o) => String(o).trim().toUpperCase()).filter(Boolean);
  const breakdown    = Array.isArray(dest.flights) ? dest.flights : [];

  return (
    <div className="wc-card">
      {/* Image strip */}
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          <span className="wc-dest-code">{code}</span>
          {city && <span className="wc-dest-city">{city}</span>}
        </div>
      </div>

      {/* Body */}
      <div className="wc-body">
        {/* Header row */}
        <div className="wc-header-row">
          <div>
            <div className="wc-eyebrow">Destino recomendado</div>
            <div className="wc-dest-big">{code}{city ? ` · ${city}` : ""}</div>
          </div>

          {/* Criterion toggle */}
          <div className="btn-group btn-group-sm" role="group" aria-label="Criterio">
            {[["total", "Precio"], ["fairness", "Equidad"]].map(([v, l]) => (
              <button key={v} type="button"
                className={`btn ${uiCriterion === v ? "btn-light fw-bold" : "btn-outline-light"}`}
                onClick={() => onChangeCriterion(v)}>{l}</button>
            ))}
          </div>
        </div>

        {/* Dates */}
        {dep && (
          <div className="wc-dates">
            {tripType === "roundtrip"
              ? `${formatDate(dep)} → ${formatDate(ret)}`
              : `Salida: ${formatDate(dep)}`}
            {" · "}{tripType === "roundtrip" ? "Ida y vuelta" : "Solo ida"}
          </div>
        )}

        {/* Price block */}
        <div className="wc-price-block">
          <div>
            <div className="wc-price-label">Total del grupo</div>
            <div className="wc-price">{formatEur(dest.totalCostEUR, 2)}</div>
          </div>
          <div className="wc-price-divider" />
          <div>
            <div className="wc-price-label">Media por persona</div>
            <div className="wc-price wc-price--secondary">{formatEur(dest.averageCostPerTraveler, 2)}</div>
          </div>
        </div>

        {/* Per-origin pills */}
        {breakdown.length > 0 && (
          <div className="wc-breakdown">
            <div className="wc-breakdown-label">Precio por origen</div>
            <div className="wc-breakdown-pills">
              {breakdown.map((f, i) => (
                <span key={i} className="wc-pill">
                  <strong>{String(f.origin).toUpperCase()}</strong>
                  <span className="wc-pill-arrow">→</span>
                  <strong>{code}</strong>
                  <span className="wc-pill-price">{typeof f.price === "number" ? formatEur(f.price, 0) : "N/D"}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Fairness + spread */}
        <div className="wc-metrics">
          <div className="wc-metric">
            <div className="wc-metric-label">Equidad</div>
            <div className="wc-metric-value">{(dest.fairnessScore ?? 0).toFixed(0)}<span className="wc-metric-unit">/100</span></div>
            <div className="wc-fairness-bar">
              <div className="wc-fairness-fill" style={{ width: `${Math.min(100, dest.fairnessScore ?? 0)}%` }} />
            </div>
            <div className="wc-fairness-tag" style={{ color: fairness.color }}>{fairness.text}</div>
          </div>
          <div className="wc-metric">
            <div className="wc-metric-label">Diferencia máxima</div>
            <div className="wc-metric-value">{formatEur(dest.priceSpread ?? 0, 2)}</div>
            <div className="wc-metric-sub">Entre el vuelo más caro y el más barato</div>
          </div>
          <div className="wc-metric">
            <div className="wc-metric-label">Destinos analizados</div>
            <div className="wc-metric-value">{flightsCount}</div>
            <div className="wc-metric-sub">Con tus criterios de búsqueda</div>
          </div>
        </div>

        {/* Skyscanner links */}
        {cleanOrigins.length > 0 && dep && (
          <div className="wc-book">
            <div className="wc-book-label">Reservar en Skyscanner · un enlace por origen</div>
            <div className="wc-book-links">
              {cleanOrigins.map((origin) => {
                const url = buildSkyscannerUrl({ origin, destination: code, departureDate: dep, returnDate: ret, tripType });
                return url ? (
                  <a key={origin} href={url} target="_blank" rel="noreferrer" className="btn-fm-primary btn-sm-fm">
                    {origin} → {code}
                  </a>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Secondary actions */}
        <div className="wc-actions">
          <button type="button" className="btn btn-outline-light btn-sm" onClick={onViewAlternatives}>
            Ver otras opciones
          </button>
          <button type="button" className="btn btn-outline-light btn-sm" onClick={onShare}>
            {shareStatus === "ok" ? "¡Copiado!" : shareStatus === "fail" ? "Error al copiar" : "Compartir"}
          </button>
          <button type="button" className="btn btn-link text-white text-decoration-none btn-sm" onClick={onChangeSearch}>
            Cambiar búsqueda
          </button>
        </div>

        <div className="wc-disclaimer">Precios estimados vía Amadeus API. Pueden variar al reservar.</div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // View: 'landing' | 'search' | 'results'
  const [view, setView] = useState("landing");

  // Search params
  const [origins,       setOrigins]       = useState([""]);
  const [tripType,      setTripType]      = useState("oneway");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate,    setReturnDate]    = useState("");
  const [optimizeBy,    setOptimizeBy]    = useState("total");
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [maxBudget,     setMaxBudget]     = useState(200);

  // Results
  const [flights,         setFlights]         = useState([]);
  const [bestByCriterion, setBestByCriterion] = useState({ total: null, fairness: null });
  const [uiCriterion,     setUiCriterion]     = useState("total");
  const [showAlt,         setShowAlt]         = useState(false);

  // UI state
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [shareStatus, setShareStatus] = useState("");

  // Keep Render backend alive (free tier sleeps)
  useEffect(() => {
    const ping = () => fetch(`${API_BASE}/api/ping`, { cache: "no-store" }).catch(() => {});
    ping();
    const t = setInterval(ping, 8 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const bestDestination = bestByCriterion[uiCriterion] || bestByCriterion.total || null;

  const cleanOrigins = useMemo(
    () => [...new Set(origins.map((o) => String(o || "").trim().toUpperCase()).filter(Boolean))],
    [origins]
  );

  // ── Compute best for each criterion ────────────────────────────────────────

  function pickBest(arr, mode) {
    if (!arr?.length) return null;
    return arr.reduce((best, cur) => {
      if (mode === "fairness") {
        if (cur.fairnessScore > best.fairnessScore) return cur;
        if (cur.fairnessScore === best.fairnessScore && cur.totalCostEUR < best.totalCostEUR) return cur;
        return best;
      }
      return cur.totalCostEUR < best.totalCostEUR ? cur : best;
    });
  }

  // ── Handle criterion toggle ─────────────────────────────────────────────────

  const handleCriterion = (mode) => {
    setUiCriterion(mode);
    setShowAlt(false);
  };

  // ── Share ───────────────────────────────────────────────────────────────────

  const handleShare = async () => {
    if (!bestDestination) return;
    const bd = bestDestination;
    const code = normalizeCode(bd.destination);
    const lines = [
      `FlyndMe · Destino recomendado: ${destLabel(code)}`,
      `Total grupo: ${formatEur(bd.totalCostEUR, 2)} · Media: ${formatEur(bd.averageCostPerTraveler, 2)}`,
      `Equidad: ${(bd.fairnessScore ?? 0).toFixed(0)}/100`,
      `Fecha: ${bd.bestDate || departureDate}${tripType === "roundtrip" ? ` → ${bd.bestReturnDate || returnDate}` : ""}`,
    ];
    if (Array.isArray(bd.flights) && bd.flights.length) {
      lines.push("Por origen: " + bd.flights.map((f) => `${f.origin}: ${formatEur(f.price, 0)}`).join(" · "));
    }
    const ok = await copyText(lines.join("\n"));
    setShareStatus(ok ? "ok" : "fail");
    setTimeout(() => setShareStatus(""), 2500);
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!cleanOrigins.length) { setError("Introduce al menos un aeropuerto de origen."); return; }
    if (!departureDate)        { setError("Selecciona una fecha de salida."); return; }
    if (tripType === "roundtrip") {
      if (!returnDate)               { setError("Selecciona una fecha de vuelta."); return; }
      if (returnDate <= departureDate) { setError("La fecha de vuelta debe ser posterior a la de salida."); return; }
    }

    setFlights([]);
    setBestByCriterion({ total: null, fairness: null });
    setShowAlt(false);
    setLoading(true);

    try {
      const body = {
        origins: cleanOrigins,
        departureDate,
        tripType,
        optimizeBy,
        dateMode: "exact",
        flexDays: 0,
        ...(tripType === "roundtrip" && { returnDate }),
        ...(budgetEnabled && { maxBudgetPerTraveler: maxBudget }),
      };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Error ${res.status}`);
      }

      const data = await res.json();
      const arr  = Array.isArray(data.flights) ? data.flights : [];

      if (!arr.length) {
        setError(
          budgetEnabled
            ? "Sin resultados con ese presupuesto. Sube el máximo o desactiva el filtro."
            : "Sin resultados para esos orígenes y fechas. Prueba otras fechas o aeropuertos."
        );
        return;
      }

      setFlights(arr);
      setBestByCriterion({ total: pickBest(arr, "total"), fairness: pickBest(arr, "fairness") });
      setUiCriterion(optimizeBy);
      setView("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message || "Error inesperado. Vuelve a intentarlo.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="container d-flex align-items-center justify-content-between" style={{ maxWidth: 1080 }}>
          <div className="app-logo" onClick={() => { setView("landing"); setFlights([]); setBestByCriterion({ total: null, fairness: null }); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setView("landing")}>
            <img src={`${getBaseUrl()}logo-flyndme.svg`} alt="FlyndMe" height={28}
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <span className="app-logo-name">FlyndMe</span>
            <span className="app-logo-sub">Meet smarter, fly fair</span>
          </div>
          {view !== "landing" && (
            <button type="button" className="btn btn-sm btn-outline-secondary"
              onClick={() => { setView("search"); setShowAlt(false); }}>
              {view === "results" ? "Nueva búsqueda" : "Inicio"}
            </button>
          )}
        </div>
      </header>

      {/* Loading bar */}
      <SearchProgress loading={loading} />

      {/* Views */}
      {view === "landing" && <Landing onStart={() => setView("search")} />}

      {view === "search" && (
        <SearchPage
          origins={origins}           setOrigins={setOrigins}
          tripType={tripType}         setTripType={setTripType}
          departureDate={departureDate} setDepartureDate={setDepartureDate}
          returnDate={returnDate}     setReturnDate={setReturnDate}
          optimizeBy={optimizeBy}     setOptimizeBy={setOptimizeBy}
          budgetEnabled={budgetEnabled} setBudgetEnabled={setBudgetEnabled}
          maxBudget={maxBudget}       setMaxBudget={setMaxBudget}
          loading={loading}           error={error}
          onSubmit={handleSubmit}
        />
      )}

      {view === "results" && bestDestination && (
        <main className="container py-4" style={{ maxWidth: 1080 }}>
          <WinnerCard
            dest={bestDestination}
            origins={cleanOrigins}
            tripType={tripType}
            returnDate={returnDate}
            uiCriterion={uiCriterion}
            onChangeCriterion={handleCriterion}
            flightsCount={flights.length}
            onShare={handleShare}
            shareStatus={shareStatus}
            onViewAlternatives={() => setShowAlt((v) => !v)}
            onChangeSearch={() => setView("search")}
          />

          {showAlt && flights.length > 1 && (
            <div className="mt-4">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h3 className="h5 fw-bold mb-0" style={{ color: "#0F172A" }}>Otras opciones</h3>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowAlt(false)}>Ocultar</button>
              </div>
              <ErrorBoundary>
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
        </main>
      )}

      <footer className="app-footer">
        <div className="container" style={{ maxWidth: 1080 }}>
          FlyndMe · Prototipo funcional · React + Node.js + Amadeus API
        </div>
      </footer>
    </div>
  );
}
