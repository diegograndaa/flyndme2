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

console.log("\n=== Simplification Verification ===\n");

// 1. Core components still present in results view
console.log("-- Core components visible --");
check("WinnerCard rendered", jsx.includes("<WinnerCard"));
check("OriginRankingTable in core", jsx.includes("{/* ── CORE: Origin ranking table"));
check("TopDestinationsPodium in core", jsx.includes("{/* ── CORE: Top 3 destinations podium"));
check("StatsBar in core", jsx.includes("{/* ── CORE: Stats bar"));
check("PriceCompareExternal in core", jsx.includes("{/* ── CORE: Price compare"));
check("DestImageBanner rendered", jsx.includes("<DestImageBanner"));

// 2. More details toggle exists
console.log("\n-- More details toggle --");
check("showMoreDetails state", jsx.includes("showMoreDetails, setShowMoreDetails"));
check("fm-more-toggle button", jsx.includes('className="fm-more-toggle"'));
check("showDetails i18n ref", jsx.includes('t("results.showDetails")'));
check("hideDetails i18n ref", jsx.includes('t("results.hideDetails")'));
check("fm-more-section div", jsx.includes('className="fm-more-section'));

// 3. Secondary components are inside showMoreDetails block
console.log("\n-- Secondary components in collapsible --");
const moreSection = jsx.substring(jsx.indexOf("fm-more-section"), jsx.indexOf("fm-more-section") + 15000);
check("GroupSizeIndicator in more", moreSection.includes("<GroupSizeIndicator"));
check("DestWeatherBadge in more", moreSection.includes("<DestWeatherBadge"));
check("DestCurrencyConverter in more", moreSection.includes("<DestCurrencyConverter"));
check("DestVisaHint in more", moreSection.includes("<DestVisaHint"));
check("FlightTimeline in more", moreSection.includes("<FlightTimeline"));
check("CostSplitCard in more", moreSection.includes("<CostSplitCard"));
check("AirlineLogos in more", moreSection.includes("<AirlineLogos"));
check("TravelChecklist in more", moreSection.includes("<TravelChecklist"));
check("PlanYourTripCTA in more", moreSection.includes("<PlanYourTripCTA"));
check("GroupChatLink in more", moreSection.includes("<GroupChatLink"));
check("ResultsShareLink in more", moreSection.includes("<ResultsShareLink"));

// 4. CSS for toggle
console.log("\n-- CSS --");
check("fm-more-toggle CSS", css.includes(".fm-more-toggle {"));
check("fm-more-arrow CSS", css.includes(".fm-more-arrow {"));
check("fm-more-section CSS", css.includes(".fm-more-section {"));
check("dark mode toggle", css.includes('[data-theme="dark"] .fm-more-toggle'));
check("print hides toggle", css.includes(".fm-more-toggle,"));

// 5. i18n keys
console.log("\n-- i18n --");
check("en showDetails", en.results && en.results.showDetails);
check("en hideDetails", en.results && en.results.hideDetails);
check("es showDetails", es.results && es.results.showDetails);
check("es hideDetails", es.results && es.results.hideDetails);

// 6. Search form: flex dates inside advanced
console.log("\n-- Search form simplification --");
// Flex dates should be INSIDE showAdvanced block
const advIdx = jsx.indexOf("sf-advanced-panel");
const flexInAdvanced = jsx.indexOf('id="flexSwitch"');
check("flex dates inside advanced panel", flexInAdvanced > advIdx);

// 7. JSON validity
console.log("\n-- JSON validity --");
try { JSON.parse(fs.readFileSync("frontend/src/i18n/en.json","utf8")); check("en.json valid", true); } catch(e) { check("en.json valid", false); }
try { JSON.parse(fs.readFileSync("frontend/src/i18n/es.json","utf8")); check("es.json valid", true); } catch(e) { check("es.json valid", false); }

console.log("\n=== Results: " + pass + " passed, " + fail + " failed ===\n");
process.exit(fail > 0 ? 1 : 0);
