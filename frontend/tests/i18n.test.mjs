// Paridad de claves entre en.json y es.json: cada clave debe existir en ambos
// idiomas y con el mismo tipo (string/array/objeto). Evita que una traducción
// olvidada aparezca como clave cruda en la UI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(readFileSync(join(here, "../src/i18n/en.json"), "utf8"));
const es = JSON.parse(readFileSync(join(here, "../src/i18n/es.json"), "utf8"));

function flatten(obj, prefix = "") {
  const out = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of flatten(v, key)) out.set(k2, v2);
    } else {
      out.set(key, Array.isArray(v) ? "array" : typeof v);
    }
  }
  return out;
}

const enKeys = flatten(en);
const esKeys = flatten(es);

test("i18n: es.json tiene todas las claves de en.json", () => {
  const missing = [...enKeys.keys()].filter((k) => !esKeys.has(k));
  assert.deepEqual(missing, [], `faltan en es.json: ${missing.slice(0, 10).join(", ")}`);
});

test("i18n: en.json tiene todas las claves de es.json", () => {
  const missing = [...esKeys.keys()].filter((k) => !enKeys.has(k));
  assert.deepEqual(missing, [], `faltan en en.json: ${missing.slice(0, 10).join(", ")}`);
});

test("i18n: tipos coinciden entre idiomas (string vs array)", () => {
  const mismatched = [...enKeys.entries()]
    .filter(([k, t]) => esKeys.has(k) && esKeys.get(k) !== t)
    .map(([k]) => k);
  assert.deepEqual(mismatched, [], `tipos distintos: ${mismatched.slice(0, 10).join(", ")}`);
});

test("i18n: las interpolaciones {{var}} coinciden entre idiomas", () => {
  const vars = (s) => (typeof s === "string" ? [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort() : []);
  function collect(obj, prefix = "") {
    let out = [];
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) out = out.concat(collect(v, key));
      else if (typeof v === "string") out.push([key, vars(v)]);
    }
    return out;
  }
  const enVars = new Map(collect(en));
  for (const [key, esV] of collect(es)) {
    const enV = enVars.get(key) || [];
    assert.deepEqual(esV, enV, `interpolaciones distintas en "${key}": en=[${enV}] es=[${esV}]`);
  }
});
