import React, { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useI18n } from "../i18n/useI18n";
import { travelerSlot } from "../utils/resultsLogic";
import {
  airlinesIn, applyResultFilters, arrivalBars, arrivalGapChoices, durationSteps,
  formatDurationMin, legAirline, nextAirlines,
} from "../utils/resultFilters";

function Opt({ pressed, onClick, children, count, label }) {
  return (
    <button type="button" className={`fm-filter-opt${pressed ? " fm-filter-opt--on" : ""}`}
      aria-pressed={pressed}
      aria-label={count == null ? undefined : `${label} (${count})`}
      onClick={onClick}>
      <span>{children}</span>
      {count != null && <span className="fm-filter-opt-n" aria-hidden="true">{count}</span>}
    </button>
  );
}

function ArrivalStrip({ dest, origins, requestedMin }) {
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
      <div className="fm-arr-scale" aria-hidden="true">
        <span>{first?.clock || ""}</span>
        <span>{right}</span>
      </div>
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
  const gaps = showArrival ? arrivalGapChoices(flights) : [];
  const requestedMin = filters.arrival === "within4h"
    ? 240
    : (filters.maxArrivalMin != null ? Number(filters.maxArrivalMin) : null);
  const hasBars = showArrival && arrivalBars(displayDest?.flights || [], requestedMin).min != null;
  const caption = hasBars
    ? (status?.kind === "partial"
      ? t("filters.arrivalPartial")
      : (requestedMin
        ? t("filters.arrivalRequested", { time: formatDurationMin(requestedMin) })
        : statusText))
    : "";
  const pickGap = (min) => {
    const on = filters.maxArrivalMin === min || (min === 240 && filters.arrival === "within4h");
    if (on) {
      set({ maxArrivalMin: null, arrival: filters.arrival === "closest" ? "closest" : "any" });
      return;
    }
    set({
      maxArrivalMin: min,
      arrival: filters.arrival === "closest" ? "closest" : "gap",
    });
  };
  const capNow = filters.arrival === "within4h" ? 240 : filters.maxArrivalMin;
  const gapActive = capNow != null && filters.arrival !== "sameDay";
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
        <p className="fm-filter-hint">{t("filters.note")}</p>

        {showDomestic && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-domestic">{t("filters.domestic")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-domestic">
              <Opt pressed={!filters.domestic} label={t("filters.domesticAny")} onClick={() => set({ domestic: false })}>{t("filters.domesticAny")}</Opt>
              <Opt pressed={!!filters.domestic} label={t("filters.domesticOnly", { country: domesticName })}
                count={count({ domestic: true }) || null}
                onClick={() => set({ domestic: true })}>{t("filters.domesticOnly", { country: domesticName })}</Opt>
            </div>
            <p className="fm-filter-hint">{t("filters.domesticHint", { country: domesticName })}</p>
          </div>
        )}

        {showArrival && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-arrival">{t("filters.arrival")}</span>
            {hasBars && (
              <ArrivalStrip dest={displayDest} origins={origins} requestedMin={requestedMin} />
            )}
            {caption && <p className="fm-filter-hint">{caption}</p>}
            {gaps.length > 0 && (
              <div className="fm-filter-gaps" role="group" aria-labelledby="fm-filter-arrival">
                {gaps.map((min) => {
                  const label = t("filters.arrivalUpTo", { time: formatDurationMin(min) });
                  const pressed = filters.maxArrivalMin === min || (min === 240 && filters.arrival === "within4h");
                  const gapCount = count({
                    arrival: filters.arrival === "closest" ? "closest" : "gap",
                    maxArrivalMin: min,
                  });
                  return (
                    <Opt key={min} pressed={pressed} label={label} count={gapCount} onClick={() => pickGap(min)}>
                      {formatDurationMin(min)}
                    </Opt>
                  );
                })}
              </div>
            )}
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-arrival">
              <Opt pressed={(!filters.arrival || filters.arrival === "any") && filters.maxArrivalMin == null} label={t("filters.arrivalAny")} count={count({ arrival: "any", maxArrivalMin: null })} onClick={() => set({ arrival: "any", maxArrivalMin: null })}>{t("filters.arrivalAny")}</Opt>
              <Opt pressed={filters.arrival === "closest"} label={t("filters.arrivalClosest")} count={count({ arrival: "closest" })} onClick={() => set({ arrival: "closest" })}>{t("filters.arrivalClosest")}</Opt>
              <Opt pressed={filters.arrival === "sameDay"} label={t("filters.arrivalSameDay")} count={count({ arrival: "sameDay", maxArrivalMin: null })} onClick={() => set({ arrival: "sameDay", maxArrivalMin: null })}>{t("filters.arrivalSameDay")}</Opt>
            </div>
            {!hasBars && <p className="fm-filter-hint">{statusText || t("filters.arrivalHint")}</p>}
            {gapAlready && <p className="fm-filter-hint">{t("filters.gapAlready")}</p>}
          </div>
        )}

        {showStops && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-stops">{t("filters.stops")}</span>
            <div className="fm-filter-opts" role="group" aria-labelledby="fm-filter-stops">
              <Opt pressed={!filters.stops || filters.stops === "any"} label={t("filters.stopsAny")} count={count({ stops: "any" })} onClick={() => set({ stops: "any" })}>{t("filters.stopsAny")}</Opt>
              <Opt pressed={filters.stops === "direct"} label={directLabel} count={directCount} onClick={() => set({ stops: "direct" })}>{directLabel}</Opt>
              <Opt pressed={filters.stops === "max1"} label={t("filters.stopsMax1")} count={count({ stops: "max1" })} onClick={() => set({ stops: "max1" })}>{t("filters.stopsMax1")}</Opt>
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
              <Opt pressed={filters.maxDurationMin == null} label={t("filters.durationAny")} count={count({ maxDurationMin: null })} onClick={() => set({ maxDurationMin: null })}>{t("filters.durationAny")}</Opt>
              {steps.map((min) => {
                const label = t("filters.durationUpTo", { time: formatDurationMin(min) });
                return (
                  <Opt key={min} pressed={filters.maxDurationMin === min} label={label} count={count({ maxDurationMin: min })} onClick={() => set({ maxDurationMin: min })}>
                    {label}
                  </Opt>
                );
              })}
            </div>
          </div>
        )}

        {showAirlines && (
          <div className="fm-filter-block">
            <span className="fm-filter-label" id="fm-filter-air">{t("filters.airlines")}</span>
            <div className="fm-filter-airlines" role="group" aria-labelledby="fm-filter-air">
              {airlines.map((code) => {
                const on = !Array.isArray(filters.airlines) || filters.airlines.includes(code);
                const only = Array.isArray(filters.airlines) && on;
                const used = flights.filter((d) => (d.flights || []).some((leg) => legAirline(leg) === code)).length;
                return (
                  <button key={code} type="button"
                    className={`fm-filter-opt fm-filter-opt--air${on ? " fm-filter-opt--picked" : ""}${only ? " fm-filter-opt--on" : ""}`}
                    aria-pressed={on} aria-label={`${code} (${used})`} onClick={() => toggleAirline(code)}>
                    <span>{code}</span>
                    <span className="fm-filter-opt-n" aria-hidden="true">{used}</span>
                  </button>
                );
              })}
            </div>
            <p className="fm-filter-hint">{t("filters.airlinesHint")}</p>
          </div>
        )}

        {active > 0 && (
          <button type="button" className="fm-filter-reset" onClick={onReset}>{t("filters.reset")}</button>
        )}
      </div>
    </aside>
  );
}
