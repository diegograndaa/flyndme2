const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createStore } = require("../utils/kvStore");
const { verifySocial, publicProviderIds } = require("../services/socialAuth");

const router = express.Router();

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Cuentas: correo + contraseña, y Google / Apple / Facebook si están
// configurados. El botón social solo existe cuando el servidor puede
// comprobar el token. La contraseña sale de aquí solo como hash scrypt.
// La sesión es un token opaco (Upstash si está configurado, memoria si no).

const ACCOUNT_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DUMMY_SALT = "00".repeat(16);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const accounts = createStore({
  namespace: "account",
  ttlMs: ACCOUNT_TTL_MS,
  maxSize: 5000,
  sweepEveryMs: 60 * 60 * 1000,
});
const sessions = createStore({
  namespace: "session",
  ttlMs: REMEMBER_TTL_MS,
  maxSize: 20000,
  sweepEveryMs: 60 * 60 * 1000,
});
// google:sub → { email }. Así el mismo botón vuelve a la misma cuenta
// aunque el proveedor cambie el correo que enseña.
const identities = createStore({
  namespace: "identity",
  ttlMs: ACCOUNT_TTL_MS,
  maxSize: 20000,
  sweepEveryMs: 60 * 60 * 1000,
});

const attemptLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AUTH_ATTEMPT_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many attempts. Try again in a few minutes." },
});

function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return "";
  return email;
}

function passwordOk(pw) {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 72;
}

function cleanName(raw) {
  return String(raw == null ? "" : raw).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40);
}

function cleanFavorite(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const city = String(raw.city || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 48);
  let price = null;
  if (raw.price !== null && raw.price !== undefined && raw.price !== "") {
    const n = Number(raw.price);
    if (Number.isFinite(n) && n >= 0) price = Math.round(n * 100) / 100;
  }
  const ts = Number(raw.ts);
  return {
    code,
    city,
    price,
    ts: Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : 0,
  };
}

function sanitizeFavorites(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list.slice(0, 50)) {
    const fav = cleanFavorite(raw);
    if (fav) out.push(fav);
  }
  return out;
}

// Unión por código: se queda el más reciente. Un precio ausente no borra el
// que ya había. Tope 20, igual que el navegador.
function mergeFavorites(stored, incoming) {
  const map = new Map();
  for (const fav of [...sanitizeFavorites(stored), ...sanitizeFavorites(incoming)]) {
    const prev = map.get(fav.code);
    if (!prev) {
      map.set(fav.code, { ...fav });
      continue;
    }
    const favNewer = fav.ts >= prev.ts;
    const newer = favNewer ? { ...fav } : { ...prev };
    const older = favNewer ? prev : fav;
    if (newer.price == null && older.price != null) newer.price = older.price;
    map.set(fav.code, newer);
  }
  return [...map.values()].sort((a, b) => b.ts - a.ts || a.code.localeCompare(b.code)).slice(0, 20);
}

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString("hex"));
    });
  });
}

async function verifyPassword(password, saltHex, expectedHex) {
  const got = Buffer.from(await hashPassword(password, saltHex), "hex");
  const expected = Buffer.from(String(expectedHex || ""), "hex");
  if (got.length === 0 || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

function publicUser(user) {
  return { email: user.email, name: user.name || "" };
}

function cleanProviders(raw) {
  const out = {};
  for (const name of ["google", "apple", "facebook"]) {
    const sub = raw && raw[name] ? String(raw[name]).slice(0, 128) : "";
    if (sub) out[name] = sub;
  }
  return out;
}

function linkedProvider(user) {
  return ["google", "apple", "facebook"].find((name) => user && user.providers && user.providers[name]) || "";
}

function tokenFrom(req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(String(req.headers.authorization || ""));
  return m ? m[1] : "";
}

async function readSession(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const session = await sessions.get(token);
  if (!session || !session.email || (session.expiresAt && Date.now() > session.expiresAt)) {
    if (session) await sessions.delete(token);
    return null;
  }
  return { token, email: normalizeEmail(session.email) };
}

async function issueSession(email, remember) {
  const token = crypto.randomBytes(32).toString("base64url");
  const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  await sessions.set(token, { email, expiresAt: Date.now() + ttl }, { ttlMs: ttl });
  return token;
}

async function saveAccount(user) {
  const stored = {
    email: user.email,
    name: user.name || "",
    salt: user.salt || "",
    hash: user.hash || "",
    providers: cleanProviders(user.providers),
    favorites: sanitizeFavorites(user.favorites),
    createdAt: user.createdAt,
  };
  await accounts.set(user.email, stored, { ttlMs: ACCOUNT_TTL_MS });
  return stored;
}

router.post("/register", attemptLimiter, asyncH(async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!email) return res.status(400).json({ code: "AUTH_BAD_EMAIL" });
  if (!passwordOk(password)) return res.status(400).json({ code: "AUTH_WEAK_PASSWORD" });
  const existing = await accounts.get(email);
  if (existing) {
    if (!existing.hash) return res.status(409).json({ code: "AUTH_USE_PROVIDER", provider: linkedProvider(existing) });
    return res.status(409).json({ code: "AUTH_EXISTS" });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const user = await saveAccount({
    email,
    name: cleanName(req.body && req.body.name),
    salt,
    hash: await hashPassword(password, salt),
    favorites: sanitizeFavorites(req.body && req.body.favorites),
    createdAt: Date.now(),
  });

  const token = await issueSession(email, req.body && req.body.remember === true);
  return res.status(201).json({ user: publicUser(user), token, favorites: user.favorites });
}));

router.post("/login", attemptLimiter, asyncH(async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  const invalid = () => res.status(401).json({ code: "AUTH_INVALID" });
  if (!email || typeof password !== "string" || !password) {
    await hashPassword("invalid-pw", DUMMY_SALT);
    return invalid();
  }
  const user = await accounts.get(email);
  // Misma cantidad de scrypt si el correo no existe o entra solo con un
  // proveedor: la respuesta no adelanta si hay cuenta o no, salvo cuando
  // esa cuenta no tiene contraseña (hay que decir con qué botón entra).
  if (user && !user.hash) {
    await hashPassword("invalid-pw", DUMMY_SALT);
    return res.status(401).json({ code: "AUTH_USE_PROVIDER", provider: linkedProvider(user) });
  }
  const ok = user
    ? await verifyPassword(password, user.salt, user.hash)
    : (await hashPassword(password, DUMMY_SALT), false);
  if (!user || !ok) return invalid();

  user.favorites = mergeFavorites(user.favorites, req.body && req.body.favorites);
  await saveAccount(user);
  const token = await issueSession(email, req.body && req.body.remember === true);
  return res.json({ user: publicUser(user), token, favorites: user.favorites });
}));

router.get("/providers", (_req, res) => {
  res.json(publicProviderIds());
});

async function establishSocialSession({ profile, name, remember, favorites }) {
  const provider = profile.provider;
  const sub = String(profile.sub || "");
  const emailFromToken = normalizeEmail(profile.email);
  if (!sub || !emailFromToken) {
    const err = new Error("profile");
    err.code = "AUTH_PROVIDER_FAILED";
    throw err;
  }
  const idKey = `${provider}:${sub}`;
  const linked = await identities.get(idKey);
  let email = linked && linked.email ? normalizeEmail(linked.email) : "";
  let user = email ? await accounts.get(email) : null;
  if (!user) {
    email = emailFromToken;
    user = await accounts.get(email);
    const already = user && user.providers && user.providers[provider];
    if (already && already !== sub) {
      const err = new Error("taken");
      err.code = "AUTH_PROVIDER_TAKEN";
      throw err;
    }
  }
  const created = !user;
  const providers = { ...(user && user.providers), [provider]: sub };
  const stored = await saveAccount({
    email,
    name: (user && user.name) || cleanName(name) || cleanName(profile.name),
    salt: user && user.salt,
    hash: user && user.hash,
    providers,
    favorites: mergeFavorites(user && user.favorites, favorites),
    createdAt: (user && user.createdAt) || Date.now(),
  });
  await identities.set(idKey, { email }, { ttlMs: ACCOUNT_TTL_MS });
  const token = await issueSession(email, remember === true);
  return { status: created ? 201 : 200, user: publicUser(stored), token, favorites: stored.favorites };
}

router.post("/social", attemptLimiter, asyncH(async (req, res) => {
  try {
    const profile = await verifySocial({
      provider: req.body && req.body.provider,
      credential: req.body && req.body.credential,
      nonce: req.body && req.body.nonce,
    });
    const result = await establishSocialSession({
      profile,
      name: req.body && req.body.name,
      remember: req.body && req.body.remember === true,
      favorites: req.body && req.body.favorites,
    });
    return res.status(result.status).json({
      user: result.user,
      token: result.token,
      favorites: result.favorites,
    });
  } catch (err) {
    const code = err && err.code;
    if (code === "AUTH_PROVIDER_OFF") return res.status(404).json({ code });
    if (code === "AUTH_PROVIDER" || code === "AUTH_NO_EMAIL" || code === "AUTH_PROVIDER_TAKEN") {
      return res.status(400).json({ code });
    }
    if (code === "AUTH_PROVIDER_FAILED") return res.status(401).json({ code });
    throw err;
  }
}));

router.get("/me", asyncH(async (req, res) => {
  const session = await readSession(req);
  if (!session) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const user = await accounts.get(session.email);
  if (!user) return res.status(401).json({ code: "AUTH_REQUIRED" });
  return res.json({ user: publicUser(user), favorites: sanitizeFavorites(user.favorites) });
}));

router.post("/logout", asyncH(async (req, res) => {
  const token = tokenFrom(req);
  if (token) await sessions.delete(token);
  return res.status(204).end();
}));

router.post("/favorites", asyncH(async (req, res) => {
  const session = await readSession(req);
  if (!session) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const user = await accounts.get(session.email);
  if (!user) return res.status(401).json({ code: "AUTH_REQUIRED" });
  user.favorites = sanitizeFavorites(req.body && req.body.favorites);
  await saveAccount(user);
  return res.json({ favorites: user.favorites });
}));

module.exports = router;
module.exports.normalizeEmail = normalizeEmail;
module.exports.passwordOk = passwordOk;
module.exports.mergeFavorites = mergeFavorites;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.establishSocialSession = establishSocialSession;
