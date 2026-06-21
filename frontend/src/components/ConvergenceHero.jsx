import React from "react";
import { useI18n } from "../i18n/useI18n";

/**
 * Firma visual de FlyndMe: varios orígenes que CONVERGEN en un punto de
 * encuentro. Embodia el producto (multi-origen → mejor destino común) en una
 * imagen. Honesto: los nodos son ejemplos de origen y el destino es un
 * marcador — sin precios inventados (regla 1).
 *
 * Animación de trazado (los arcos "viajan" hacia el destino) con
 * `prefers-reduced-motion` respetado en CSS.
 */
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

export default function ConvergenceHero() {
  const { t } = useI18n();
  return (
    <div className="cv" role="img" aria-label={t("landing.diagramAlt")}>
      <svg viewBox="0 0 360 300" className="cv-svg" aria-hidden="true">
        <defs>
          <radialGradient id="cv-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Arcos de convergencia (pathLength=1 → draw-in uniforme) */}
        {ORIGINS.map((o, i) => (
          <path key={o.code} className="cv-arc" d={arcPath(o)} pathLength="1"
            fill="none" style={{ animationDelay: `${0.15 + i * 0.22}s` }} />
        ))}

        {/* Nodos de origen */}
        {ORIGINS.map((o, i) => (
          <g key={o.code} className="cv-origin" style={{ animationDelay: `${i * 0.18}s` }}>
            <circle cx={o.x} cy={o.y} r="5.5" className="cv-origin-dot" />
            <text x={o.x - 13} y={o.y + 4} textAnchor="end" className="cv-origin-label">{o.code}</text>
          </g>
        ))}

        {/* Destino: halo + anillo de pulso + punto */}
        <circle cx={DEST.x} cy={DEST.y} r="48" fill="url(#cv-glow)" />
        <circle cx={DEST.x} cy={DEST.y} r="13" className="cv-dest-ring" fill="none" />
        <circle cx={DEST.x} cy={DEST.y} r="11" className="cv-dest-dot" />
        {/* glifo de "pin" (marcador) en blanco dentro del punto */}
        <circle cx={DEST.x} cy={DEST.y - 1} r="3.4" className="cv-dest-pin" />
      </svg>
      <span className="cv-meet">{t("landing.diagramMeet")}</span>
    </div>
  );
}
