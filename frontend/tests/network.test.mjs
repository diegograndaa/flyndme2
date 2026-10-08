import { test } from "node:test";
import assert from "node:assert/strict";
import { isOffline } from "../src/utils/network.js";

test("isOffline: solo true cuando el navegador dice que no hay red", () => {
  assert.equal(isOffline({ onLine: false }), true);
  assert.equal(isOffline({ onLine: true }), false);
  assert.equal(isOffline({}), false);
  assert.equal(isOffline(undefined), false);
  assert.equal(isOffline(null), false);
});
