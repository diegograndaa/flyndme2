const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const router = express.Router();

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

const groupStore = new Map();

// Cleanup stale entries every hour (unref so it never keeps the process alive).
setInterval(() => {
  const now = Date.now();
  for (const [id, g] of groupStore.entries()) {
    if (now > g.expiresAt) groupStore.delete(id);
  }
}, 60 * 60 * 1000).unref();

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

router.post("/", createLimiter, (req, res) => {
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

    // Evict oldest if the store is full.
    if (groupStore.size >= MAX_GROUPS) {
      const entries = Array.from(groupStore.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toDelete = entries.slice(0, Math.max(1, entries.length - MAX_GROUPS + 50));
      for (const [k] of toDelete) groupStore.delete(k);
    }

    const id = generateId();
    groupStore.set(id, {
      departureDate,
      returnDate,
      tripType,
      members: cleaned,
      createdAt: Date.now(),
      expiresAt: Date.now() + GROUP_TTL_MS,
    });

    console.log(`[groups] Created ${id} (store: ${groupStore.size}/${MAX_GROUPS})`);
    return res.json({ id, expiresIn: GROUP_TTL_MS });
  } catch (err) {
    console.error("[groups] Error creating group:", err.message);
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Error creating group link." });
  }
});

// ─── GET /api/groups/:id — read the current roster ──────────────────────────

router.get("/:id", (req, res) => {
  const { id } = req.params;
  if (!GROUP_ID_RE.test(id)) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const g = groupStore.get(id);
  if (!g || Date.now() > g.expiresAt) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  return res.json(publicView(id, g));
});

// ─── POST /api/groups/:id/members — a traveler adds their departure city ────

router.post("/:id/members", memberLimiter, (req, res) => {
  const { id } = req.params;
  if (!GROUP_ID_RE.test(id)) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const g = groupStore.get(id);
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
  return res.json(publicView(id, g));
});

// ─── DELETE /api/groups/:id/members/:index — remove a roster entry ──────────

router.delete("/:id/members/:index", (req, res) => {
  const { id, index } = req.params;
  if (!GROUP_ID_RE.test(id)) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const g = groupStore.get(id);
  if (!g || Date.now() > g.expiresAt) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Group not found or expired." });
  }
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= g.members.length) {
    return res.status(400).json({ code: "INVALID_INDEX", message: "No such member." });
  }
  g.members.splice(i, 1);
  return res.json(publicView(id, g));
});

module.exports = router;
module.exports.cleanMember = cleanMember;
module.exports._store = groupStore; // exposed for tests only
