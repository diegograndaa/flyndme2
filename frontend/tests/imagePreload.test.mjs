import { test } from "node:test";
import assert from "node:assert/strict";
import { imagePreloadCount } from "../src/utils/cityImages.js";

test("imagePreloadCount: 3 por defecto o sin Network Information API", () => {
  assert.equal(imagePreloadCount(undefined), 3);
  assert.equal(imagePreloadCount(null), 3);
  assert.equal(imagePreloadCount({ effectiveType: "4g" }), 3);
  assert.equal(imagePreloadCount({ effectiveType: "4g" }, 5), 5);
});

test("imagePreloadCount: nada con ahorro de datos o red lenta", () => {
  assert.equal(imagePreloadCount({ saveData: true, effectiveType: "4g" }), 0);
  assert.equal(imagePreloadCount({ effectiveType: "slow-2g" }), 0);
  assert.equal(imagePreloadCount({ effectiveType: "2g" }), 0);
  assert.equal(imagePreloadCount({ effectiveType: "3g" }), 0);
});
