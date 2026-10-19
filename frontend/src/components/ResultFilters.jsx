import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { useI18n } from "../i18n/useI18n";
import { travelerSlot } from "../utils/resultsLogic";
import {
  airlinesIn, applyResultFilters, arrivalBars, arrivalSliderRange, departFloors,
  durationSteps, formatClockMin, formatDurationMin, legAirline, nextAirlines,
} from "../utils/resultFilters";

function CheckRow({ checked, onClick, children, count, label }) {
  return (
    <button type="button" className={`fm-check${checked ? " fm-check--on" : ""}`}
      role="checkbox" aria-checked={checked}
      aria-label={count == null ? label : `${label} (${count})`}
      onClick={onClick}>
      <span className="fm-check-box" aria-hidden="true">{checked ? <Check size={14} strokeWidth={3} /> : null}</span>
      <span className="fm-check-label">{children}</span>
      {count != null && <span className="fm-filter-opt-n" aria-hidden="true">{count}</span>}
    </button>
  );
}

function ArrivalStrip({ dest, origins, requestedMin, hideScale = false }) {
  const { t } = useI18n();
  const drawn = arrivalBars(dest?.flights || [], requestedMin);
  if (drawn.min == null) return null;
  const known = drawn.bars.filter((b) => b.ms != null);
  const first = known.find((b) => b.ms === drawn.min);
  const last = [...known].reverse().find((b) => b.ms === drawn.max);
  const cap = Number(requestedMin);
  const capped = Number.isFinite(cap) && cap > 0;
  const right = capped
    ? t("filters.arrivalGapEnd", { time: formatDurationMin(cap) })
    : (last?.clock || "");
  const bits = drawn.bars.map((b) => (
    b.clock
      ? t("filters.arrivalBarLabel", { origin: b.origin || "—", clock: b.clock })
      : t("filters.arrivalNoClock", { origin: b.origin || "—" })
  ));
  return (
    <div className="fm-arr" role="img" aria-label={`${t("filters.arrivalBars")}. ${bits.join(". ")}`}>
      {!hideScale && (
        <div className="fm-arr-scale" aria-hidden="true">
          <span>{first?.clock || ""}</span>
          <span>{right}</span>
        </div>
      )}
      {drawn.bars.map((b, i) => {
        const slot = travelerSlot(origins, b.origin);
        const width = b.pct == null ? 0 : Math.round(b.pct * 1000) / 10;
        return (
          <div key={`${b.origin || "x"}-${i}`} className={`fm-arr-row trav-c${slot}`} aria-hidden="true">
            <span className="fm-arr-code">{b.origin || "—"}</span>
            <span className={`fm-arr-track${capped ? " fm-arr-track--cap" : ""}`}>
              {b.pct != null && <span className="fm-arr-bar" style={{ width: `${width}%` }} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ResultFilters({
  flights = [], listedCount = 0, filters, onChange, onReset, multiOrigin = false,
  domesticCountry = null, domesticName = "", domesticChoices = 0,
  displayDest = null, origins = [],
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const closeRef = useRef(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    if (!open || wide) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, wide]);
  const airlines = airlinesIn(flights);
  const steps = durationSteps(flights);
  const departs = departFloors(flights);
  const showArrival = multiOrigin;
  const showStops = (flights || []).some((d) => (d.flights || []).length > 0);
  const showDuration = steps.length > 0;
  const showDepart = departs.length > 0;
  const showAirlines = airlines.length >= 2;
  const showDomestic = Boolean(domesticCountry) && domesticChoices > 0;
  if (!showArrival && !showDuration && !showDepart && !showAirlines && !showDomestic && (flights || []).length < 2) return null;

  const set = (patch) => onChange({ ...filters, ...patch });
  const count = (patch) => applyResultFilters(flights, { ...filters, ...patch }, { country: domesticCountry }).length;
  const arrivalOn = (filters.arrival && filters.arrival !== "any") || filters.maxArrivalMin != null;
  const active = (arrivalOn ? 1 : 0)
    + (filters.stops && filters.stops !== "any" ? 1 : 0)
    + (filters.maxDurationMin != null ? 1 : 0)
    + (filters.minDepartMin != null ? 1 : 0)
    + (Array.isArray(filters.airlines) ? 1 : 0)
    + (filters.domestic ? 1 : 0);

  const toggleAirline = (code) => {
    set({ airlines: nextAirlines(filters.airlines, code, airlines) });
  };
  const directLabel = t("filters.stopsDirect");
  const directCount = showStops ? count({ stops: "direct" }) : 0;
  const slider = showArrival ? arrivalSliderRange(flights) : null;
  const capNow = filters.arrival === "within4h" ? 240 : (filters.maxArrivalMin != null ? Number(filters.maxArrivalMin) : null);
  const sliderCapped = capNow != null && filters.arrival !== "sameDay";
  const sliderValue = slider
    ? (sliderCapped ? Math.min(slider.max, Math.max(slider.min, capNow)) : slider.max)
    : null;
  const requestedMin = sliderCapped ? capNow : null;
  const drawn = showArrival ? arrivalBars(displayDest?.flights || [], requestedMin) : null;
  const hasBars = drawn?.min != null;
  const knownMarks = (drawn?.bars || []).filter((b) => b.ms != null);
  const firstClock = knownMarks.find((b) => b.ms === drawn?.min)?.clock || "";
  const lastClock = [...knownMarks].reverse().find((b) => b.ms === drawn?.max)?.clock || "";
  const sliderRight = requestedMin
    ? t("filters.arrivalGapEnd", { time: formatDurationMin(requestedMin) })
    : lastClock;
  const sliderPct = slider && slider.max > slider.min
    ? Math.round(((sliderValue - slider.min) / (slider.max - slider.min)) * 1000) / 10
    : 100;
  const moveSlider = (raw) => {
    const value = Number(raw);
    if (!slider || !Number.isFinite(value)) return;
    if (value >= slider.max) {
      set({ maxArrivalMin: null, arrival: filters.arrival === "closest" ? "closest" : "any" });
      return;
    }
    set({
      maxArrivalMin: value,
      arrival: filters.arrival === "closest" ? "closest" : "gap",
    });
  };

  const drawer = open && !wide;
  const groups = (
      <div className="fm-filters-body">
        <div className="fm-filters-head">
          <span className="fm-filter-label">{t("filters.title")}</span>
          <span className="fm-filter-count">{t("filters.count", { n: listedCount, total: flights.length })}</span>
          <button type="button" ref={closeRef} className="fm-filters-close" aria-label={t("a11y.close")} onClick={() => setOpen(false)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {showDomestic && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-domestic">{t("filters.domestic")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-domestic">
              <CheckRow checked={!!filters.domestic} label={t("filters.domesticOnly", { country: domesticName })}
                count={count({ domestic: true }) || null}
                onClick={() => set({ domestic: !filters.domestic })}>{t("filters.domesticOnly", { country: domesticName })}</CheckRow>
            </div>
          </div>
        )}

        {showArrival && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-arrival">{t("filters.arrival")}</span>
            {slider && (
              <div className="fm-arr-control">
                <div className="fm-arr-scale" aria-hidden="true">
                  <span>{firstClock}</span>
                  <span>{sliderRight}</span>
                </div>
                <div className="fm-arr-range">
                  <span className="fm-arr-range-fill" style={{ width: `${sliderPct}%` }} />
                  <input
                    type="range"
                    className="fm-arr-slider"
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={sliderValue}
                    disabled={slider.max <= slider.min}
                    aria-label={t("filters.arrivalSlider")}
                    aria-valuemin={slider.min}
                    aria-valuemax={slider.max}
                    aria-valuenow={sliderValue}
                    aria-valuetext={requestedMin
                      ? t("filters.arrivalUpTo", { time: formatDurationMin(requestedMin) })
                      : t("filters.arrivalAny")}
                    onChange={(e) => moveSlider(e.target.value)}
                  />
                </div>
              </div>
            )}
            {hasBars && (
              <ArrivalStrip dest={displayDest} origins={origins} requestedMin={requestedMin} hideScale={!!slider} />
            )}
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-arrival">
              <CheckRow checked={filters.arrival === "closest"} label={t("filters.arrivalClosest")} count={count({ arrival: "closest" })} onClick={() => set({ arrival: filters.arrival === "closest" ? "any" : "closest" })}>{t("filters.arrivalClosest")}</CheckRow>
              <CheckRow checked={filters.arrival === "sameDay"} label={t("filters.arrivalSameDay")} count={count({ arrival: "sameDay", maxArrivalMin: null })} onClick={() => set(filters.arrival === "sameDay" ? { arrival: "any", maxArrivalMin: null } : { arrival: "sameDay", maxArrivalMin: null })}>{t("filters.arrivalSameDay")}</CheckRow>
            </div>
          </div>
        )}

        {showDepart && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-depart">{t("filters.depart")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-depart">
              {departs.map((min) => {
                const label = t("filters.departFrom", { time: formatClockMin(min) });
                return (
                  <CheckRow key={min} checked={filters.minDepartMin === min} label={label} count={count({ minDepartMin: min })} onClick={() => set({ minDepartMin: filters.minDepartMin === min ? null : min })}>
                    {label}
                  </CheckRow>
                );
              })}
            </div>
          </div>
        )}

        {showStops && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-stops">{t("filters.stops")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-stops">
              <CheckRow checked={filters.stops === "direct"} label={directLabel} count={directCount} onClick={() => set({ stops: filters.stops === "direct" ? "any" : "direct" })}>{directLabel}</CheckRow>
              <CheckRow checked={filters.stops === "max1"} label={t("filters.stopsMax1")} count={count({ stops: "max1" })} onClick={() => set({ stops: filters.stops === "max1" ? "any" : "max1" })}>{t("filters.stopsMax1")}</CheckRow>
            </div>
          </div>
        )}

        {showDuration && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-dur">{t("filters.duration")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-dur">
              {steps.map((min) => {
                const label = t("filters.durationUpTo", { time: formatDurationMin(min) });
                return (
                  <CheckRow key={min} checked={filters.maxDurationMin === min} label={label} count={count({ maxDurationMin: min })} onClick={() => set({ maxDurationMin: filters.maxDurationMin === min ? null : min })}>
                    {label}
                  </CheckRow>
                );
              })}
            </div>
          </div>
        )}

        {showAirlines && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-air">{t("filters.airlines")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-air">
              {airlines.map((code) => {
                const on = !Array.isArray(filters.airlines) || filters.airlines.includes(code);
                const used = flights.filter((d) => (d.flights || []).some((leg) => legAirline(leg) === code)).length;
                return (
                  <CheckRow key={code} checked={on} label={code} count={used} onClick={() => toggleAirline(code)}>
                    {code}
                  </CheckRow>
                );
              })}
            </div>
          </div>
        )}

        {active > 0 && (
          <button type="button" className="fm-filter-reset" onClick={onReset}>{t("filters.reset")}</button>
        )}
      </div>
  );

  return (
    <aside className="fm-filters" aria-label={t("filters.title")}>
      <button type="button" className="fm-filters-toggle" aria-expanded={open} onClick={() => setOpen(true)}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>{t("filters.title")}</span>
        {active > 0 && <span className="fm-filter-badge">{active}</span>}
      </button>
      {!drawer && groups}
      {drawer && typeof document !== "undefined" && createPortal(
        <div className="fm-filters-layer">
          <button type="button" className="fm-filters-backdrop" aria-label={t("a11y.close")} onClick={() => setOpen(false)} />
          <aside className="fm-filters fm-filters--drawer" role="dialog" aria-modal="true" aria-label={t("filters.title")}>
            {groups}
          </aside>
        </div>,
        document.body
      )}
    </aside>
  );
}
