#!/usr/bin/env node
/**
 * build-map-geo.mjs — genera frontend/src/components/europeGeo.js
 *
 * Script PUNTUAL (no forma parte del build ni del runtime). Descarga las
 * fronteras de países de Natural Earth (dominio público) desde el repo
 * nvkelso/natural-earth-vector, recorta al bbox del mapa de FlyndMe
 * (lon -14..36, lat 30..62, con sangrado para que la costa llegue al borde
 * del canvas), simplifica (Douglas-Peucker), cuantiza a centigrados y
 * delta-codifica para que el módulo resultante quede pequeño (~100 KB).
 *
 * Uso:   node frontend/scripts/build-map-geo.mjs [tolerancia]
 *        tolerancia = grados de simplificación (defecto 0.01; por debajo no
 *        se gana nada porque la cuantización a centigrados es el límite)
 *
 * Sin dependencias: Node >= 18 (fetch global). La descarga se cachea en el
 * directorio temporal del sistema para no repetirla en cada ejecución.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
const CACHE_FILE = join(tmpdir(), "ne_50m_admin_0_countries.geojson");

// Bbox de recorte: el mapa renderiza lon -14..36 / lat 30..62; recortamos un
// poco más allá para que la tierra "sangre" hasta el borde del SVG en vez de
// cortarse justo en la línea visible.
const CLIP = { minX: -15.5, minY: 28.2, maxX: 37.5, maxY: 63.8 };
const TOLERANCE = Number(process.argv[2]) || 0.01; // grados
const MIN_RING_BBOX_AREA = 0.012; // deg² — descarta islotes invisibles (Malta ≈ 0.11, se conserva)
const Q = 100; // cuantización: centigrados

const OUT_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "components",
  "europeGeo.js"
);

// ── Recorte Sutherland–Hodgman contra el bbox ────────────────────────────────
function lerpX(a, b, x) {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}
function lerpY(a, b, y) {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}
function clipRing(ring) {
  const clippers = [
    { inside: (p) => p[0] >= CLIP.minX, isect: (a, b) => lerpX(a, b, CLIP.minX) },
    { inside: (p) => p[0] <= CLIP.maxX, isect: (a, b) => lerpX(a, b, CLIP.maxX) },
    { inside: (p) => p[1] >= CLIP.minY, isect: (a, b) => lerpY(a, b, CLIP.minY) },
    { inside: (p) => p[1] <= CLIP.maxY, isect: (a, b) => lerpY(a, b, CLIP.maxY) },
  ];
  let out = ring;
  for (const { inside, isect } of clippers) {
    const input = out;
    out = [];
    if (input.length === 0) return out;
    let prev = input[input.length - 1];
    for (const cur of input) {
      if (inside(cur)) {
        if (!inside(prev)) out.push(isect(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(isect(prev, cur));
      }
      prev = cur;
    }
  }
  return out;
}

// ── Simplificación Douglas–Peucker (iterativa) ──────────────────────────────
function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    let maxD = -1;
    let idx = -1;
    const [ax, ay] = pts[s];
    const [bx, by] = pts[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      let d;
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function ringBBoxArea(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return (maxX - minX) * (maxY - minY);
}

// Cuantiza a centigrados, elimina duplicados consecutivos y el punto de cierre
// (el path SVG cierra con Z). Devuelve null si queda degenerado.
function quantizeRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const qx = Math.round(x * Q);
    const qy = Math.round(y * Q);
    const last = out[out.length - 1];
    if (last && last[0] === qx && last[1] === qy) continue;
    out.push([qx, qy]);
  }
  if (out.length > 1) {
    const [fx, fy] = out[0];
    const [lx, ly] = out[out.length - 1];
    if (fx === lx && fy === ly) out.pop();
  }
  return out.length >= 3 ? out : null;
}

// Delta-codificación: [x0, y0, dx1, dy1, ...] en centigrados enteros.
function deltaEncode(ring) {
  const flat = [];
  let px = 0, py = 0;
  for (const [x, y] of ring) {
    flat.push(x - px, y - py);
    px = x;
    py = y;
  }
  return flat;
}

async function main() {
  let raw;
  if (existsSync(CACHE_FILE)) {
    console.log(`Usando caché: ${CACHE_FILE}`);
    raw = readFileSync(CACHE_FILE, "utf8");
  } else {
    console.log(`Descargando ${SOURCE_URL} ...`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} descargando Natural Earth`);
    raw = await res.text();
    writeFileSync(CACHE_FILE, raw);
    console.log(`Cacheado en ${CACHE_FILE} (${(raw.length / 1e6).toFixed(1)} MB)`);
  }

  const geo = JSON.parse(raw);
  const countries = [];
  let totalPoints = 0;

  for (const f of geo.features) {
    const p = f.properties || {};
    let iso = p.ISO_A2_EH || p.ISO_A2 || "";
    if (!iso || iso === "-99") iso = p.ADM0_A3 || "??";
    const name = p.NAME_EN || p.NAME || p.ADMIN || iso;

    const polys =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates
          : [];

    const rings = [];
    for (const poly of polys) {
      const outer = poly[0]; // solo anillo exterior; los huecos (enclaves) son invisibles a esta escala
      if (!outer || outer.length < 4) continue;
      // Descarte rápido si el anillo no toca el bbox
      let touches = false;
      for (const [x, y] of outer) {
        if (x >= CLIP.minX && x <= CLIP.maxX && y >= CLIP.minY && y <= CLIP.maxY) {
          touches = true;
          break;
        }
      }
      if (!touches) continue;
      const clipped = clipRing(outer);
      if (clipped.length < 3) continue;
      const simplified = simplify(clipped, TOLERANCE);
      if (ringBBoxArea(simplified) < MIN_RING_BBOX_AREA) continue;
      const quantized = quantizeRing(simplified);
      if (!quantized) continue;
      rings.push(deltaEncode(quantized));
      totalPoints += quantized.length;
    }
    if (rings.length) countries.push([iso, name, rings]);
  }

  countries.sort((a, b) => a[0].localeCompare(b[0]));

  const dataLines = countries
    .map(([iso, name, rings]) => `  [${JSON.stringify(iso)},${JSON.stringify(name)},${JSON.stringify(rings)}]`)
    .join(",\n");

  const header = `// AUTO-GENERADO por frontend/scripts/build-map-geo.mjs — NO editar a mano.
// Fuente: Natural Earth ne_50m_admin_0_countries (dominio público),
// recortado a lon ${CLIP.minX}..${CLIP.maxX} / lat ${CLIP.minY}..${CLIP.maxY},
// simplificado (Douglas-Peucker ${TOLERANCE}°) y cuantizado a centigrados con
// delta-codificación. Para regenerar: node frontend/scripts/build-map-geo.mjs
//
// Formato: [iso, nombre, anillos]; cada anillo es [x0, y0, dx1, dy1, ...]
// en centigrados (lon/lat * ${Q}).
`;

  const body = `const Q = ${Q};

const DATA = [
${dataLines}
];

/**
 * Países con sus anillos decodificados a [lon, lat] en grados.
 * @type {{ iso: string, name: string, rings: [number, number][][] }[]}
 */
export const COUNTRIES = DATA.map(([iso, name, rings]) => ({
  iso,
  name,
  rings: rings.map((flat) => {
    const pts = new Array(flat.length / 2);
    let x = 0;
    let y = 0;
    for (let k = 0; k < flat.length; k += 2) {
      x += flat[k];
      y += flat[k + 1];
      pts[k / 2] = [x / Q, y / Q];
    }
    return pts;
  }),
}));
`;

  const out = header + "\n" + body;
  writeFileSync(OUT_FILE, out);
  console.log(
    `OK → ${OUT_FILE}\n` +
      `   ${countries.length} países, ${totalPoints} puntos, ` +
      `${(out.length / 1024).toFixed(1)} KB (tolerancia ${TOLERANCE}°)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
