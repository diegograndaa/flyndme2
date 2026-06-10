const fs = require("fs");
let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}

const jsx = fs.readFileSync("frontend/src/App.jsx", "utf8");
const css = fs.readFileSync("frontend/src/App.css", "utf8");
const en = JSON.parse(fs.readFileSync("frontend/src/i18n/en.json", "utf8"));
const es = JSON.parse(fs.readFileSync("frontend/src/i18n/es.json", "utf8"));

console.log("\n=== Round 35 Verification ===\n");

// Component definitions
console.log("-- Component Definitions --");
const comps = ["DestFoodCulture", "WifiAvailabilityHint", "PricePerDayCalc", "EarlyMorningWarning", "DestLanguagePhrase"];
comps.forEach(c => check("function " + c, jsx.includes("function " + c + "(")));

// Component wiring
console.log("\n-- Component Wiring --");
comps.forEach(c => check("<" + c, jsx.includes("<" + c)));

// CSS classes
console.log("\n-- CSS Classes --");
const cssClasses = [".fm-food", ".fm-wifi", ".fm-perday", ".fm-earlyam", ".fm-phrase"];
cssClasses.forEach(c => check(c, css.includes(c + " {")));

// Dark mode
console.log("\n-- Dark Mode CSS --");
cssClasses.forEach(c => check("dark " + c, css.includes('[data-theme="dark"] ' + c)));

// i18n EN keys
console.log("\n-- i18n EN Keys --");
const i18nKeys = ["food", "wifi", "perDay", "earlyAm", "phrase"];
i18nKeys.forEach(k => check("en." + k, en[k] && typeof en[k] === "object"));

// i18n ES keys
console.log("\n-- i18n ES Keys --");
i18nKeys.forEach(k => check("es." + k, es[k] && typeof es[k] === "object"));

// Print styles
console.log("\n-- Print Styles --");
check("food hidden in print", css.includes(".fm-food") && css.includes("@media print"));
check("fm-perday in printable", css.includes(".fm-perday {") && css.includes("break-inside: avoid"));

// Responsive
console.log("\n-- Responsive --");
cssClasses.forEach(c => check("responsive " + c, css.includes(c + " { padding:")));

// JSON validity
console.log("\n-- JSON Validity --");
try { JSON.parse(fs.readFileSync("frontend/src/i18n/en.json","utf8")); check("en.json valid", true); } catch(e) { check("en.json valid", false); }
try { JSON.parse(fs.readFileSync("frontend/src/i18n/es.json","utf8")); check("es.json valid", true); } catch(e) { check("es.json valid", false); }

console.log("\n=== Results: " + pass + " passed, " + fail + " failed ===\n");
process.exit(fail > 0 ? 1 : 0);
