// Viajeros que añaden su ciudad a la vez no deben pisarse. Con Upstash cada
// lectura devuelve una copia; aquí se simula con un store que copia y tarda,
// montando el router en un servidor local efímero (sin red externa).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const groups = require("../routes/groups");
const { withGroupLock, _store: store } = groups;

let server;
let BASE;
const original = {};

before(async () => {
  original.get = store.get;
  original.set = store.set;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  store.get = async (id) => { const v = await original.get.call(store, id); await sleep(15); return v ? JSON.parse(JSON.stringify(v)) : v; };
  store.set = async (id, v, o) => { await sleep(15); return original.set.call(store, id, JSON.parse(JSON.stringify(v)), o); };
  const app = express();
  app.use(express.json());
  app.use("/api/groups", groups);
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  store.get = original.get;
  store.set = original.set;
  server?.close();
});

const dep = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
const post = (p, body) => fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("cinco viajeros añadiendo a la vez: no se pierde ninguno", async () => {
  const { id } = await (await post("/api/groups", { departureDate: dep, members: [{ origin: "MAD" }] })).json();
  const codes = ["BCN", "LON", "BER", "PAR", "ROM"];
  const rs = await Promise.all(codes.map((origin) => post(`/api/groups/${id}/members`, { origin })));
  assert.ok(rs.every((r) => r.status === 200));
  const g = await (await fetch(`${BASE}/api/groups/${id}`)).json();
  assert.deepEqual(g.members.map((m) => m.origin).sort(), ["BCN", "BER", "LON", "MAD", "PAR", "ROM"]);
});

test("añadir y quitar a la vez se aplican en orden, sin perder cambios", async () => {
  const { id } = await (await post("/api/groups", { departureDate: dep, members: [{ origin: "MAD" }, { origin: "BCN" }] })).json();
  await Promise.all([
    post(`/api/groups/${id}/members`, { origin: "LIS" }),
    fetch(`${BASE}/api/groups/${id}/members/0`, { method: "DELETE" }),
    post(`/api/groups/${id}/members`, { origin: "OPO" }),
  ]);
  const g = await (await fetch(`${BASE}/api/groups/${id}`)).json();
  assert.equal(g.members.length, 3);
  assert.ok(!g.members.some((m) => m.origin === "MAD"), "el DELETE del índice 0 quitó MAD");
  assert.ok(g.members.some((m) => m.origin === "LIS") && g.members.some((m) => m.origin === "OPO"));
});

test("withGroupLock: serializa por id, no bloquea otros ids y sobrevive a errores", async () => {
  const order = [];
  const slow = (tag, ms) => () => new Promise((r) => setTimeout(() => { order.push(tag); r(tag); }, ms));
  const a1 = withGroupLock("a", slow("a1", 30));
  const a2 = withGroupLock("a", slow("a2", 1));
  const b1 = withGroupLock("b", slow("b1", 5));
  const boom = withGroupLock("a", () => { throw new Error("boom"); });
  const a3 = withGroupLock("a", slow("a3", 1));
  await assert.rejects(boom, /boom/);
  assert.deepEqual(await Promise.all([a1, a2, b1, a3]), ["a1", "a2", "b1", "a3"]);
  assert.deepEqual(order, ["b1", "a1", "a2", "a3"]);
});
