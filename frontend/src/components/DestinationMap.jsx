import React, { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur } from "../utils/helpers";

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

function project(lon, lat) {
  const x = ((lon - MAP_BOUNDS.lonMin) / (MAP_BOUNDS.lonMax - MAP_BOUNDS.lonMin)) * SVG_W;
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const latMinRad = (MAP_BOUNDS.latMin * Math.PI) / 180;
  const latMaxRad = (MAP_BOUNDS.latMax * Math.PI) / 180;
  const mercMin = Math.log(Math.tan(Math.PI / 4 + latMinRad / 2));
  const mercMax = Math.log(Math.tan(Math.PI / 4 + latMaxRad / 2));
  const y = SVG_H - ((mercN - mercMin) / (mercMax - mercMin)) * SVG_H;
  return [x, y];
}

// Helper: generate SVG path from array of [lon, lat]
function toPath(coords) {
  return coords.map(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

// ── Simplified coastline polygons (lon, lat) ─────────────────────────────────
// These are heavily simplified outlines for visual reference only.

const IBERIA = [
  [-9.5, 37.0], [-9.3, 38.7], [-8.8, 41.2], [-8.9, 42.1], [-9.3, 43.0],
  [-8.2, 43.4], [-6.0, 43.6], [-4.5, 43.4], [-3.8, 43.4], [-1.8, 43.4],
  [0.3, 42.7], [3.2, 42.4], [3.3, 41.9], [2.1, 41.3], [0.8, 40.7],
  [-0.3, 39.5], [0.0, 38.7], [-0.5, 37.8], [-1.6, 37.0], [-2.3, 36.7],
  [-5.3, 36.1], [-5.6, 36.0], [-7.4, 37.0], [-9.5, 37.0],
];

const FRANCE_BENELUX = [
  [-1.8, 43.4], [-1.2, 46.2], [-1.8, 47.2], [-3.5, 48.5], [-1.5, 48.6],
  [0.0, 49.5], [1.8, 51.0], [2.5, 51.1], [3.4, 51.4], [4.3, 51.5],
  [5.0, 51.5], [6.1, 51.9], [6.0, 50.8], [6.4, 49.5], [8.2, 49.0],
  [7.6, 47.6], [7.0, 47.3], [6.8, 46.4], [6.1, 46.2], [6.6, 45.1],
  [7.1, 44.2], [6.5, 43.2], [5.4, 43.2], [4.2, 43.5], [3.0, 42.5],
  [0.3, 42.7], [-1.8, 43.4],
];

const BRITAIN = [
  [-5.7, 50.1], [-5.0, 50.3], [-3.5, 50.4], [-1.2, 50.8], [1.4, 51.4],
  [1.7, 52.5], [0.5, 52.9], [0.3, 53.5], [-0.5, 54.0], [-1.2, 54.6],
  [-3.0, 55.0], [-3.4, 55.9], [-5.2, 56.1], [-5.7, 57.6], [-5.0, 58.5],
  [-3.0, 58.6], [-2.0, 57.7], [-1.8, 57.5], [-2.0, 56.0], [-3.4, 55.9],
  [-4.8, 54.9], [-3.2, 54.1], [-3.0, 53.4], [-4.1, 53.3], [-5.3, 51.8],
  [-5.7, 50.1],
];

const IRELAND = [
  [-9.9, 52.2], [-10.0, 53.5], [-8.5, 54.3], [-7.3, 55.3], [-6.2, 55.2],
  [-5.5, 54.2], [-6.0, 52.7], [-6.4, 52.2], [-9.0, 51.3], [-9.9, 52.2],
];

const ITALY = [
  [6.6, 45.1], [7.7, 44.1], [8.3, 44.0], [9.7, 44.4], [10.0, 44.0],
  [11.1, 42.4], [11.8, 42.1], [12.5, 41.9], [13.6, 41.2], [14.0, 40.7],
  [15.0, 40.0], [15.6, 40.1], [16.5, 39.0], [16.1, 38.8], [15.7, 38.0],
  [15.6, 37.9], [12.4, 37.8], [12.0, 38.2], [13.3, 38.2], [15.2, 38.8],
  [15.6, 40.1], [15.0, 40.0], [14.8, 40.6], [13.7, 41.3], [12.3, 41.8],
  [11.1, 44.0], [10.5, 44.9], [10.0, 45.5], [8.8, 46.0], [7.0, 45.9],
  [6.6, 45.1],
];

const SCANDINAVIA = [
  [4.8, 58.0], [5.3, 59.0], [5.0, 61.0], [6.0, 62.5],
  [10.5, 59.9], [11.0, 59.0], [12.0, 56.0], [12.6, 56.0],
  [14.0, 55.4], [13.0, 55.3], [11.0, 55.2], [8.6, 54.9],
  [8.1, 55.5], [8.6, 57.0], [7.0, 57.9], [4.8, 58.0],
];

const SCANDINAVIA_NORTH = [
  [12.6, 56.0], [14.3, 55.5], [14.8, 56.2], [16.5, 56.6],
  [18.3, 59.3], [18.5, 60.5], [17.3, 62.5], [14.5, 63.5],
  [11.5, 63.0], [10.0, 62.5], [6.0, 62.5], [10.5, 59.9],
  [12.0, 56.0], [12.6, 56.0],
];

const BALKANS = [
  [13.5, 45.5], [14.5, 45.3], [16.0, 45.8], [19.0, 45.0], [20.4, 44.8],
  [22.0, 44.0], [22.5, 43.2], [23.3, 42.7], [24.0, 42.1], [26.0, 41.7],
  [26.5, 40.5], [24.0, 38.0], [23.6, 38.0], [22.7, 37.6], [21.7, 38.3],
  [20.0, 39.6], [19.5, 40.5], [19.8, 41.3], [19.3, 42.2], [18.5, 42.5],
  [17.6, 42.9], [16.4, 43.5], [15.2, 44.2], [14.3, 44.9], [13.5, 45.5],
];

const CENTRAL_EAST = [
  [14.3, 55.5], [14.2, 54.0], [16.0, 54.5], [18.5, 54.4],
  [20.0, 54.3], [22.8, 55.0], [24.0, 56.0], [24.8, 57.0],
  [24.4, 59.4], [28.0, 59.5], [28.0, 56.0], [27.5, 54.0],
  [24.0, 53.9], [23.8, 52.7], [24.1, 50.9], [24.0, 49.0],
  [22.5, 48.1], [21.0, 48.5], [17.0, 48.0], [16.8, 48.7],
  [15.0, 49.0], [14.5, 48.6], [13.0, 48.3], [12.1, 47.7],
  [9.6, 47.5], [8.6, 47.6], [8.2, 49.0], [6.4, 49.5],
  [6.0, 50.8], [6.1, 51.9], [5.9, 53.0], [8.6, 54.9],
  [11.0, 55.2], [12.0, 56.0], [14.3, 55.5],
];

const TURKEY_EU = [
  [26.0, 41.7], [28.0, 41.0], [29.1, 41.3], [29.5, 41.2],
  [28.5, 41.7], [26.5, 42.0], [26.0, 41.7],
];

const NORTH_AFRICA = [
  [-5.6, 36.0], [-2.3, 35.0], [0.0, 35.5], [3.0, 37.0],
  [9.0, 37.0], [10.5, 37.0], [10.5, 35.0], [0.0, 34.0],
  [-5.0, 34.0], [-6.0, 35.0], [-5.6, 36.0],
];

const MOROCCO = [
  [-13.0, 32.0], [-13.0, 35.0], [-6.0, 35.0], [-5.0, 34.0],
  [-1.0, 35.0], [-2.3, 35.0], [-5.6, 36.0], [-5.3, 36.1],
  [-7.4, 37.0], [-9.5, 37.0], [-9.8, 36.0], [-10.0, 34.0],
  [-13.0, 32.0],
];

const SICILY = [
  [12.4, 37.8], [13.0, 37.5], [15.2, 37.1], [15.7, 38.0], [15.6, 37.9],
  [13.3, 38.2], [12.0, 38.2], [12.4, 37.8],
];

const SARDINIA = [
  [8.1, 39.1], [9.0, 39.0], [9.8, 39.2], [9.7, 40.9], [8.3, 41.1],
  [8.1, 40.7], [8.1, 39.1],
];

const CORSICA = [
  [8.6, 41.4], [9.4, 41.4], [9.6, 42.0], [9.4, 43.0], [8.6, 42.5],
  [8.6, 41.4],
];

const ALL_LANDS = [
  IBERIA, FRANCE_BENELUX, BRITAIN, IRELAND, ITALY, SCANDINAVIA,
  SCANDINAVIA_NORTH, BALKANS, CENTRAL_EAST, TURKEY_EU,
  NORTH_AFRICA, MOROCCO, SICILY, SARDINIA, CORSICA,
];

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
      return { code, city: cityOf(code), pos: project(coords[0], coords[1]) };
    }).filter(Boolean);
  }, [origins]);

  const destPoints = useMemo(() => {
    return Object.entries(destData).map(([code, data]) => {
      const coords = CITY_COORDS[code];
      if (!coords) return null;
      return { code, ...data, pos: project(coords[0], coords[1]) };
    }).filter(Boolean);
  }, [destData]);

  const prices = destPoints.map((d) => d.avg).filter(Boolean);
  const minPrice = Math.min(...prices, 0);
  const maxPrice = Math.max(...prices, 1);

  function priceColor(avg) {
    if (!avg) return "#94A3B8";
    const ratio = (avg - minPrice) / (maxPrice - minPrice || 1);
    if (ratio < 0.5) {
      const r = Math.round(34 + (217 - 34) * (ratio * 2));
      const g = Math.round(197 + (119 - 197) * (ratio * 2));
      return `rgb(${r}, ${g}, 56)`;
    }
    const r = Math.round(217 + (220 - 217) * ((ratio - 0.5) * 2));
    const g = Math.round(119 - 119 * ((ratio - 0.5) * 2));
    return `rgb(${r}, ${g}, 38)`;
  }

  // Pre-compute land paths
  const landPaths = useMemo(() => ALL_LANDS.map(toPath), []);

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
            <linearGradient id="seaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#DBEAFE" />
              <stop offset="100%" stopColor="#C7D9F0" />
            </linearGradient>
            <filter id="landShadow" x="-2%" y="-2%" width="104%" height="104%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.08" />
            </filter>
          </defs>

          {/* Sea background */}
          <rect width={SVG_W} height={SVG_H} rx="12" fill="url(#seaGrad)" />

          {/* Graticule (grid lines) */}
          {[-10, 0, 10, 20, 30].map((lon) => {
            const [x1] = project(lon, MAP_BOUNDS.latMin);
            const [x2] = project(lon, MAP_BOUNDS.latMax);
            return <line key={`glon${lon}`} x1={x1} y1={0} x2={x2} y2={SVG_H}
              stroke="#B0C4E0" strokeWidth="0.5" opacity="0.4" />;
          })}
          {[35, 40, 45, 50, 55, 60].map((lat) => {
            const [, y1] = project(MAP_BOUNDS.lonMin, lat);
            return <line key={`glat${lat}`} x1={0} y1={y1} x2={SVG_W} y2={y1}
              stroke="#B0C4E0" strokeWidth="0.5" opacity="0.4" />;
          })}

          {/* Land masses */}
          {landPaths.map((d, i) => (
            <path key={i} d={d}
              fill="#E8ECF1" stroke="#C8CDD5" strokeWidth="0.8"
              filter="url(#landShadow)" />
          ))}

          {/* Country borders (subtle inner lines) */}
          {[
            // France-Spain border
            [[-1.8, 43.4], [0.3, 42.7], [3.2, 42.4]],
            // France-Italy
            [[6.6, 45.1], [7.0, 44.2], [7.1, 44.2]],
            // Germany-France
            [[6.4, 49.5], [8.2, 49.0], [7.6, 47.6]],
          ].map((border, i) => {
            const d = border.map(([lon, lat], j) => {
              const [x, y] = project(lon, lat);
              return `${j === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(" ");
            return <path key={`border${i}`} d={d} fill="none" stroke="#C0C8D4" strokeWidth="0.5" strokeDasharray="3 2" />;
          })}

          {/* Connection lines from origins to best destination */}
          {bestCode && CITY_COORDS[bestCode] && originPoints.map((o) => {
            const destPos = project(CITY_COORDS[bestCode][0], CITY_COORDS[bestCode][1]);
            return (
              <line key={`line-${o.code}`}
                x1={o.pos[0]} y1={o.pos[1]}
                x2={destPos[0]} y2={destPos[1]}
                stroke="#0062E3" strokeWidth="1.8" strokeDasharray="6 4" opacity="0.35"
              />
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
                style={{ cursor: "pointer" }}>
                {/* Drop shadow ring */}
                <circle cx={d.pos[0]} cy={d.pos[1]} r={r + 2}
                  fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="3"
                  style={{ transition: "r 0.2s" }} />
                <circle cx={d.pos[0]} cy={d.pos[1]}
                  r={r}
                  fill={d.isBest ? "#0062E3" : priceColor(d.avg)}
                  stroke={d.isBest ? "#003D8F" : "white"}
                  strokeWidth={d.isBest ? 3 : 2}
                  opacity={hovered && !isHov ? 0.4 : 0.92}
                  style={{ transition: "all 0.2s ease" }}
                />
                <text x={d.pos[0]} y={d.pos[1] + 1}
                  textAnchor="middle" dominantBaseline="central"
                  fill="white" fontSize={d.isBest ? 10 : 9} fontWeight="700"
                  style={{ pointerEvents: "none" }}>
                  {formatEur(d.avg, 0).replace(/[€\s]/g, "")}
                </text>
                {(d.isBest || isHov) && (
                  <>
                    <rect x={d.pos[0] - 30} y={d.pos[1] - (d.isBest ? 36 : 30)} width="60" height="16" rx="4"
                      fill="white" stroke="#E2E8F0" strokeWidth="0.5" opacity="0.9"
                      style={{ pointerEvents: "none" }} />
                    <text x={d.pos[0]} y={d.pos[1] - (d.isBest ? 26 : 20)}
                      textAnchor="middle" fill="#111827" fontSize="10" fontWeight="700"
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
              <circle cx={o.pos[0]} cy={o.pos[1]} r="8"
                fill="#05C3A8" stroke="white" strokeWidth="2.5" />
              <circle cx={o.pos[0]} cy={o.pos[1]} r="3"
                fill="white" />
              <rect x={o.pos[0] - 16} y={o.pos[1] - 22} width="32" height="14" rx="4"
                fill="#05C3A8" opacity="0.9" />
              <text x={o.pos[0]} y={o.pos[1] - 13}
                textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
                {o.code}
              </text>
            </g>
          ))}

          {/* Best destination star label */}
          {bestCode && CITY_COORDS[bestCode] && (() => {
            const pos = project(CITY_COORDS[bestCode][0], CITY_COORDS[bestCode][1]);
            return (
              <g>
                <rect x={pos[0] - 24} y={pos[1] + 20} width="48" height="16" rx="8"
                  fill="#0062E3" />
                <text x={pos[0]} y={pos[1] + 30}
                  textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
                  ★ {t("map.best")}
                </text>
              </g>
            );
          })()}
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
