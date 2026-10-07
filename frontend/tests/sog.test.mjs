// Función Edge api/sog.js: meta-HTML de las tarjetas de compartir/grupo. Todo
// lo que llega por query se ESCAPA, y un id malformado redirige a la portada
// (nunca a otro dominio). Node 22 trae Request/Response, así que se prueba tal cual.
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/sog.js";

const call = (qs) => handler(new Request(`https://flyndme2.vercel.app/api/sog?${qs}`));

test("sog: los valores de la query salen escapados en el HTML", async () => {
  const evil = encodeURIComponent('"><script>alert(1)</script>');
  const res = await call(`id=abc123&dest=${evil}&from=${evil}&pp=${evil}&total=${evil}&n=3`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes("<script>alert"), "sin etiquetas inyectadas");
  assert.ok(!/content="[^"]*"><script/.test(html), "sin romper atributos");
  assert.ok(html.includes("&lt;script&gt;"), "el texto aparece escapado");
});

test("sog: id malformado → 302 a la portada del MISMO origen", async () => {
  for (const id of ["", "a b", "x".repeat(30), "../../evil", "https://evil.com"]) {
    const res = await call(`id=${encodeURIComponent(id)}&dest=PAR`);
    assert.equal(res.status, 302, `id=${id}`);
    assert.equal(new URL(res.headers.get("location")).origin, "https://flyndme2.vercel.app");
  }
});

test("sog: legs solo se reenvía a la imagen si viene bien formado", async () => {
  const ok = await (await call("id=abc123&dest=Par&legs=MAD:135,LON:300")).text();
  assert.match(ok, /legs=MAD%3A135%2CLON%3A300/);
  const bad = await (await call(`id=abc123&dest=Par&legs=${encodeURIComponent("MAD:1<x>")}`)).text();
  assert.ok(!/legs=/.test(bad));
});

test("sog: modo grupo enlaza a ?group= y el meta-refresh apunta al mismo origen", async () => {
  const html = await (await call("mode=group&id=grp_01&n=2&from=Madrid")).text();
  assert.match(html, /url=https:\/\/flyndme2\.vercel\.app\/\?group=grp_01/);
  assert.match(html, /2 cities added/);
});
