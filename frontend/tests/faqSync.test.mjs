// El FAQ de la portada y su copia en JSON-LD (index.html, rich snippets de
// Google) deben decir lo mismo: si una cambia y la otra no, Google enseña
// respuestas que la app ya no da.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const en = JSON.parse(readFileSync(new URL("../src/i18n/en.json", import.meta.url), "utf8"));
const es = JSON.parse(readFileSync(new URL("../src/i18n/es.json", import.meta.url), "utf8"));

const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const faqPage = blocks.find((b) => b["@type"] === "FAQPage");

test("JSON-LD FAQPage = landing.faqs de en.json", () => {
  assert.ok(faqPage, "falta el bloque FAQPage");
  const ld = faqPage.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }));
  assert.deepEqual(ld, en.landing.faqs);
});

test("el FAQ tiene las mismas preguntas en ES y EN", () => {
  assert.equal(es.landing.faqs.length, en.landing.faqs.length);
  for (const f of [...es.landing.faqs, ...en.landing.faqs]) {
    assert.ok(f.q && f.a, "pregunta o respuesta vacía");
  }
});
