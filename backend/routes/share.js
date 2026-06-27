const express = require("express");
const crypto  = require("crypto");
const rateLimit = require("express-rate-limit");
const { createStore } = require("../utils/kvStore");
const { counters } = require("../utils/metrics");
const router  = express.Router();

// Envuelve un handler async para que cualquier rechazo llegue al error handler
// global (→ 500) en vez de quedar como unhandledRejection.
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ─── In-memory share store (TTL: 48 hours) ──────────────────────────────────

const SHARE_TTL_MS   = 48 * 60 * 60 * 1000; // 48 hours
const MAX_SHARES     = 500;
const MAX_PAYLOAD_KB = 64;

// Store con TTL: in-memory por defecto; persistente (Upstash Redis) si están
// UPSTASH_REDIS_REST_URL/TOKEN. El barrido y la evicción los gestiona el store.
const store = createStore({
  namespace: "share",
  ttlMs: SHARE_TTL_MS,
  maxSize: MAX_SHARES,
  sweepEveryMs: 30 * 60 * 1000,
});

function generateId() {
  return crypto.randomBytes(6).toString("base64url"); // ~8 chars, URL-safe
}

// Limite especifico de creacion de shares: sin el, un bucle trivial podia
// llenar el store en memoria (MAX_SHARES x MAX_PAYLOAD_KB) y expulsar los
// links legitimos de otros usuarios. La lectura (GET) no se limita aqui.
const createShareLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.SHARE_CREATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Demasiados enlaces creados. Espera unos minutos." },
});

// Formato de los ids generados por generateId(): base64url de 6 bytes.
const SHARE_ID_RE = /^[A-Za-z0-9_-]{4,24}$/;

// ─── POST /api/share — save results and return share ID ─────────────────────

router.post("/", createShareLimiter, asyncH(async (req, res) => {
  try {
    const { results, searchParams } = req.body;

    if (!results || !searchParams) {
      return res.status(400).json({ code: "INVALID_PAYLOAD", message: "Missing results or searchParams." });
    }

    // Size guard
    const payloadSize = JSON.stringify(req.body).length / 1024;
    if (payloadSize > MAX_PAYLOAD_KB) {
      return res.status(413).json({ code: "PAYLOAD_TOO_LARGE", message: `Max ${MAX_PAYLOAD_KB}KB allowed.` });
    }

    const id = generateId();
    await store.set(id, {
      results,
      searchParams,
      createdAt: Date.now(),
      expiresAt: Date.now() + SHARE_TTL_MS,
    });

    const n = await store.size();
    console.log(`[share] Created ${id}${n != null ? ` (store: ${n}/${MAX_SHARES})` : ""}`);

    counters.incr("share_created"); // fire-and-forget (loop metric)
    return res.json({ id, expiresIn: SHARE_TTL_MS });
  } catch (err) {
    console.error("[share] Error creating share:", err.message);
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Error creating share link." });
  }
}));

// ─── GET /api/share/:id/og — render OG meta tags for social previews ────────

const FRONTEND_URL = process.env.FRONTEND_URL || "https://flyndme2.vercel.app";

const CITY_NAMES = {
  MAD: "Madrid", BCN: "Barcelona", LON: "London", PAR: "Paris", ROM: "Rome",
  MIL: "Milan", BER: "Berlin", AMS: "Amsterdam", LIS: "Lisbon", DUB: "Dublin",
  VIE: "Vienna", BRU: "Brussels", PRG: "Prague", WAW: "Warsaw", ATH: "Athens",
  CPH: "Copenhagen", HEL: "Helsinki", ZRH: "Zurich", OSL: "Oslo", BUD: "Budapest",
  IST: "Istanbul", OPO: "Porto", AGP: "Malaga", PMI: "Palma de Mallorca",
  TFS: "Tenerife", NAP: "Naples", MRS: "Marseille", NCE: "Nice", GVA: "Geneva",
  EDI: "Edinburgh", KRK: "Krakow", BEG: "Belgrade", OTP: "Bucharest",
  SOF: "Sofia", ZAG: "Zagreb", TIA: "Tirana", SKG: "Thessaloniki",
  RAK: "Marrakech", TLL: "Tallinn", RIX: "Riga", VNO: "Vilnius",
  STO: "Stockholm", MLA: "Malta", DBV: "Dubrovnik", SPU: "Split",
  RHO: "Rhodes", TLV: "Tel Aviv", CMN: "Casablanca",
};

function cityName(code) {
  return CITY_NAMES[String(code).toUpperCase()] || String(code).toUpperCase();
}
function fmtEur(n) { return `€${Math.round(Number(n) || 0)}`; }
function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

router.get("/:id/og", asyncH(async (req, res) => {
  const { id } = req.params;
  if (!SHARE_ID_RE.test(id)) return res.redirect(302, FRONTEND_URL);
  const entry = await store.get(id);

  if (!entry || Date.now() > entry.expiresAt) {
    return res.redirect(302, FRONTEND_URL);
  }

  const best = entry.results?.flights?.[0];
  const params = entry.searchParams || {};
  const destCity = cityName(best?.destination || "???");
  const total = best ? fmtEur(best.totalCostEUR) : "";
  const avg = best ? fmtEur(best.averageCostPerTraveler) : "";
  // Prefer the pax-aware count from the backend payload; fall back to summing
  // searchParams.passengers; fall back to origins count for legacy shares.
  const numTravelers =
    best?.totalPassengers ||
    (Array.isArray(params.passengers)
      ? params.passengers.reduce((s, n) => s + (Number(n) || 1), 0)
      : 0) ||
    (params.origins || []).length;
  const originCities = (params.origins || []).map(cityName).join(", ");

  const ogTitle = `FlyndMe: ${originCities} → ${destCity}`;
  const ogDesc = total
    ? `Best destination for ${numTravelers} travelers. Group total: ${total} · ${avg}/person.`
    : "Find the cheapest place to meet your group.";
  const shareUrl = `${FRONTEND_URL}?share=${id}`;

  // Dynamic OG image (per-result card) rendered by the Vercel edge function.
  // Falls back to the static preview only if no winner data is available.
  const ogImage = best
    ? `${FRONTEND_URL}/api/og?${new URLSearchParams({
        dest: destCity,
        pp: avg,
        from: originCities,
        total,
        n: String(numTravelers || ""),
      }).toString()}`
    : `${FRONTEND_URL}/og-preview.png`;

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta property="og:title" content="${escapeHtml(ogTitle)}"/>
<meta property="og:description" content="${escapeHtml(ogDesc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${escapeHtml(shareUrl)}"/>
<meta property="og:site_name" content="FlyndMe"/>
<meta property="og:image" content="${escapeHtml(ogImage)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:description" content="${escapeHtml(ogDesc)}"/>
<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(shareUrl)}"/>
<title>${escapeHtml(ogTitle)}</title>
</head><body><p>Redirecting to <a href="${escapeHtml(shareUrl)}">FlyndMe</a>…</p></body></html>`;

  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  return res.send(html);
}));

// ─── GET /api/share/:id — retrieve shared results ──────────────────────────

router.get("/:id", asyncH(async (req, res) => {
  const { id } = req.params;
  if (!SHARE_ID_RE.test(id)) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Share link not found or expired." });
  }

  const entry = await store.get(id);
  if (!entry) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Share link not found or expired." });
  }

  if (Date.now() > entry.expiresAt) {
    await store.delete(id);
    return res.status(410).json({ code: "EXPIRED", message: "Share link has expired." });
  }

  // Alguien abrió un ?share= y el SPA está cargando los datos = visita real.
  // (Los crawlers piden /og, no /:id, así que esto no los cuenta.)
  counters.incr("share_landing");
  return res.json({
    results:      entry.results,
    searchParams: entry.searchParams,
    createdAt:    entry.createdAt,
    expiresAt:    entry.expiresAt,
  });
}));

module.exports = router;
