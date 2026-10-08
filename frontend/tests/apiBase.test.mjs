import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiBase, PROD_API_BASE, DEV_API_BASE } from "../src/utils/apiBase.js";

test("apiBase: VITE_API_BASE_URL manda y pierde las barras finales", () => {
  assert.equal(resolveApiBase({ VITE_API_BASE_URL: "http://localhost:5000/", PROD: true }), "http://localhost:5000");
  assert.equal(resolveApiBase({ VITE_API_BASE_URL: " https://api.example.com// " }), "https://api.example.com");
});

test("apiBase: sin variable, producción usa el backend de producción", () => {
  assert.equal(resolveApiBase({ PROD: true }), PROD_API_BASE);
});

test("apiBase: sin variable, desarrollo y tests usan el backend local (nunca producción)", () => {
  assert.equal(resolveApiBase({ PROD: false }), DEV_API_BASE);
  assert.equal(resolveApiBase({}), DEV_API_BASE);
  assert.equal(resolveApiBase(undefined), DEV_API_BASE);
  assert.notEqual(resolveApiBase({ DEV: true }), PROD_API_BASE);
});
