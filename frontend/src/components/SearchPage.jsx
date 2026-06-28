// ─── SearchPage ──────────────────────────────────────────────────────────────
// Extraída de App.jsx (Mejora 20). Formulario de búsqueda completo: orígenes,
// pasajeros, fechas (con avisos), destinos opcionales, opciones avanzadas.
import React, { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useI18n } from "../i18n/useI18n";
import { Check, Plus, Map as MapIcon, User, Users, ArrowUp, ArrowDown, X, GripVertical, AlertTriangle, Zap, Lightbulb, Hand, List } from "lucide-react";
import {
  AIRPORTS, AIRPORT_MAP, normalizeCode, cityOf, destLabel, formatEur,
  formatDate, weekdayOf, todayISO, countryFlag,
} from "../utils/helpers";
import { FriendlyError } from "./UiBits";
import { useFocusTrap } from "../hooks/useFocusTrap";

// Placeholder animado del buscador (vivía en App.jsx antes del troceo; su
// único consumidor es este componente).
const TYPING_EXAMPLES = ["Madrid", "London", "Berlin", "Rome", "Paris", "Lisbon", "MAD", "LON", "BCN"];

function useDateWarnings(departureDate, returnDate, tripType) {
  const { t } = useI18n();
  return useMemo(() => {
    const warnings = [];
    if (!departureDate) return warnings;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dep = new Date(departureDate + "T00:00:00");

    if (dep < today) {
      warnings.push({ key: "past", text: t("search.dateWarnPast"), type: "error" });
    } else {
      const diffDays = Math.round((dep - today) / 86400000);
      if (diffDays <= 3) {
        warnings.push({ key: "soon", text: t("search.dateWarnSoon"), type: "warn" });
      }
      if (diffDays > 330) {
        warnings.push({ key: "far", text: t("search.dateWarnFar"), type: "warn" });
      }
      if (diffDays >= 42 && diffDays <= 56) {
        warnings.push({ key: "sweet", text: t("search.dateWarnSweet"), type: "tip" });
      }
    }

    if (tripType === "roundtrip" && returnDate && departureDate) {
      const ret = new Date(returnDate + "T00:00:00");
      const tripLen = Math.round((ret - dep) / 86400000);
      if (tripLen > 30) {
        warnings.push({ key: "long", text: t("search.dateWarnLong"), type: "warn" });
      }
    }

    return warnings;
  }, [departureDate, returnDate, tripType, t]);
}

// Carrusel de tecleo COMPARTIDO: un único reloj (un setInterval) avanza un
// `base` (qué palabra empieza la fila 0) y un `char` (progreso de tecleo)
// comunes a TODOS los inputs vacíos. Cada fila `idx` muestra
// TYPING_EXAMPLES[(base + idx) % N] cortada a `char`, así escriben a la vez
// ciudades DISTINTAS y rotan en sincronía. Como N=9 > 8 orígenes máx, dos
// filas vacías nunca enseñan la misma ciudad simultáneamente.
const TYPING_MAXLEN = Math.max(...TYPING_EXAMPLES.map((w) => w.length));
const TYPING_TICK_MS = 120;      // ritmo del reloj (typewriter)
const TYPING_HOLD_FULL = 7;      // pausa con la palabra completa (legible)
const TYPING_HOLD_EMPTY = 2;     // pausa en blanco antes de la siguiente

function useTypingCarousel(active) {
  const [, force] = useState(0);
  // base = índice de la palabra de la fila 0; char = letras visibles;
  // typing = true mientras se TECLEA (cursor), false al borrar/en pausa;
  // hold = ticks restantes de pausa.
  const stateRef = useRef({ base: 0, char: 0, typing: true, hold: 0 });

  useEffect(() => {
    if (!active) return undefined;
    stateRef.current = { base: 0, char: 0, typing: true, hold: 0 };
    force((n) => n + 1);
    const id = setInterval(() => {
      const s = stateRef.current;
      if (s.hold > 0) {
        s.hold -= 1;
      } else if (s.typing) {
        s.char += 1;
        if (s.char >= TYPING_MAXLEN) {
          s.char = TYPING_MAXLEN;
          s.typing = false;          // palabra completa → quita cursor y descansa
          s.hold = TYPING_HOLD_FULL;
        }
      } else {
        s.char -= 1;
        if (s.char <= 0) {
          s.char = 0;
          s.base = (s.base + 1) % TYPING_EXAMPLES.length; // rota a la siguiente
          s.typing = true;
          s.hold = TYPING_HOLD_EMPTY;
        }
      }
      force((n) => n + 1);
    }, TYPING_TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  const s = stateRef.current;
  return { base: s.base, char: s.char, typing: s.typing };
}

const SearchPage = React.memo(function SearchPage({
  origins, setOrigins,
  tripType, setTripType,
  departureDate, setDepartureDate,
  returnDate, setReturnDate,
  optimizeBy, setOptimizeBy,
  budgetEnabled, setBudgetEnabled,
  maxBudget, setMaxBudget,
  flexEnabled, setFlexEnabled,
  flexDays, setFlexDays,
  selectedDests, setSelectedDests,
  passengers, setPassengers,
  directOnly, setDirectOnly,
  cabinClass, setCabinClass,
  currency, setCurrency,
  loading, error,
  onSubmit, onCreateGroup, groupBusy,
  recentSearches, onLoadRecent, onClearRecent,
}) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [showMobileAirports, setShowMobileAirports] = useState(false);
  // Focus-trap solo cuando actúa como bottom drawer modal en móvil (en
  // escritorio es un sidebar inline y showMobileAirports nunca se activa:
  // el botón que lo abre está display:none).
  const drawerTrapRef = useFocusTrap(showMobileAirports, () => setShowMobileAirports(false));
  const [acFocus, setAcFocus] = useState(-1); // which origin input has autocomplete open
  const [acHighlight, setAcHighlight] = useState(0); // keyboard nav index
  const [dragIdx, setDragIdx] = useState(-1); // drag-drop reorder
  const [dragOver, setDragOver] = useState(-1);

  // Animated typing placeholder for ALL empty origin inputs, coordinated by a
  // single shared clock (every empty input shows a different rotating city).
  // El reloj se PAUSA mientras un input de origen está enfocado (acFocus >= 0):
  // así no compite por re-renders con el typing del usuario (el update del
  // input usa startTransition) y no distrae mientras escribe. Los spans siguen
  // visibles (congelados) en los inputs vacíos no enfocados.
  const showTyping = !loading && origins.some((o) => !o?.trim());
  const { base: typingBase, char: typingChar, typing: typingActive } = useTypingCarousel(showTyping && acFocus < 0);

  const dateWarnings = useDateWarnings(departureDate, returnDate, tripType);

  const safeIdx = activeIdx >= 0 && activeIdx < origins.length ? activeIdx : 0;
  const filterVal = origins[safeIdx]?.trim().toLowerCase() || "";

  // Memoize airport filtering to avoid blocking the main thread on every keystroke (fixes INP)
  const filtered = useMemo(() => {
    if (!filterVal) return AIRPORTS;
    return AIRPORTS.filter((a) =>
      a.code.toLowerCase().includes(filterVal) ||
      a.city.toLowerCase().includes(filterVal) ||
      a.country.toLowerCase().includes(filterVal)
    );
  }, [filterVal]);

  // Inline autocomplete suggestions (max 5, only when typing 1+ chars)
  const acSuggestions = useMemo(() => {
    if (acFocus < 0) return [];
    const val = (origins[acFocus] || "").trim().toLowerCase();
    if (!val || val.length < 1) return [];
    // Don't show if already a valid code
    if (AIRPORT_MAP[val.toUpperCase()]) return [];
    return AIRPORTS.filter((a) =>
      a.code.toLowerCase().includes(val) ||
      a.city.toLowerCase().includes(val)
    ).slice(0, 5);
  }, [acFocus, origins]);

  // Memoize destination airports (excludes selected origins)
  const destAirports = useMemo(() => {
    const originCodes = new Set(origins.map(o => normalizeCode(o)));
    return AIRPORTS.filter(a => !originCodes.has(a.code));
  }, [origins]);

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

  // Show city name next to code in the origin input
  const originDisplay = (val) => {
    const code = normalizeCode(val);
    const city = cityOf(code);
    return city ? `${code}` : val;
  };

  return (
    <div className="container py-4" style={{ maxWidth: 960 }}>
      <div className="sf-grid">
        {/* ── Left: form ── */}
        <div className="sf-form fm-card">
          <h2 className="sf-title">{t("search.title")}</h2>
          <p className="sf-sub">{t("search.subtitle")}</p>

          {/* Recent searches */}
          {recentSearches?.length > 0 && !loading && (
            <div className="sf-recent">
              <div className="sf-recent-header">
                <span className="sf-recent-title">{t("recentSearches.title")}</span>
                <button type="button" className="sf-recent-clear" onClick={onClearRecent}>{t("recentSearches.clear")}</button>
              </div>
              <div className="sf-recent-chips">
                {recentSearches.map((r, i) => (
                  <button key={i} type="button" className="sf-recent-chip" onClick={() => onLoadRecent(r)}>
                    <span className="sf-recent-origins">{r.origins.join(" · ")}</span>
                    <span className="sf-recent-date">{r.departureDate}{r.tripType === "roundtrip" ? ` ↔ ${r.returnDate}` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            {/* Empty state prompt */}
            {origins.length === 1 && !origins[0].trim() && !loading && (
              <div className="sf-empty-state">
                <div className="sf-empty-icon"><MapIcon size={28} aria-hidden="true" /></div>
                <div className="sf-empty-text">{t("search.emptyHint")}</div>
              </div>
            )}

            {/* Trip type + Dates combined */}
            <div className="sf-section">
              <div className="sf-label">{t("search.tripTypeLabel")}</div>
              <div className="sf-pills" style={{ marginBottom: 16 }} role="group" aria-label={t("search.tripTypeLabel")}>
                {[["oneway", t("search.oneway")], ["roundtrip", t("search.roundtrip")]].map(([v, l]) => (
                  <button key={v} type="button"
                    aria-pressed={tripType === v}
                    className={`sf-pill ${tripType === v ? "sf-pill--active" : ""}`}
                    onClick={() => {
                      setTripType(v);
                      // Auto-suggest return date when switching to roundtrip
                      if (v === "roundtrip" && !returnDate && departureDate) {
                        const d = new Date(departureDate + "T00:00:00");
                        d.setDate(d.getDate() + 7);
                        setReturnDate(d.toISOString().slice(0, 10));
                      }
                    }} disabled={loading}>{l}</button>
                ))}
              </div>

              <div className="sf-label">{t("search.datesLabel")}</div>
              <div className="row g-3">
                <div className={tripType === "roundtrip" ? "col-sm-6" : "col-12"}>
                  <label className="sf-input-label" htmlFor="sf-date-dep">{t("search.departure")}</label>
                  <div className="sf-date-wrap">
                    <input type="date" id="sf-date-dep" className="form-control sf-input"
                      value={departureDate} min={todayISO()}
                      onChange={(e) => setDepartureDate(e.target.value)} disabled={loading} />
                    {departureDate && <span className={`sf-weekday-badge${["Tue","Wed"].includes(weekdayOf(departureDate)) ? " sf-weekday-badge--cheap" : ""}`}>{weekdayOf(departureDate)}</span>}
                  </div>
                </div>
                {tripType === "roundtrip" && (
                  <div className="col-sm-6">
                    <label className="sf-input-label" htmlFor="sf-date-ret">{t("search.return")}</label>
                    <div className="sf-date-wrap">
                      <input type="date" id="sf-date-ret" className="form-control sf-input"
                        value={returnDate} min={departureDate || todayISO()}
                        onChange={(e) => setReturnDate(e.target.value)} disabled={loading} />
                      {returnDate && <span className={`sf-weekday-badge${["Tue","Wed"].includes(weekdayOf(returnDate)) ? " sf-weekday-badge--cheap" : ""}`}>{weekdayOf(returnDate)}</span>}
                    </div>
                  </div>
                )}
              </div>

              {/* Date warnings */}
              {dateWarnings.length > 0 && (
                <div className="sf-date-warnings mt-2">
                  {dateWarnings.map((w) => (
                    <div key={w.key} className={`sf-date-warn sf-date-warn--${w.type}`}>
                      <span className="sf-date-warn-icon">{w.type === "error" ? <AlertTriangle size={15} /> : w.type === "warn" ? <Zap size={15} /> : <Lightbulb size={15} />}</span>
                      <span>{w.text}</span>
                    </div>
                  ))}
                </div>
              )}

            </div>

            {/* Origins */}
            <div className="sf-section">
              <div className="sf-label">{t("search.originLabel")}</div>
              {origins.map((origin, idx) => {
                const code = normalizeCode(origin);
                const city = cityOf(code);
                const isUnknown = origin.trim().length >= 3 && !city;
                const empty = !origin.trim();
                // Cada fila vacía teclea una ciudad distinta, desfasada por idx
                // sobre el mismo reloj compartido (base 0 → Madrid/London/Berlin).
                const typingSlice = empty && showTyping
                  ? TYPING_EXAMPLES[(typingBase + idx) % TYPING_EXAMPLES.length].slice(0, typingChar)
                  : "";
                return (
                  <div key={idx}
                    className={`sf-origin-row${dragIdx === idx ? " sf-origin-row--dragging" : ""}${dragOver === idx ? " sf-origin-row--dragover" : ""}`}
                    draggable={origins.length > 1 && !loading}
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
                    onDragLeave={() => setDragOver(-1)}
                    onDrop={() => {
                      if (dragIdx >= 0 && dragIdx !== idx) {
                        const o = [...origins]; const p = [...passengers];
                        const [oItem] = o.splice(dragIdx, 1); o.splice(idx, 0, oItem);
                        const [pItem] = p.splice(dragIdx, 1); p.splice(idx, 0, pItem);
                        setOrigins(o); setPassengers(p);
                      }
                      setDragIdx(-1); setDragOver(-1);
                    }}
                    onDragEnd={() => { setDragIdx(-1); setDragOver(-1); }}>
                    {origins.length > 1 && <span className="sf-drag-handle" title="Drag to reorder" aria-hidden="true"><GripVertical size={14} /></span>}
                    <span className="sf-badge" title={t("search.travelerTooltip", { n: idx + 1 })}>
                      <span className="sf-badge-icon"><User size={12} aria-hidden="true" /></span>{idx + 1}
                    </span>
                    <div className="sf-input-wrap">
                      {/* Typing placeholder animation (coordinated across all empty inputs) */}
                      {empty && showTyping && typingSlice && (
                        <span className={`sf-typing-placeholder${typingActive ? " sf-typing-placeholder--active" : ""}`}>
                          {typingSlice}
                        </span>
                      )}
                      <input
                        type="text"
                        className={`form-control sf-input text-uppercase${isUnknown ? " sf-input--unknown" : ""}`}
                        placeholder={empty && showTyping ? "" : t("search.placeholder")}
                        aria-label={t("search.originAria", { n: idx + 1 })}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={acFocus === idx && acSuggestions.length > 0}
                        aria-controls={`sf-ac-list-${idx}`}
                        value={origin}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          startTransition(() => {
                            const copy = [...origins];
                            copy[idx] = val;
                            setOrigins(copy);
                          });
                          setAcFocus(idx);
                          setAcHighlight(0);
                        }}
                        onFocus={() => { setActiveIdx(idx); setAcFocus(idx); setAcHighlight(0); }}
                        onBlur={() => setTimeout(() => setAcFocus(-1), 150)}
                        onKeyDown={(e) => {
                          if (acFocus === idx && acSuggestions.length > 0) {
                            if (e.key === "ArrowDown") { e.preventDefault(); setAcHighlight((h) => Math.min(h + 1, acSuggestions.length - 1)); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setAcHighlight((h) => Math.max(h - 1, 0)); }
                            else if (e.key === "Enter" && acSuggestions[acHighlight]) {
                              e.preventDefault();
                              const copy = [...origins]; copy[idx] = acSuggestions[acHighlight].code; setOrigins(copy); setAcFocus(-1);
                            }
                          }
                        }}
                        disabled={loading}
                        autoComplete="off"
                      />
                      {/* Inline autocomplete dropdown */}
                      {acFocus === idx && acSuggestions.length > 0 && (
                        <div className="sf-ac-dropdown" role="listbox" id={`sf-ac-list-${idx}`}>
                          {acSuggestions.map((a, ai) => (
                            <div key={a.code}
                              role="option"
                              aria-selected={ai === acHighlight}
                              className={`sf-ac-item${ai === acHighlight ? " sf-ac-item--hl" : ""}`}
                              onMouseDown={(e) => { e.preventDefault(); const copy = [...origins]; copy[idx] = a.code; setOrigins(copy); setAcFocus(-1); }}
                              onMouseEnter={() => setAcHighlight(ai)}>
                              <span className="sf-ac-code">{a.code}</span>
                              <span className="sf-ac-city">{a.city}</span>
                              <span className="sf-ac-country">{countryFlag(a.code)} {a.country}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {city && origin.trim() && (
                        <span className="sf-input-city">{countryFlag(code)} {city}</span>
                      )}
                      {isUnknown && (
                        <span className="sf-input-unknown">{t("search.unknownAirport")}</span>
                      )}
                    </div>
                    {/* Passenger count stepper */}
                    <div className="sf-pax" title={t("search.paxTooltip")} role="group" aria-label={t("search.paxTooltip")}>
                      <button type="button" className="sf-pax-btn" aria-label={t("search.paxDecrease")}
                        onClick={() => { const p = [...passengers]; p[idx] = Math.max(1, (p[idx] || 1) - 1); setPassengers(p); }}
                        disabled={loading || (passengers[idx] || 1) <= 1}>−</button>
                      <span className="sf-pax-count">{passengers[idx] || 1}</span>
                      <button type="button" className="sf-pax-btn" aria-label={t("search.paxIncrease")}
                        onClick={() => { const p = [...passengers]; p[idx] = Math.min(9, (p[idx] || 1) + 1); setPassengers(p); }}
                        disabled={loading || (passengers[idx] || 1) >= 9}>+</button>
                    </div>
                    {/* Reorder + remove */}
                    <div className="sf-origin-actions-inline">
                      {origins.length > 1 && idx > 0 && (
                        <button type="button" className="sf-reorder-btn" disabled={loading} title={t("search.moveUp")} aria-label={t("search.moveUp")}
                          onClick={() => {
                            const o = [...origins]; const p = [...passengers];
                            [o[idx], o[idx - 1]] = [o[idx - 1], o[idx]];
                            [p[idx], p[idx - 1]] = [p[idx - 1], p[idx]];
                            setOrigins(o); setPassengers(p); setActiveIdx(idx - 1);
                          }} aria-hidden="false"><ArrowUp size={15} /></button>
                      )}
                      {origins.length > 1 && idx < origins.length - 1 && (
                        <button type="button" className="sf-reorder-btn" disabled={loading} title={t("search.moveDown")} aria-label={t("search.moveDown")}
                          onClick={() => {
                            const o = [...origins]; const p = [...passengers];
                            [o[idx], o[idx + 1]] = [o[idx + 1], o[idx]];
                            [p[idx], p[idx + 1]] = [p[idx + 1], p[idx]];
                            setOrigins(o); setPassengers(p); setActiveIdx(idx + 1);
                          }}><ArrowDown size={15} /></button>
                      )}
                    </div>
                    {origins.length > 1 && (
                      <button
                        type="button"
                        className="sf-remove"
                        onClick={() => {
                          const copy = origins.filter((_, i) => i !== idx);
                          const pCopy = passengers.filter((_, i) => i !== idx);
                          setOrigins(copy.length ? copy : [""]);
                          setPassengers(pCopy.length ? pCopy : [1]);
                          setActiveIdx(Math.min(safeIdx, copy.length - 1));
                        }}
                        disabled={loading}
                        title={t("search.removeTitle")}
                        aria-label={t("search.removeTitle")}
                      ><X size={16} /></button>
                    )}
                  </div>
                );
              })}
              <div className="sf-origin-actions">
                <button type="button" className="sf-add-btn" onClick={() => { setOrigins([...origins, ""]); setPassengers([...passengers, 1]); setActiveIdx(origins.length); }} disabled={loading || origins.length >= 8}>
                  {t("search.addTraveler")}
                </button>
                <button type="button" className="sf-pick-btn" onClick={() => setShowMobileAirports(true)} disabled={loading}>
                  <List size={14} aria-hidden="true" /> {t("search.pickAirport")}
                </button>
                {origins.length === 1 && !origins[0].trim() && (
                  <button type="button" className="sf-example-btn" onClick={() => {
                    setOrigins(["MAD", "LON", "BER"]);
                    setPassengers([1, 1, 1]);
                    setActiveIdx(0);
                  }} disabled={loading}>
                    {t("search.tryExample")}
                  </button>
                )}
              </div>
            </div>

            {/* Advanced options toggle */}
            <button
              type="button"
              className="sf-advanced-toggle"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? t("search.hideAdvanced") : t("search.showAdvanced")}
              <span className={`sf-advanced-arrow${showAdvanced ? " sf-advanced-arrow--open" : ""}`} aria-hidden="true">▾</span>
            </button>

            {/* Advanced: Flex dates + Optimize + Budget */}
            {showAdvanced && (
              <div className="sf-advanced-panel">
                {/* Flexible dates */}
                <div className="sf-section">
                  <div className="d-flex align-items-center justify-content-between">
                    <div>
                      <div className="sf-label mb-0">{t("search.flexLabel")}</div>
                      <div className="sf-hint">
                        {flexEnabled
                          ? t("search.flexHintOn", { days: flexDays })
                          : t("search.flexHintOff")}
                      </div>
                    </div>
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" id="flexSwitch"
                        checked={flexEnabled} onChange={(e) => setFlexEnabled(e.target.checked)} disabled={loading} />
                    </div>
                  </div>
                  {flexEnabled && (
                    <div className="sf-flex-pills mt-2" role="group" aria-label={t("search.flexLabel")}>
                      {[1, 2, 3].map((d) => (
                        <button key={d} type="button"
                          aria-pressed={flexDays === d}
                          className={`sf-pill sf-pill--sm${flexDays === d ? " sf-pill--active" : ""}`}
                          onClick={() => setFlexDays(d)} disabled={loading}>
                          ±{d} {t("search.flexDaysUnit")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Optimize */}
                <div className="sf-section">
                  <div className="sf-label">
                    {t("search.optimizeLabel")}
                    {/* aria-hidden: el texto de ayuda ya está visible en sf-hint debajo */}
                    <span className="sf-label-help" title={t("search.optimizeHelp")} aria-hidden="true">?</span>
                  </div>
                  <div className="sf-pills" role="group" aria-label={t("search.optimizeLabel")}>
                    {[["total", t("search.optTotal")], ["fairness", t("search.optFairness")]].map(([v, l]) => (
                      <button key={v} type="button"
                        aria-pressed={optimizeBy === v}
                        className={`sf-pill ${optimizeBy === v ? "sf-pill--active" : ""}`}
                        onClick={() => setOptimizeBy(v)} disabled={loading}>{l}</button>
                    ))}
                  </div>
                  <div className="sf-hint mt-1">{t("search.optimizeHint")}</div>
                </div>

                {/* Budget */}
                <div className="sf-section">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <div className="sf-label mb-0">{t("search.budgetLabel")}</div>
                      <div className="sf-hint">
                        {budgetEnabled ? t("search.budgetHintOn", { amount: formatEur(maxBudget) }) : t("search.budgetHintOff")}
                      </div>
                    </div>
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" id="budgetSwitch"
                        checked={budgetEnabled} onChange={(e) => setBudgetEnabled(e.target.checked)} disabled={loading} />
                      <label className="form-check-label small" htmlFor="budgetSwitch">
                        {budgetEnabled ? t("search.budgetOn") : t("search.budgetOff")}
                      </label>
                    </div>
                  </div>
                  {budgetEnabled && (
                    <div className="sf-budget-box mt-3">
                      <input type="range" className="form-range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP}
                        aria-label={t("search.budgetLabel")}
                        value={maxBudget} onChange={(e) => setMaxBudget(Number(e.target.value))} disabled={loading} />
                      <div className="d-flex justify-content-between small" style={{ color: "var(--slate-500)" }}>
                        <span>{formatEur(BUDGET_MIN)}</span>
                        <strong>{formatEur(maxBudget)}</strong>
                        <span>{formatEur(BUDGET_MAX)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Direct flights only */}
                <div className="sf-section">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <div className="sf-label mb-0">{t("search.directOnly")}</div>
                      <div className="sf-hint">{t("search.directHint")}</div>
                    </div>
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" id="directSwitch"
                        checked={directOnly} onChange={(e) => setDirectOnly(e.target.checked)} disabled={loading} />
                    </div>
                  </div>
                </div>

                {/* Cabin class */}
                <div className="sf-section">
                  <div className="sf-label mb-1">{t("search.cabinLabel")}</div>
                  <div className="sf-pills" role="group" aria-label={t("search.cabinLabel")}>
                    {[["ECONOMY", t("search.cabinEconomy")], ["PREMIUM_ECONOMY", t("search.cabinPremium")], ["BUSINESS", t("search.cabinBusiness")]].map(([v, l]) => (
                      <button key={v} type="button"
                        aria-pressed={cabinClass === v}
                        className={`sf-pill sf-pill--sm${cabinClass === v ? " sf-pill--active" : ""}`}
                        onClick={() => setCabinClass(v)} disabled={loading}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Currency selector */}
                <div className="sf-section">
                  <div className="sf-label mb-1">{t("search.currencyLabel")}</div>
                  <div className="sf-pills" role="group" aria-label={t("search.currencyLabel")}>
                    {["EUR", "GBP", "USD"].map((c) => (
                      <button key={c} type="button"
                        aria-pressed={currency === c}
                        className={`sf-pill sf-pill--sm${currency === c ? " sf-pill--active" : ""}`}
                        onClick={() => setCurrency(c)} disabled={loading}>
                        {c === "EUR" ? "€ EUR" : c === "GBP" ? "£ GBP" : "$ USD"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Destination filter */}
                <div className="sf-section">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <div className="sf-label mb-0">{t("search.destLabel")}</div>
                      <div className="sf-hint">
                        {selectedDests.length > 0
                          ? t("search.destSelected", { n: selectedDests.length })
                          : t("search.destAll")}
                      </div>
                    </div>
                    <button type="button" className="btn btn-sm btn-outline-primary"
                      onClick={() => setShowDestPicker((v) => !v)} disabled={loading}>
                      {showDestPicker ? t("search.destHide") : t("search.destChoose")}
                    </button>
                  </div>
                  {showDestPicker && (
                    <div className="sf-dest-picker mt-3">
                      {/* Quick category filters */}
                      <div className="sf-dest-categories">
                        {[
                          ["all",     t("search.destCatAll"),     []],
                          ["beach",   t("search.destCatBeach"),   ["AGP","PMI","TFS","NCE","MLA","DBV","SPU","RHO","TLV"]],
                          ["budget",  t("search.destCatBudget"),  ["OPO","NAP","KRK","BEG","OTP","SOF","TIA","RAK","TLL","RIX","VNO","SKG"]],
                          ["capital", t("search.destCatCapital"), ["LON","PAR","ROM","BER","MAD","LIS","VIE","PRG","ATH","CPH","BUD","DUB","BRU","WAW","OSL","HEL","STO"]],
                        ].map(([key, label, codes]) => (
                          <button key={key} type="button"
                            className={`sf-pill sf-pill--sm${key === "all" && selectedDests.length === 0 ? " sf-pill--active" : ""}`}
                            onClick={() => {
                              if (key === "all") setSelectedDests([]);
                              else setSelectedDests(codes);
                            }} disabled={loading}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {/* Individual city toggles */}
                      <div className="sf-dest-grid">
                        {destAirports.map((a) => {
                          const isOn = selectedDests.length === 0 || selectedDests.includes(a.code);
                          return (
                            <button key={a.code} type="button"
                              aria-pressed={isOn}
                              className={`sf-dest-chip${isOn ? " sf-dest-chip--on" : ""}`}
                              onClick={() => {
                                if (selectedDests.length === 0) {
                                  // Switch from "all" to "all except this one"
                                  setSelectedDests(destAirports.map(x => x.code).filter(c => c !== a.code));
                                } else if (selectedDests.includes(a.code)) {
                                  setSelectedDests(selectedDests.filter(c => c !== a.code));
                                } else {
                                  setSelectedDests([...selectedDests, a.code]);
                                }
                              }} disabled={loading}>
                              <span className="sf-dest-chip-code">{a.code}</span>
                              <span className="sf-dest-chip-city">{a.city}</span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedDests.length > 0 && (
                        <button type="button" className="sf-dest-clear" onClick={() => setSelectedDests([])} disabled={loading}>
                          {t("search.destReset")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && <FriendlyError message={error} onRetry={onSubmit} />}

            {/* Traveler summary bar */}
            {origins.some((o) => o.trim()) && (
              <div className="sf-summary-bar">
                <div className="sf-summary-travelers">
                  {origins.filter((o) => o.trim()).map((o, i) => {
                    const c = normalizeCode(o);
                    const flag = countryFlag(c);
                    return (
                      <span key={i} className="sf-summary-chip" title={cityOf(c) || c}>
                        {flag && <span className="sf-summary-flag">{flag}</span>}
                        {c}
                        {(passengers[origins.indexOf(o)] || 1) > 1 && (
                          <span className="sf-summary-pax">×{passengers[origins.indexOf(o)]}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div className="sf-summary-meta">
                  {(() => {
                    const totalPax = origins.filter(o => o.trim()).reduce((s, o, i) => s + (passengers[i] || 1), 0);
                    return totalPax > 1 ? <span className="sf-summary-pax-total"><Users size={14} aria-hidden="true" /> {totalPax} {t("search.paxLabel")}</span> : null;
                  })()}
                  {departureDate && <span>{formatDate(departureDate)}</span>}
                  {tripType === "roundtrip" && returnDate && <span> → {formatDate(returnDate)}</span>}
                  {flexEnabled && <span className="sf-summary-flex">±{flexDays}d</span>}
                </div>
              </div>
            )}

            <div className="sf-submit-wrap">
              <button type="submit" className={`btn-fm-primary w-100 py-3 fw-bold fs-6${!loading && origins.some(o => o.trim()) && departureDate ? " sf-submit--ready" : ""}`} disabled={loading}>
                {loading ? t("search.searching") : t("search.submit")}
              </button>
              {onCreateGroup && (
                <button type="button" className="sf-group-cta" onClick={onCreateGroup} disabled={loading || groupBusy}>
                  <Users size={16} className="lucide" /> {t("group.cta")}
                </button>
              )}
            </div>
            <div className="sf-footnote">
              <span>{t("search.footnoteTime")}</span>
              <span className="sf-kbd-hint">{t("search.kbdHint")}</span>
              <span>{t("search.footnotePrices")}</span>
            </div>
          </form>
        </div>

        {/* ── Right: airport picker (desktop sidebar / mobile bottom drawer) ── */}
        {showMobileAirports && <div className="sf-drawer-overlay" onClick={() => setShowMobileAirports(false)} />}
        <aside className={`sf-airports fm-card${showMobileAirports ? " sf-airports--open" : ""}`}
          ref={drawerTrapRef}
          role={showMobileAirports ? "dialog" : undefined}
          aria-modal={showMobileAirports ? "true" : undefined}
          aria-label={t("search.airportsTitle")}>
          <div className="sf-drawer-handle" onClick={() => setShowMobileAirports(false)} aria-hidden="true">
            <span className="sf-drawer-bar" />
          </div>
          <div className="sf-airports-header">
            <div className="sf-label">{t("search.airportsTitle")}</div>
            <button type="button" className="sf-drawer-close" onClick={() => setShowMobileAirports(false)}>
              {t("search.closeDrawer")}
            </button>
          </div>
          <div className="sf-picker-hint">
            <span className="sf-picker-hint-icon"><Hand size={15} aria-hidden="true" /></span>
            {t("search.airportsHint", { n: safeIdx + 1 })}
          </div>
          <div className="sf-airport-list">
            {filtered.map((a) => {
              const isSelected = origins.some((o) => normalizeCode(o) === a.code);
              return (
                <div key={a.code}
                  className={`sf-airport-item${isSelected ? " sf-airport-item--selected" : ""}`}
                  onClick={() => !loading && handleClickAirport(a.code)}
                  role="button" tabIndex={0} aria-pressed={isSelected}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!loading) handleClickAirport(a.code); } }}>
                  <span className="sf-airport-code">{a.code}</span>
                  <span className="sf-airport-city">{a.city}</span>
                  <span className="sf-airport-country">{a.country}</span>
                  {isSelected
                    ? <span className="sf-airport-check"><Check size={14} /></span>
                    : <span className="sf-airport-add" aria-hidden="true"><Plus size={15} /></span>}
                </div>
              );
            })}
            {!filtered.length && <div className="text-center small" style={{ color: "var(--slate-400)", padding: "16px 0" }}>{t("search.noMatches")}</div>}
          </div>
          {/* Guía rápida (solo desktop): da propósito a la columna cuando la
              lista de aeropuertos se filtra a pocos resultados. El CSS la oculta
              en móvil (donde la aside es un drawer). */}
          <div className="sf-aside-guide">
            <div className="sf-aside-guide-title">{t("search.asideGuideTitle")}</div>
            <ol className="sf-aside-guide-list">
              {(() => {
                const gs = t("search.asideGuideSteps");
                return Array.isArray(gs) ? gs.map((s, i) => (
                  <li key={i} className="sf-aside-guide-step">
                    <span className="sf-aside-guide-num">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                )) : null;
              })()}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
});

export default SearchPage;
