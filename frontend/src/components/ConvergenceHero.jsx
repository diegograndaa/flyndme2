import React from "react";
import { useI18n } from "../i18n/useI18n";
import { FlapCycle } from "./FlapBoard";

/**
 * Firma visual de FlyndMe: varios orígenes que CONVERGEN en un punto de
 * encuentro. Embodia el producto (multi-origen → mejor destino común) en una
 * imagen. Honesto: los nodos son ejemplos de origen y el destino es un
 * marcador — sin precios inventados (regla 1).
 *
 * Los arcos son ESTÁTICOS (una animación de entrada del SVG repintaba mal de
 * forma intermitente en Chromium, ver CLAUDE.md 22-jun). Lo que se mueve son
 * bucles infinitos, que sí repintan fiables: el pulso del destino y un avión
 * por arco (SMIL <animateMotion>, oculto con prefers-reduced-motion en CSS).
 * El código del destino gira en un panel de salidas con destinos de EJEMPLO
 * (ilustrativo, sin precios).
 */
const EXAMPLE_DESTS = ["PAR", "ROM", "LIS", "PRG", "BCN", "AMS"];

// Avión de 14px apuntando a +x (animateMotion rotate="auto" lo orienta al arco)
const PLANE_D = "M7 0 L-3 -5.5 L-1.5 -1.2 L-6 -1.2 L-7.5 -3.5 L-8.5 -3.5 L-7.4 0 L-8.5 3.5 L-7.5 3.5 L-6 1.2 L-1.5 1.2 L-3 5.5 Z";
const ORIGINS = [
  { code: "MAD", x: 36, y: 54 },
  { code: "LON", x: 24, y: 150 },
  { code: "BER", x: 40, y: 246 },
];
const DEST = { x: 322, y: 150 };

function arcPath(o) {
  const mx = (o.x + DEST.x) / 2;
  const cy = (o.y + DEST.y) / 2 - 46; // curva hacia arriba
  return `M ${o.x} ${o.y} Q ${mx} ${cy} ${DEST.x} ${DEST.y}`;
}

export default function ConvergenceHero({ idSuffix = "" }) {
  const { t } = useI18n();
  // El gradiente lleva un id; si el componente se renderiza dos veces (firma de
  // desktop + remate de móvil) los ids chocarían → idSuffix los hace únicos.
  const glowId = `cv-glow${idSuffix}`;
  return (
    <div className="cv" role="img" aria-label={t("landing.diagramAlt")}>
      <svg viewBox="0 0 360 300" className="cv-svg" aria-hidden="true">
        <defs>
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--sign, #FFC20E)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--sign, #FFC20E)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Arcos de convergencia (estáticos, ver .cv-arc) */}
        {ORIGINS.map((o) => (
          <path key={o.code} id={`cv-arc-${o.code}${idSuffix}`} className="cv-arc" d={arcPath(o)} fill="none" />
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
        {ORIGINS.map((o, i) => (
          <g key={o.code} className="cv-origin" style={{ animationDelay: `${i * 0.18}s` }}>
            <circle cx={o.x} cy={o.y} r="5.5" className="cv-origin-dot" />
            <text x={o.x - 13} y={o.y + 4} textAnchor="end" className="cv-origin-label">{o.code}</text>
          </g>
        ))}

        {/* Radar alrededor del punto de encuentro: anillos de alcance estáticos
            + barrido en bucle infinito (nunca animación de entrada). */}
        <circle cx={DEST.x} cy={DEST.y} r="34" className="cv-range" />
        <circle cx={DEST.x} cy={DEST.y} r="58" className="cv-range" />
        <g className="cv-radar">
          <path d={`M ${DEST.x} ${DEST.y} L ${DEST.x} ${DEST.y - 58} A 58 58 0 0 1 ${DEST.x + 41} ${DEST.y - 41} Z`} />
          <animateTransform attributeName="transform" type="rotate"
            from={`0 ${DEST.x} ${DEST.y}`} to={`360 ${DEST.x} ${DEST.y}`} dur="7s" repeatCount="indefinite" />
        </g>

        {/* Destino: halo + anillo de pulso + punto */}
        <circle cx={DEST.x} cy={DEST.y} r="48" fill={`url(#${glowId})`} />
        <circle cx={DEST.x} cy={DEST.y} r="13" className="cv-dest-ring" fill="none" />
        <circle cx={DEST.x} cy={DEST.y} r="11" className="cv-dest-dot" />
        {/* glifo de "pin" (marcador) en blanco dentro del punto */}
        <circle cx={DEST.x} cy={DEST.y - 1} r="3.4" className="cv-dest-pin" />
      </svg>
      <span className="cv-meet">
        <span className="cv-meet-label">{t("landing.diagramMeet")}</span>
        <FlapCycle words={EXAMPLE_DESTS} size="sm" interval={3300} className="cv-meet-flap" />
      </span>
    </div>
  );
}
