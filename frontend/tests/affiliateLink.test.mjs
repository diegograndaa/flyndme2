import { test } from "node:test";
import assert from "node:assert/strict";
import { affiliateLinkForAdults } from "../src/utils/affiliateLink.js";

test("Reservar solo acepta un enlace https de Aviasales", () => {
  assert.equal(affiliateLinkForAdults(""), "");
  assert.equal(affiliateLinkForAdults("https://www.wizzair.com/book"), "");
  assert.equal(affiliateLinkForAdults("http://www.aviasales.com/search/MAD1510LIS1"), "");
  const one = affiliateLinkForAdults("https://www.aviasales.com/search/MAD1510LIS1?marker=738121");
  assert.equal(one, "https://www.aviasales.com/search/MAD1510LIS1?marker=738121");
});

test("si viajan varios, el enlace pide esos adultos y conserva el marker", () => {
  const link = affiliateLinkForAdults("https://www.aviasales.com/search/MAD1510LIS20101?marker=738121", 3);
  assert.equal(link, "https://www.aviasales.com/search/MAD1510LIS20103?marker=738121");
  const capped = affiliateLinkForAdults("https://www.aviasales.com/search/MAD1510LIS1", 12);
  assert.equal(capped, "https://www.aviasales.com/search/MAD1510LIS9");
});
