// Cada archivo que citan manifest.json, sw.js (APP_SHELL) e index.html existe
// en public/ (o es el index.html de la raíz). Un icono que falta solo se nota
// al instalar la PWA o con la app sin conexión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const exists = (ref) => {
  const path = ref.split("?")[0];
  if (path === "/" || path === "/index.html") return existsSync(new URL("index.html", root));
  return existsSync(new URL(`public${path}`, root));
};

test("manifest.json: iconos, capturas y atajos apuntan a archivos que existen", () => {
  const m = JSON.parse(read("public/manifest.json"));
  const refs = [...(m.icons || []), ...(m.screenshots || []), ...(m.shortcuts || []).flatMap((s) => s.icons || [])].map((x) => x.src);
  assert.ok(refs.length >= 5);
  assert.deepEqual(refs.filter((r) => !exists(r)), []);
  assert.ok(m.icons.some((i) => /maskable/.test(i.purpose || "")), "hay icono maskable");
  assert.ok(m.icons.some((i) => i.sizes === "512x512") && m.icons.some((i) => i.sizes === "192x192"));
  for (const s of m.shortcuts || []) assert.ok(s.url.startsWith("/"), `atajo ${s.name} con URL relativa al sitio`);
});

test("sw.js: todo lo que precarga el service worker existe", () => {
  const shell = (read("public/sw.js").match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/) || [])[1] || "";
  const refs = [...shell.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((r) => !r.startsWith("http"));
  assert.ok(refs.length >= 5);
  assert.deepEqual(refs.filter((r) => !exists(r)), []);
});

test("index.html: favicons y manifest enlazados existen", () => {
  const refs = [...read("index.html").matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((x) => x[1]).filter((r) => !r.startsWith("/src/"));
  assert.ok(refs.length >= 4);
  assert.deepEqual(refs.filter((r) => !exists(r)), []);
});
