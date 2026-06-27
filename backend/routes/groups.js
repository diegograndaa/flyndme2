const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createStore } = require("../utils/kvStore");
const { counters } = require("../utils/metrics");
const router = express.Router();

// Envuelve un handler async para que cualquier rechazo llegue al error handler
// global (→ 500) en vez de quedar como unhandledRejection.
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ─── Collaborative group planning ───────────────────────────────────────────
// A "group" lets a trip organizer create a shareable plan (one date + trip type)
// that each traveler opens to add THEIR OWN departure city, instead of one
// person collecting everyone's origins by hand. The group is just shared
// state — no prices are computed or stored here; the actual search reuses the
// existing /api/flights/multi-origin once the roster is filled. No accounts:
// the link is the capability. (Mirrors the in-memory share store next door.)

const GROUP_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — planning spans weeks
const MAX_GROUPS   = 1000;
const MAX_MEMBERS  = 9;  // same ceiling as the multi-origin search
const MAX_NAME_LEN = 40;
const MAX_ORIGIN_LEN = 60;

const GROUP_ID_RE = /^[A-Za-z0-9_-]{4,24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Store con TTL: in-memory por defecto; persistente (Upstash Redis) si están
// UPSTASH_REDIS_REST_URL/TOKEN. El barrido y la evicción los gestiona el store.
const store = createStore({
  namespace: "group",
  ttlMs: GROUP_TTL_MS,
  maxSize: MAX_GROUPS,
  sweepEveryMs: 60 * 60 * 1000,
});

function generateId() {
  return crypto.randomBytes(6).toString("base64url"); // ~8 chars, URL-safe
}

// Sanitize one member into { origin, passengers, name } or null if invalid.
// Exported so it can be unit-tested without spinning up the server.
function cleanMember(m) {
  if (!m || typeof m !== "object") return null;
  const origin = String(m.origin == null ? "" : m.origin).trim().slice(0, MAX_ORIGIN_LEN);
  if (!origin) return null;
  let pax = Math.floor(Number(m.passengers));
  if (!Number.isFinite(pax) || pax < 1) pax = 1;
  if (pax > MAX_MEMBERS) pax = MAX_MEMBERS;
  const name = String(m.name == null ? "" : m.name).trim().slice(0, MAX_NAME_LEN);
  return { origin, passengers: pax, name };
}

function publicView(id, g) {
  return {
    id,
    departureDate: g.departureDate,
    returnDate: g.returnDate || "",
    tripType: g.tripType,
    members: g.members,
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
  };
}

// Rate limits: creating groups is cheap to abuse (fills the store), adding
// members happens more often (each traveler), so it gets a looser cap.
const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.GROUP_CREATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many group links created. Try again in a few minutes." },
});
const memberLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.GROUP_MEMBER_LIMIT || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many updates. Try again in a few minutes." },
});

// ─── POST /api/groups — create a group plan ─────────────────────────────────

router.post("/", createLimiter, asyncH(async (req, res) => {
  try {
    let { departureDate, returnDate, tripType, members } = req.body || {};

    if (!DATE_RE.test(String(departureDate || ""))) {
      return res.status(400).json({ code: "INVALID_DATE", message: "departureDate must be YYYY-MM-DD." });
    }
    tripType = tripType === "roundtrip" ? "roundtrip" : "oneway";
    // Round trips carry a return date so the search the group runs later is
    // complete; ignore it for one-way and reject a malformed one.
    returnDate = tripType === "roundtrip" ? String(returnDate || "") : "";
    if (returnDate && !DATE_RE.test(returnDate)) {
      return res.status(400).json({ code: "INVALID_DATE", message: "returnDate must be YYYY-MM-DD." });
    }

    let cleaned = [];
    if (Array.isArray(members)) {
      cleaned = members.map(cleanMember).filter(Boolean).slice(0, MAX_MEMBERS);
    }

    const id = generateId();
    await store.set(id, {
      departureDate,
      returnDate,
      tripType,
      members: cleaned,
      createdAt: Date.now(),
      expiresAt: Date.now() + GROUP_TTL_MS,
    });

    const n = await store.size();
    console.log(`[groups] Created ${id}${n != null ? ` (store: ${n}/${MAX_GROUPS})` : ""}`);
    counters.incr("group_created"); // fire-and-forget (loop metric)
    return res.json({ id, expiresIn: GROUP_TTL_MS });
  } catch (err) {
    console.error("[groups] Error creating group:", err.message);
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Error creating group link." });
  }
}));

// ─── GET /api/groups/:id/og — OG meta for invite-link social previews ───────
// Mirrors share.js's OG route: served from the backend (kept warm by the
// keep-alive cron), renders meta tags pointing at the Vercel edge image in
// "group" mode, then redirects a human to the SPA. A group has no price yet, so
// the card invites participation ("Where should we all meet? · N cities · add
// yours") instead of announcing a winner.

const FRONTEND_URL = process.env.FRONTEND_URL || "https://flyndme2.vercel.app";

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

router.get("/:id/og", asyncH(async (req, res) => {
  const { id } = req.params;
  if (!GROUP_ID_RE.test(id)) return res.redirect(302, FRONTEND_URL);
  const g = await store.get(id);
  if (!g || Date.now() > g.expiresAt) return res.redirect(302, FRONTEND_URL);

  const count = Array.isArray(g.members) ? g.members.length : 0;
  const cities = (g.members || [])
    .map((m) => m && m.origin).filter(Boolean).slice(0, 5).join(", ");
  const groupUrl = `${FRONTEND_URL}?group=${id}`;

  const ogTitle = "FlyndMe: where should your group meet?";
  const ogDesc = count > 0
    ? `${count} ${count === 1 ? "city" : "cities"} added so far. Add yours — FlyndMe finds the cheapest, fairest place for the whole group to meet.`
    : "Add the city you'd fly from — FlyndMe finds the cheapest, fairest place for the whole group to meet.";
  const ogImage = `${FRONTEND_URL}/api/og?${new URLSearchParams({
    mode: "group",
    n: String(count),
    from: cities,
  }).toString()}`;

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta property="og:title" content="${escapeHtml(ogTitle)}"/>
<meta property="og:description" content="${escapeHtml(ogDesc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${escapeHtml(groupUrl)}"/>
<meta property="og:site_name" content="FlyndMe"/>
<meta property="og:image" content="${escapeHtml(ogImage)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:description" content="${escapeHtml(ogDesc)}"/>
<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(groupUrl)}"/>
<title>${escapeHtml(ogTitle)}</title>
</head><body><p>Redirecting to <a href="${escapeHtml(groupUrl)}">FlyndMe</a>…</p></body></html>`;

  res.set("Content-Type", "text/html; charset=utf-8");
  // TTL corto: el roster (y por tanto la tarjeta) cambia según se suman viajeros.
  res.set("Cache-Control", "public, max-age=300");
  return res.send(html);
}));

// ─── GET /api/groups/:id — read the current roster ──────────────────────────

router.get("/:id", asyncH(async (req, res) => {
  const { id } = req.params;
  if (!GROUP_ID_RE.test(id)) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const g = await store.get(id);
  if (!g || Date.now() > g.expiresAt) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  // Alguien abrió un ?group= (cota superior: incluye refrescos del organizador).
  counters.incr("group_landing");
  return res.json(publicView(id, g));
}));

// ─── POST /api/groups/:id/members — a traveler adds their departure city ────

router.post("/:id/members", memberLimiter, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!GROUP_ID_RE.test(id)) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const g = await store.get(id);
  if (!g || Date.now() > g.expiresAt) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const member = cleanMember(req.body);
  if (!member) {
    return res.status(400).json({ code: "INVALID_MEMBER", message: "A departure city is required." });
  }
  if (g.members.length >= MAX_MEMBERS) {
    return res.status(409).json({ code: "GROUP_FULL", message: `A group can have at most ${MAX_MEMBERS} travelers.` });
  }
  g.members.push(member);
  // Conserva el TTL restante: añadir un miembro NO reinicia la caducidad (14d).
  await store.set(id, g, { ttlMs: Math.max(1, g.expiresAt - Date.now()) });
  counters.incr("group_member_added"); // el multiplicador real del loop
  return res.json(publicView(id, g));
}));

// ─── DELETE /api/groups/:id/members/:index — remove a roster entry ──────────

router.delete("/:id/members/:index", asyncH(async (req, res) => {
  const { id, index } = req.params;
  if (!GROUP_ID_RE.test(id)) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const g = await store.get(id);
  if (!g || Date.now() > g.expiresAt) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= g.members.length) {
    return res.status(400).json({ code: "INVALID_INDEX", message: "No such member." });
  }
  g.members.splice(i, 1);
  await store.set(id, g, { ttlMs: Math.max(1, g.expiresAt - Date.now()) });
  return res.json(publicView(id, g));
}));

module.exports = router;
module.exports.cleanMember = cleanMember;
module.exports._store = store; // exposed for tests only
