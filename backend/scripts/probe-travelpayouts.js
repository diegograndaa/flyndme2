#!/usr/bin/env node
// Sondeo de densidad de caché de la Aviasales Data API en rutas europeas
// típicas de FlyndMe. Es el paso de validación previo a activar
// FLIGHT_PROVIDER=travelpayouts: mide cuántas rutas devuelven precio para
// una fecha exacta (como busca la app) y diagnostica las vacías.
//
// Uso:
//   TRAVELPAYOUTS_TOKEN=xxx node scripts/probe-travelpayouts.js
//   ... --days=45         fecha objetivo: hoy + N días (default 30)
//   ... --market=es       fija el market (default: auto por origen)
//   ... --roundtrip       ida y vuelta (+7 días de estancia)
//
// Sin dependencias: usa fetch nativo de Node 18+.

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
if (!TOKEN) {
  console.error("Falta TRAVELPAYOUTS_TOKEN. Consíguelo en https://app.travelpayouts.com/profile/api-token");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const DAYS      = Number(args.days || 30);
const MARKET    = typeof args.market === "string" ? args.market : null;
const ROUNDTRIP = !!args.roundtrip;

// Muestra representativa: orígenes y destinos de los tiers reales de
// routes/flights.js (mercado objetivo de FlyndMe).
const ORIGINS = ["MAD", "LON", "BER", "PAR", "ROM"];
const DESTS   = ["LIS", "AMS", "BCN", "PRG", "VIE", "CPH"];

const BASE = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";

function isoPlusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const DEP = isoPlusDays(DAYS);
const RET = ROUNDTRIP ? isoPlusDays(DAYS + 7) : null;

function buildUrl(origin, destination, { month = false } = {}) {
  const p = new URLSearchParams({
    origin,
    destination,
    departure_at: month ? DEP.slice(0, 7) : DEP,
    currency: "eur",
    sorting: "price",
    limit: "30",
    one_way: RET ? "false" : "true",
  });
  if (RET && !month) p.set("return_at", RET);
  if (MARKET) p.set("market", MARKET);
  return `${BASE}?${p}`;
}

async function probe(url) {
  const res = await fetch(url, { headers: { "X-Access-Token": TOKEN, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.success !== true) throw new Error(body.error || "respuesta inválida");
  return Array.isArray(body.data) ? body.data : [];
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log(`\nSondeo Aviasales Data API — salida ${DEP}${RET ? ` / vuelta ${RET}` : " (solo ida)"} · market: ${MARKET || "auto (por origen)"}\n`);
  console.log("RUTA       PRECIO   AERO  ESCALAS  SALIDA               DIAGNÓSTICO");
  console.log("─".repeat(78));

  let exactHits = 0, monthOnly = 0, empty = 0, errors = 0;
  const routes = ORIGINS.flatMap((o) => DESTS.filter((d) => d !== o).map((d) => [o, d]));

  for (const [o, d] of routes) {
    const label = `${o}→${d}`.padEnd(10);
    try {
      const exact = await probe(buildUrl(o, d));
      const matching = exact.filter((t) => String(t.departure_at || "").slice(0, 10) === DEP);
      if (matching.length > 0) {
        exactHits++;
        const t = matching.reduce((a, b) => (Number(a.price) <= Number(b.price) ? a : b));
        console.log(
          `${label} ${String(t.price + "€").padEnd(8)} ${String(t.airline || "?").padEnd(5)} ${String(t.transfers ?? "?").padEnd(8)} ${String(t.departure_at).slice(0, 16).padEnd(20)} ok (${matching.length} opciones)`
        );
      } else {
        // ¿Es la ruta o solo la fecha? Sondear el mes completo.
        await sleep(120);
        const month = await probe(buildUrl(o, d, { month: true }));
        if (month.length > 0) {
          monthOnly++;
          console.log(`${label} ${"—".padEnd(8)} ${"".padEnd(5)} ${"".padEnd(8)} ${"".padEnd(20)} fecha exacta vacía; mes con ${month.length} precios`);
        } else {
          empty++;
          console.log(`${label} ${"—".padEnd(8)} ${"".padEnd(5)} ${"".padEnd(8)} ${"".padEnd(20)} SIN CACHÉ (ni mes completo)`);
        }
      }
    } catch (err) {
      errors++;
      console.log(`${label} ERROR: ${err.message}`);
    }
    await sleep(120); // ≤ ~8 req/s, muy por debajo de 600/min
  }

  const total = routes.length;
  const pct = (n) => `${((n / total) * 100).toFixed(0)}%`;
  console.log("─".repeat(78));
  console.log(`\nRutas sondeadas: ${total}`);
  console.log(`  Con precio en fecha exacta:   ${exactHits}  (${pct(exactHits)})`);
  console.log(`  Solo con precios en el mes:   ${monthOnly}  (${pct(monthOnly)})`);
  console.log(`  Sin caché:                    ${empty}  (${pct(empty)})`);
  if (errors) console.log(`  Errores:                      ${errors}`);

  console.log(`\nInterpretación:`);
  if (exactHits / total >= 0.8) {
    console.log("  ✓ Densidad alta: viable como proveedor primario con fecha exacta.");
  } else if ((exactHits + monthOnly) / total >= 0.8) {
    console.log("  ⚠ La ruta tiene caché pero la fecha exacta falla a menudo: considera");
    console.log("    buscar con flexibilidad de fechas o un fallback al mes (mostrando la");
    console.log("    fecha real del precio, nunca fingiendo que es la pedida).");
  } else {
    console.log("  ✗ Densidad baja. Prueba --market=es / gb / de y compara; si sigue baja,");
    console.log("    revisa el plan B del informe (informe-proveedores-vuelos-2026.md).");
  }
  if (!MARKET) console.log("  Repite con --market=es para comparar con el market fijado.");
  console.log();
})();
