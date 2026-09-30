import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { FlapText } from "./FlapBoard";
import { Odometer } from "./Odometer";
import { distanceKm, estimatedFlightMinutes } from "../utils/geo";

/**
 * Firma visual de FlyndMe: varios orígenes que CONVERGEN en un punto de
 * encuentro. Embodia el producto (multi-origen → mejor destino común) en una
 * imagen. Honesto: los nodos son ejemplos de origen y el destino es un
 * marcador — sin precios inventados (regla 1).
 *
 * Los arcos son ESTÁTICOS (una animación de entrada del SVG repintaba mal de
 * forma intermitente en Chromium, ver CLAUDE.md 22-jun). Lo que se mueve son
 * bucles infinitos: el pulso del destino, un avión por arco (SMIL) y el RADAR
 * (sep-2026): un haz cónico que gira alrededor del punto de encuentro y hace
 * "ping" en cada ciudad al barrerla. El haz y los pings son HTML animado solo
 * con transform/opacity (compositor, sin repintar el SVG).
 *
 * Al pasar el ratón, enfocar o tocar un aeropuerto, su ruta se enciende en
 * amarillo con una ficha de distancia real (ortodrómica) y un tiempo de vuelo
 * ESTIMADO ("~"). El destino de ejemplo gira en un panel de salidas y se
 * detiene mientras hay una ruta encendida.
 */
const EXAMPLE_DESTS = ["PAR", "ROM", "LIS", "PRG", "BCN", "AMS"];
const CYCLE_MS = 3300;
const SWEEP_S = 6; // una vuelta de radar (debe coincidir con .cv-sweep en board.css)
const VB_W = 360;
const VB_H = 300;

// Avión de 14px apuntando a +x (animateMotion rotate="auto" lo orienta al arco)
const PLANE_D = "M7 0 L-3 -5.5 L-1.5 -1.2 L-6 -1.2 L-7.5 -3.5 L-8.5 -3.5 L-7.4 0 L-8.5 3.5 L-7.5 3.5 L-6 1.2 L-1.5 1.2 L-3 5.5 Z";
const ORIGINS = [
  { code: "MAD", x: 36, y: 54 },
  { code: "LON", x: 24, y: 150 },
  { code: "BER", x: 40, y: 246 },
];
const DEST = { x: 322, y: 150 };

function arcCtrl(o) {
  return { x: (o.x + DEST.x) / 2, y: (o.y + DEST.y) / 2 - 46 }; // curva hacia arriba
}
function arcPath(o) {
  const c = arcCtrl(o);
  return `M ${o.x} ${o.y} Q ${c.x} ${c.y} ${DEST.x} ${DEST.y}`;
}
// Punto medio de la cuadrática (t = .5): ahí se ancla la ficha de la ruta.
function arcMid(o) {
  const c = arcCtrl(o);
  return { x: 0.25 * o.x + 0.5 * c.x + 0.25 * DEST.x, y: 0.25 * o.y + 0.5 * c.y + 0.25 * DEST.y };
}
// Ángulo (grados, sentido horario desde el norte) de la ciudad vista desde el
// punto de encuentro → retardo del ping para que coincida con el paso del haz.
function sweepDelay(o) {
  const deg = (Math.atan2(o.x - DEST.x, -(o.y - DEST.y)) * 180) / Math.PI;
  return (((deg + 360) % 360) / 360) * SWEEP_S;
}
const pct = (v, total) => `${(v / total) * 100}%`;

function prefersReducedMotion() {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

export default function ConvergenceHero({ idSuffix = "" }) {
  const { t, lang } = useI18n();
  const [idx, setIdx] = useState(0);
  const [active, setActive] = useState(null); // código de origen con la ruta encendida
  const lastPointer = useRef("keyboard");
  const stageRef = useRef(null);

  // Destino de ejemplo que gira; se detiene con una ruta encendida (la ficha
  // de km/tiempo tiene que referirse a un destino que no cambie bajo el dedo).
  useEffect(() => {
    if (active || prefersReducedMotion()) return undefined;
    const id = setInterval(() => setIdx((i) => (i + 1) % EXAMPLE_DESTS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [active]);

  // En táctil un toque fuera apaga la ruta (iOS no quita el foco al botón).
  useEffect(() => {
    if (!active) return undefined;
    const off = (e) => { if (stageRef.current && !stageRef.current.contains(e.target)) setActive(null); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [active]);

  const dest = EXAMPLE_DESTS[idx];
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

  // El gradiente/clip llevan id; si el componente se renderiza dos veces
  // (firma de desktop + remate de móvil) chocarían → idSuffix los hace únicos.
  const glowId = `cv-glow${idSuffix}`;
  const activeOrigin = ORIGINS.find((o) => o.code === active) || null;
  const activeInfo = activeOrigin ? routeInfo(activeOrigin.code) : null;
  const activeMid = activeOrigin ? arcMid(activeOrigin) : null;
  const maxLen = EXAMPLE_DESTS.reduce((mx, w) => Math.max(mx, w.length), 0);

  return (
    <div className="cv" role="group" aria-label={t("landing.diagramAlt")}>
      <div className={`cv-stage${active ? " cv-stage--focus" : ""}`} ref={stageRef}>
        {/* Haz de radar: disco cónico que gira (compositor) recortado a la
            carta y desvanecido hacia los bordes. */}
        <div className="cv-sweep-clip" aria-hidden="true">
          <div className="cv-sweep" style={{ left: pct(DEST.x, VB_W) }} />
        </div>

        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="cv-svg" aria-hidden="true">
          <defs>
            <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--sign, #FFC20E)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--sign, #FFC20E)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Arcos de convergencia (estáticos, ver .cv-arc) */}
          {ORIGINS.map((o) => (
            <path key={o.code} id={`cv-arc-${o.code}${idSuffix}`}
              className={`cv-arc${active && active !== o.code ? " cv-arc--dim" : ""}`}
              d={arcPath(o)} fill="none" />
          ))}
          {/* Ruta encendida (capa encima, solo cambia su opacidad) */}
          {ORIGINS.map((o) => (
            <g key={`lit-${o.code}`} className={`cv-lit${active === o.code ? " cv-lit--on" : ""}`}>
              <path className="cv-lit-halo" d={arcPath(o)} fill="none" />
              <path className="cv-lit-line" d={arcPath(o)} fill="none" />
            </g>
          ))}

          {/* Un avión por arco, en bucle hacia el punto de encuentro */}
          {ORIGINS.map((o, i) => (
            <g key={`p-${o.code}`} className="cv-plane" opacity="0">
              <path d={PLANE_D} />
              <animateMotion dur="3.6s" begin={`${i * 1.1}s`} repeatCount="indefinite" rotate="auto"
                keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1">
                <mpath href={`#cv-arc-${o.code}${idSuffix}`} />
              </animateMotion>
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.82;1"
                dur="3.6s" begin={`${i * 1.1}s`} repeatCount="indefinite" />
            </g>
          ))}

          {/* Nodos de origen */}
          {ORIGINS.map((o) => (
            <g key={o.code} className={`cv-origin${active === o.code ? " cv-origin--on" : ""}`}>
              <circle cx={o.x} cy={o.y} r="5.5" className="cv-origin-dot" />
              <circle cx={o.x} cy={o.y} r="6.5" className="cv-origin-lit" />
              <text x={o.x - 13} y={o.y + 4} textAnchor="end" className="cv-origin-label">{o.code}</text>
            </g>
          ))}

          {/* Anillos de alcance de radar (estáticos) */}
          <circle cx={DEST.x} cy={DEST.y} r="34" className="cv-range" />
          <circle cx={DEST.x} cy={DEST.y} r="58" className="cv-range" />

          {/* Destino: halo + anillo de pulso + punto */}
          <circle cx={DEST.x} cy={DEST.y} r="48" fill={`url(#${glowId})`} />
          <circle cx={DEST.x} cy={DEST.y} r="13" className="cv-dest-ring" fill="none" />
          <circle cx={DEST.x} cy={DEST.y} r="11" className="cv-dest-dot" />
          {/* glifo de "pin" (marcador) dentro del punto */}
          <circle cx={DEST.x} cy={DEST.y - 1} r="3.4" className="cv-dest-pin" />
        </svg>

        {/* Pings: onda en cada ciudad cuando el haz la barre (retardo = ángulo) */}
        {ORIGINS.map((o) => (
          <span key={`ping-${o.code}`} className="cv-ping" aria-hidden="true"
            style={{ left: pct(o.x, VB_W), top: pct(o.y, VB_H), animationDelay: `${sweepDelay(o).toFixed(2)}s` }} />
        ))}

        {/* Aeropuertos pulsables (botones reales encima de los nodos) */}
        {ORIGINS.map((o) => {
          const info = routeInfo(o.code);
          return (
            <button key={`hit-${o.code}`} type="button" className="cv-hit"
              style={{ left: pct(o.x - 12, VB_W), top: pct(o.y, VB_H) }}
              aria-pressed={active === o.code}
              aria-label={info ? t("landing.routeAria", { from: o.code, to: dest, km: info.km, eta: info.eta.replace(/^~/, "") }) : o.code}
              onPointerDown={(e) => { lastPointer.current = e.pointerType || "mouse"; }}
              onPointerEnter={(e) => { if (e.pointerType === "mouse") setActive(o.code); }}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive((a) => (a === o.code ? null : a)); }}
              onFocus={() => { if (lastPointer.current === "keyboard") setActive(o.code); }}
              onBlur={() => setActive((a) => (a === o.code ? null : a))}
              onClick={() => {
                const p = lastPointer.current;
                lastPointer.current = "keyboard";
                if (p === "mouse") setActive(o.code);
                else setActive((a) => (a === o.code ? null : o.code));
              }} />
          );
        })}

        {/* Pista discreta de que los aeropuertos se pueden tocar */}
        <span className="cv-hint" aria-hidden="true">{t("landing.diagramHint")}</span>

        {/* Ficha de la ruta encendida: distancia real + tiempo estimado */}
        {activeOrigin && activeInfo && (
          <span key={`${activeOrigin.code}-${dest}`} className="cv-route-tag" aria-hidden="true"
            style={{ left: pct(activeMid.x, VB_W), top: pct(activeMid.y, VB_H) }}>
            <span className="cv-route-tag-k">{activeOrigin.code} → {dest}</span>
            <span className="cv-route-tag-v">
              <Odometer value={activeInfo.km} /> km<i aria-hidden="true">·</i>{activeInfo.eta}
            </span>
          </span>
        )}
      </div>
      <span className="cv-meet">
        <span className="cv-meet-label">{t("landing.diagramMeet")}</span>
        <FlapText text={dest.padEnd(maxLen, " ")} size="sm" className="cv-meet-flap" settleMs={520} />
      </span>
    </div>
  );
}
