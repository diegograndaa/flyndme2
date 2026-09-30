// ─── DestinationMap ─────────────────────────────────────────────────────────
// Carta de rutas (sep-2026, identidad «terminal de aeropuerto»): geografía real
// (Natural Earth), encuadre automático a los puntos del resultado, fichas de
// precio legibles (código + €/pp) colocadas sin solaparse, el punto de
// encuentro como cartel amarillo con pulso de radar, rutas del grupo con un
// avión en bucle y, al pasar por otro destino, sus rutas en vista previa.
// Pulsar un destino lo pone en la tarjeta de embarque (onSelect).
// Datos 100% reales: precios tal cual del backend, nada se inventa.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { normalizeCode, cityOf, formatEur } from "../utils/helpers";
import { convertPrice } from "../utils/resultsLogic";
import { COUNTRIES } from "./europeGeo";
import { CITY_COORDS } from "../utils/geo";

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
  const lift = Math.min(60, dist * 0.2);
  // Perpendicular to the chord, always bowing towards the top of the map
  let px = -dy / dist;
  let py = dx / dist;
  if (py > 0) { px = -px; py = -py; }
  const cx = (x1 + x2) / 2 + px * lift;
  const cy = (y1 + y2) / 2 + py * lift;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

// Avión de 14px apuntando a +x (animateMotion rotate="auto" lo orienta)
const PLANE_D = "M7 0 L-3 -5.5 L-1.5 -1.2 L-6 -1.2 L-7.5 -3.5 L-8.5 -3.5 L-7.4 0 L-8.5 3.5 L-7.5 3.5 L-6 1.2 L-1.5 1.2 L-3 5.5 Z";

// Encuadre: caja de los puntos + margen, con la proporción del contenedor y
// un zoom máximo (para que dos ciudades vecinas no llenen la pantalla).
function fitView(points, aspect) {
  if (!points.length) return { x: 0, y: 0, w: SVG_W, h: SVG_H };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = Math.max(56, 0.16 * Math.max(maxX - minX, maxY - minY));
  minX -= pad; maxX += pad; minY -= pad * 1.15; maxY += pad * 0.85;
  let w = Math.max(maxX - minX, 260);
  let h = Math.max(maxY - minY, 260 / aspect);
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  // No mostrar más que el mapa entero en ninguna dimensión
  if (w > SVG_W) { w = SVG_W; h = w / aspect; }
  if (h > SVG_H) { h = SVG_H; w = Math.min(SVG_W, h * aspect); }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const x = Math.min(SVG_W - w, Math.max(0, cx - w / 2));
  const y = Math.min(SVG_H - h, Math.max(0, cy - h / 2));
  return { x, y, w, h };
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Coloca cada ficha arriba/abajo/derecha/izquierda de su punto, la primera
// posición que no pisa otra ficha ni otro punto (voraz, por prioridad).
function placeLabels(items, dots, vb, u) {
  const placed = [];
  const gap = 9 * u;
  const out = {};
  for (const it of items) {
    const { w, h } = it;
    const [x, y] = it.pos;
    const cands = [
      { x: x - w / 2, y: y - gap - h, side: "top" },
      { x: x - w / 2, y: y + gap, side: "bottom" },
      { x: x + gap, y: y - h / 2, side: "right" },
      { x: x - gap - w, y: y - h / 2, side: "left" },
    ];
    let best = null;
    let bestScore = Infinity;
    for (const c of cands) {
      const r = { x: c.x, y: c.y, w, h };
      let score = 0;
      for (const p of placed) if (overlaps(r, p)) score += 10;
      for (const d of dots) {
        if (d.code === it.code) continue;
        const dr = { x: d.pos[0] - 6 * u, y: d.pos[1] - 6 * u, w: 12 * u, h: 12 * u };
        if (overlaps(r, dr)) score += 4;
      }
      if (r.x < vb.x || r.y < vb.y || r.x + w > vb.x + vb.w || r.y + h > vb.y + vb.h) score += 6;
      if (score < bestScore) { bestScore = score; best = { ...c, w, h }; }
      if (score === 0) break;
    }
    placed.push(best);
    out[it.code] = best;
  }
  return out;
}

const GRAT_STEP = 5;

// Mismos umbrales que el panel de salidas / tarjeta
function fairnessKey(score) {
  if (score >= 85) return "veryBalanced";
  if (score >= 65) return "fairlyBalanced";
  if (score >= 45) return "somewhatUnequal";
  return "unequal";
}

export default function DestinationMap({ flights, bestDestination, origins, currency = "EUR", onSelect, onShowCard }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(null);
  const wrapRef = useRef(null);
  // Ancho real del contenedor → los marcadores miden lo mismo en pantalla
  // con cualquier zoom (SSR: 700 px).
  const [widthPx, setWidthPx] = useState(700);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w > 0) setWidthPx(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const money = (v) => (currency === "EUR" ? formatEur(v, 0) : convertPrice(v, currency));
  const bestCode = normalizeCode(bestDestination?.destination || "");
  const singleOrigin = (origins || []).filter(Boolean).length <= 1;
  const compact = widthPx < 480;
  const aspect = compact ? 1.05 : 1.45;

  const originPoints = useMemo(() => (origins || []).filter(Boolean).map((o) => {
    const code = normalizeCode(o);
    const coords = CITY_COORDS[code];
    if (!coords) return null;
    return { code, city: cityOf(code), ...clampPos(project(coords[0], coords[1])) };
  }).filter(Boolean), [origins]);

  const destPoints = useMemo(() => (flights || []).map((f) => {
    const code = normalizeCode(f.destination);
    const coords = CITY_COORDS[code];
    if (!coords) return null;
    return {
      code, flight: f, city: cityOf(code), avg: f.averageCostPerTraveler, total: f.totalCostEUR,
      fairness: f.fairnessScore ?? 0, isBest: code === bestCode,
      ...clampPos(project(coords[0], coords[1])),
    };
  }).filter(Boolean), [flights, bestCode]);

  const vb = useMemo(
    () => fitView([...originPoints, ...destPoints].map((p) => p.pos), aspect),
    [originPoints, destPoints, aspect],
  );
  const u = vb.w / Math.max(widthPx, 1); // unidades SVG por píxel de pantalla

  // Rampa de precio (verde → ámbar → rojo) normalizada al resultado
  const prices = destPoints.map((d) => d.avg).filter(Boolean);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  function priceTone(avg) {
    const r = (avg - minPrice) / (maxPrice - minPrice || 1);
    return r < 0.34 ? "cheap" : r < 0.67 ? "mid" : "expensive";
  }

  // Fichas: medidas en px de pantalla × u (fuente mono ≈ 0,62 em por carácter)
  const chipFor = (d) => {
    const label = compact ? money(d.avg) : `${d.code}  ${money(d.avg)}`;
    const fs = d.isBest ? 12.5 : 11;
    const w = (label.length * fs * 0.62 + (d.isBest ? 20 : 17)) * u;
    const h = (d.isBest ? 24 : 20) * u;
    return { code: d.code, pos: d.pos, label, fs, w, h };
  };
  const originChip = (o) => ({ code: `o-${o.code}`, pos: o.pos, label: o.code, fs: 10.5, w: (o.code.length * 10.5 * 0.62 + 12) * u, h: 18 * u });

  const bestPoint = destPoints.find((d) => d.isBest) || null;
  const chips = [
    ...(bestPoint ? [chipFor(bestPoint)] : []),
    ...originPoints.map(originChip),
    ...destPoints.filter((d) => !d.isBest).sort((a, b) => a.avg - b.avg).map(chipFor),
  ];
  const allDots = [
    ...destPoints.map((d) => ({ code: d.code, pos: d.pos })),
    ...originPoints.map((o) => ({ code: `o-${o.code}`, pos: o.pos })),
  ];
  const labelPos = placeLabels(chips, allDots, vb, u);
  const chipByCode = Object.fromEntries(chips.map((c) => [c.code, c]));

  const hoveredPoint = hovered ? destPoints.find((d) => d.code === hovered) : null;
  const previewPoint = hoveredPoint && !hoveredPoint.isBest ? hoveredPoint : null;

  // Retícula (meridianos/paralelos cada 5°) dentro del encuadre, con rótulos
  const grat = useMemo(() => {
    const lons = [], lats = [];
    for (let lon = -15; lon <= 40; lon += GRAT_STEP) {
      const [x] = project(lon, 45);
      if (x > vb.x && x < vb.x + vb.w) lons.push({ lon, x });
    }
    for (let lat = 30; lat <= 65; lat += GRAT_STEP) {
      const [, y] = project(0, lat);
      if (y > vb.y && y < vb.y + vb.h) lats.push({ lat, y });
    }
    return { lons, lats };
  }, [vb]);

  const select = (d) => { if (!d.isBest && onSelect) onSelect(d.flight); };

  // Tooltip HTML sobre el SVG (posición en % del encuadre)
  const tip = hoveredPoint ? {
    left: ((hoveredPoint.pos[0] - vb.x) / vb.w) * 100,
    top: ((hoveredPoint.pos[1] - vb.y) / vb.h) * 100,
  } : null;

  const nf = (v) => v.toFixed(1);

  return (
    <div className="dm-wrap">
      <div className="dm-header">
        <div>
          <h3 className="dm-title">{t("map.title")}</h3>
          {onSelect && destPoints.length > 1 && <p className="dm-sub">{t("map.subtitle")}</p>}
        </div>
        <div className="dm-legend" aria-hidden="true">
          <span className="dm-legend-item"><span className="dm-key dm-key--best" /> {t("map.meetPoint")}</span>
          <span className="dm-legend-item"><span className="dm-key dm-key--dest"><i className="dm-tone--cheap" /></span> {t("map.cheap")}</span>
          <span className="dm-legend-item"><span className="dm-key dm-key--dest"><i className="dm-tone--mid" /></span> {t("map.mid")}</span>
          <span className="dm-legend-item"><span className="dm-key dm-key--dest"><i className="dm-tone--expensive" /></span> {t("map.expensive")}</span>
          <span className="dm-legend-item"><span className="dm-key dm-key--origin" /> {t("map.origin")}</span>
        </div>
      </div>

      {bestPoint && (
        <div className="dm-current">
          <span className="dm-current-label">{t("board.selected")}</span>
          <span className="dm-current-dest">{bestPoint.code} · {bestPoint.city || bestPoint.code}</span>
          <span className="dm-current-price">{money(bestPoint.avg)}<small>/pp</small></span>
          {onShowCard && (
            <button type="button" className="dm-current-btn" onClick={onShowCard}>{t("map.showCard")} ↑</button>
          )}
        </div>
      )}

      <div className="dm-container" ref={wrapRef}>
        <svg viewBox={`${nf(vb.x)} ${nf(vb.y)} ${nf(vb.w)} ${nf(vb.h)}`} className="dm-svg"
          role="group" aria-label={t("map.ariaLabel")}>
          {/* Mar */}
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} className="dm-sea" />

          {/* Retícula bajo la tierra */}
          <g className="dm-graticule">
            {grat.lons.map((g) => <line key={`glon${g.lon}`} x1={g.x} y1={vb.y} x2={g.x} y2={vb.y + vb.h} vectorEffect="non-scaling-stroke" />)}
            {grat.lats.map((g) => <line key={`glat${g.lat}`} x1={vb.x} y1={g.y} x2={vb.x + vb.w} y2={g.y} vectorEffect="non-scaling-stroke" />)}
          </g>

          {/* Tierra con fronteras reales (Natural Earth) */}
          <g>
            {COUNTRY_PATHS.map((c, i) => (
              <path key={`${c.iso}${i}`} d={c.d} vectorEffect="non-scaling-stroke"
                className={c.alt ? "dm-land dm-land--alt" : "dm-land"} />
            ))}
          </g>

          {/* Rótulos de la retícula (grados), como en una carta */}
          <g className="dm-grat-labels" aria-hidden="true">
            {grat.lons.map((g) => (
              <text key={`llon${g.lon}`} x={g.x + 3 * u} y={vb.y + vb.h - 5 * u} fontSize={8.5 * u}>
                {Math.abs(g.lon)}°{g.lon < 0 ? "W" : "E"}
              </text>
            ))}
            {grat.lats.map((g) => (
              <text key={`llat${g.lat}`} x={vb.x + 4 * u} y={g.y - 3 * u} fontSize={8.5 * u}>{g.lat}°N</text>
            ))}
          </g>

          {/* Rosa de los vientos (estática) */}
          <g className="dm-compass" aria-hidden="true"
            transform={`translate(${nf(vb.x + vb.w - 26 * u)} ${nf(vb.y + 30 * u)}) scale(${u.toFixed(3)})`}>
            <circle r="13" />
            <path d="M0 -12 L3.2 0 L0 12 L-3.2 0 Z" className="dm-compass-needle" />
            <path d="M0 -12 L3.2 0 L-3.2 0 Z" className="dm-compass-north" />
            <text y="-16" textAnchor="middle" fontSize="8">N</text>
          </g>

          {/* Vista previa: rutas del grupo hacia el destino que señalas */}
          {previewPoint && originPoints.map((o) => (
            <path key={`pv-${o.code}`} d={flightArc(o.pos, previewPoint.pos)} className="dm-route dm-route--preview" vectorEffect="non-scaling-stroke" />
          ))}

          {/* Rutas del grupo hacia el punto de encuentro + avión en bucle */}
          {bestPoint && originPoints.map((o, i) => {
            const id = `dm-route-${o.code}`;
            return (
              <g key={id}>
                <path id={id} d={flightArc(o.pos, bestPoint.pos)} className="dm-route" vectorEffect="non-scaling-stroke" />
                <g className="dm-plane" opacity="0">
                  <path d={PLANE_D} transform={`scale(${(u * 1.05).toFixed(3)})`} />
                  <animateMotion dur="3.4s" begin={`${(i * 0.9).toFixed(1)}s`} repeatCount="indefinite" rotate="auto"
                    keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1">
                    <mpath href={`#${id}`} />
                  </animateMotion>
                  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1"
                    dur="3.4s" begin={`${(i * 0.9).toFixed(1)}s`} repeatCount="indefinite" />
                </g>
              </g>
            );
          })}

          {/* Puntos de origen */}
          {originPoints.map((o) => (
            <circle key={`od-${o.code}`} cx={o.pos[0]} cy={o.pos[1]} r={5 * u} strokeWidth={2 * u} className="dm-origin-dot" />
          ))}

          {/* Destinos: punto + ficha (código · €/pp), pulsables */}
          {destPoints.map((d) => {
            const c = chipByCode[d.code];
            const L = labelPos[d.code];
            const tone = priceTone(d.avg);
            const isHov = hovered === d.code;
            const dim = hovered && !isHov && !d.isBest;
            return (
              <g key={d.code}
                className={`dm-dest${d.isBest ? " dm-dest--best" : ""}${isHov ? " dm-dest--hover" : ""}${dim ? " dm-dest--dim" : ""}`}
                role="button" tabIndex={0}
                aria-current={d.isBest ? "true" : undefined}
                aria-label={t(d.isBest ? "map.bestAria" : "map.selectAria", { city: d.city || d.code, price: money(d.avg) })}
                onMouseEnter={() => setHovered(d.code)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(d.code)}
                onBlur={() => setHovered(null)}
                onClick={() => select(d)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(d); } }}>
                {d.isBest && (
                  <>
                    <circle cx={d.pos[0]} cy={d.pos[1]} r={7 * u} className="dm-ping" />
                    <circle cx={d.pos[0]} cy={d.pos[1]} r={7 * u} className="dm-ping dm-ping--late" />
                  </>
                )}
                {d.offMap && (
                  <path d="M0,-3.4 L5.4,0 L0,3.4 Z" className="dm-offmap-arrow"
                    transform={`translate(${nf(d.pos[0] + Math.cos((d.offAngle * Math.PI) / 180) * 11 * u)},${nf(d.pos[1] + Math.sin((d.offAngle * Math.PI) / 180) * 11 * u)}) rotate(${d.offAngle.toFixed(1)}) scale(${u.toFixed(3)})`} />
                )}
                <circle cx={d.pos[0]} cy={d.pos[1]} r={(d.isBest ? 6 : 4) * u} strokeWidth={1.6 * u}
                  className={`dm-dot dm-dot--${d.isBest ? "best" : tone}`} />
                {c && L && (
                  <g className="dm-chip">
                    <rect x={L.x} y={L.y} width={L.w} height={L.h} rx={3 * u} strokeWidth={u} className="dm-chip-bg" />
                    {!d.isBest && <rect x={L.x} y={L.y} width={3.5 * u} height={L.h} className={`dm-chip-tone dm-tone--${tone}`} />}
                    <text x={L.x + L.w / 2 + (d.isBest ? 0 : 1.5 * u)} y={L.y + L.h / 2} textAnchor="middle" dominantBaseline="central"
                      fontSize={c.fs * u} className="dm-chip-text">
                      {c.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Fichas de origen (código IATA) */}
          {originPoints.map((o) => {
            const c = chipByCode[`o-${o.code}`];
            const L = labelPos[`o-${o.code}`];
            if (!c || !L) return null;
            return (
              <g key={`oc-${o.code}`} className="dm-origin-chip" aria-hidden="true">
                <rect x={L.x} y={L.y} width={L.w} height={L.h} rx={2 * u} strokeWidth={1.2 * u} />
                <text x={L.x + L.w / 2} y={L.y + L.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={c.fs * u}>{c.label}</text>
              </g>
            );
          })}
        </svg>

        {/* Ficha informativa del destino señalado */}
        {hoveredPoint && tip && (
          <div className={`dm-tooltip${tip.top < 30 ? " dm-tooltip--below" : ""}`}
            style={{ left: `${Math.min(88, Math.max(12, tip.left))}%`, top: `${tip.top}%` }} aria-hidden="true">
            <div className="dm-tooltip-city">{hoveredPoint.city || hoveredPoint.code} <span>{hoveredPoint.code}</span></div>
            <div className="dm-tooltip-price">{money(hoveredPoint.avg)} <small>{t("compare.perPerson")}</small></div>
            <div className="dm-tooltip-row">{t("map.groupTotal")}: {money(hoveredPoint.total)}</div>
            {!singleOrigin && <div className="dm-tooltip-row">{t(`fairness.${fairnessKey(hoveredPoint.fairness)}`)}</div>}
            <div className="dm-tooltip-hint">{hoveredPoint.isBest ? t("board.selected") : t("map.tapHint")}</div>
          </div>
        )}
      </div>
      <p className="dm-note">{t("board.estimateNote")}</p>
    </div>
  );
}
