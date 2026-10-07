// ─── Proyección y geografía compartidas por los mapas ────────────────────────
// La usan la carta de rutas de resultados (DestinationMap) y el mapa de la
// portada (HeroMap). Importa europeGeo (geodatos Natural Earth, pesado): solo
// debe entrar por componentes cargados con React.lazy.
import { COUNTRIES } from "./europeGeo";

// ── Mercator projection for Europe ──────────────────────────────────────────
export const MAP_BOUNDS = { lonMin: -14, lonMax: 36, latMin: 30, latMax: 62 };
export const SVG_W = 700;
export const SVG_H = 500;

const MERC_MIN = Math.log(Math.tan(Math.PI / 4 + (MAP_BOUNDS.latMin * Math.PI) / 360));
const MERC_MAX = Math.log(Math.tan(Math.PI / 4 + (MAP_BOUNDS.latMax * Math.PI) / 360));

export function project(lon, lat) {
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
export const COUNTRY_PATHS = COUNTRIES.map((c) => ({
  iso: c.iso,
  alt: (c.iso.charCodeAt(0) + c.iso.charCodeAt(c.iso.length - 1)) % 2 === 1,
  d: c.rings.map(toPath).join(" "),
}));

// Quadratic Bézier arc between two points, bowed upwards (great-circle feel).
export function flightArc([x1, y1], [x2, y2]) {
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

// Punto medio del arco anterior (t = .5): ahí se anclan las fichas de ruta.
export function flightArcMid([x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const lift = Math.min(60, dist * 0.2);
  let px = -dy / dist;
  let py = dx / dist;
  if (py > 0) { px = -px; py = -py; }
  return [(x1 + x2) / 2 + px * lift * 0.5, (y1 + y2) / 2 + py * lift * 0.5];
}

// Avión de 14px apuntando a +x (animateMotion rotate="auto" lo orienta)
export const PLANE_D = "M7 0 L-3 -5.5 L-1.5 -1.2 L-6 -1.2 L-7.5 -3.5 L-8.5 -3.5 L-7.4 0 L-8.5 3.5 L-7.5 3.5 L-6 1.2 L-1.5 1.2 L-3 5.5 Z";

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Coloca cada ficha arriba/abajo/derecha/izquierda de su punto, la primera
// posición que no pisa otra ficha ni otro punto (voraz, por prioridad).
export function placeLabels(items, dots, vb, u) {
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
