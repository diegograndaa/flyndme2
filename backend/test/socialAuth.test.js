// Verificación de Google / Apple / Facebook y enlace con la cuenta. Sin red:
// las respuestas de los proveedores se inyectan.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { verifyRs256Jwt, verifySocial } = require("../services/socialAuth");
const { establishSocialSession } = require("../routes/auth");

function jsonRes(body, ok = true) {
  return { ok, async json() { return body; } };
}

test("un JWT de Apple con otra audiencia, caducado o mal firmado no entra", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "kid-1";
  const sign = (payload, kid = "kid-1") => {
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url");
    return `${h}.${p}.${sig}`;
  };
  const now = 1_700_000_000_000;
  const nonce = "nonce-de-prueba";
  const nonceHash = crypto.createHash("sha256").update(nonce).digest("hex");
  const good = {
    iss: "https://appleid.apple.com",
    aud: "com.flyndme.web",
    sub: "apple-sub-1",
    email: "Ana@Flynd.Me",
    email_verified: true,
    nonce: nonceHash,
    exp: Math.floor(now / 1000) + 600,
  };
  assert.equal(verifyRs256Jwt(sign(good), [jwk]).sub, "apple-sub-1");
  assert.equal(verifyRs256Jwt(sign(good, "otro"), [jwk]), null);

  const env = { APPLE_CLIENT_ID: "com.flyndme.web" };
  const ok = await verifySocial({
    provider: "apple", credential: sign(good), nonce, env, keys: [jwk], now,
  });
  assert.equal(ok.email, "Ana@Flynd.Me");
  assert.equal(ok.sub, "apple-sub-1");

  await assert.rejects(
    () => verifySocial({
      provider: "apple",
      credential: sign({ ...good, aud: "otra.app" }),
      nonce, env, keys: [jwk], now,
    }),
    (err) => err.code === "AUTH_PROVIDER_FAILED",
  );
  await assert.rejects(
    () => verifySocial({
      provider: "apple",
      credential: sign({ ...good, exp: Math.floor(now / 1000) - 120 }),
      nonce, env, keys: [jwk], now,
    }),
    (err) => err.code === "AUTH_PROVIDER_FAILED",
  );
  await assert.rejects(
    () => verifySocial({ provider: "apple", credential: sign(good), nonce: "otro", env, keys: [jwk], now }),
    (err) => err.code === "AUTH_PROVIDER_FAILED",
  );
});

test("Google solo entra si el token es de este cliente y el correo está verificado", async () => {
  const env = { GOOGLE_CLIENT_ID: "cliente.apps.googleusercontent.com" };
  const fetchImpl = async (url, opts) => {
    assert.ok(String(url).startsWith("https://oauth2.googleapis.com/tokeninfo"));
    assert.ok(opts && opts.signal, "la comprobación de Google tiene un tope de tiempo");
    return jsonRes({
      aud: "cliente.apps.googleusercontent.com",
      sub: "google-sub-1",
      email: "ana@flynd.me",
      email_verified: "true",
      name: "Ana",
    });
  };
  const profile = await verifySocial({ provider: "google", credential: "token-google", env, fetchImpl });
  assert.equal(profile.sub, "google-sub-1");
  assert.equal(profile.name, "Ana");

  const otherApp = async () => jsonRes({ aud: "otra", sub: "x", email: "a@b.co", email_verified: "true" });
  await assert.rejects(
    () => verifySocial({ provider: "google", credential: "t", env, fetchImpl: otherApp }),
    (err) => err.code === "AUTH_PROVIDER_FAILED",
  );
  await assert.rejects(
    () => verifySocial({ provider: "google", credential: "t", env: {}, fetchImpl }),
    (err) => err.code === "AUTH_PROVIDER_OFF",
  );
  await assert.rejects(
    () => verifySocial({
      provider: "google",
      credential: "t",
      env,
      fetchImpl: async () => { throw new Error("timeout"); },
    }),
    (err) => err.code === "AUTH_PROVIDER_FAILED",
  );
});

test("Facebook rechaza un token de otra app y no pide el correo si no lo dan", async () => {
  const env = { FACEBOOK_APP_ID: "111", FACEBOOK_APP_SECRET: "secreto-no-sale" };
  const fetchImpl = async (url) => {
    if (String(url).includes("debug_token")) {
      return jsonRes({ data: { is_valid: true, app_id: "999", user_id: "fb-1" } });
    }
    return jsonRes({ id: "fb-1", email: "ana@flynd.me", name: "Ana" });
  };
  await assert.rejects(
    () => verifySocial({ provider: "facebook", credential: "tok", env, fetchImpl, now: Date.now() }),
    (err) => err.code === "AUTH_PROVIDER_FAILED",
  );

  const okFetch = async (url) => {
    if (String(url).includes("debug_token")) {
      assert.ok(String(url).includes("111%7Csecreto-no-sale") || String(url).includes("111|secreto-no-sale"));
      return jsonRes({ data: { is_valid: true, app_id: "111", user_id: "fb-1", expires_at: 0 } });
    }
    return jsonRes({ id: "fb-1", name: "Ana" });
  };
  await assert.rejects(
    () => verifySocial({ provider: "facebook", credential: "tok", env, fetchImpl: okFetch, now: Date.now() }),
    (err) => err.code === "AUTH_NO_EMAIL",
  );
});

test("el mismo Google crea la cuenta, guarda el destino y al volver no la duplica", async () => {
  const created = await establishSocialSession({
    profile: { provider: "google", sub: "sub-ana", email: "Ana@Social.Me", name: "Ana" },
    remember: true,
    favorites: [{ code: "MAD", city: "Madrid", price: 40, ts: 10 }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.user.email, "ana@social.me");
  assert.equal(created.user.name, "Ana");
  assert.equal(created.favorites[0].code, "MAD");
  assert.equal(created.user.hash, undefined);

  const again = await establishSocialSession({
    profile: { provider: "google", sub: "sub-ana", email: "otro@social.me", name: "Otra" },
    remember: false,
    favorites: [{ code: "BCN", city: "Barcelona", price: 15, ts: 20 }],
  });
  assert.equal(again.status, 200);
  assert.equal(again.user.email, "ana@social.me");
  assert.equal(again.user.name, "Ana");
  assert.deepEqual(again.favorites.map((f) => f.code), ["BCN", "MAD"]);
});

test("GET /providers no enseña el secreto y un proveedor apagado no entra", async () => {
  const express = require("express");
  const prev = {
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  };
  process.env.FACEBOOK_APP_ID = "111";
  process.env.FACEBOOK_APP_SECRET = "canary-secret-no-sale";
  delete process.env.GOOGLE_CLIENT_ID;
  const app = express();
  app.use(express.json());
  app.use("/api/auth", require("../routes/auth"));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const restore = () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/providers`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.equal(body.includes("canary-secret-no-sale"), false);
    const json = JSON.parse(body);
    assert.equal(json.facebook, "111");
    assert.equal(json.google, "");
    assert.equal(json.apple, "");

    delete process.env.FACEBOOK_APP_SECRET;
    const hidden = await fetch(`http://127.0.0.1:${port}/api/auth/providers`);
    const hiddenJson = await hidden.json();
    assert.equal(hiddenJson.facebook, "");

    const off = await fetch(`http://127.0.0.1:${port}/api/auth/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", credential: "token" }),
    });
    assert.equal(off.status, 404);
    assert.equal((await off.json()).code, "AUTH_PROVIDER_OFF");

    await establishSocialSession({
      profile: { provider: "apple", sub: "http-apple", email: "http@social.me", name: "Http" },
      remember: false,
      favorites: [],
    });
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "http@social.me", password: "contrasena-larga" }),
    });
    const loginBody = await login.json();
    assert.equal(login.status, 401);
    assert.equal(loginBody.code, "AUTH_USE_PROVIDER");
    assert.equal(loginBody.provider, "apple");
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});
