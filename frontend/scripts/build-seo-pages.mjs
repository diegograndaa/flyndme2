#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// build-seo-pages.mjs — generador de páginas SEO estáticas (SSG) por par de
// ciudades / caso de uso. Enfoque elegido por Diego: GENERAR EN LOCAL Y
// COMMITEAR (no build-time, no cron). Lee el contenido MANUAL de seo-seed.json
// (prosa/títulos/FAQ ya escritos a mano — NO se autogenera prosa) y produce un
// HTML estático ligero y on-brand por (página, idioma) en frontend/public{path}.
//
// PRECIOS (regla dura #1): los números salen del backend real (/multi-origin),
// se etiquetan SIEMPRE como "estimación en caché" y NUNCA se inventan. Si el
// backend no da datos para un par → página SIN tabla y con el lead recortado a
// texto neutro (jamás cifras/destinos fabricados).
//
// Uso:  cd frontend && npm run seo:build
// Env:  SEO_API_BASE (default https://flyndme-backend.onrender.com)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = join(__dirname, "..");
const PUBLIC_DIR = join(FRONTEND_DIR, "public");

const seed = JSON.parse(readFileSync(join(__dirname, "seo-seed.json"), "utf8"));
const SITE = String(seed.site || "https://flyndme2.vercel.app").replace(/\/+$/, "");
const API = String(process.env.SEO_API_BASE || "https://flyndme-backend.onrender.com").replace(/\/+$/, "");

// ─── Nombres de ciudad (IATA → display), localizados ────────────────────────
// EN se alinea con src/utils/helpers.js (AIRPORTS). ES con exónimos comunes
// para que las páginas en español no digan "Lisbon" o "London".
const CITY_EN = {
  MAD: "Madrid", BCN: "Barcelona", LON: "London", BER: "Berlin", LIS: "Lisbon",
  PAR: "Paris", ROM: "Rome", AMS: "Amsterdam", MIL: "Milan", DUB: "Dublin",
  VIE: "Vienna", PRG: "Prague", ATH: "Athens", BUD: "Budapest", OPO: "Porto",
  CPH: "Copenhagen", IST: "Istanbul", AGP: "Malaga", PMI: "Palma de Mallorca",
  NCE: "Nice", DBV: "Dubrovnik", MLA: "Malta", NAP: "Naples", ZRH: "Zurich",
  VLC: "Valencia", SVQ: "Seville",
};
const CITY_ES = {
  MAD: "Madrid", BCN: "Barcelona", LON: "Londres", BER: "Berlín", LIS: "Lisboa",
  PAR: "París", ROM: "Roma", AMS: "Ámsterdam", MIL: "Milán", DUB: "Dublín",
  VIE: "Viena", PRG: "Praga", ATH: "Atenas", BUD: "Budapest", OPO: "Oporto",
  CPH: "Copenhague", IST: "Estambul", AGP: "Málaga", PMI: "Palma de Mallorca",
  NCE: "Niza", DBV: "Dubrovnik", MLA: "Malta", NAP: "Nápoles", ZRH: "Zúrich",
  VLC: "Valencia", SVQ: "Sevilla",
};
function cityName(code, lang) {
  const c = String(code || "").toUpperCase();
  return (lang === "es" ? CITY_ES[c] : CITY_EN[c]) || CITY_EN[c] || c;
}

// ─── UI strings de la plantilla (lo que NO está en el seed) ──────────────────
const UI = {
  es: {
    htmlLang: "es", ogLocale: "es_ES",
    home: "Inicio", homeAria: "FlyndMe — inicio", brandTag: "vuelos de grupo",
    eyebrowPair: "Coste total + reparto justo", eyebrowUsecase: "Guía",
    cachedLabel: (m) => `Estimación en caché · precios consultados ${m}`,
    travelLabel: (d) => `Precios para viajar alrededor del ${d}`,
    liveLink: "Comprueba el precio en vivo",
    tableCaption: "Destinos más baratos para el grupo, estimados a partir de búsquedas en caché",
    colDest: "Destino", colTotal: "Coste total del grupo", colPp: "Por persona",
    bestPill: "Mejor opción",
    whoTitle: "Quién paga qué",
    whoSub: (city) => `Lo que pagaría cada uno volando a ${city}`,
    avgLabel: (pp) => `Media: ${pp} por persona`,
    ctaPair: "Buscad vuestro destino",
    ctaUsecase: "Probadlo con vuestras ciudades",
    ctaNote: "Sin registro. Metéis las ciudades y sale el destino.",
    faqTitle: "Preguntas frecuentes",
    relatedTitle: "Seguir comparando",
    backHome: "Volver al inicio",
    footer: "FlyndMe compara vuelos desde varias ciudades para encontrar dónde sale más barato y justo quedar. Precios orientativos de búsquedas en caché; comprueba el precio en vivo antes de reservar.",
    pax: (n) => `${n} viajeros`,
  },
  en: {
    htmlLang: "en", ogLocale: "en_US",
    home: "Home", homeAria: "FlyndMe — home", brandTag: "group flights",
    eyebrowPair: "Total cost + fair split", eyebrowUsecase: "Guide",
    cachedLabel: (m) => `Cached estimate · prices checked ${m}`,
    travelLabel: (d) => `Prices for travel around ${d}`,
    liveLink: "Check the live price",
    tableCaption: "Cheapest destinations for the group, estimated from cached searches",
    colDest: "Destination", colTotal: "Group total", colPp: "Per person",
    bestPill: "Best option",
    whoTitle: "Who pays what",
    whoSub: (city) => `What each person would pay flying to ${city}`,
    avgLabel: (pp) => `Average: ${pp} per person`,
    ctaPair: "Find your destination",
    ctaUsecase: "Try it with your cities",
    ctaNote: "No sign-up. Drop in the cities and the destination comes out.",
    faqTitle: "Frequently asked questions",
    relatedTitle: "Keep comparing",
    backHome: "Back home",
    footer: "FlyndMe compares flights from several cities to find where it's cheapest and fairest to meet. Prices are indicative cached estimates; check the live price before booking.",
    pax: (n) => `${n} travellers`,
  },
};

// ─── Fechas ──────────────────────────────────────────────────────────────────
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const NOW = new Date();
const GEN_DATE = isoOf(NOW);
const TRAVEL = new Date(NOW.getTime());
TRAVEL.setDate(TRAVEL.getDate() + 60);
const TRAVEL_DATE = isoOf(TRAVEL);
// Etiqueta de frescura = MES DE GENERACIÓN (cuándo se consultaron de verdad los
// precios). Decir el mes del viaje sería mentir sobre la frescura del dato.
const MONTH_LABEL = {
  es: `${MONTHS_ES[NOW.getMonth()]} de ${NOW.getFullYear()}`,
  en: `${MONTHS_EN[NOW.getMonth()]} ${NOW.getFullYear()}`,
};
// Ventana de viaje a la que corresponden los precios (la fecha que se envió al
// backend). Un precio sin fecha de viaje es falsa precisión; "alrededor del" por
// el fallback de fechas vecinas (±2 días) del proveedor.
const TRAVEL_LABEL = {
  es: `${TRAVEL.getDate()} de ${MONTHS_ES[TRAVEL.getMonth()]} de ${TRAVEL.getFullYear()}`,
  en: `${TRAVEL.getDate()} ${MONTHS_EN[TRAVEL.getMonth()]} ${TRAVEL.getFullYear()}`,
};

// ─── Formato € ───────────────────────────────────────────────────────────────
const eur = (n) => `€${Math.round(Number(n) || 0)}`;

// ─── Escapado HTML ───────────────────────────────────────────────────────────
function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// JSON-LD seguro dentro de <script> (evita cerrar el script con "</...").
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// ─── Red: despertar Render + buscar por par ──────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wakeBackend() {
  process.stdout.write(`Waking backend at ${API} `);
  for (let i = 1; i <= 8; i++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(`${API}/api/ping`, { signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) { process.stdout.write(" awake.\n"); return true; }
    } catch { /* dormido / cold start */ }
    clearTimeout(to);
    process.stdout.write(".");
    await sleep(5000);
  }
  process.stdout.write(" no response.\n");
  return false;
}

async function searchPair(page) {
  const body = {
    origins: page.origins,
    passengers: page.passengers,
    departureDate: TRAVEL_DATE,
    tripType: page.tripType || "oneway",
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 50000);
    try {
      const r = await fetch(`${API}/api/flights/multi-origin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const flights = Array.isArray(data.flights) ? data.flights : [];
      if (flights.length > 0) return flights;
      return []; // respuesta válida pero sin resultados → sin tabla (honesto)
    } catch (e) {
      clearTimeout(to);
      if (attempt === 3) {
        console.warn(`    ! ${page.slug}: search failed (${e.message})`);
        return null; // null = error de red (distinto de [] = sin resultados)
      }
      await sleep(2500 * attempt);
    }
  }
  return null;
}

// ─── Lead: inyectar precio real o recortar a neutro ──────────────────────────
function buildLead(rawLead, lang, winner) {
  if (winner) {
    return rawLead
      .replace(/\{dest\}/g, cityName(winner.destination, lang))
      .replace(/\{pp\}/g, eur(winner.averageCostPerTraveler));
  }
  // Sin datos: quitar la cláusula del destino/precio. El conector ("suele ser"
  // / "tends to be") precede al {dest}; cortamos desde ahí hasta el final.
  let neutral = rawLead.replace(/[\s,]*(?:suele ser|tends to be)\s+\{dest\}[\s\S]*$/, ".");
  // Salvaguarda: si quedara algún placeholder, eliminarlo.
  neutral = neutral.replace(/\s*\{dest\}|\s*\{pp\}/g, "").replace(/,\s*\./g, ".");
  return neutral.trim();
}

// ─── Convergencia (SVG estático, on-brand, sin animación) ────────────────────
// Lección documentada (22-jun): animar la entrada del SVG repinta mal de forma
// intermitente en Chromium → diagrama ESTÁTICO a propósito.
function convergenceSVG(count) {
  const n = Math.max(2, Math.min(4, count || 3));
  const dx = 168, dy = 70;
  const ys = n === 2 ? [42, 98] : n === 3 ? [30, 70, 110] : [26, 58, 90, 122];
  let paths = "", nodes = "";
  for (let i = 0; i < n; i++) {
    const oy = ys[i];
    paths += `<path class="cv-path" d="M40 ${oy} Q104 ${oy} ${dx} ${dy}"/>`;
    nodes += `<circle class="cv-o" cx="40" cy="${oy}" r="6"/>`;
  }
  return `<svg class="cv" viewBox="0 0 200 140" role="img" aria-hidden="true" focusable="false">`
    + paths
    + `<circle class="cv-ring" cx="${dx}" cy="${dy}" r="20"/>`
    + `<circle class="cv-d" cx="${dx}" cy="${dy}" r="11"/>`
    + `<circle class="cv-dot" cx="${dx}" cy="${dy}" r="3.5"/>`
    + nodes
    + `</svg>`;
}

// ─── Tabla de estimación + desglose "quién paga qué" ─────────────────────────
function payTone(price, avg) {
  if (price <= avg * 1.001) return "good";
  if (price <= avg * 1.2) return "warn";
  return "bad";
}

function estimateBlock(flights, lang, t, ctaUrl) {
  const top = flights.slice(0, 5);
  const winner = top[0];
  const winCity = cityName(winner.destination, lang);

  const rows = top.map((d, i) => {
    const isWin = i === 0;
    const city = cityName(d.destination, lang);
    const pill = isWin
      ? ` <span class="pill">${escHtml(t.bestPill)}</span>`
      : "";
    return `<tr${isWin ? ' class="win"' : ""}>`
      + `<th scope="row"><span class="dest-city">${escHtml(city)}</span>`
      + `<span class="dest-code">${escHtml(d.destination)}</span>${pill}</th>`
      + `<td class="num">${eur(d.totalCostEUR)}</td>`
      + `<td class="num">${eur(d.averageCostPerTraveler)}</td>`
      + `</tr>`;
  }).join("");

  // Desglose del ganador (el diferenciador): barra por origen con el precio
  // real por persona, coloreada por equidad relativa a la media.
  const legs = Array.isArray(winner.flights) ? winner.flights : [];
  const avg = Number(winner.averageCostPerTraveler) || 0;
  const maxPrice = Math.max(...legs.map((f) => Number(f.price) || 0), 1);
  const bars = legs.map((f) => {
    const price = Number(f.price) || 0;
    const w = Math.max(8, Math.round((price / maxPrice) * 100));
    const tone = payTone(price, avg);
    const city = cityName(f.origin, lang);
    const paxNote = (f.passengers && f.passengers > 1) ? ` <span class="leg-pax">×${f.passengers}</span>` : "";
    return `<div class="leg">`
      + `<div class="leg-city">${escHtml(city)}${paxNote}</div>`
      + `<div class="leg-bar"><span class="leg-fill ${tone}" style="width:${w}%"></span></div>`
      + `<div class="leg-price num">${eur(price)}</div>`
      + `</div>`;
  }).join("");

  return `<section class="est" aria-labelledby="est-h">
        <div class="est-head">
          <h2 id="est-h" class="est-title">${escHtml(t.cachedLabel(MONTH_LABEL[lang]))}</h2>
          <a class="est-live" href="${escAttr(ctaUrl)}">${escHtml(t.liveLink)} &rarr;</a>
        </div>
        <p class="est-sub">${escHtml(t.travelLabel(TRAVEL_LABEL[lang]))}</p>
        <table class="est-table">
          <caption class="sr-only">${escHtml(t.tableCaption)}</caption>
          <thead>
            <tr>
              <th scope="col">${escHtml(t.colDest)}</th>
              <th scope="col" class="num">${escHtml(t.colTotal)}</th>
              <th scope="col" class="num">${escHtml(t.colPp)}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="who">
          <h3 class="who-title">${escHtml(t.whoTitle)} · <span class="who-city">${escHtml(winCity)}</span></h3>
          <p class="who-sub">${escHtml(t.whoSub(winCity))}</p>
          <div class="legs">${bars}</div>
          <p class="who-avg">${escHtml(t.avgLabel(eur(avg)))}</p>
        </div>
      </section>`;
}

// ─── CSS de marca (inline, ligero) ───────────────────────────────────────────
const STYLE = `
:root{
  --maroon:#AE2F34; --coral:#FF6B6B; --bg:#FCF8FF; --panel:#EEECFF; --card:#FFFFFF;
  --ink:#16173B; --muted:#5B5C7A; --line:#E4DEF6;
  --good:#15803D; --warn:#B45309; --bad:#DC2626;
  --cta-bg:#AE2F34; --cta-fg:#FFFFFF; --pill-bg:#AE2F34; --pill-fg:#FFFFFF;
  --radius:16px; --shadow:0 2px 14px rgba(174,47,52,.08);
  --display:"Bricolage Grotesque",Georgia,serif;
  --body:"Plus Jakarta Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
}
@media (prefers-color-scheme: dark){
  :root{
    --maroon:#FFB3B0; --coral:#FF8E8C; --bg:#131434; --panel:#1B1C40; --card:#22234C;
    --ink:#ECEBFF; --muted:#A9AAD2; --line:#2C2D52;
    --good:#5BD08C; --warn:#E0A85B; --bad:#FF8A8A;
    --cta-bg:#FFB3B0; --cta-fg:#16173B; --pill-bg:#FFB3B0; --pill-fg:#16173B;
    --shadow:0 2px 16px rgba(0,0,0,.4);
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);
  line-height:1.65;font-size:17px;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
a{color:var(--maroon)}
.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0,0,0,0);white-space:nowrap;border:0}
:focus-visible{outline:2px solid var(--maroon);outline-offset:2px;border-radius:4px}

.site-head{display:flex;align-items:center;justify-content:space-between;padding:20px 0}
.brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink)}
.brand-mark{flex:0 0 auto}
.brand-name{font-family:var(--display);font-weight:800;font-size:1.32rem;letter-spacing:-.01em}
.brand-name b{color:var(--maroon)}
.brand-tag{font-size:.82rem;color:var(--muted)}

.hero{display:flex;gap:18px;align-items:center;padding:14px 0 6px;flex-wrap:wrap}
.hero-text{flex:1 1 320px;min-width:0}
.eyebrow{font-size:.74rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--maroon);margin:0 0 10px}
h1{font-family:var(--display);font-weight:700;font-size:2.15rem;line-height:1.12;
  letter-spacing:-.02em;margin:0 0 14px}
.lead{font-size:1.16rem;color:var(--ink);margin:0;max-width:60ch}
.cv{width:148px;height:104px;flex:0 0 auto;color:var(--maroon)}
.cv-path{fill:none;stroke:var(--maroon);stroke-width:1.6;opacity:.45}
.cv-o{fill:var(--card);stroke:var(--coral);stroke-width:2.4}
.cv-ring{fill:none;stroke:var(--maroon);stroke-width:2;opacity:.3}
.cv-d{fill:var(--maroon)}
.cv-dot{fill:var(--card)}

.est{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:18px 18px 6px;margin:26px 0}
.est-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
  flex-wrap:wrap;margin-bottom:10px}
.est-title{font-family:var(--body);font-size:.82rem;font-weight:700;letter-spacing:.02em;
  text-transform:uppercase;color:var(--muted);margin:0}
.est-sub{font-size:.85rem;color:var(--muted);font-weight:600;margin:4px 0 14px}
.est-live{font-size:.9rem;font-weight:700;text-decoration:none;white-space:nowrap}
.est-live:hover{text-decoration:underline}
.est-table{width:100%;border-collapse:collapse;font-size:1rem}
.est-table th[scope=col]{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;
  color:var(--muted);font-weight:700;text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
.est-table th[scope=col].num{text-align:right}
.est-table tbody th{font-weight:600;text-align:left;padding:11px 8px;vertical-align:top}
.est-table td{padding:11px 8px}
.est-table tbody tr{border-bottom:1px solid var(--line)}
.est-table tbody tr.win{background:var(--panel)}
.dest-city{display:block;font-weight:700}
.dest-code{font-size:.76rem;color:var(--muted);font-weight:600;letter-spacing:.06em}
.pill{display:inline-block;margin-left:6px;background:var(--pill-bg);color:var(--pill-fg);
  font-size:.66rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  padding:2px 7px;border-radius:999px;vertical-align:1px}

.who{margin:18px 0 2px;padding:16px 2px 8px;border-top:1px dashed var(--line)}
.who-title{font-family:var(--display);font-size:1.04rem;font-weight:700;margin:0}
.who-city{color:var(--maroon)}
.who-sub{font-size:.9rem;color:var(--muted);margin:3px 0 14px}
.legs{display:flex;flex-direction:column;gap:9px}
.leg{display:grid;grid-template-columns:96px 1fr auto;align-items:center;gap:10px}
.leg-city{font-size:.92rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.leg-pax{color:var(--muted);font-weight:600}
.leg-bar{height:12px;background:var(--panel);border-radius:999px;overflow:hidden}
.leg-fill{display:block;height:100%;border-radius:999px;background:var(--muted)}
.leg-fill.good{background:var(--good)}
.leg-fill.warn{background:var(--warn)}
.leg-fill.bad{background:var(--bad)}
.leg-price{font-size:.94rem;font-weight:700}
.who-avg{font-size:.86rem;color:var(--muted);margin:13px 0 0;text-align:right}

.cta-wrap{margin:30px 0;text-align:center}
.cta{display:inline-block;background:var(--cta-bg);color:var(--cta-fg);text-decoration:none;
  font-weight:700;font-size:1.06rem;padding:15px 34px;border-radius:999px;
  box-shadow:var(--shadow);transition:transform .12s ease}
.cta:hover{transform:translateY(-1px)}
.cta:active{transform:translateY(0)}
.cta-note{font-size:.86rem;color:var(--muted);margin:11px 0 0}

.prose{margin:30px 0}
.prose p{margin:0 0 18px}

.faq{margin:34px 0}
.faq h2,.related h2{font-family:var(--display);font-size:1.4rem;font-weight:700;margin:0 0 14px}
.faq details{border-top:1px solid var(--line);padding:13px 2px}
.faq details:last-of-type{border-bottom:1px solid var(--line)}
.faq summary{font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--maroon);font-weight:800;font-size:1.2rem;line-height:1}
.faq details[open] summary::after{content:"\\2013"}
.faq details p{margin:10px 0 2px;color:var(--ink)}

.related{margin:34px 0}
.related ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:2px}
.related a{display:block;padding:12px 14px;border:1px solid var(--line);border-radius:12px;
  text-decoration:none;font-weight:600;background:var(--card)}
.related a:hover{border-color:var(--maroon)}
.related .home-link{margin-top:6px;background:transparent;border-style:dashed}

.site-foot{border-top:1px solid var(--line);margin-top:36px;padding:22px 0 40px;
  font-size:.84rem;color:var(--muted)}
.site-foot a{font-weight:600}

@media (max-width:560px){
  body{font-size:16px}
  h1{font-size:1.74rem}
  .lead{font-size:1.08rem}
  .cv{display:none}
  .leg{grid-template-columns:80px 1fr auto}
  .est{padding:16px 14px 6px}
}
@media (prefers-reduced-motion: reduce){
  *{transition:none !important}
}`.trim();

// ─── Plantilla de página ─────────────────────────────────────────────────────
function renderPage(page, lang, flights) {
  const t = UI[lang];
  const meta = page.i18n[lang];
  const other = lang === "es" ? "en" : "es";
  const selfUrl = SITE + meta.path;
  const esUrl = SITE + page.i18n.es.path;
  const enUrl = SITE + page.i18n.en.path;
  const isPair = page.type === "pair";
  const winner = (isPair && flights && flights.length) ? flights[0] : null;

  const ctaOriginsRaw = isPair ? (page.ctaOrigins || page.origins.join(",")) : (page.exampleOrigins || "");
  const ctaUrl = "/?" + ctaOriginsRaw.split(",").map((c) => "o=" + encodeURIComponent(c.trim())).filter(Boolean).join("&");
  const ctaLabel = isPair ? t.ctaPair : t.ctaUsecase;

  const lead = buildLead(meta.lead, lang, winner);

  // Bloque de estimación (solo pair con datos)
  const estimate = (isPair && flights && flights.length)
    ? estimateBlock(flights, lang, t, ctaUrl)
    : "";

  // Prosa
  const prose = `<div class="prose">${meta.prose.map((p) => `<p>${escHtml(p)}</p>`).join("")}</div>`;

  // FAQ visible (refleja el JSON-LD)
  const faq = `<section class="faq" aria-labelledby="faq-h">
        <h2 id="faq-h">${escHtml(t.faqTitle)}</h2>
        ${meta.faq.map((f) => `<details><summary>${escHtml(f.q)}</summary><p>${escHtml(f.a)}</p></details>`).join("\n        ")}
      </section>`;

  // Enlaces internos (mismo idioma) + home
  const relatedItems = (page.related || [])
    .map((slug) => seed.pages.find((p) => p.slug === slug))
    .filter(Boolean)
    .map((rp) => {
      const rm = rp.i18n[lang];
      return `<li><a href="${escAttr(rm.path)}">${escHtml(rm.h1)}</a></li>`;
    }).join("\n          ");
  const related = `<nav class="related" aria-labelledby="rel-h">
        <h2 id="rel-h">${escHtml(t.relatedTitle)}</h2>
        <ul>
          ${relatedItems}
          <li><a class="home-link" href="/">${escHtml(t.backHome)} &rarr;</a></li>
        </ul>
      </nav>`;

  // Convergencia (origin count para pair; ejemplo para usecase)
  const cvCount = isPair ? page.origins.length
    : (page.exampleOrigins ? page.exampleOrigins.split(",").length : 3);
  const cv = convergenceSVG(cvCount);

  // JSON-LD
  const faqLd = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: meta.faq.map((f) => ({
      "@type": "Question", name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: t.home, item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: meta.h1, item: selfUrl },
    ],
  };

  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#AE2F34" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#131434" media="(prefers-color-scheme: dark)">

  <title>${escHtml(meta.title)}</title>
  <meta name="description" content="${escAttr(meta.metaDescription)}">
  <link rel="canonical" href="${escAttr(selfUrl)}">

  <link rel="alternate" hreflang="es" href="${escAttr(esUrl)}">
  <link rel="alternate" hreflang="en" href="${escAttr(enUrl)}">
  <link rel="alternate" hreflang="x-default" href="${escAttr(enUrl)}">

  <meta property="og:title" content="${escAttr(meta.title)}">
  <meta property="og:description" content="${escAttr(meta.metaDescription)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escAttr(selfUrl)}">
  <meta property="og:site_name" content="FlyndMe">
  <meta property="og:locale" content="${t.ogLocale}">
  <meta property="og:locale:alternate" content="${UI[other].ogLocale}">
  <meta property="og:image" content="${escAttr(SITE + "/og-preview.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="icon" href="/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="icon" type="image/svg+xml" href="/logo-flyndme.svg">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <script type="application/ld+json">${jsonLd(faqLd)}</script>
  <script type="application/ld+json">${jsonLd(breadcrumbLd)}</script>

  <style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    <header class="site-head">
      <a class="brand" href="/" aria-label="${escAttr(t.homeAria)}">
        <svg class="brand-mark" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 13l8-2 4-7 2 1-2 7 6 2-1 2-6-1-3 5-2-1 1-5-5-1z" fill="#AE2F34"/>
        </svg>
        <span class="brand-name">Flynd<b>Me</b></span>
        <span class="brand-tag">${escHtml(t.brandTag)}</span>
      </a>
    </header>

    <main>
      <div class="hero">
        <div class="hero-text">
          <p class="eyebrow">${escHtml(isPair ? t.eyebrowPair : t.eyebrowUsecase)}</p>
          <h1>${escHtml(meta.h1)}</h1>
          <p class="lead">${escHtml(lead)}</p>
        </div>
        ${cv}
      </div>

      ${estimate}

      <div class="cta-wrap">
        <a class="cta" href="${escAttr(ctaUrl)}">${escHtml(ctaLabel)} &rarr;</a>
        <p class="cta-note">${escHtml(t.ctaNote)}</p>
      </div>

      ${prose}

      ${faq}

      ${related}
    </main>

    <footer class="site-foot">
      <p>${escHtml(t.footer)}</p>
      <p>&copy; ${NOW.getFullYear()} FlyndMe &middot; <a href="/">flyndme2.vercel.app</a></p>
    </footer>
  </div>
</body>
</html>
`;
}

// ─── Sitemap ─────────────────────────────────────────────────────────────────
function buildSitemap() {
  const url = (loc, prio, alts) => {
    const links = alts ? alts.map((a) =>
      `\n    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${escAttr(a.href)}"/>`).join("") : "";
    return `  <url>
    <loc>${escAttr(loc)}</loc>${links}
    <lastmod>${GEN_DATE}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${prio}</priority>
  </url>`;
  };

  const entries = [url(SITE + "/", "1.0", null)];
  for (const page of seed.pages) {
    const esUrl = SITE + page.i18n.es.path;
    const enUrl = SITE + page.i18n.en.path;
    const alts = [
      { lang: "es", href: esUrl },
      { lang: "en", href: enUrl },
      { lang: "x-default", href: enUrl },
    ];
    const prio = page.type === "pair" ? "0.8" : "0.7";
    entries.push(url(esUrl, prio, alts));
    entries.push(url(enUrl, prio, alts));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nFlyndMe SEO page generator`);
  console.log(`  site=${SITE}  api=${API}`);
  console.log(`  travel date=${TRAVEL_DATE}  prices-checked label="${MONTH_LABEL.en}" / "${MONTH_LABEL.es}"\n`);

  const pairPages = seed.pages.filter((p) => p.type === "pair");
  let backendAwake = true;
  if (pairPages.length > 0) {
    backendAwake = await wakeBackend();
    if (!backendAwake) {
      console.warn("  ! Backend did not wake — pair pages will render WITHOUT price tables (honest fallback).\n");
    }
  }

  const summary = [];
  for (const page of seed.pages) {
    let flights = null;
    if (page.type === "pair" && backendAwake) {
      console.log(`  search ${page.slug} (${page.origins.join(",")})...`);
      flights = await searchPair(page);
    }

    const hasTable = page.type === "pair" && Array.isArray(flights) && flights.length > 0;
    const winnerCity = hasTable ? cityName(flights[0].destination, "en") : null;

    for (const lang of ["es", "en"]) {
      const meta = page.i18n[lang];
      const html = renderPage(page, lang, flights);
      const outDir = join(PUBLIC_DIR, meta.path);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "index.html"), html, "utf8");
    }

    summary.push({
      slug: page.slug, type: page.type, table: hasTable, winner: winnerCity,
      paths: [page.i18n.es.path, page.i18n.en.path],
    });
  }

  // Sitemap
  writeFileSync(join(PUBLIC_DIR, "sitemap.xml"), buildSitemap(), "utf8");

  // Resumen
  console.log(`\n──────── Summary ────────`);
  let withTable = 0, noData = 0;
  for (const s of summary) {
    if (s.type === "pair") {
      if (s.table) { withTable++; console.log(`  [table  ] ${s.slug.padEnd(22)} winner=${s.winner}`); }
      else { noData++; console.log(`  [NO DATA] ${s.slug.padEnd(22)} → rendered without price table`); }
    } else {
      console.log(`  [usecase] ${s.slug.padEnd(22)} (no backend call, no table)`);
    }
    for (const p of s.paths) console.log(`             ${SITE}${p}`);
  }
  const pages = summary.length;
  console.log(`\n  ${pages} pages × 2 languages = ${pages * 2} HTML files written to frontend/public`);
  console.log(`  pair w/ table: ${withTable}   pair w/o data: ${noData}   usecase: ${summary.filter((s) => s.type === "usecase").length}`);
  console.log(`  sitemap.xml regenerated: home + ${pages * 2} URLs`);
  if (noData > 0) console.log(`\n  NOTE: ${noData} pair page(s) had no backend data → no invented prices, no table.`);
  console.log("");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
