// ─── DateField ───────────────────────────────────────────────────────────────
// Selector de fecha propio (oct-2026): sustituye al <input type="date"> nativo,
// que desentonaba con la identidad de terminal (y enseñaba "mm/dd/yyyy" con la
// interfaz en español). El campo muestra la fecha en el idioma de la app
// ("lun, 16 nov 2026") y abre un calendario de un mes con el estilo del panel.
//
// En pantallas táctiles (puntero grueso) se usa el selector del SISTEMA, que es
// mejor con el dedo: el campo se ve igual, pero encima va un <input type="date">
// transparente que abre la rueda/calendario nativo.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { todayISO } from "../utils/helpers";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
};
const locale = (lang) => (lang === "es" ? "es-ES" : "en-GB");

export function formatDateLong(s, lang) {
  const p = parse(s);
  if (!p) return "";
  return new Intl.DateTimeFormat(locale(lang), { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(p.y, p.m, p.d)));
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    try { setCoarse(window.matchMedia("(pointer: coarse)").matches); } catch { /* sin matchMedia */ }
  }, []);
  return coarse;
}

export default function DateField({ id, value, min, max, onChange, disabled = false, label }) {
  const { t, lang } = useI18n();
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const gridRef = useRef(null);
  const sel = parse(value);
  const minP = parse(min);
  const [view, setView] = useState(() => {
    const p = sel || minP || parse(todayISO());
    return { y: p.y, m: p.m };
  });

  // Al abrir, el mes visible es el de la fecha elegida (o el mínimo).
  useEffect(() => {
    if (!open) return;
    const p = parse(value) || parse(min);
    if (p) setView({ y: p.y, m: p.m });
    // foco al día elegido (o al primero disponible) para navegar con teclado
    const id2 = requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector('[aria-pressed="true"]:not(:disabled)')
        || gridRef.current?.querySelector("button:not(:disabled)");
      el?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cerrar al pulsar fuera o con Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale(lang), { weekday: "short", timeZone: "UTC" });
    // 5-ene-2026 es lunes → semana de lunes a domingo
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 0, 5 + i))).replace(".", "").slice(0, 2));
  }, [lang]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale(lang), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(view.y, view.m, 1))),
    [view, lang],
  );

  const days = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const lead = (first.getUTCDay() + 6) % 7; // lunes = 0
    const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [view]);

  const todayIso = todayISO();
  const isOff = (d) => { const s = iso(view.y, view.m, d); return (min && s < min) || (max && s > max); };
  const canPrev = !min || iso(view.y, view.m, 1) > min;
  const canNext = !max || iso(view.y, view.m, new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()) < max;
  const shift = (n) => setView((v) => { const d = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });

  const pick = (d) => { onChange(iso(view.y, view.m, d)); setOpen(false); triggerRef.current?.focus(); };

  // Flechas: mueven el foco entre días (±1 día, ±1 semana) dentro del mes
  const onGridKey = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    const btns = [...(gridRef.current?.querySelectorAll("button[data-day]") || [])];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    let j = i + step;
    while (btns[j] && btns[j].disabled) j += Math.sign(step);
    btns[j]?.focus();
  };

  const shown = value ? formatDateLong(value, lang) : "";

  // Un solo día entra en el orden de tabulación (el elegido o el primero
  // disponible); el resto se recorre con flechas. Así Tab sale del calendario
  // en vez de recorrer 30 botones.
  const selDay = sel && sel.y === view.y && sel.m === view.m ? sel.d : null;
  const tabDay = selDay && !isOff(selDay) ? selDay : days.find((d) => d !== null && !isOff(d));

  return (
    <div className={`df${open ? " df--open" : ""}${disabled ? " df--disabled" : ""}`} ref={rootRef}
      onBlur={(e) => { if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" id={coarse ? undefined : id} className="df-trigger form-control sf-input" ref={triggerRef}
        aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
        tabIndex={coarse ? -1 : undefined} aria-hidden={coarse ? "true" : undefined}
        onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} className="df-icon" aria-hidden="true" />
        <span className={`df-value${shown ? "" : " df-value--empty"}`}>{shown || t("search.datePlaceholder")}</span>
      </button>

      {/* Táctil: selector del sistema encima del campo (transparente) */}
      {coarse && (
        <input type="date" id={id} className="df-native" value={value || ""} min={min} max={max}
          aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}

      {open && !coarse && (
        <div className="df-pop" role="dialog" aria-label={label}>
          <div className="df-head">
            <button type="button" className="df-nav" onClick={() => shift(-1)} disabled={!canPrev} aria-label={t("search.datePrev")}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="df-month" aria-live="polite">{monthLabel}</span>
            <button type="button" className="df-nav" onClick={() => shift(1)} disabled={!canNext} aria-label={t("search.dateNext")}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="df-week" aria-hidden="true">
            {weekdays.map((w, i) => <span key={i}>{w}</span>)}
          </div>
          <div className="df-grid" ref={gridRef} onKeyDown={onGridKey}>
            {days.map((d, i) => {
              if (d === null) return <span key={`e${i}`} />;
              const s = iso(view.y, view.m, d);
              const on = s === value;
              return (
                <button key={s} type="button" data-day={d}
                  className={`df-day${on ? " df-day--on" : ""}${s === todayIso ? " df-day--today" : ""}`}
                  aria-pressed={on} aria-label={formatDateLong(s, lang)}
                  tabIndex={d === tabDay ? 0 : -1}
                  disabled={isOff(d)} onClick={() => pick(d)}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
