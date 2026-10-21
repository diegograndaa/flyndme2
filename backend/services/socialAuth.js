const crypto = require("crypto");

// Comprueba el token que devuelve el botón de Google, Apple o Facebook.
// El secreto de Facebook no sale de aquí. Google y Apple se verifican con
// sus claves públicas (el id de cliente es público). Sin id, el proveedor
// está apagado: no hay botón que finja entrar.

const GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
const APPLE_KEYS = "https://appleid.apple.com/auth/keys";
const APPLE_ISS = "https://appleid.apple.com";
const FACEBOOK_GRAPH = "https://graph.facebook.com";

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function b64urlJson(segment) {
  const pad = segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
  const raw = Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
  return JSON.parse(raw);
}

function b64urlBuf(segment) {
  const pad = segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function audMatches(aud, clientId) {
  if (Array.isArray(aud)) return aud.includes(clientId);
  return aud === clientId;
}

function emailVerified(value) {
  return value === true || value === "true";
}

// Google, Apple y Facebook a veces no contestan. Sin tope, el registro se
// queda colgado hasta que el proxy corta. 8 s bastan para un token válido.
const PROVIDER_TIMEOUT_MS = 8000;

async function providerFetch(fetchImpl, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  if (typeof timer.unref === "function") timer.unref();
  try {
    return await fetchImpl(url, { signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === "AssertionError") throw err;
    throw coded("AUTH_PROVIDER_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

// Firma RS256 contra una JWK del proveedor. Devuelve las claims o null.
function verifyRs256Jwt(token, keys) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  let header;
  try { header = b64urlJson(parts[0]); } catch { return null; }
  if (!header || header.alg !== "RS256" || !header.kid) return null;
  const jwk = (keys || []).find((k) => k && k.kid === header.kid);
  if (!jwk) return null;
  let key;
  try { key = crypto.createPublicKey({ key: jwk, format: "jwk" }); } catch { return null; }
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64urlBuf(parts[2]));
  if (!ok) return null;
  try { return b64urlJson(parts[1]); } catch { return null; }
}

function assertFresh(claims, now) {
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp * 1000 < now - 60_000) throw coded("AUTH_PROVIDER_FAILED");
}

function publicProviderIds(env = process.env) {
  const facebookId = String(env.FACEBOOK_APP_ID || "").trim();
  const facebookSecret = String(env.FACEBOOK_APP_SECRET || "").trim();
  return {
    google: String(env.GOOGLE_CLIENT_ID || "").trim(),
    apple: String(env.APPLE_CLIENT_ID || "").trim(),
    facebook: facebookId && facebookSecret ? facebookId : "",
  };
}

async function verifyGoogle(credential, { clientId, fetchImpl }) {
  if (!clientId) throw coded("AUTH_PROVIDER_OFF");
  if (!credential || String(credential).length > 4096) throw coded("AUTH_PROVIDER_FAILED");
  const res = await providerFetch(fetchImpl, `${GOOGLE_TOKENINFO}?access_token=${encodeURIComponent(credential)}`);
  if (!res.ok) throw coded("AUTH_PROVIDER_FAILED");
  const data = await res.json();
  if (!data || data.aud !== clientId || !data.sub) throw coded("AUTH_PROVIDER_FAILED");
  if (!emailVerified(data.email_verified)) throw coded("AUTH_NO_EMAIL");
  return { provider: "google", sub: String(data.sub), email: data.email, name: data.name || "" };
}

async function verifyApple(credential, { clientId, nonce, fetchImpl, keys, now }) {
  if (!clientId) throw coded("AUTH_PROVIDER_OFF");
  if (!credential || String(credential).length > 8192 || !nonce) throw coded("AUTH_PROVIDER_FAILED");
  const jwks = keys || await (async () => {
    const res = await providerFetch(fetchImpl, APPLE_KEYS);
    if (!res.ok) throw coded("AUTH_PROVIDER_FAILED");
    const body = await res.json();
    return body.keys || [];
  })();
  const claims = verifyRs256Jwt(credential, jwks);
  if (!claims || claims.iss !== APPLE_ISS || !audMatches(claims.aud, clientId) || !claims.sub) {
    throw coded("AUTH_PROVIDER_FAILED");
  }
  assertFresh(claims, now);
  const hashed = crypto.createHash("sha256").update(String(nonce)).digest("hex");
  if (claims.nonce !== hashed) throw coded("AUTH_PROVIDER_FAILED");
  if (!emailVerified(claims.email_verified)) throw coded("AUTH_NO_EMAIL");
  return { provider: "apple", sub: String(claims.sub), email: claims.email, name: "" };
}

async function verifyFacebook(credential, { appId, appSecret, fetchImpl, now }) {
  if (!appId || !appSecret) throw coded("AUTH_PROVIDER_OFF");
  if (!credential || String(credential).length > 4096) throw coded("AUTH_PROVIDER_FAILED");
  const appToken = `${appId}|${appSecret}`;
  const debugRes = await providerFetch(
    fetchImpl,
    `${FACEBOOK_GRAPH}/debug_token?input_token=${encodeURIComponent(credential)}&access_token=${encodeURIComponent(appToken)}`
  );
  if (!debugRes.ok) throw coded("AUTH_PROVIDER_FAILED");
  const debug = await debugRes.json();
  const data = debug && debug.data;
  if (!data || data.is_valid !== true || String(data.app_id) !== String(appId) || !data.user_id) {
    throw coded("AUTH_PROVIDER_FAILED");
  }
  if (data.expires_at && Number(data.expires_at) * 1000 < now) throw coded("AUTH_PROVIDER_FAILED");
  const meRes = await providerFetch(
    fetchImpl,
    `${FACEBOOK_GRAPH}/me?fields=id,name,email&access_token=${encodeURIComponent(credential)}`
  );
  if (!meRes.ok) throw coded("AUTH_PROVIDER_FAILED");
  const me = await meRes.json();
  if (!me || String(me.id) !== String(data.user_id)) throw coded("AUTH_PROVIDER_FAILED");
  if (!me.email) throw coded("AUTH_NO_EMAIL");
  return { provider: "facebook", sub: String(me.id), email: me.email, name: me.name || "" };
}

async function verifySocial({ provider, credential, nonce, env = process.env, fetchImpl = fetch, now = Date.now(), keys } = {}) {
  if (provider === "google") {
    return verifyGoogle(credential, { clientId: publicProviderIds(env).google, fetchImpl });
  }
  if (provider === "apple") {
    return verifyApple(credential, { clientId: publicProviderIds(env).apple, nonce, fetchImpl, keys, now });
  }
  if (provider === "facebook") {
    return verifyFacebook(credential, {
      appId: String(env.FACEBOOK_APP_ID || "").trim(),
      appSecret: String(env.FACEBOOK_APP_SECRET || "").trim(),
      fetchImpl,
      now,
    });
  }
  throw coded("AUTH_PROVIDER");
}

module.exports = {
  verifyRs256Jwt,
  verifySocial,
  publicProviderIds,
};
