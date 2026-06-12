import React, { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur } from "../utils/helpers";
import { COUNTRIES } from "./europeGeo";

// ── City coordinates (lon, lat) for European destinations ────────────────────
const CITY_COORDS = {
  MAD: [-3.70, 40.42], BCN: [2.17, 41.39], AGP: [-4.42, 36.72],
  PMI: [2.74, 39.55], TFS: [-16.57, 28.04], LON: [-0.12, 51.51],
  EDI: [-3.19, 55.95], PAR: [2.35, 48.86], MRS: [5.37, 43.30],
  NCE: [7.26, 43.71], ROM: [12.50, 41.90], MIL: [9.19, 45.46],
  NAP: [14.27, 40.85], BER: [13.40, 52.52], MUC: [11.58, 48.14],
  FRA: [8.68, 50.11], AMS: [4.90, 52.37], LIS: [-9.14, 38.74],
  OPO: [-8.61, 41.15], DUB: [-6.26, 53.35], BRU: [4.35, 50.85],
  GVA: [6.14, 46.20], ZRH: [8.54, 47.38], VIE: [16.37, 48.21],
  PRG: [14.42, 50.08], WAW: [21.01, 52.23], KRK: [19.94, 50.06],
  BUD: [19.04, 47.50], OTP: [26.10, 44.43], SOF: [23.32, 42.70],
  BEG: [20.47, 44.79], ZAG: [15.98, 45.81], DBV: [18.09, 42.65],
  SPU: [16.44, 43.51], TIA: [19.82, 41.33], CPH: [12.57, 55.68],
  HEL: [24.94, 60.17], OSL: [10.75, 59.91], STO: [18.07, 59.33],
  TLL: [24.75, 59.44], RIX: [24.11, 56.95], VNO: [25.28, 54.69],
  ATH: [23.73, 37.98], SKG: [22.95, 40.63], RHO: [28.23, 36.43],
  IST: [28.98, 41.01], MLA: [14.51, 35.90], RAK: [-8.00, 31.63],
  CMN: [-7.59, 33.57], TLV: [34.79, 32.08],
};

// ── Mercator projection for Europe ──────────────────────────────────────────
const MAP_BOUNDS = { lonMin: -14, lonMax: 36, latMin: 30, latMax: 62 };
const SVG_W = 700;
const SVG_H = 500;

const MERC_MIN = Math.log(Math.tan(Math.PI / 4 + (MAP_BOUNDS.latMin * Math.PI) / 360));
const MERC_MAX = Math.log(Math.tan(Math.PI / 4 + (MAP_BOUNDS.latMax * Math.PI) / 360));

function project(lon, lat) {
  const x = ((lon - MAP_BOUNDS.lonMin) / (MAP_BOUNDS.lonMax - MAP_BOUNDS.lonMin)) * SVG_W;
  const mercN = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const y = SVG_H - ((mercN - MERC_MIN) / (MERC_MAX - MERC_MIN)) * SVG_H;
  return [x, y];
}

// Helper: generate SVG path from array of [lon, lat]
function toPath(coords) {
  return coords.map(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

// ── Real country shapes (Natural Earth, see europeGeo.js) ───────────────────
// Pre-projected once at module load; fills alternate subtly per country so
// internal borders read without strong color differences.
const COUNTRY_PATHS = COUNTRIES.map((c) => ({
  iso: c.iso,
  alt: (c.iso.charCodeAt(0) + c.iso.charCodeAt(c.iso.length - 1)) % 2 === 1,
  d: c.rings.map(toPath).join(" "),
}));

// ── Edge clamping for cities outside the visible canvas (TFS, etc.) ─────────
const EDGE_PAD = 16;
function clampPos([x, y]) {
  const cx = Math.min(SVG_W - EDGE_PAD, Math.max(EDGE_PAD, x));
  const cy = Math.min(SVG_H - EDGE_PAD, Math.max(EDGE_PAD, y));
  const offMap = cx !== x || cy !== y;
  return {
    pos: [cx, cy],
    offMap,
    // Angle pointing from the clamped position towards the real location
    offAngle: offMap ? (Math.atan2(y - cy, x - cx) * 180) / Math.PI : 0,
  };
}

// Quadratic Bézier arc between two points, bowed upwards (great-circle feel).
function flightArc([x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const lift = Math.min(46, dist * 0.18);
  // Perpendicular to the chord, always bowing towards the top of the map
  let px = -dy / dist;
  let py = dx / dist;
  if (py > 0) { px = -px; py = -py; }
  const cx = (x1 + x2) / 2 + px * lift;
  const cy = (y1 + y2) / 2 + py * lift;
  return {
    d: `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
    // Bézier midpoint (t = 0.5) and tangent angle (parallel to the chord there)
    mid: [(x1 + 2 * cx + x2) / 4, (y1 + 2 * cy + y2) / 4],
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

// Small airplane silhouette pointing towards +x, centred on the origin.
const PLANE_PATH =
  "M7 0c0-.5-.5-.9-1.3-.9H2.4L-1.2-4.4h-1.5l1.8 3.5h-3.3L-5.5-2.4h-1.1L-5.8 0l-.8 2.4h1.1l1.3-1.5h3.3l-1.8 3.5h1.5L2.4.9h3.3C6.5.9 7 .5 7 0z";

const GRATICULE_LON = [-10, 0, 10, 20, 30];
const GRATICULE_LAT = [35, 40, 45, 50, 55, 60];

export default function DestinationMap({ flights, bestDestination, origins }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(null);

  const bestCode = normalizeCode(bestDestination?.destination || "");

  const destData = useMemo(() => {
    const map = {};
    (flights || []).forEach((f) => {
      const code = normalizeCode(f.destination);
      map[code] = {
        total: f.totalCostEUR,
        avg: f.averageCostPerTraveler,
        fairness: f.fairnessScore,
        isBest: code === bestCode,
        city: cityOf(code),
      };
    });
    return map;
  }, [flights, bestCode]);

  const originPoints = useMemo(() => {
    return (origins || []).filter(Boolean).map((o) => {
      const code = normalizeCode(o);
      const coords = CITY_COORDS[code];
      if (!coords) return null;
      return { code, city: cityOf(code), ...clampPos(project(coords[0], coords[1])) };
    }).filter(Boolean);
  }, [origins]);

  const destPoints = useMemo(() => {
    return Object.entries(destData).map(([code, data]) => {
      const coords = CITY_COORDS[code];
      if (!coords) return null;
      return { code, ...data, ...clampPos(project(coords[0], coords[1])) };
    }).filter(Boolean);
  }, [destData]);

  // Normalizado al rango real del resultado: el más barato es verde y el más
  // caro rojo (antes el mínimo era 0 y el verde no aparecía nunca).
  const prices = destPoints.map((d) => d.avg).filter(Boolean);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;

  // Green → amber → red ramp with enough depth for white text (AA at bold 9px)
  function priceColor(avg) {
    if (!avg) return "#64748B";
    const ratio = (avg - minPrice) / (maxPrice - minPrice || 1);
    const mix = (a, b, k) => Math.round(a + (b - a) * k);
    if (ratio < 0.5) {
      const k = ratio * 2; // #15803D → #B45309
      return `rgb(${mix(21, 180, k)}, ${mix(128, 83, k)}, ${mix(61, 9, k)})`;
    }
    const k = (ratio - 0.5) * 2; // #B45309 → #DC2626
    return `rgb(${mix(180, 220, k)}, ${mix(83, 38, k)}, ${mix(9, 38, k)})`;
  }

  const bestPoint = destPoints.find((d) => d.isBest) || null;
  const hoveredData = hovered ? destData[hovered] || null : null;

  return (
    <div className="dm-wrap">
      <div className="dm-header">
        <h3 className="dm-title">{t("map.title")}</h3>
        <div className="dm-legend">
          <span className="dm-legend-item">
            <span className="dm-dot dm-dot--cheap" /> {t("map.cheap")}
          </span>
          <span className="dm-legend-item">
            <span className="dm-dot dm-dot--mid" /> {t("map.mid")}
          </span>
          <span className="dm-legend-item">
            <span className="dm-dot dm-dot--expensive" /> {t("map.expensive")}
          </span>
          <span className="dm-legend-item">
            <span className="dm-dot dm-dot--origin" /> {t("map.origin")}
          </span>
        </div>
      </div>

      <div className="dm-container">
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="dm-svg" role="img"
          aria-label={t("map.ariaLabel")}>
          <defs>
            <linearGradient id="dmSea" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop className="dm-sea-stop1" offset="0%" />
              <stop className="dm-sea-stop2" offset="100%" />
            </linearGradient>
            <radialGradient id="dmVignette" cx="50%" cy="46%" r="72%">
              <stop className="dm-vignette-in" offset="62%" />
              <stop className="dm-vignette-out" offset="100%" />
            </radialGradient>
            <filter id="dmLandShadow" x="-3%" y="-3%" width="106%" height="106%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.6" floodColor="#0B1030" floodOpacity="0.18" />
            </filter>
          </defs>

          {/* Sea background */}
          <rect width={SVG_W} height={SVG_H} fill="url(#dmSea)" />

          {/* Graticule (under land) */}
          <g className="dm-graticule">
            {GRATICULE_LON.map((lon) => {
              const [x] = project(lon, MAP_BOUNDS.latMin);
              return <line key={`glon${lon}`} x1={x} y1={0} x2={x} y2={SVG_H} />;
            })}
            {GRATICULE_LAT.map((lat) => {
              const [, y] = project(MAP_BOUNDS.lonMin, lat);
              return <line key={`glat${lat}`} x1={0} y1={y} x2={SVG_W} y2={y} />;
            })}
          </g>

          {/* Real land masses with national borders (Natural Earth) */}
          <g filter="url(#dmLandShadow)">
            {COUNTRY_PATHS.map((c, i) => (
              <path key={`${c.iso}${i}`} d={c.d}
                className={c.alt ? "dm-land dm-land--alt" : "dm-land"} />
            ))}
          </g>

          {/* Soft vignette for plate depth */}
          <rect width={SVG_W} height={SVG_H} fill="url(#dmVignette)" style={{ pointerEvents: "none" }} />

          {/* Flight arcs from each origin to the best destination */}
          {bestPoint && originPoints.map((o) => {
            const arc = flightArc(o.pos, bestPoint.pos);
            return (
              <g key={`arc-${o.code}`}>
                <path d={arc.d} className="dm-arc" />
                <path d={PLANE_PATH} className="dm-plane"
                  transform={`translate(${arc.mid[0].toFixed(1)},${arc.mid[1].toFixed(1)}) rotate(${arc.angle.toFixed(1)})`} />
              </g>
            );
          })}

          {/* Destination bubbles */}
          {destPoints.map((d) => {
            const isHov = hovered === d.code;
            const r = d.isBest ? 18 : isHov ? 15 : 11;
            return (
              <g key={d.code}
                onMouseEnter={() => setHovered(d.code)}
                onMouseLeave={() => setHovered(null)}
                opacity={hovered && !isHov && !d.isBest ? 0.45 : 1}
                style={{ cursor: "pointer" }}>
                {d.isBest && (
                  <circle cx={d.pos[0]} cy={d.pos[1]} r={r + 7} className="dm-best-halo" />
                )}
                {d.offMap && (
                  <>
                    <circle cx={d.pos[0]} cy={d.pos[1]} r={r + 5} className="dm-offmap-ring" />
                    <path d="M0,-3.4 L5.4,0 L0,3.4 Z" className="dm-offmap-arrow"
                      transform={`translate(${(d.pos[0] + Math.cos((d.offAngle * Math.PI) / 180) * (r + 9)).toFixed(1)},${(d.pos[1] + Math.sin((d.offAngle * Math.PI) / 180) * (r + 9)).toFixed(1)}) rotate(${d.offAngle.toFixed(1)})`} />
                  </>
                )}
                <circle cx={d.pos[0]} cy={d.pos[1]} r={r}
                  className={d.isBest ? "dm-bubble dm-bubble--best" : "dm-bubble"}
                  fill={d.isBest ? undefined : priceColor(d.avg)}
                />
                <text x={d.pos[0]} y={d.pos[1] + 1}
                  textAnchor="middle" dominantBaseline="central"
                  className={d.isBest ? "dm-bubble-text dm-bubble-text--best" : "dm-bubble-text"}
                  fontSize={d.isBest ? 10 : 9}
                  style={{ pointerEvents: "none" }}>
                  {formatEur(d.avg, 0).replace(/[€\s]/g, "")}
                </text>
                {(d.isBest || isHov) && (
                  <>
                    <rect x={d.pos[0] - 30} y={d.pos[1] - (d.isBest ? 36 : 30)} width="60" height="16" rx="4"
                      className="dm-city-pill" style={{ pointerEvents: "none" }} />
                    <text x={d.pos[0]} y={d.pos[1] - (d.isBest ? 26 : 20)}
                      textAnchor="middle" className="dm-city-pill-text" fontSize="10"
                      style={{ pointerEvents: "none" }}>
                      {d.city || d.code}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Origin markers */}
          {originPoints.map((o) => (
            <g key={`origin-${o.code}`}>
              <circle cx={o.pos[0]} cy={o.pos[1]} r="8" className="dm-origin" />
              <circle cx={o.pos[0]} cy={o.pos[1]} r="3" className="dm-origin-core" />
              <rect x={o.pos[0] - 16} y={o.pos[1] - 22} width="32" height="14" rx="4"
                className="dm-origin-pill" />
              <text x={o.pos[0]} y={o.pos[1] - 13}
                textAnchor="middle" className="dm-origin-pill-text" fontSize="9">
                {o.code}
              </text>
            </g>
          ))}

          {/* Best destination star label */}
          {bestPoint && (
            <g>
              <rect x={bestPoint.pos[0] - 24} y={bestPoint.pos[1] + 20} width="48" height="16" rx="8"
                className="dm-best-pill" />
              <text x={bestPoint.pos[0]} y={bestPoint.pos[1] + 30}
                textAnchor="middle" className="dm-best-pill-text" fontSize="9">
                ★ {t("map.best")}
              </text>
            </g>
          )}
        </svg>

        {/* Hover tooltip */}
        {hovered && hoveredData && (
          <div className="dm-tooltip">
            <div className="dm-tooltip-city">{hoveredData.city || hovered}</div>
            <div className="dm-tooltip-price">{formatEur(hoveredData.avg, 0)} /pp</div>
            <div className="dm-tooltip-total">{t("map.groupTotal")}: {formatEur(hoveredData.total, 0)}</div>
            <div className="dm-tooltip-fairness">Fairness: {(hoveredData.fairness || 0).toFixed(0)}/100</div>
          </div>
        )}
      </div>
    </div>
  );
}
