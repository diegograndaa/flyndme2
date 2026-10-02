// ─── HeroMap ─────────────────────────────────────────────────────────────────
// Mapa de la portada (oct-2026). ESCUCHA AL FORMULARIO: dibuja en su sitio real
// las ciudades de salida según se escriben y traza sus rutas hacia un punto de
// encuentro. Sustituye al diagrama fijo MAD/LON/BER (ConvergenceHero), que no
// cambiaba al rellenar el formulario.
//
// Honestidad (regla 1): antes de buscar NO hay destino real, así que el punto
// de encuentro rota entre destinos CANDIDATOS de ejemplo (va marcado con "¿?"
// y una nota lo dice). Sin precios. Lo único calculado es la distancia
// ortodrómica real y un tiempo de vuelo ESTIMADO ("~"), al tocar una ciudad.
//
// Sin ciudades escritas enseña un ejemplo (MAD/LON/BER) etiquetado como tal.
//
// Movimiento: la geografía y los arcos son estáticos (nada de animaciones de
// entrada en el SVG, ver CLAUDE.md 22-jun). Solo bucles: un avión por ruta
// (SMIL) y el pulso del punto de encuentro (HTML, transform/opacity).
// Este módulo importa los geodatos: cargarlo SIEMPRE con React.lazy.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { cityOf } from "../utils/helpers";
import { CITY_COORDS, distanceKm, estimatedFlightMinutes } from "../utils/geo";
import { travelerSlot } from "../utils/resultsLogic";
import { project, COUNTRY_PATHS, flightArc, flightArcMid, PLANE_D, placeLabels } from "./mapProjection";
import { FlapText } from "./FlapBoard";

const EXAMPLE_ORIGINS = ["MAD", "LON", "BER"];
const CANDIDATES = ["PAR", "ROM", "LIS", "PRG", "BCN", "AMS"];
const CYCLE_MS = 3600;

// Encuadres fijos (unidades del mapa 700×500): Europa entera en escritorio y
// una franja más apaisada en la versión compacta del móvil. Fijos a propósito:
// el mapa no salta al añadir una ciudad.
const FRAMES = {
  wide:    { x: 30, y: 22, w: 610, h: 448 },
  compact: { x: 40, y: 100, w: 600, h: 330 },
};
const EDGE = 14;

function prefersReducedMotion() {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

// Posición en el mapa; las ciudades fuera del encuadre se pegan a su borde.
function place(code, vb) {
  const c = CITY_COORDS[code];
  if (!c) return null;
  const [x, y] = project(c[0], c[1]);
  return [
    Math.min(vb.x + vb.w - EDGE, Math.max(vb.x + EDGE, x)),
    Math.min(vb.y + vb.h - EDGE, Math.max(vb.y + EDGE, y)),
  ];
}

export default function HeroMap({ origins = [], compact = false, idSuffix = "" }) {
  const { t, lang } = useI18n();
  const vb = compact ? FRAMES.compact : FRAMES.wide;
  const wrapRef = useRef(null);
  const lastPointer = useRef("keyboard");
  const [widthPx, setWidthPx] = useState(compact ? 358 : 520);
  const [idx, setIdx] = useState(0);
  const [active, setActive] = useState(null); // ciudad con la ruta encendida

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w > 0) setWidthPx(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ciudades reales del formulario (con coordenadas, sin repetir). Vacío → ejemplo.
  const typed = useMemo(() => {
    const seen = new Set();
    return (origins || []).map((o) => String(o || "").toUpperCase())
      .filter((c) => CITY_COORDS[c] && !seen.has(c) && seen.add(c));
  }, [origins]);
  const isExample = typed.length === 0;
  const codes = isExample ? EXAMPLE_ORIGINS : typed;
  const codesKey = codes.join(",");

  const candidates = useMemo(() => {
    const list = CANDIDATES.filter((c) => !codes.includes(c));
    return list.length ? list : CANDIDATES;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey]);
  const dest = candidates[idx % candidates.length];

  // El candidato rota; se detiene con una ruta encendida (su ficha de km/tiempo
  // no puede cambiar bajo el dedo) y con movimiento reducido.
  useEffect(() => {
    if (active || prefersReducedMotion() || candidates.length < 2) return undefined;
    const id = setInterval(() => setIdx((i) => i + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, [active, candidates.length]);

  // Si la ciudad encendida desaparece del formulario, se apaga.
  useEffect(() => { if (active && !codes.includes(active)) setActive(null); }, [active, codes]);

  // En táctil un toque fuera apaga la ruta (iOS no quita el foco al botón).
  useEffect(() => {
    if (!active) return undefined;
    const off = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setActive(null); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [active]);

  const u = vb.w / Math.max(widthPx, 1); // unidades del mapa por píxel de pantalla
  const pts = codes.map((code) => ({ code, pos: place(code, vb) })).filter((p) => p.pos);
  const destPos = place(dest, vb);
  const others = candidates.filter((c) => c !== dest).map((code) => ({ code, pos: place(code, vb) })).filter((p) => p.pos);

  // Fichas de código (medidas en px de pantalla × u), colocadas sin pisarse.
  const chip = (code, label, fs, pad) => ({ code, label, fs, w: (label.length * fs * 0.62 + pad) * u, h: (fs + 9) * u });
  const destChip = { ...chip(`d-${dest}`, `¿${dest}?`, 12, 14), pos: destPos };
  const originChips = pts.map((p) => ({ ...chip(p.code, p.code, 11.5, 12), pos: p.pos }));
  const labelPos = placeLabels(
    [destChip, ...originChips],
    [{ code: `d-${dest}`, pos: destPos }, ...pts.map((p) => ({ code: p.code, pos: p.pos }))],
    vb, u,
  );

  const nf = new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-GB");
  const routeInfo = (code) => {
    const km = distanceKm(code, dest);
    const min = estimatedFlightMinutes(km);
    if (!km || !min) return null;
    const h = Math.floor(min / 60);
    const m = min % 60;
    const eta = h === 0 ? t("landing.routeEtaM", { m })
      : m === 0 ? t("landing.routeEtaH", { h })
      : t("landing.routeEtaHM", { h, m });
    return { km: nf.format(km), eta };
  };

  const pctX = (x) => `${(((x - vb.x) / vb.w) * 100).toFixed(2)}%`;
  const pctY = (y) => `${(((y - vb.y) / vb.h) * 100).toFixed(2)}%`;
  const f1 = (v) => v.toFixed(1);
  const activePt = pts.find((p) => p.code === active) || null;
  const activeInfo = activePt ? routeInfo(activePt.code) : null;
  const activeMid = activePt ? flightArcMid(activePt.pos, destPos) : null;

  return (
    <div className={`hm${compact ? " hm--compact" : ""}${isExample ? " hm--example" : " hm--live"}`}
      role="group" aria-label={t("landing.diagramAlt")}>
      <div className={`hm-stage${active ? " hm-stage--focus" : ""}`} ref={wrapRef}>
        <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="hm-svg" aria-hidden="true">
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} className="hm-sea" />
          <g>
            {COUNTRY_PATHS.map((c, i) => (
              <path key={`${c.iso}${i}`} d={c.d} vectorEffect="non-scaling-stroke"
                className={c.alt ? "hm-land hm-land--alt" : "hm-land"} />
            ))}
          </g>

          {/* Otros candidatos: puntos huecos, sin rótulo (solo contexto) */}
          {others.map((o) => (
            <circle key={`c-${o.code}`} cx={o.pos[0]} cy={o.pos[1]} r={3 * u} strokeWidth={1.2 * u} className="hm-cand" />
          ))}

          {/* Rutas de cada ciudad al candidato actual + avión en bucle */}
          {pts.map((p, i) => {
            const id = `hm-arc-${p.code}${idSuffix}`;
            const d = flightArc(p.pos, destPos);
            const lit = active === p.code;
            return (
              <g key={p.code} className={`hm-route-g trav-c${travelerSlot(codes, p.code)}`}>
                <path id={id} d={d} fill="none" vectorEffect="non-scaling-stroke"
                  className={`hm-route${lit ? " hm-route--lit" : ""}${active && !lit ? " hm-route--dim" : ""}`} />
                <g className="hm-plane" opacity="0">
                  <path d={PLANE_D} transform={`scale(${(u * 0.95).toFixed(3)})`} />
                  <animateMotion dur="3.6s" begin={`${(i * 0.8).toFixed(1)}s`} repeatCount="indefinite" rotate="auto"
                    keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1">
                    <mpath href={`#${id}`} />
                  </animateMotion>
                  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.84;1"
                    dur="3.6s" begin={`${(i * 0.8).toFixed(1)}s`} repeatCount="indefinite" />
                </g>
              </g>
            );
          })}

          {/* Ciudades de salida: punto con el color del viajero + ficha del código */}
          {pts.map((p) => {
            const L = labelPos[p.code];
            const c = originChips.find((x) => x.code === p.code);
            return (
              <g key={`o-${p.code}`} className={`hm-origin trav-c${travelerSlot(codes, p.code)}${active === p.code ? " hm-origin--on" : ""}`}>
                <circle cx={p.pos[0]} cy={p.pos[1]} r={5.5 * u} strokeWidth={2.2 * u} className="hm-origin-dot" />
                {L && c && (
                  <g className="hm-chip">
                    <rect x={L.x} y={L.y} width={L.w} height={L.h} rx={2.5 * u} strokeWidth={u} />
                    <text x={L.x + L.w / 2} y={L.y + L.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={c.fs * u}>{c.label}</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Punto de encuentro candidato: cartel amarillo "¿PAR?" */}
          {destPos && (
            <g className="hm-dest">
              <circle cx={destPos[0]} cy={destPos[1]} r={7.5 * u} strokeWidth={2 * u} className="hm-dest-dot" />
              <circle cx={destPos[0]} cy={destPos[1]} r={2.6 * u} className="hm-dest-pin" />
              {labelPos[destChip.code] && (() => {
                const L = labelPos[destChip.code];
                return (
                  <g className="hm-chip hm-chip--dest">
                    <rect x={L.x} y={L.y} width={L.w} height={L.h} rx={2.5 * u} strokeWidth={u} />
                    <text x={L.x + L.w / 2} y={L.y + L.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={destChip.fs * u}>{destChip.label}</text>
                  </g>
                );
              })()}
            </g>
          )}
        </svg>

        {/* Pulso de radar en el candidato (HTML: solo transform/opacity).
            key = destino → la onda vuelve a salir al cambiar de candidato. */}
        {destPos && (
          <span key={dest} className="hm-pulse" aria-hidden="true" style={{ left: pctX(destPos[0]), top: pctY(destPos[1]) }}>
            <i /><i />
          </span>
        )}

        {/* Ciudades pulsables (botones reales encima de los puntos) */}
        {pts.map((p) => {
          const info = routeInfo(p.code);
          return (
            <button key={`hit-${p.code}`} type="button" className="hm-hit"
              style={{ left: pctX(p.pos[0]), top: pctY(p.pos[1]) }}
              aria-pressed={active === p.code}
              aria-label={info
                ? t("landing.routeAria", { from: cityOf(p.code) || p.code, to: cityOf(dest) || dest, km: info.km, eta: info.eta.replace(/^~/, "") })
                : (cityOf(p.code) || p.code)}
              onPointerDown={(e) => { lastPointer.current = e.pointerType || "mouse"; }}
              onPointerEnter={(e) => { if (e.pointerType === "mouse") setActive(p.code); }}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive((a) => (a === p.code ? null : a)); }}
              onFocus={() => { if (lastPointer.current === "keyboard") setActive(p.code); }}
              onBlur={() => setActive((a) => (a === p.code ? null : a))}
              onClick={() => {
                const ptr = lastPointer.current;
                lastPointer.current = "keyboard";
                if (ptr === "mouse") setActive(p.code);
                else setActive((a) => (a === p.code ? null : p.code));
              }} />
          );
        })}

        {/* Ficha de la ruta encendida: distancia real + tiempo estimado */}
        {activePt && activeInfo && activeMid && (
          <span key={`${activePt.code}-${dest}`} className="hm-route-tag" aria-hidden="true"
            style={{ left: `clamp(70px, ${pctX(activeMid[0])}, calc(100% - 70px))`, top: pctY(activeMid[1]) }}>
            <span className="hm-route-tag-k">{activePt.code} → {dest}</span>
            <span className="hm-route-tag-v">{activeInfo.km} km<i aria-hidden="true">·</i>{activeInfo.eta}</span>
          </span>
        )}

        {/* Estado: ejemplo o las ciudades reales del formulario */}
        <span className={`hm-state${isExample ? "" : " hm-state--live"}`}>
          <span className="hm-state-dot" aria-hidden="true" />
          {isExample ? t("landing.mapExample") : t(codes.length === 1 ? "landing.mapYoursOne" : "landing.mapYours", { n: codes.length })}
        </span>
      </div>

      <div className="hm-foot">
        <span className="hm-meet">
          <span className="hm-meet-label">{t("landing.diagramMeet")}</span>
          <FlapText text={dest} size="sm" className="hm-meet-flap" settleMs={520} />
          <span className="hm-meet-q" aria-hidden="true">?</span>
        </span>
        <span className="hm-note">{t("landing.mapNote")}</span>
      </div>
    </div>
  );
}
