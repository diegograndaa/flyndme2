import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadText } from "../src/utils/download.js";

function fakes() {
  const log = [];
  const body = { children: [], appendChild(n) { this.children.push(n); log.push("append"); } };
  const doc = {
    body,
    createElement: () => ({ style: {}, click() { log.push(`click:${this.download}`); }, remove() { body.children = body.children.filter((x) => x !== this); log.push("remove"); } }),
  };
  let blob = null;
  const urlApi = { createObjectURL: (b) => { blob = b; return "blob:1"; }, revokeObjectURL: (u) => log.push(`revoke:${u}`) };
  const pending = [];
  return { doc, urlApi, log, later: (fn) => pending.push(fn), flush: () => pending.forEach((f) => f()), getBlob: () => blob };
}

test("downloadText: BOM UTF-8 para Excel y contenido intacto", async () => {
  const f = fakes();
  downloadText("a.csv", '"Málaga","Zúrich"', f);
  const bytes = new Uint8Array(await f.getBlob().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM al principio");
  assert.equal(new TextDecoder().decode(bytes.slice(3)), '"Málaga","Zúrich"');
  assert.match(f.getBlob().type, /text\/csv/);
});

test("downloadText: el enlace se añade, se pulsa, se quita y la URL se revoca DESPUÉS", () => {
  const f = fakes();
  assert.equal(downloadText("r.csv", "x", f), true);
  assert.deepEqual(f.log, ["append", "click:r.csv", "remove"], "aún sin revocar");
  f.flush();
  assert.deepEqual(f.log.at(-1), "revoke:blob:1");
});

test("downloadText: sin DOM (SSR) no hace nada y no lanza", () => {
  assert.equal(downloadText("a.csv", "x", { doc: undefined }), false);
});

test("downloadText: sin BOM si se pide", async () => {
  const f = fakes();
  downloadText("a.txt", "hola", { ...f, bom: false, mime: "text/plain" });
  assert.equal(await f.getBlob().text(), "hola");
});
