const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createStore } = require("../utils/kvStore");
const { verifySocial, publicProviderIds } = require("../services/socialAuth");
const saleMail = require("../services/saleMail");

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
  strict: true,
  ttlMs: ACCOUNT_TTL_MS,
  maxSize: 5000,
  sweepEveryMs: 60 * 60 * 1000,
});
const sessions = createStore({
  namespace: "session",
  strict: true,
  ttlMs: REMEMBER_TTL_MS,
  maxSize: 20000,
  sweepEveryMs: 60 * 60 * 1000,
});
// google:sub → { email }. Así el mismo botón vuelve a la misma cuenta
// aunque el proveedor cambie el correo que enseña.
const identities = createStore({
  namespace: "identity",
  strict: true,
  ttlMs: ACCOUNT_TTL_MS,
  maxSize: 20000,
  sweepEveryMs: 60 * 60 * 1000,
});

// Enlaces de un solo uso que llegan por correo: cambiar la contraseña (1 h) y
// confirmar el correo (7 días). Se guarda la huella del token, no el token.
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const mailTokens = createStore({
  namespace: "mailtoken",
  strict: true,
  ttlMs: VERIFY_TTL_MS,
  maxSize: 5000,
  sweepEveryMs: 60 * 60 * 1000,
});
// Fallos de contraseña y correos pedidos, por cuenta. El límite por IP no
// frena a quien reparte los intentos entre muchas direcciones.
const LOCK_WINDOW_MS = 60 * 60 * 1000;
const MAX_FAILS = Number(process.env.AUTH_ACCOUNT_FAILS || 10);
const MAX_MAILS = 3;
const throttles = createStore({
  namespace: "authlimit",
  ttlMs: LOCK_WINDOW_MS,
  maxSize: 20000,
  sweepEveryMs: 10 * 60 * 1000,
});

async function countOf(kind, email) {
  const hit = await throttles.get(`${kind}:${email}`);
  return hit && Number(hit.until) > Date.now() ? Number(hit.n) || 0 : 0;
}

async function bump(kind, email) {
  const key = `${kind}:${email}`;
  const hit = await throttles.get(key);
  const live = hit && Number(hit.until) > Date.now();
  const until = live ? Number(hit.until) : Date.now() + LOCK_WINDOW_MS;
  const n = (live ? Number(hit.n) || 0 : 0) + 1;
  await throttles.set(key, { n, until }, { ttlMs: Math.max(1000, until - Date.now()) });
  return n;
}

function tokenKey(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function validMailToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

async function mintMailToken(kind, email, ttlMs) {
  const token = crypto.randomBytes(32).toString("base64url");
  await mailTokens.set(tokenKey(token), { kind, email, expiresAt: Date.now() + ttlMs }, { ttlMs });
  return token;
}

async function takeMailToken(kind, token) {
  if (!validMailToken(token)) return null;
  const key = tokenKey(token);
  const hit = await mailTokens.get(key);
  if (!hit || hit.kind !== kind || !hit.email || Date.now() > Number(hit.expiresAt)) return null;
  await mailTokens.delete(key);
  return normalizeEmail(hit.email);
}

function accountMail(kind, token, lang) {
  const en = lang === "en";
  const base = saleMail.homeUrl();
  if (kind === "reset") {
    const link = `${base}/?reset=${token}`;
    return {
      subject: en ? "FlyndMe — set a new password" : "FlyndMe — nueva contraseña",
      text: (en
        ? ["Someone asked to change the password of your FlyndMe account.", "", "Open this link to choose a new one. It works once and for one hour:", link, "", "If it was not you, ignore this message: nothing changes."]
        : ["Alguien ha pedido cambiar la contraseña de tu cuenta de FlyndMe.", "", "Abre este enlace para elegir una nueva. Sirve una vez y durante una hora:", link, "", "Si no has sido tú, ignora este mensaje: no cambia nada."]
      ).join("\n"),
    };
  }
  const link = `${base}/?verify=${token}`;
  return {
    subject: en ? "FlyndMe — confirm your email" : "FlyndMe — confirma tu correo",
    text: (en
      ? ["Confirm that this email is yours to finish your FlyndMe account:", link, "", "If you did not create an account, ignore this message."]
      : ["Confirma que este correo es tuyo para terminar tu cuenta de FlyndMe:", link, "", "Si no has creado una cuenta, ignora este mensaje."]
    ).join("\n"),
  };
}

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
  return String(raw == null ? "" : raw).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
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
  const search = cleanFavoriteSearch(raw.search);
  return {
    code,
    city,
    price,
    ts: Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : 0,
    ...(search ? { search } : {}),
  };
}

function cleanFavoriteSearch(raw) {
  const item = cleanRecent(raw);
  if (!item) return null;
  return {
    origins: item.origins,
    passengers: item.passengers,
    tripType: item.tripType,
    departureDate: item.departureDate,
    returnDate: item.returnDate,
    flexDays: item.flexDays,
    maxBudget: item.maxBudget,
    directOnly: item.directOnly,
    cabinClass: item.cabinClass,
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CABINS = new Set(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]);

function iata(raw) {
  const code = String(raw || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

function dateOnly(raw) {
  const s = String(raw || "");
  return DATE_RE.test(s) ? s : "";
}

function cleanRecent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const origins = [];
  for (const item of (Array.isArray(raw.origins) ? raw.origins : []).slice(0, 8)) {
    const code = iata(item);
    if (code && !origins.includes(code)) origins.push(code);
  }
  const departureDate = dateOnly(raw.departureDate);
  if (!origins.length || !departureDate) return null;
  const tripType = raw.tripType === "roundtrip" ? "roundtrip" : "oneway";
  const passengers = origins.map((_, i) => {
    const n = Math.floor(Number(Array.isArray(raw.passengers) ? raw.passengers[i] : 1));
    return Number.isFinite(n) ? Math.min(9, Math.max(1, n)) : 1;
  });
  const cabin = String(raw.cabinClass || "").toUpperCase();
  const flex = Math.floor(Number(raw.flexDays));
  const budget = Number(raw.maxBudget);
  const destinations = [];
  for (const item of (Array.isArray(raw.destinations) ? raw.destinations : []).slice(0, 12)) {
    const code = iata(item);
    if (code && !destinations.includes(code)) destinations.push(code);
  }
  const ts = Number(raw.ts);
  return {
    origins,
    passengers,
    tripType,
    departureDate,
    returnDate: tripType === "roundtrip" ? dateOnly(raw.returnDate) : "",
    flexDays: Number.isFinite(flex) && flex >= 0 && flex <= 7 ? flex : 0,
    maxBudget: Number.isFinite(budget) && budget >= 0 && budget <= 100000 ? Math.round(budget) : 0,
    directOnly: raw.directOnly === true,
    cabinClass: CABINS.has(cabin) ? cabin : "ECONOMY",
    destinations,
    destBasis: raw.destBasis === "cheaper" ? "cheaper" : "usual",
    ts: Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : 0,
  };
}

function recentKey(item) {
  return [
    item.origins.join(","),
    item.passengers.join(","),
    item.departureDate,
    item.tripType,
    item.returnDate,
    item.flexDays,
    item.maxBudget,
    item.directOnly ? 1 : 0,
    item.cabinClass,
    item.destinations.slice().sort().join(","),
    item.destBasis,
  ].join("|");
}

function sanitizeRecent(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, 20)) {
    const item = cleanRecent(raw);
    if (!item) continue;
    const key = recentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 5) break;
  }
  return out;
}

function cleanWatch(raw) {
  if (!raw || typeof raw !== "object") return null;
  const destination = iata(raw.destination);
  const departureDate = dateOnly(raw.departureDate);
  const origins = [];
  for (const item of (Array.isArray(raw.origins) ? raw.origins : []).slice(0, 8)) {
    const code = iata(item);
    if (code) origins.push(code);
  }
  const id = String(raw.id || "").slice(0, 180);
  const total = Number(raw.savedTotalEUR);
  if (!destination || !departureDate || !origins.length || !id || !Number.isFinite(total) || total < 0) return null;
  const tripType = raw.tripType === "roundtrip" ? "roundtrip" : "oneway";
  const createdAt = Number(raw.createdAt);
  return {
    id,
    origins,
    passengers: origins.map((_, i) => {
      const n = Math.floor(Number(Array.isArray(raw.passengers) ? raw.passengers[i] : 1));
      return Number.isFinite(n) ? Math.min(9, Math.max(1, n)) : 1;
    }),
    departureDate,
    returnDate: tripType === "roundtrip" ? dateOnly(raw.returnDate) : "",
    tripType,
    destination,
    nonStop: raw.nonStop === true,
    savedTotalEUR: Math.round(total),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : 0,
  };
}

function sanitizeWatches(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, 10)) {
    const item = cleanWatch(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= 3) break;
  }
  return out;
}

function personalOf(user) {
  return {
    favorites: sanitizeFavorites(user && user.favorites),
    recent: sanitizeRecent(user && user.recent),
    watches: sanitizeWatches(user && user.watches),
  };
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
    if (!newer.search && older.search) newer.search = older.search;
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
  return { email: user.email, name: user.name || "", hasPassword: Boolean(user.hash), emailVerified: user.emailVerified === true };
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
  return { token, email: normalizeEmail(session.email), issuedAt: Number(session.issuedAt) || 0 };
}

// Sesión + cuenta. Una sesión abierta antes de `sessionsAfter` ya no vale:
// así se cierran las de quien registró el correo antes que su dueño.
async function sessionUser(req) {
  const session = await readSession(req);
  if (!session) return null;
  const user = await accounts.get(session.email);
  if (!user) return null;
  if (Number(user.sessionsAfter) > 0 && session.issuedAt < Number(user.sessionsAfter)) {
    await sessions.delete(session.token);
    return null;
  }
  return { session, user };
}

async function issueSession(email, remember) {
  const token = crypto.randomBytes(32).toString("base64url");
  const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const now = Date.now();
  await sessions.set(token, { email, issuedAt: now, expiresAt: now + ttl }, { ttlMs: ttl });
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
    recent: sanitizeRecent(user.recent),
    watches: sanitizeWatches(user.watches),
    createdAt: user.createdAt,
    ...(Number(user.sessionsAfter) > 0 ? { sessionsAfter: Number(user.sessionsAfter) } : {}),
    ...(user.emailVerified === true ? { emailVerified: true } : {}),
  };
  await accounts.set(user.email, stored, { ttlMs: ACCOUNT_TTL_MS });
  return stored;
}

// Sin correo configurado no hay enlace: la cuenta sigue sin confirmar.
async function sendVerification(email, lang) {
  if (!saleMail.configured()) return false;
  if (await bump("mail", email) > MAX_MAILS) return false;
  const token = await mintMailToken("verify", email, VERIFY_TTL_MS);
  const sent = await saleMail.sendConfirmation(accountMail("verify", token, lang === "en" ? "en" : "es"), email);
  return sent.sent === true;
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
    // Las sesiones de una cuenta anterior con este correo (ya borrada) no
    // valen para la nueva.
    sessionsAfter: Date.now(),
  });

  const token = await issueSession(email, req.body && req.body.remember === true);
  sendVerification(email, req.body && req.body.lang).catch(() => {});
  return res.status(201).json({ user: publicUser(user), token, ...personalOf(user) });
}));

router.post("/login", attemptLimiter, asyncH(async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  const invalid = () => res.status(401).json({ code: "AUTH_INVALID" });
  if (!email || typeof password !== "string" || !password) {
    await hashPassword("invalid-pw", DUMMY_SALT);
    return invalid();
  }
  if (await countOf("fail", email) >= MAX_FAILS) {
    await hashPassword("invalid-pw", DUMMY_SALT);
    return res.status(429).json({ code: "AUTH_LOCKED" });
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
  if (!user || !ok) {
    // También si el correo no existe: contar solo las cuentas reales diría cuáles lo son.
    await bump("fail", email);
    return invalid();
  }
  await throttles.delete(`fail:${email}`);

  user.favorites = mergeFavorites(user.favorites, req.body && req.body.favorites);
  const stored = await saveAccount(user);
  const token = await issueSession(email, req.body && req.body.remember === true);
  return res.json({ user: publicUser(stored), token, ...personalOf(stored) });
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
    // Un proveedor que no ha demostrado el correo no se engancha a una
    // cuenta que ya existe (otra persona podría declarar ese email).
    if (user && profile.emailVerified !== true) {
      const err = new Error("unverified");
      err.code = "AUTH_PROVIDER_TAKEN";
      throw err;
    }
    const already = user && user.providers && user.providers[provider];
    if (already && already !== sub) {
      const err = new Error("taken");
      err.code = "AUTH_PROVIDER_TAKEN";
      throw err;
    }
  }
  const created = !user;
  const providers = { ...(user && user.providers), [provider]: sub };
  // El correo de una cuenta con contraseña nunca se comprobó: pudo crearla
  // otra persona. Cuando el dueño lo demuestra con su proveedor por primera
  // vez, esa contraseña y las sesiones abiertas con ella dejan de valer.
  // Si el correo ya se confirmó con el enlace, la contraseña es de su dueño y se queda.
  const takeover = Boolean(user && user.hash && user.emailVerified !== true && !(user.providers && user.providers[provider]));
  const stored = await saveAccount({
    email,
    name: (user && user.name) || cleanName(name) || cleanName(profile.name),
    salt: takeover ? "" : user && user.salt,
    hash: takeover ? "" : user && user.hash,
    sessionsAfter: takeover ? Date.now() : user && user.sessionsAfter,
    emailVerified: (user && user.emailVerified === true) || profile.emailVerified === true,
    providers,
    favorites: mergeFavorites(user && user.favorites, favorites),
    recent: user && user.recent,
    watches: user && user.watches,
    createdAt: (user && user.createdAt) || Date.now(),
  });
  await identities.set(idKey, { email }, { ttlMs: ACCOUNT_TTL_MS });
  const token = await issueSession(email, remember === true);
  return { status: created ? 201 : 200, user: publicUser(stored), token, ...personalOf(stored) };
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
      recent: result.recent,
      watches: result.watches,
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
  const found = await sessionUser(req);
  if (!found) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const { user } = found;
  return res.json({ user: publicUser(user), ...personalOf(user) });
}));

router.post("/logout", asyncH(async (req, res) => {
  const token = tokenFrom(req);
  if (token) await sessions.delete(token);
  return res.status(204).end();
}));

router.post("/favorites", asyncH(async (req, res) => {
  const found = await sessionUser(req);
  if (!found) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const { user } = found;
  user.favorites = sanitizeFavorites(req.body && req.body.favorites);
  const stored = await saveAccount(user);
  return res.json({ favorites: stored.favorites });
}));

// Solo toca las listas que vienen en el cuerpo. Así guardar favoritos no
// borra las búsquedas, ni al revés.
router.post("/personal", asyncH(async (req, res) => {
  const found = await sessionUser(req);
  if (!found) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const { user } = found;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (Object.prototype.hasOwnProperty.call(body, "favorites")) user.favorites = body.favorites;
  if (Object.prototype.hasOwnProperty.call(body, "recent")) user.recent = body.recent;
  if (Object.prototype.hasOwnProperty.call(body, "watches")) user.watches = body.watches;
  const stored = await saveAccount(user);
  return res.json(personalOf(stored));
}));

// Pide el enlace para cambiar la contraseña. La respuesta es la misma haya
// cuenta o no: no dice qué correos están registrados.
router.post("/forgot", attemptLimiter, asyncH(async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ code: "AUTH_BAD_EMAIL" });
  if (!saleMail.configured()) return res.status(503).json({ code: "AUTH_MAIL_OFF" });
  const user = await accounts.get(email);
  if (user && await bump("mail", email) <= MAX_MAILS) {
    const token = await mintMailToken("reset", email, RESET_TTL_MS);
    await saleMail.sendConfirmation(accountMail("reset", token, req.body && req.body.lang === "en" ? "en" : "es"), email);
  }
  return res.json({ ok: true });
}));

// El enlace del correo demuestra que el correo es suyo: la contraseña nueva
// sustituye a la anterior y cierra todas las sesiones abiertas.
router.post("/reset", attemptLimiter, asyncH(async (req, res) => {
  const password = req.body && req.body.password;
  if (!passwordOk(password)) return res.status(400).json({ code: "AUTH_WEAK_PASSWORD" });
  const email = await takeMailToken("reset", req.body && req.body.token);
  const user = email ? await accounts.get(email) : null;
  if (!user) return res.status(400).json({ code: "AUTH_LINK_EXPIRED" });
  const salt = crypto.randomBytes(16).toString("hex");
  const stored = await saveAccount({
    ...user,
    salt,
    hash: await hashPassword(password, salt),
    emailVerified: true,
    sessionsAfter: Date.now(),
  });
  await throttles.delete(`fail:${email}`);
  const token = await issueSession(email, req.body && req.body.remember === true);
  return res.json({ user: publicUser(stored), token, ...personalOf(stored) });
}));

router.post("/verify", attemptLimiter, asyncH(async (req, res) => {
  const email = await takeMailToken("verify", req.body && req.body.token);
  const user = email ? await accounts.get(email) : null;
  if (!user) return res.status(400).json({ code: "AUTH_LINK_EXPIRED" });
  await saveAccount({ ...user, emailVerified: true });
  return res.json({ ok: true });
}));

// Cambiar la contraseña con la sesión abierta. Pide la actual si la hay y
// cierra las demás sesiones.
router.post("/password", attemptLimiter, asyncH(async (req, res) => {
  const found = await sessionUser(req);
  if (!found) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const { user } = found;
  const next = req.body && req.body.password;
  if (!passwordOk(next)) return res.status(400).json({ code: "AUTH_WEAK_PASSWORD" });
  if (user.hash) {
    const current = req.body && req.body.current;
    const ok = typeof current === "string" && current && await verifyPassword(current, user.salt, user.hash);
    if (!ok) return res.status(401).json({ code: "AUTH_INVALID" });
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const stored = await saveAccount({ ...user, salt, hash: await hashPassword(next, salt), sessionsAfter: Date.now() });
  const token = await issueSession(user.email, true);
  return res.json({ user: publicUser(stored), token });
}));

// Copia de lo que la cuenta guarda. Sin la huella de la contraseña.
router.get("/export", asyncH(async (req, res) => {
  const found = await sessionUser(req);
  if (!found) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const { user } = found;
  return res.json({
    exportedAt: new Date().toISOString(),
    account: {
      email: user.email,
      name: user.name || "",
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      emailVerified: user.emailVerified === true,
      hasPassword: Boolean(user.hash),
      signInWith: Object.keys(cleanProviders(user.providers)),
    },
    ...personalOf(user),
  });
}));

// Borra la cuenta y lo que cuelga de ella. Con contraseña, la pide.
router.delete("/me", attemptLimiter, asyncH(async (req, res) => {
  const found = await sessionUser(req);
  if (!found) return res.status(401).json({ code: "AUTH_REQUIRED" });
  const { user, session } = found;
  if (user.hash) {
    const current = req.body && req.body.password;
    const ok = typeof current === "string" && current && await verifyPassword(current, user.salt, user.hash);
    if (!ok) return res.status(401).json({ code: "AUTH_INVALID" });
  }
  for (const [provider, sub] of Object.entries(cleanProviders(user.providers))) {
    await identities.delete(`${provider}:${sub}`);
  }
  await accounts.delete(user.email);
  await sessions.delete(session.token);
  return res.json({ ok: true });
}));

// Redis caído: 503, nunca «no existe».
router.use((err, _req, res, next) => {
  if (err && err.code === "STORE_UNAVAILABLE") return res.status(503).json({ code: "AUTH_UNAVAILABLE" });
  return next(err);
});

module.exports = router;
module.exports.normalizeEmail = normalizeEmail;
module.exports.passwordOk = passwordOk;
module.exports.mergeFavorites = mergeFavorites;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.establishSocialSession = establishSocialSession;
