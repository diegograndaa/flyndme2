const express = require("express");
const crypto  = require("crypto");
const router  = express.Router();

// ─── In-memory share store (TTL: 48 hours) ──────────────────────────────────

const SHARE_TTL_MS   = 48 * 60 * 60 * 1000; // 48 hours
const MAX_SHARES     = 500;
const MAX_PAYLOAD_KB = 64;

const shareStore = new Map();

// Cleanup stale entries every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of shareStore.entries()) {
    if (now > entry.expiresAt) shareStore.delete(id);
  }
}, 30 * 60 * 1000);

function generateId() {
  return crypto.randomBytes(6).toString("base64url"); // ~8 chars, URL-safe
}

// ─── POST /api/share — save results and return share ID ─────────────────────

router.post("/", (req, res) => {
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

    // Evict oldest if full
    if (shareStore.size >= MAX_SHARES) {
      const entries = Array.from(shareStore.entries());
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toDelete = entries.slice(0, Math.max(1, entries.length - MAX_SHARES + 50));
      for (const [k] of toDelete) shareStore.delete(k);
    }

    const id = generateId();
    shareStore.set(id, {
      results,
      searchParams,
      createdAt: Date.now(),
      expiresAt: Date.now() + SHARE_TTL_MS,
    });

    console.log(`[share] Created ${id} (store: ${shareStore.size}/${MAX_SHARES})`);

    return res.json({ id, expiresIn: SHARE_TTL_MS });
  } catch (err) {
    console.error("[share] Error creating share:", err.message);
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Error creating share link." });
  }
});

// ─── GET /api/share/:id/og — render OG meta tags for social previews ────────

const FRONTEND_URL = process.env.FRONTEND_URL || "https://flyndme.vercel.app";

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

router.get("/:id/og", (req, res) => {
  const { id } = req.params;
  const entry = shareStore.get(id);

  if (!entry || Date.now() > entry.expiresAt) {
    return res.redirect(302, FRONTEND_URL);
  }

  const best = entry.results?.flights?.[0];
  const params = entry.searchParams || {};
  const destCity = cityName(best?.destination || "???");
  const total = best ? fmtEur(best.totalCostEUR) : "";
  const avg = best ? fmtEur(best.averageCostPerTraveler) : "";
  const numTravelers = (params.origins || []).length;
  const originCities = (params.origins || []).map(cityName).join(", ");

  const ogTitle = `FlyndMe: ${originCities} → ${destCity}`;
  const ogDesc = total
    ? `Best destination for ${numTravelers} travelers. Group total: ${total} · ${avg}/person.`
    : "Find the cheapest place to meet your group.";
  const shareUrl = `${FRONTEND_URL}?share=${id}`;

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta property="og:title" content="${escapeHtml(ogTitle)}"/>
<meta property="og:description" content="${escapeHtml(ogDesc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${escapeHtml(shareUrl)}"/>
<meta property="og:site_name" content="FlyndMe"/>
<meta property="og:image" content="${FRONTEND_URL}/og-preview.png"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:description" content="${escapeHtml(ogDesc)}"/>
<meta name="twitter:image" content="${FRONTEND_URL}/og-preview.png"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(shareUrl)}"/>
<title>${escapeHtml(ogTitle)}</title>
</head><body><p>Redirecting to <a href="${escapeHtml(shareUrl)}">FlyndMe</a>…</p></body></html>`;

  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  return res.send(html);
});

// ─── GET /api/share/:id — retrieve shared results ──────────────────────────

router.get("/:id", (req, res) => {
  const { id } = req.params;

  const entry = shareStore.get(id);
  if (!entry) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Share link not found or expired." });
  }

  if (Date.now() > entry.expiresAt) {
    shareStore.delete(id);
    return res.status(410).json({ code: "EXPIRED", message: "Share link has expired." });
  }

  return res.json({
    results:      entry.results,
    searchParams: entry.searchParams,
    createdAt:    entry.createdAt,
    expiresAt:    entry.expiresAt,
  });
});

module.exports = router;
