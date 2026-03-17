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
const MAP_BOUNDS = { lonMin: -18, lonMax: 38, latMin: 28, latMax: 63 };
const SVG_W = 700;
const SVG_H = 480;

function project(lon, lat) {
  const x = ((lon - MAP_BOUNDS.lonMin) / (MAP_BOUNDS.lonMax - MAP_BOUNDS.lonMin)) * SVG_W;
  // Mercator latitude
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const latMinRad = (MAP_BOUNDS.latMin * Math.PI) / 180;
  const latMaxRad = (MAP_BOUNDS.latMax * Math.PI) / 180;
  const mercMin = Math.log(Math.tan(Math.PI / 4 + latMinRad / 2));
  const mercMax = Math.log(Math.tan(Math.PI / 4 + latMaxRad / 2));
  const y = SVG_H - ((mercN - mercMin) / (mercMax - mercMin)) * SVG_H;
  return [x, y];
}

export default function DestinationMap({ flights, bestDestination, origins }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(null);

  const bestCode = normalizeCode(bestDestination?.destination || "");

  // Build price map: { destCode: { total, avg, isBest } }
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

  // Project origin cities
  const originPoints = useMemo(() => {
    return (origins || []).filter(Boolean).map((o) => {
      const code = normalizeCode(o);
      const coords = CITY_COORDS[code];
      if (!coords) return null;
      return { code, city: cityOf(code), pos: project(coords[0], coords[1]) };
    }).filter(Boolean);
  }, [origins]);

  // Project destination cities with prices
  const destPoints = useMemo(() => {
    return Object.entries(destData).map(([code, data]) => {
      const coords = CITY_COORDS[code];
      if (!coords) return null;
      return { code, ...data, pos: project(coords[0], coords[1]) };
    }).filter(Boolean);
  }, [destData]);

  // Price range for color scale
  const prices = destPoints.map((d) => d.avg).filter(Boolean);
  const minPrice = Math.min(...prices, 0);
  const maxPrice = Math.max(...prices, 1);

  function priceColor(avg) {
    if (!avg) return "#94A3B8";
    const t = (avg - minPrice) / (maxPrice - minPrice || 1);
    // Green → Yellow → Red
    if (t < 0.5) {
      const r = Math.round(34 + (217 - 34) * (t * 2));
      const g = Math.round(197 + (119 - 197) * (t * 2));
      return `rgb(${r}, ${g}, 56)`;
    }
    const r = Math.round(217 + (220 - 217) * ((t - 0.5) * 2));
    const g = Math.round(119 - 119 * ((t - 0.5) * 2));
    return `rgb(${r}, ${g}, 38)`;
  }

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
          {/* Background */}
          <rect width={SVG_W} height={SVG_H} rx="12" fill="#F0F4F8" />

          {/* Connection lines from origins to best destination */}
          {bestCode && CITY_COORDS[bestCode] && originPoints.map((o) => {
            const destPos = project(CITY_COORDS[bestCode][0], CITY_COORDS[bestCode][1]);
            return (
              <line key={`line-${o.code}`}
                x1={o.pos[0]} y1={o.pos[1]}
                x2={destPos[0]} y2={destPos[1]}
                stroke="#0062E3" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3"
              />
            );
          })}

          {/* Destination bubbles */}
          {destPoints.map((d) => (
            <g key={d.code}
              onMouseEnter={() => setHovered(d.code)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}>
              <circle cx={d.pos[0]} cy={d.pos[1]}
                r={d.isBest ? 18 : hovered === d.code ? 15 : 12}
                fill={d.isBest ? "#0062E3" : priceColor(d.avg)}
                stroke={d.isBest ? "#003D8F" : "white"}
                strokeWidth={d.isBest ? 3 : 2}
                opacity={hovered && hovered !== d.code ? 0.4 : 0.9}
                style={{ transition: "all 0.2s ease" }}
              />
              <text x={d.pos[0]} y={d.pos[1] + 1}
                textAnchor="middle" dominantBaseline="central"
                fill="white" fontSize={d.isBest ? 10 : 9} fontWeight="700"
                style={{ pointerEvents: "none" }}>
                {formatEur(d.avg, 0).replace("€", "")}
              </text>
              {/* Label on hover or for best */}
              {(d.isBest || hovered === d.code) && (
                <text x={d.pos[0]} y={d.pos[1] - (d.isBest ? 24 : 20)}
                  textAnchor="middle" fill="#111827" fontSize="11" fontWeight="700"
                  style={{ pointerEvents: "none" }}>
                  {d.city || d.code}
                </text>
              )}
            </g>
          ))}

          {/* Origin markers */}
          {originPoints.map((o) => (
            <g key={`origin-${o.code}`}>
              <circle cx={o.pos[0]} cy={o.pos[1]} r="7"
                fill="#05C3A8" stroke="white" strokeWidth="2" />
              <text x={o.pos[0]} y={o.pos[1] - 12}
                textAnchor="middle" fill="#05C3A8" fontSize="10" fontWeight="700">
                {o.code}
              </text>
            </g>
          ))}

          {/* Best destination star marker */}
          {bestCode && CITY_COORDS[bestCode] && (() => {
            const pos = project(CITY_COORDS[bestCode][0], CITY_COORDS[bestCode][1]);
            return (
              <text x={pos[0]} y={pos[1] + 28}
                textAnchor="middle" fill="#0062E3" fontSize="10" fontWeight="800">
                ★ {t("map.best")}
              </text>
            );
          })()}
        </svg>

        {/* Hover tooltip */}
        {hovered && hoveredData && (
          <div className="dm-tooltip">
            <div className="dm-tooltip-city">{hoveredData.city || hovered}</div>
            <div className="dm-tooltip-price">{formatEur(hoveredData.avg, 0)} /pp</div>
            <div className="dm-tooltip-total">{t("map.groupTotal")}: {formatEur(hoveredData.total, 0)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
