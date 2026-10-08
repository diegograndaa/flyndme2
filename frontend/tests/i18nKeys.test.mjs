// Cada clave que el código pide con t("…") existe en EN y en ES. Si falta, en
// pantalla sale la propia clave (p. ej. «share.copyError»). Las claves que se
// construyen en tiempo de ejecución (errors.codes.${code}) no entran aquí.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(n) ? [p] : []; });
const es = JSON.parse(readFileSync(join(SRC, "i18n/es.json"), "utf8"));
const en = JSON.parse(readFileSync(join(SRC, "i18n/en.json"), "utf8"));
const get = (o, k) => k.split(".").reduce((a, p) => (a == null ? a : a[p]), o);

test("i18n: toda clave literal usada con t() existe en los dos idiomas", () => {
  const used = new Map();
  for (const f of walk(SRC)) {
    const s = readFileSync(f, "utf8");
    // t("a.b") y también t(cond ? "a.b" : "c.d")
    for (const m of s.matchAll(/\bt\(\s*["']([a-zA-Z][\w.]*)["']/g)) used.set(m[1], f);
    for (const m of s.matchAll(/\bt\([^()]*?\?\s*["']([a-z][a-zA-Z]+\.[\w.]+)["']\s*:\s*["']([a-z][a-zA-Z]+\.[\w.]+)["']/g)) { used.set(m[1], f); used.set(m[2], f); }
  }
  assert.ok(used.size > 200, `claves encontradas: ${used.size}`);
  const missing = [...used].filter(([k]) => get(es, k) === undefined || get(en, k) === undefined)
    .map(([k, f]) => `${k} (${f.replace(SRC, "src/")})`);
  assert.deepEqual(missing, []);
});
