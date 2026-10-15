import { test } from "node:test";
import assert from "node:assert/strict";
import { centsOf, quoteAddsUp, checkoutPath } from "../src/utils/saleCheckout.js";

const quote = {
  fare: "59.74",
  commission: "2.99",
  cardFee: "1.87",
  charge: "64.60",
  legs: [
    { fare: "30.00", commission: "1.50", cardFee: "0.94", charge: "32.44" },
    { fare: "29.74", commission: "1.49", cardFee: "0.93", charge: "32.16" },
  ],
};

test("saleCheckout: el desglose de los dos suma el cobro", () => {
  assert.equal(quoteAddsUp(quote), true);
  assert.equal(centsOf(quote.charge), 6460);
  assert.equal(checkoutPath("abcDEF1234567890"), "/?caja=abcDEF1234567890");
});

test("saleCheckout: un céntimo de diferencia no se cobra", () => {
  assert.equal(quoteAddsUp({ ...quote, charge: "64.61" }), false);
  assert.equal(quoteAddsUp({ ...quote, legs: [{ ...quote.legs[0], charge: "32.45" }, quote.legs[1]] }), false);
  assert.equal(quoteAddsUp({ ...quote, legs: [] }), false);
});
