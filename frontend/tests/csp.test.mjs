// La CSP de vercel.json autoriza el script inline anti-flash de index.html por
// su hash: si alguien edita ese script sin actualizar el hash, el tema dejaría
// de aplicarse antes de pintar (y, con la CSP aplicada, el script se bloquearía).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));

function cspValue() {
  for (const rule of vercel.headers || []) {
    for (const h of rule.headers || []) {
      if (/^content-security-policy(-report-only)?$/i.test(h.key)) return h.value;
    }
  }
  return null;
}

test("CSP: cada script inline ejecutable de index.html está autorizado por hash", () => {
  const csp = cspValue();
  assert.ok(csp, "vercel.json define una CSP");
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) || "";
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(inline.length >= 1, "index.html tiene el script anti-flash");
  for (const body of inline) {
    const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
    assert.ok(scriptSrc.includes(hash), `falta ${hash} en script-src`);
  }
});

test("CSP: sin 'unsafe-inline' ni 'unsafe-eval' en script-src", () => {
  const scriptSrc = cspValue().split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
  assert.ok(!/unsafe-(inline|eval)/.test(scriptSrc), scriptSrc);
});

// La política completa sigue en modo informe hasta probarla con los accesos de
// Google, Apple y Facebook. Lo que no puede romper nada ya se aplica.
test("CSP: nadie puede enmarcar la web (política aplicada, no solo informe)", () => {
  const headers = (vercel.headers || []).flatMap((rule) => rule.headers || []);
  const enforced = headers.find((h) => /^content-security-policy$/i.test(h.key));
  assert.ok(enforced, "hay una Content-Security-Policy aplicada");
  assert.match(enforced.value, /frame-ancestors 'none'/);
  assert.match(enforced.value, /object-src 'none'/);
  assert.match(enforced.value, /base-uri 'self'/);
  const xfo = headers.find((h) => /^x-frame-options$/i.test(h.key));
  assert.equal(xfo && xfo.value, "DENY");
});

test("CSP: las fuentes se sirven desde el propio sitio", () => {
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(JSON.stringify(vercel)));
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html));
  assert.match(html, /href="\/fonts\/plex\.css"/);
});
