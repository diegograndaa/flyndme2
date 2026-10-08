// ─── SearchPage ──────────────────────────────────────────────────────────────
// Extraída de App.jsx (Mejora 20). Formulario de búsqueda completo: orígenes,
// pasajeros, fechas (con avisos), destinos opcionales, opciones avanzadas.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { Map as MapIcon, User, Users, ArrowUp, ArrowDown, X, GripVertical, AlertTriangle, Zap, Lightbulb, PlaneTakeoff, Plane } from "lucide-react";
import {
  AIRPORTS, AIRPORT_MAP, POPULAR_ORIGINS, normalizeCode, cityOf, destLabel, formatEur,
  formatDate, weekdayOf, todayISO, countryFlag, countryOf, searchAirports, foldText, resolveOriginCode,
} from "../utils/helpers";
import { FriendlyError } from "./UiBits";
import { Notice } from "./BoardPanels";
import { tapHaptic } from "../utils/haptics";
import { travelerSlot } from "../utils/resultsLogic";
import DateField from "./DateField";

// Placeholder animado del buscador (vivía en App.jsx antes del troceo; su
// único consumidor es este componente).
// Ciudades por código → se teclean con el nombre del idioma de la interfaz
// ("Londres", "Roma"…); los tres últimos enseñan que también vale el código.
const TYPING_CODES = ["MAD", "LON", "BER", "ROM", "PAR", "LIS"];
const TYPING_RAW = ["MAD", "LON", "BCN"];
const TYPING_COUNT = TYPING_CODES.length + TYPING_RAW.length;
const typingExample = (i) => (i < TYPING_CODES.length ? cityOf(TYPING_CODES[i]) : TYPING_RAW[i - TYPING_CODES.length]);

// Resalta en la sugerencia lo que coincide con lo escrito (sin acentos).
function MatchText({ text, q }) {
  const i = q ? foldText(text).indexOf(q) : -1;
  if (i < 0 || foldText(text).length !== String(text).length) return text;
  return <>{text.slice(0, i)}<mark className="sf-ac-mark">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

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
// typingExample((base + idx) % N) cortada a `char`, así escriben a la vez
// ciudades DISTINTAS y rotan en sincronía. Como N=9 > 8 orígenes máx, dos
// filas vacías nunca enseñan la misma ciudad simultáneamente.
const TYPING_MAXLEN = 8; // "Londres"/"Lisbon" caben; el resto se completa antes
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
          s.base = (s.base + 1) % TYPING_COUNT; // rota a la siguiente
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
  loading, error, errorHint = null, // { tag, text, detail, actionLabel, onAction }: alternativa real a un 0 resultados
  onSubmit, onCreateGroup, groupBusy,
  recentSearches, onLoadRecent, onClearRecent,
}) {
  const { t } = useI18n();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [acFocus, setAcFocus] = useState(-1); // which origin input has autocomplete open
  const [acHighlight, setAcHighlight] = useState(0); // keyboard nav index
  const [dragIdx, setDragIdx] = useState(-1); // drag-drop reorder
  const [dragOver, setDragOver] = useState(-1);

  // Animated typing placeholder for ALL empty origin inputs, coordinated by a
  // single shared clock (every empty input shows a different rotating city).
  // El reloj se PAUSA mientras un input de origen está enfocado (acFocus >= 0):
  // así no distrae ni provoca re-renders mientras el usuario escribe. Los
  // ejemplos siguen visibles (congelados) en los campos vacíos no enfocados.
  const showTyping = !loading && origins.some((o) => !o?.trim());
  const { base: typingBase, char: typingChar, typing: typingActive } = useTypingCarousel(showTyping && acFocus < 0);

  const dateWarnings = useDateWarnings(departureDate, returnDate, tripType);

  // Sugerencias del campo de origen (sustituyen al antiguo selector lateral):
  // vacío y enfocado → salidas populares; escribiendo → searchAirports (código,
  // nombre, nombres en español, país). Nunca repite una ciudad ya elegida en
  // otra fila; si el campo ya es un código válido no se abre.
  const acState = useMemo(() => {
    if (acFocus < 0) return { items: [], popular: false, q: "" };
    const raw = (origins[acFocus] || "").trim();
    const exclude = origins.filter((o, i) => i !== acFocus && o?.trim()).map((o) => resolveOriginCode(o));
    if (!raw) {
      return { items: POPULAR_ORIGINS.filter((c) => !exclude.includes(c)).slice(0, 6).map((c) => AIRPORT_MAP[c]), popular: true, q: "" };
    }
    if (AIRPORT_MAP[raw.toUpperCase()]) return { items: [], popular: false, q: "" };
    return { items: searchAirports(raw, { exclude, limit: 6 }), popular: false, q: foldText(raw) };
  }, [acFocus, origins]);
  const acSuggestions = acState.items;

  // Elegir una sugerencia: fija el código y salta al siguiente origen vacío
  // (con dos filas vacías: MAD → la fila 2 ya enseña sus salidas populares).
  const inputRefs = useRef([]);
  const pickOrigin = (idx, code) => {
    const copy = [...origins];
    copy[idx] = code;
    setOrigins(copy);
    tapHaptic();
    const next = copy.findIndex((o, i) => i > idx && !o.trim());
    const nextAny = next >= 0 ? next : copy.findIndex((o, i) => i !== idx && !o.trim());
    if (nextAny >= 0 && inputRefs.current[nextAny]) {
      inputRefs.current[nextAny].focus();
    } else {
      setAcFocus(-1);
    }
  };

  // Ciudades ya reconocidas, en orden: cada una lleva su color de viajero
  // (el mismo que tendrá después en el mapa y en los resultados).
  const setCodes = useMemo(
    () => [...new Set(origins.map((o) => String(o || "").trim().toUpperCase()).filter((c) => AIRPORT_MAP[c]))],
    [origins],
  );

  // Memoize destination airports (excludes selected origins)
  const destAirports = useMemo(() => {
    const originCodes = new Set(origins.map(o => resolveOriginCode(o)));
    return AIRPORTS.filter(a => !originCodes.has(a.code));
  }, [origins]);

  const BUDGET_MIN = 30; const BUDGET_MAX = 800; const BUDGET_STEP = 10;

  // Show city name next to code in the origin input
  const originDisplay = (val) => {
    const code = normalizeCode(val);
    const city = cityOf(code);
    return city ? `${code}` : val;
  };

  return (
    <div className="container py-4 sf-wrap" style={{ maxWidth: 720 }}>
      {/* Una sola columna: el selector lateral de aeropuertos se retiró (las
          sugerencias del propio campo ya cubren la búsqueda y la exploración). */}
      <div className="sf-grid">
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

            {/* Tipo de billete + fechas, en una sola fila en escritorio */}
            <div className="sf-section sf-section--when">
              <div className={`sf-when${tripType === "roundtrip" ? " sf-when--two" : ""}`}>
                <div className="sf-when-type">
                  <div className="sf-label">{t("search.tripTypeLabel")}</div>
                  <div className="sf-pills" role="group" aria-label={t("search.tripTypeLabel")}>
                    {[["oneway", t("search.oneway")], ["roundtrip", t("search.roundtrip")]].map(([v, l]) => (
                      <button key={v} type="button"
                        aria-pressed={tripType === v}
                        className={`sf-pill fm-switch ${tripType === v ? "sf-pill--active" : ""}`}
                        onClick={() => {
                          tapHaptic();
                          setTripType(v);
                          // Auto-suggest return date when switching to roundtrip
                          if (v === "roundtrip" && !returnDate && departureDate) {
                            const d = new Date(departureDate + "T00:00:00");
                            d.setDate(d.getDate() + 7);
                            setReturnDate(d.toISOString().slice(0, 10));
                          }
                        }} disabled={loading}><span className="fm-led" aria-hidden="true" />{l}</button>
                    ))}
                  </div>
                </div>
                <div className={`sf-when-dates${tripType === "roundtrip" ? " sf-when-dates--two" : ""}`}>
                  <div className="sf-when-date">
                    <label className="sf-label" htmlFor="sf-date-dep">{tripType === "roundtrip" ? t("search.departure") : t("search.datesLabel")}</label>
                    <DateField id="sf-date-dep" label={t("search.departure")} value={departureDate} min={todayISO()}
                      onChange={setDepartureDate} disabled={loading} />
                  </div>
                  {tripType === "roundtrip" && (
                    <div className="sf-when-date sf-ret-col">
                      <label className="sf-label" htmlFor="sf-date-ret">{t("search.return")}</label>
                      <DateField id="sf-date-ret" label={t("search.return")} value={returnDate} min={departureDate || todayISO()}
                        onChange={setReturnDate} disabled={loading} />
                    </div>
                  )}
                </div>
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
                const code = resolveOriginCode(origin);
                const city = cityOf(code);
                const isUnknown = origin.trim().length >= 3 && !city;
                const empty = !origin.trim();
                // Cada fila vacía teclea una ciudad distinta, desfasada por idx
                // sobre el mismo reloj compartido (base 0 → Madrid/London/Berlin).
                const typingSlice = empty && showTyping
                  ? typingExample((typingBase + idx) % TYPING_COUNT).slice(0, typingChar)
                  : "";
                return (
                  <div key={idx}
                    className={`sf-origin-row${city && origin.trim() ? " sf-origin-row--set" : ""}${dragIdx === idx ? " sf-origin-row--dragging" : ""}${dragOver === idx ? " sf-origin-row--dragover" : ""}`}
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
                    <span className={`sf-badge${city && origin.trim() ? ` sf-badge--set trav-c${travelerSlot(setCodes, code)}` : ""}`} title={t("search.travelerTooltip", { n: idx + 1 })}>
                      <span className="sf-badge-icon"><User size={12} aria-hidden="true" /></span>{idx + 1}
                    </span>
                    <div className="sf-input-wrap">
                      {/* Typing placeholder animation (coordinated across all empty inputs) */}
                      {/* "p. ej." fijo delante: deja claro que es un EJEMPLO y no un
                          valor ya rellenado (decorativo: el campo tiene aria-label) */}
                      {empty && showTyping && acFocus !== idx && (
                        <span className="sf-typing-placeholder" aria-hidden="true">
                          <span className="sf-typing-lead">{t("search.exampleLead")}</span>
                          <span className={`sf-typing-word${typingActive ? " sf-typing-word--active" : ""}`}>{typingSlice}</span>
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
                        aria-activedescendant={acFocus === idx && acSuggestions[acHighlight] ? `sf-ac-${idx}-${acSuggestions[acHighlight].code}` : undefined}
                        ref={(el) => { inputRefs.current[idx] = el; }}
                        value={origin}
                        onChange={(e) => {
                          // Actualización SÍNCRONA: con startTransition el campo
                          // controlado volvía un instante al valor anterior y, al
                          // teclear rápido, se perdían letras.
                          const val = e.target.value.toUpperCase();
                          const copy = [...origins];
                          copy[idx] = val;
                          setOrigins(copy);
                          setAcFocus(idx);
                          setAcHighlight(0);
                        }}
                        onFocus={() => { setAcFocus(idx); setAcHighlight(0); }}
                        onBlur={() => setTimeout(() => setAcFocus((f) => (f === idx ? -1 : f)), 150)}
                        onKeyDown={(e) => {
                          if (acFocus === idx && acSuggestions.length > 0) {
                            if (e.key === "ArrowDown") { e.preventDefault(); setAcHighlight((h) => Math.min(h + 1, acSuggestions.length - 1)); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setAcHighlight((h) => Math.max(h - 1, 0)); }
                            else if (e.key === "Enter" && acSuggestions[acHighlight]) {
                              e.preventDefault();
                              pickOrigin(idx, acSuggestions[acHighlight].code);
                            }
                            else if (e.key === "Escape") { setAcFocus(-1); }
                          }
                        }}
                        disabled={loading}
                        autoComplete="off"
                      />
                      {/* Sugerencias como mini panel de salidas */}
                      {acFocus === idx && acSuggestions.length > 0 && (
                        <div className={`sf-ac-dropdown${acState.popular ? " sf-ac-dropdown--popular" : ""}`} role="listbox" id={`sf-ac-list-${idx}`}
                          aria-label={acState.popular ? t("search.acPopular") : t("search.acMatches")}>
                          {acState.popular && <div className="sf-ac-head" aria-hidden="true">{t("search.acPopular")}</div>}
                          {acSuggestions.map((a, ai) => (
                            <div key={a.code} id={`sf-ac-${idx}-${a.code}`}
                              role="option"
                              aria-selected={ai === acHighlight}
                              style={{ "--i": ai }}
                              className={`sf-ac-item${ai === acHighlight ? " sf-ac-item--hl" : ""}`}
                              onMouseDown={(e) => { e.preventDefault(); pickOrigin(idx, a.code); }}
                              onMouseEnter={() => setAcHighlight(ai)}>
                              <span className="sf-ac-code">{a.code}</span>
                              <span className="sf-ac-city">
                                <MatchText text={cityOf(a.code)} q={acState.q} />
                                {(() => {
                                  // Segundo nombre: el que acertó la búsqueda si no es el mostrado
                                  const shown = cityOf(a.code);
                                  const other = a.alias && a.alias !== shown ? a.alias
                                    : shown !== a.city && acState.q && foldText(a.city).includes(acState.q) && !foldText(shown).includes(acState.q) ? a.city : "";
                                  return other ? <span className="sf-ac-alias"> · <MatchText text={other} q={acState.q} /></span> : null;
                                })()}
                              </span>
                              <span className="sf-ac-country">{countryFlag(a.code)} {countryOf(a.code)}</span>
                              <span className="sf-ac-go" aria-hidden="true"><Plane size={14} /></span>
                            </div>
                          ))}
                        </div>
                      )}
                      {city && origin.trim() && (
                        <span className="sf-input-city"><span className="sf-input-flag">{countryFlag(code)}</span> <span className="sf-input-cityname">{city}</span></span>
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
                            setOrigins(o); setPassengers(p);
                          }} aria-hidden="false"><ArrowUp size={15} /></button>
                      )}
                      {origins.length > 1 && idx < origins.length - 1 && (
                        <button type="button" className="sf-reorder-btn" disabled={loading} title={t("search.moveDown")} aria-label={t("search.moveDown")}
                          onClick={() => {
                            const o = [...origins]; const p = [...passengers];
                            [o[idx], o[idx + 1]] = [o[idx + 1], o[idx]];
                            [p[idx], p[idx + 1]] = [p[idx + 1], p[idx]];
                            setOrigins(o); setPassengers(p);
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
                <button type="button" className="sf-add-btn" onClick={() => { setOrigins([...origins, ""]); setPassengers([...passengers, 1]); }} disabled={loading || origins.length >= 8}>
                  {t("search.addTraveler")}
                </button>
                {origins.length === 1 && !origins[0].trim() && (
                  <button type="button" className="sf-example-btn" onClick={() => {
                    setOrigins(["MAD", "LON", "BER"]);
                    setPassengers([1, 1, 1]);
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
                        className={`sf-pill fm-switch ${optimizeBy === v ? "sf-pill--active" : ""}`}
                        onClick={() => { tapHaptic(); setOptimizeBy(v); }} disabled={loading}><span className="fm-led" aria-hidden="true" />{l}</button>
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
                        aria-label={t("search.budgetLabel")} aria-valuetext={formatEur(maxBudget)}
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
                              <span className="sf-dest-chip-city">{cityOf(a.code)}</span>
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
            {error && errorHint && <Notice variant="next" {...errorHint} />}

            {/* Traveler summary bar */}
            {origins.some((o) => o.trim()) && (
              <div className="sf-summary-bar">
                <div className="sf-summary-travelers">
                  {origins.filter((o) => o.trim()).map((o, i) => {
                    const c = resolveOriginCode(o);
                    const flag = countryFlag(c);
                    return (
                      <span key={`${c}-${i}`} className="sf-summary-chip" title={cityOf(c) || c}>
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
                {/* Avión que rueda al pasar el ratón y despega al pulsar (decorativo) */}
                <span className="sf-cta-plane" aria-hidden="true"><PlaneTakeoff size={18} /></span>
              </button>
            </div>
            {/* Fuera de .sf-submit-wrap a propósito: en móvil esa caja es la barra
                fija inferior y solo debe llevar el CTA (con la invitación dentro
                tapaba ~170 px de formulario mientras se rellenaba). */}
            {onCreateGroup && (
              <button type="button" className="sf-group-cta" onClick={onCreateGroup} disabled={loading || groupBusy}>
                <Users size={16} className="lucide" /> <span>{groupBusy ? t("group.creating") : t("group.cta")}</span>
              </button>
            )}
            <div className="sf-footnote">
              <span>{t("search.footnoteTime")}</span>
              <span className="sf-kbd-hint">{t("search.kbdHint")}</span>
              <span>{t("search.footnotePrices")}</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

export default SearchPage;
