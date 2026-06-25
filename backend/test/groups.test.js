// Unit tests for the group-planning member sanitizer (pure, no server/network).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { cleanMember } = require("../routes/groups");

test("cleanMember: valid member is normalized", () => {
  const m = cleanMember({ origin: "  MAD ", passengers: 2, name: "  Diego " });
  assert.deepEqual(m, { origin: "MAD", passengers: 2, name: "Diego" });
});

test("cleanMember: missing/blank origin is rejected", () => {
  assert.equal(cleanMember({ passengers: 1 }), null);
  assert.equal(cleanMember({ origin: "   ", passengers: 1 }), null);
  assert.equal(cleanMember(null), null);
  assert.equal(cleanMember("MAD"), null); // not an object
});

test("cleanMember: passengers defaults to 1 and clamps to 1..9", () => {
  assert.equal(cleanMember({ origin: "LON" }).passengers, 1);
  assert.equal(cleanMember({ origin: "LON", passengers: 0 }).passengers, 1);
  assert.equal(cleanMember({ origin: "LON", passengers: -3 }).passengers, 1);
  assert.equal(cleanMember({ origin: "LON", passengers: 99 }).passengers, 9);
  assert.equal(cleanMember({ origin: "LON", passengers: "3" }).passengers, 3);
  assert.equal(cleanMember({ origin: "LON", passengers: 2.9 }).passengers, 2); // floored
  assert.equal(cleanMember({ origin: "LON", passengers: "abc" }).passengers, 1); // NaN -> 1
});

test("cleanMember: name defaults to empty and is truncated", () => {
  assert.equal(cleanMember({ origin: "BER" }).name, "");
  assert.equal(cleanMember({ origin: "BER", name: "x".repeat(60) }).name.length, 40);
});

test("cleanMember: origin is truncated to 60 chars", () => {
  assert.equal(cleanMember({ origin: "y".repeat(120) }).origin.length, 60);
});
