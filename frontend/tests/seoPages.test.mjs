// Regresión de las páginas SEO estáticas (public/quedar, public/meet). Se
// regeneran con `npm run seo:build`; este test comprueba lo que no puede
// romperse al regenerarlas. Solo lee archivos: sin red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const SITE = "https://flyndme2.vercel.app";
const pub = new URL("../public/", import.meta.url);
const pages = {};
for (const dir of ["quedar", "meet"]) {
  for (const slug of readdirSync(new URL(dir, pub))) {
    pages[`/${dir}/${slug}/`] = readFileSync(new URL(`${dir}/${slug}/index.html`, pub), "utf8");
  }
}
const entries = Object.entries(pages);
const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();

test("seo: hay páginas en los dos idiomas y el mismo número en cada uno", () => {
  const es = entries.filter(([p]) => p.startsWith("/quedar/")).length;
  const en = entries.filter(([p]) => p.startsWith("/meet/")).length;
  assert.ok(es >= 10);
  assert.equal(es, en);
});

test("seo: lang, canonical, un solo h1, title y description", () => {
  for (const [p, h] of entries) {
    assert.match(h, new RegExp(`<html lang="${p.startsWith("/quedar/") ? "es" : "en"}"`), p);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE}${p}"`), `${p}: canonical`);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${p}: h1`);
    assert.match(h, /<title>[^<]{10,}<\/title>/, `${p}: title`);
    assert.match(h, /<meta name="description" content="[^"]{50,}"/, `${p}: description`);
  }
});

test("seo: hreflang recíproco ES ↔ EN y x-default", () => {
  const alts = (h) => Object.fromEntries([...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  for (const [p, h] of entries) {
    const lang = p.startsWith("/quedar/") ? "es" : "en";
    const other = lang === "es" ? "en" : "es";
    const a = alts(h);
    assert.equal(a[lang], SITE + p, `${p}: hreflang propio`);
    assert.ok(a["x-default"], `${p}: x-default`);
    const op = (a[other] || "").replace(SITE, "");
    assert.ok(pages[op], `${p}: hreflang ${other} apunta a una página que no existe (${op})`);
    assert.equal(alts(pages[op])[lang], SITE + p, `${p}: no recíproco desde ${op}`);
  }
});

test("seo: los enlaces internos /quedar y /meet existen y los recursos /… también", () => {
  for (const [p, h] of entries) {
    for (const m of h.matchAll(/href="(\/(?:quedar|meet)\/[^"]+)"/g)) assert.ok(pages[m[1]], `${p}: enlace roto ${m[1]}`);
    for (const m of h.matchAll(/(?:href|src)="(\/[^"/][^"]*\.(?:svg|png|ico|webmanifest|json))(?:\?[^"]*)?"/g)) assert.ok(existsSync(new URL(m[1].slice(1), pub)), `${p}: recurso ${m[1]}`);
  }
});

test("seo: JSON-LD válido; las preguntas del FAQPage son las que se ven", () => {
  for (const [p, h] of entries) {
    const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const faq = ld.find((j) => j["@type"] === "FAQPage");
    const crumbs = ld.find((j) => j["@type"] === "BreadcrumbList");
    assert.ok(faq && crumbs, `${p}: FAQPage y BreadcrumbList`);
    const visible = [...h.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => decode(m[1]));
    assert.deepEqual(visible, faq.mainEntity.map((q) => q.name), `${p}: FAQ`);
    assert.equal(crumbs.itemListElement.at(-1).item, SITE + p, `${p}: breadcrumb`);
  }
});

test("seo: si hay tabla de precios, va etiquetada como estimación y con fecha de viaje", () => {
  for (const [p, h] of entries) {
    if (!h.includes('class="est-table')) continue;
    assert.match(h, p.startsWith("/quedar/") ? /Estimación en caché/ : /Cached estimate/i, `${p}: etiqueta de estimación`);
    assert.match(h, p.startsWith("/quedar/") ? /Precios para viajar alrededor del/ : /Prices for travel around/i, `${p}: fecha de viaje`);
  }
});
