// Ciclo de vida de la cuenta: recuperar y cambiar la contraseña, confirmar el
// correo, descargar los datos, borrar la cuenta y el bloqueo por intentos.
// Sin red: el correo se captura en memoria.
process.env.BREVO_API_KEY = "test-key";
process.env.AUTH_ATTEMPT_LIMIT = "500";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const saleMail = require("../services/saleMail");

let server;
let base;
const outbox = [];

before(async () => {
  saleMail.__test.setTransport(async (mail) => { outbox.push(mail); return { status: 201 }; });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", require("../routes/auth"));
  server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(() => {
  saleMail.__test.reset();
  server.close();
});

async function call(path, { method = "POST", body, token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let seq = 0;
const fresh = () => `persona-${Date.now()}-${++seq}@flynd.me`;
const linkToken = (mail, param) => new RegExp(`[?&]${param}=([A-Za-z0-9_-]+)`).exec(mail.text)[1];
const mailsTo = (email) => outbox.filter((m) => m.to === email);

test("recuperar la contraseña: enlace de un solo uso que cierra las sesiones anteriores", async () => {
  const email = fresh();
  const created = await call("/register", { body: { email, password: "vieja-clave-1" } });
  assert.equal(created.status, 201);
  const oldToken = created.body.token;

  const asked = await call("/forgot", { body: { email } });
  assert.deepEqual(asked, { status: 200, body: { ok: true } });
  const mail = mailsTo(email).find((m) => m.text.includes("?reset="));
  assert.ok(mail, "sale un correo con el enlace");
  assert.ok(mail.text.includes("https://flyndme.com/?reset="));
  const token = linkToken(mail, "reset");

  assert.equal((await call("/reset", { body: { token, password: "corta" } })).body.code, "AUTH_WEAK_PASSWORD");
  const done = await call("/reset", { body: { token, password: "nueva-clave-2" } });
  assert.equal(done.status, 200);
  assert.equal(done.body.user.emailVerified, true);
  assert.equal((await call("/me", { method: "GET", token: done.body.token })).status, 200);
  assert.equal((await call("/me", { method: "GET", token: oldToken })).status, 401, "la sesión anterior ya no vale");

  assert.equal((await call("/reset", { body: { token, password: "otra-clave-33" } })).body.code, "AUTH_LINK_EXPIRED");
  assert.equal((await call("/login", { body: { email, password: "vieja-clave-1" } })).status, 401);
  assert.equal((await call("/login", { body: { email, password: "nueva-clave-2" } })).status, 200);
});

test("recuperar: no dice si el correo existe, no acepta tokens inventados y limita los correos", async () => {
  const before = outbox.length;
  const ghost = await call("/forgot", { body: { email: fresh() } });
  assert.deepEqual(ghost, { status: 200, body: { ok: true } });
  assert.equal(outbox.length, before, "sin cuenta no sale correo");
  assert.equal((await call("/forgot", { body: { email: "no-es-correo" } })).body.code, "AUTH_BAD_EMAIL");
  assert.equal((await call("/reset", { body: { token: "x".repeat(43), password: "nueva-clave-2" } })).body.code, "AUTH_LINK_EXPIRED");

  const email = fresh();
  await call("/register", { body: { email, password: "vieja-clave-1" } });
  for (let i = 0; i < 6; i++) await call("/forgot", { body: { email } });
  // 3 correos por hora y cuenta, contando el de confirmación del registro.
  assert.equal(mailsTo(email).length, 3);
});

test("un token de confirmar el correo no sirve para cambiar la contraseña", async () => {
  const email = fresh();
  const created = await call("/register", { body: { email, password: "vieja-clave-1", lang: "en" } });
  assert.equal(created.body.user.emailVerified, false);
  await new Promise((r) => setTimeout(r, 30));
  const mail = mailsTo(email).find((m) => m.text.includes("?verify="));
  assert.ok(mail, "el registro manda el enlace de confirmación");
  assert.equal(mail.subject, "FlyndMe — confirm your email");
  const token = linkToken(mail, "verify");
  assert.equal((await call("/reset", { body: { token, password: "nueva-clave-2" } })).body.code, "AUTH_LINK_EXPIRED");
  // El intento anterior no lo gasta: sigue valiendo para lo suyo, una vez.
  assert.equal((await call("/verify", { body: { token } })).status, 200);
  assert.equal((await call("/verify", { body: { token } })).body.code, "AUTH_LINK_EXPIRED");
  const me = await call("/me", { method: "GET", token: created.body.token });
  assert.equal(me.body.user.emailVerified, true);
  assert.equal(me.body.user.hasPassword, true);
});

test("cambiar la contraseña pide la actual y cierra las demás sesiones", async () => {
  const email = fresh();
  const a = await call("/register", { body: { email, password: "vieja-clave-1" } });
  const b = await call("/login", { body: { email, password: "vieja-clave-1" } });
  assert.equal((await call("/password", { body: { current: "no-es-esta-1", password: "nueva-clave-2" }, token: a.body.token })).status, 401);
  assert.equal((await call("/password", { body: { current: "vieja-clave-1", password: "corta" }, token: a.body.token })).body.code, "AUTH_WEAK_PASSWORD");
  assert.equal((await call("/password", { body: { current: "vieja-clave-1", password: "nueva-clave-2" } })).status, 401);
  await new Promise((r) => setTimeout(r, 5));
  const changed = await call("/password", { body: { current: "vieja-clave-1", password: "nueva-clave-2" }, token: a.body.token });
  assert.equal(changed.status, 200);
  assert.equal((await call("/me", { method: "GET", token: changed.body.token })).status, 200);
  assert.equal((await call("/me", { method: "GET", token: b.body.token })).status, 401);
  assert.equal((await call("/me", { method: "GET", token: a.body.token })).status, 401);
  assert.equal((await call("/login", { body: { email, password: "nueva-clave-2" } })).status, 200);
});

test("descargar los datos no incluye la huella de la contraseña", async () => {
  const email = fresh();
  const created = await call("/register", {
    body: { email, password: "vieja-clave-1", name: "Ana", favorites: [{ code: "BCN", city: "Barcelona", price: 40, ts: 1 }] },
  });
  assert.equal((await call("/export", { method: "GET" })).status, 401);
  const out = await call("/export", { method: "GET", token: created.body.token });
  assert.equal(out.status, 200);
  assert.equal(out.body.account.email, email);
  assert.equal(out.body.account.name, "Ana");
  assert.equal(out.body.favorites[0].code, "BCN");
  const raw = JSON.stringify(out.body);
  assert.equal(/"hash"|"salt"/.test(raw), false);
});

test("borrar la cuenta pide la contraseña, y volver a registrarla no revive sesiones viejas", async () => {
  const email = fresh();
  const created = await call("/register", { body: { email, password: "vieja-clave-1" } });
  const other = await call("/login", { body: { email, password: "vieja-clave-1" } });
  assert.equal((await call("/me", { method: "DELETE", body: { password: "no-es-esta-1" }, token: created.body.token })).status, 401);
  assert.equal((await call("/me", { method: "DELETE", body: {} })).status, 401);
  const gone = await call("/me", { method: "DELETE", body: { password: "vieja-clave-1" }, token: created.body.token });
  assert.deepEqual(gone, { status: 200, body: { ok: true } });
  assert.equal((await call("/me", { method: "GET", token: created.body.token })).status, 401);
  assert.equal((await call("/login", { body: { email, password: "vieja-clave-1" } })).status, 401);

  await new Promise((r) => setTimeout(r, 5));
  const again = await call("/register", { body: { email, password: "otra-persona-9" } });
  assert.equal(again.status, 201);
  assert.equal((await call("/me", { method: "GET", token: other.body.token })).status, 401, "la sesión de la cuenta borrada no entra en la nueva");
  assert.equal((await call("/me", { method: "GET", token: again.body.token })).status, 200);
});

test("diez contraseñas falladas bloquean esa cuenta una hora, venga de donde venga", async () => {
  const email = fresh();
  await call("/register", { body: { email, password: "vieja-clave-1" } });
  for (let i = 0; i < 10; i++) {
    assert.equal((await call("/login", { body: { email, password: `fallo-numero-${i}` } })).status, 401);
  }
  const locked = await call("/login", { body: { email, password: "vieja-clave-1" } });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, "AUTH_LOCKED");
  // El enlace del correo sigue siendo la salida, y levanta el bloqueo.
  await call("/forgot", { body: { email } });
  const token = linkToken(mailsTo(email).find((m) => m.text.includes("?reset=")), "reset");
  assert.equal((await call("/reset", { body: { token, password: "nueva-clave-2" } })).status, 200);
  assert.equal((await call("/login", { body: { email, password: "nueva-clave-2" } })).status, 200);
});

test("sin correo configurado, recuperar lo dice en vez de fingir que lo envía", async () => {
  const prev = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  try {
    const res = await call("/forgot", { body: { email: fresh() } });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "AUTH_MAIL_OFF");
  } finally {
    process.env.BREVO_API_KEY = prev;
  }
});
