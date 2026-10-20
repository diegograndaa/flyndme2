// La política de privacidad es una página pública: Facebook y Google tienen
// que poder abrirla sin ejecutar la app. El texto describe lo que el código
// hace hoy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../public/privacidad/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("privacidad: es una página pública con contacto y sin guardar la tarjeta", () => {
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(page.includes('href="https://flyndme.com/privacidad/"'));
  assert.ok(page.includes("mailto:hello@flyndme.com"));
  assert.ok(page.includes("FlyndMe también los guarda 14 días"));
  assert.ok(page.includes("no pasa por los servidores de FlyndMe"));
  assert.ok(page.includes("No hay un botón para borrar la cuenta"));
  assert.ok(page.includes("does not pass through FlyndMe"));
  assert.ok(page.includes("No vendemos tus datos"));
  assert.ok(app.includes('href="/privacidad/"'));
});
