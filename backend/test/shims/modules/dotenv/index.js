// Minimal dotenv shim (test-only). Parses KEY=VALUE lines; never overrides
// variables already present in process.env (same semantics as real dotenv).
const fs = require("fs");
function config(options = {}) {
  const path = options.path || ".env";
  try {
    const src = fs.readFileSync(path, "utf8");
    for (const line of src.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m) continue;
      let v = (m[2] || "").trim().replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    return { parsed: {} };
  } catch (e) {
    return { error: e };
  }
}
module.exports = { config };
