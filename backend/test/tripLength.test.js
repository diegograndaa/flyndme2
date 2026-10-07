const { test } = require("node:test");
const assert = require("node:assert/strict");
const { candidateNights, MAX_CANDIDATES } = require("../services/tripLength");

test("candidateNights: primero más cortos (de más cerca a más lejos), luego uno más largo", () => {
  assert.deepEqual(candidateNights(7), [6, 5, 4, 8]);
});

test("candidateNights: con pocas noches completa hacia arriba", () => {
  assert.deepEqual(candidateNights(2), [1, 3, 4, 5]);
  assert.deepEqual(candidateNights(1), [2, 3, 4, 5]);
});

test("candidateNights: nunca incluye la duración pedida ni noches < 1", () => {
  for (const n of [1, 2, 3, 7, 14]) {
    const c = candidateNights(n);
    assert.equal(c.length, MAX_CANDIDATES);
    assert.ok(!c.includes(n));
    assert.ok(c.every((x) => x >= 1));
  }
});

test("candidateNights: entrada inválida → []", () => {
  assert.deepEqual(candidateNights(0), []);
  assert.deepEqual(candidateNights(-3), []);
  assert.deepEqual(candidateNights("x"), []);
});
