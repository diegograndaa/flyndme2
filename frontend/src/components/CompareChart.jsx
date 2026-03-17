import React, { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur } from "../utils/helpers";

/**
 * Scatter plot: X = avg price per person, Y = fairness score
 * Quadrants: cheap+fair (ideal), cheap+unfair, expensive+fair, expensive+unfair
 */
const W = 600;
const H = 360;
const PAD = { top: 30, right: 30, bottom: 40, left: 50 };

export default function CompareChart({ flights, bestDestination }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(null);

  const bestCode = normalizeCode(bestDestination?.destination || "");

  const points = useMemo(() => {
    return (flights || []).map((f) => {
      const code = normalizeCode(f.destination);
      return {
        code,
        city: cityOf(code) || code,
        avg: f.averageCostPerTraveler || 0,
        fairness: f.fairnessScore || 0,
        total: f.totalCostEUR || 0,
        isBest: code === bestCode,
      };
    });
  }, [flights, bestCode]);

  // Scales
  const xMin = Math.max(0, Math.min(...points.map((p) => p.avg)) * 0.85);
  const xMax = Math.max(...points.map((p) => p.avg)) * 1.1;
  const yMin = 0;
  const yMax = 100;

  const scaleX = (v) => PAD.left + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD.left - PAD.right);
  const scaleY = (v) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  // Quadrant midpoints
  const midX = scaleX((xMin + xMax) / 2);
  const midY = scaleY(50);

  return (
    <div className="cc-wrap">
      <h3 className="cc-title">{t("compare.title")}</h3>

      <div className="cc-container">
        <svg viewBox={`0 0 ${W} ${H}`} className="cc-svg">
          {/* Quadrant backgrounds */}
          <rect x={PAD.left} y={PAD.top} width={midX - PAD.left} height={midY - PAD.top}
            fill="#E8F5E9" opacity="0.4" />
          <rect x={midX} y={PAD.top} width={W - PAD.right - midX} height={midY - PAD.top}
            fill="#FFF3E0" opacity="0.4" />
          <rect x={PAD.left} y={midY} width={midX - PAD.left} height={H - PAD.bottom - midY}
            fill="#FFF8E1" opacity="0.4" />
          <rect x={midX} y={midY} width={W - PAD.right - midX} height={H - PAD.bottom - midY}
            fill="#FFEBEE" opacity="0.4" />

          {/* Quadrant labels */}
          <text x={PAD.left + 6} y={PAD.top + 16} fontSize="9" fill="#2E7D32" opacity="0.6">{t("compare.cheapFair")}</text>
          <text x={W - PAD.right - 4} y={PAD.top + 16} fontSize="9" fill="#E65100" opacity="0.6" textAnchor="end">{t("compare.expFair")}</text>
          <text x={PAD.left + 6} y={H - PAD.bottom - 6} fontSize="9" fill="#F57F17" opacity="0.6">{t("compare.cheapUnfair")}</text>
          <text x={W - PAD.right - 4} y={H - PAD.bottom - 6} fontSize="9" fill="#C62828" opacity="0.6" textAnchor="end">{t("compare.expUnfair")}</text>

          {/* Axes */}
          <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom}
            stroke="#CBD5E1" strokeWidth="1" />
          <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom}
            stroke="#CBD5E1" strokeWidth="1" />

          {/* X axis label */}
          <text x={(PAD.left + W - PAD.right) / 2} y={H - 6}
            textAnchor="middle" fontSize="10" fill="#64748B">{t("compare.priceAxis")}</text>
          {/* Y axis label */}
          <text x={14} y={(PAD.top + H - PAD.bottom) / 2}
            textAnchor="middle" fontSize="10" fill="#64748B"
            transform={`rotate(-90, 14, ${(PAD.top + H - PAD.bottom) / 2})`}>
            {t("compare.fairnessAxis")}
          </text>

          {/* Grid lines */}
          {[25, 50, 75].map((v) => (
            <g key={`grid-${v}`}>
              <line x1={PAD.left} y1={scaleY(v)} x2={W - PAD.right} y2={scaleY(v)}
                stroke="#E2E8F0" strokeWidth="0.5" strokeDasharray="3 3" />
              <text x={PAD.left - 6} y={scaleY(v) + 3}
                textAnchor="end" fontSize="9" fill="#94A3B8">{v}</text>
            </g>
          ))}

          {/* Data points */}
          {points.map((p) => {
            const cx = scaleX(p.avg);
            const cy = scaleY(p.fairness);
            const isHov = hovered === p.code;
            return (
              <g key={p.code}
                onMouseEnter={() => setHovered(p.code)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}>
                <circle cx={cx} cy={cy}
                  r={p.isBest ? 14 : isHov ? 11 : 8}
                  fill={p.isBest ? "#0062E3" : "#64748B"}
                  stroke="white" strokeWidth="2"
                  opacity={hovered && !isHov ? 0.35 : 0.85}
                  style={{ transition: "all 0.2s" }}
                />
                <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central"
                  fill="white" fontSize={p.isBest ? 8 : 7} fontWeight="700"
                  style={{ pointerEvents: "none" }}>
                  {p.code}
                </text>
                {(p.isBest || isHov) && (
                  <text x={cx} y={cy - (p.isBest ? 20 : 16)}
                    textAnchor="middle" fill="#111827" fontSize="10" fontWeight="700"
                    style={{ pointerEvents: "none" }}>
                    {p.city} · {formatEur(p.avg, 0)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
