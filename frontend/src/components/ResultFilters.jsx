import React, { useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { useI18n } from "../i18n/useI18n";
import { travelerSlot } from "../utils/resultsLogic";
import {
  airlinesIn, applyResultFilters, arrivalBars, arrivalSliderRange, durationSteps,
  formatDurationMin, legAirline, nextAirlines,
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
  flights = [], listedCount = 0, filters, onChange, onReset, multiOrigin = false, status = null,
  domesticCountry = null, domesticName = "", domesticChoices = 0,
  displayDest = null, origins = [],
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const airlines = airlinesIn(flights);
  const steps = durationSteps(flights);
  const showArrival = multiOrigin;
  const showStops = (flights || []).some((d) => (d.flights || []).length > 0);
  const showDuration = steps.length > 0;
  const showAirlines = airlines.length >= 2;
  const showDomestic = Boolean(domesticCountry) && domesticChoices > 0;
  if (!showArrival && !showDuration && !showAirlines && !showDomestic && (flights || []).length < 2) return null;

  const set = (patch) => onChange({ ...filters, ...patch });
  const count = (patch) => applyResultFilters(flights, { ...filters, ...patch }, { country: domesticCountry }).length;
  const arrivalOn = (filters.arrival && filters.arrival !== "any") || filters.maxArrivalMin != null;
  const active = (arrivalOn ? 1 : 0)
    + (filters.stops && filters.stops !== "any" ? 1 : 0)
    + (filters.maxDurationMin != null ? 1 : 0)
    + (Array.isArray(filters.airlines) ? 1 : 0)
    + (filters.domestic ? 1 : 0);

  let statusText = "";
  if (showArrival && status) {
    if (status.kind === "unknown") statusText = t("filters.arrivalUnknown");
    else if (status.kind === "partial") statusText = t("filters.arrivalPartial");
    else {
      const time = status.totalHours === 0
        ? t("arrivalCoord.timeUnder1h")
        : status.days > 0
          ? (status.hours
            ? t("arrivalCoord.daysAndHours", {
              days: status.days === 1 ? t("arrivalCoord.dayOne") : t("arrivalCoord.dayMany", { d: status.days }),
              h: status.hours,
            })
            : (status.days === 1 ? t("arrivalCoord.dayOne") : t("arrivalCoord.dayMany", { d: status.days })))
          : t("arrivalCoord.timeHours", { h: status.hours });
      statusText = status.kind === "days"
        ? t("filters.arrivalDays", { time })
        : t("filters.arrivalGap", { time });
    }
  }

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
  const caption = hasBars
    ? (status?.kind === "partial"
      ? t("filters.arrivalPartial")
      : (requestedMin
        ? t("filters.arrivalRequested", { time: formatDurationMin(requestedMin) })
        : statusText))
    : "";
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
  const gapActive = sliderCapped;
  const looseArrival = filters.arrival === "gap" || filters.arrival === "within4h" ? "any" : filters.arrival;
  const cappedCount = gapActive
    ? count({
      arrival: filters.arrival === "within4h" ? "within4h" : (filters.arrival === "closest" ? "closest" : "gap"),
      maxArrivalMin: filters.arrival === "within4h" ? null : capNow,
    })
    : 0;
  const gapAlready = gapActive
    && cappedCount > 0
    && cappedCount === count({ arrival: looseArrival, maxArrivalMin: null });

  return (
    <aside className={`fm-filters${open ? " fm-filters--open" : ""}`} aria-label={t("filters.title")}>
      <button type="button" className="fm-filters-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>{t("filters.title")}</span>
        {active > 0 && <span className="fm-filter-badge">{active}</span>}
      </button>
      <div className="fm-filters-body">
        <div className="fm-filters-head">
          <span className="fm-filter-label">{t("filters.title")}</span>
          <span className="fm-filter-count">{t("filters.count", { n: listedCount, total: flights.length })}</span>
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
            {caption && <p className="fm-filter-hint">{caption}</p>}
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-arrival">
              <CheckRow checked={filters.arrival === "closest"} label={t("filters.arrivalClosest")} count={count({ arrival: "closest" })} onClick={() => set({ arrival: filters.arrival === "closest" ? "any" : "closest" })}>{t("filters.arrivalClosest")}</CheckRow>
              <CheckRow checked={filters.arrival === "sameDay"} label={t("filters.arrivalSameDay")} count={count({ arrival: "sameDay", maxArrivalMin: null })} onClick={() => set(filters.arrival === "sameDay" ? { arrival: "any", maxArrivalMin: null } : { arrival: "sameDay", maxArrivalMin: null })}>{t("filters.arrivalSameDay")}</CheckRow>
            </div>
            {!hasBars && <p className="fm-filter-hint">{statusText || t("filters.arrivalHint")}</p>}
            {gapAlready && <p className="fm-filter-hint">{t("filters.gapAlready")}</p>}
          </div>
        )}

        {showStops && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-stops">{t("filters.stops")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-stops">
              <CheckRow checked={filters.stops === "direct"} label={directLabel} count={directCount} onClick={() => set({ stops: filters.stops === "direct" ? "any" : "direct" })}>{directLabel}</CheckRow>
              <CheckRow checked={filters.stops === "max1"} label={t("filters.stopsMax1")} count={count({ stops: "max1" })} onClick={() => set({ stops: filters.stops === "max1" ? "any" : "max1" })}>{t("filters.stopsMax1")}</CheckRow>
            </div>
            {filters.stops === "direct" && directCount === count({ stops: "any" }) && directCount > 0 && (
              <p className="fm-filter-hint">{t("filters.stopsAlready")}</p>
            )}
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
    </aside>
  );
}
