// Cada cuenta se queda con sus listas. La copia del navegador no salta de una persona a otra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listsForAccount, listsOnLogout } from "../src/utils/personal.js";

const mad = { code: "MAD", city: "Madrid", price: 10, ts: 1 };
const bcn = { code: "BCN", city: "Barcelona", price: 20, ts: 5 };
const lis = { code: "LIS", city: "Lisboa", price: 30, ts: 9 };
const recentMad = { origins: ["MAD"], passengers: [1], departureDate: "2026-12-01", tripType: "oneway", ts: 1 };
const watchBcn = { id: "w-bcn", destination: "BCN", savedTotalEUR: 40, createdAt: 3 };

test("la primera entrada adopta lo del invitado si la cuenta está vacía", () => {
  const decided = listsForAccount("ana@flynd.me", { favorites: [], recent: [], watches: [] }, {
    favorites: [mad], recent: [recentMad], watches: [],
  }, "");
  assert.equal(decided.favorites[0].code, "MAD");
  assert.equal(decided.recent.length, 1);
  assert.equal(decided.stashGuest, true);
  assert.equal(decided.upload.favorites[0].code, "MAD");
  assert.equal(decided.upload.recent.length, 1);
  assert.equal(decided.upload.watches, undefined);
});

test("si la cuenta ya tiene destinos, no se le cuelan los del invitado", () => {
  const decided = listsForAccount("ana@flynd.me", {
    favorites: [bcn], recent: [], watches: [watchBcn],
  }, {
    favorites: [mad], recent: [recentMad], watches: [],
  }, "guest");
  assert.equal(decided.favorites[0].code, "BCN");
  assert.equal(decided.upload.favorites, undefined);
  assert.equal(decided.recent[0].origins[0], "MAD");
  assert.ok(decided.upload.recent);
  assert.equal(decided.watches[0].id, "w-bcn");
  assert.equal(decided.stashGuest, true);
});

test("la copia de otra cuenta no se adopta ni se guarda como invitado", () => {
  const decided = listsForAccount("luis@flynd.me", {
    favorites: [bcn], recent: [], watches: [],
  }, {
    favorites: [{ code: "PAR", city: "Paris", price: 1, ts: 9 }], recent: [], watches: [],
  }, "ana@flynd.me");
  assert.equal(decided.favorites[0].code, "BCN");
  assert.equal(decided.stashGuest, false);
  assert.deepEqual(decided.upload, {});
});

test("la misma cuenta une un destino añadido sin red y no borra el precio", () => {
  const decided = listsForAccount("ana@flynd.me", {
    favorites: [{ code: "MAD", city: "Madrid", price: 40, ts: 10 }], recent: [], watches: [],
  }, {
    favorites: [{ code: "MAD", city: "Madrid", price: null, ts: 20 }, lis], recent: [], watches: [],
  }, "ana@flynd.me");
  assert.deepEqual(decided.favorites.map((f) => f.code), ["MAD", "LIS"]);
  assert.equal(decided.favorites.find((f) => f.code === "MAD").price, 40);
  assert.equal(decided.stashGuest, false);
  assert.equal(decided.upload.favorites.length, 2);
});

test("al salir vuelve la copia del invitado, o nada si no había", () => {
  const back = listsOnLogout({ favorites: [mad], recent: [], watches: [] });
  assert.equal(back.owner, "guest");
  assert.equal(back.favorites[0].code, "MAD");
  const empty = listsOnLogout(null);
  assert.equal(empty.favorites.length, 0);
  assert.equal(empty.recent.length, 0);
  assert.equal(empty.watches.length, 0);
});
