// Enlace a la web de la aerolínea para el trayecto, la fecha y los viajeros
// de un billete. No es el precio de la tarjeta: la aerolínea enseña su tarifa
// de hoy. Si no conocemos un enlace suyo, no se inventa ni se manda a otra web.

const EASYJET = new Set(["U2", "EC", "DS"]);
const WIZZ = new Set(["W6", "W9", "W4", "5W"]);
const RYANAIR = new Set(["FR", "RK", "AL", "RR"]);
const VUELING = new Set(["VY"]);
const BRITISH_AIRWAYS = new Set(["BA", "CJ", "A0"]);
const KLM = new Set(["KL", "WA"]);
const FINNAIR = new Set(["AY"]);

function codeOf(airline) {
  return String(airline || "").trim().toUpperCase();
}

function adultsOf(adults) {
  const n = Math.floor(Number(adults));
  if (!Number.isFinite(n)) return 1;
  return Math.min(9, Math.max(1, n));
}

function airports(origin, destination) {
  const from = String(origin || "").trim().toUpperCase();
  const to = String(destination || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  return { from, to };
}

function day(iso) {
  const s = String(iso || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function easyjet({ from, to, departureDate, returnDate, adults }) {
  const params = new URLSearchParams({
    isOneWay: returnDate ? "off" : "on",
    pid: "www.easyjet.com",
    origin: from,
    destination: to,
    departureDate,
    adults: String(adults),
    children: "0",
    infants: "0",
  });
  if (returnDate) params.set("returnDate", returnDate);
  return `https://www.easyjet.com/en/buy/flights?${params}`;
}

function wizz({ from, to, departureDate, returnDate, adults }) {
  const back = returnDate || "null";
  return `https://www.wizzair.com/en-gb/booking/select-flight/${from}/${to}/${departureDate}/${back}/${adults}/0/0/null`;
}

function ryanair({ from, to, departureDate, returnDate, adults }) {
  const params = new URLSearchParams({
    adults: String(adults),
    teens: "0",
    children: "0",
    infants: "0",
    dateOut: departureDate,
    originIata: from,
    destinationIata: to,
    isConnectedFlight: "false",
  });
  if (returnDate) params.set("dateIn", returnDate);
  return `https://www.ryanair.com/es/es/trip/flights/select?${params}`;
}

function britishAirways({ from, to, departureDate, returnDate, adults }) {
  const legs = [`${from}-${to}_${departureDate}`];
  if (returnDate) legs.push(`${to}-${from}_${returnDate}`);
  const params = new URLSearchParams({
    onds: legs.join(","),
    ad: String(adults),
    yad: "0",
    ch: "0",
    inf: "0",
    cabin: "M",
    flex: "LOWEST",
  });
  return `https://www.britishairways.com/travel/book/public/en_gb/flightList?${params}`;
}

function klm({ from, to, departureDate, returnDate, adults }) {
  const ymd = (iso) => iso.replace(/-/g, "");
  let connections = `${from}:A:${ymd(departureDate)}>${to}:A`;
  if (returnDate) connections += `-${to}:A:${ymd(returnDate)}>${from}:A`;
  const params = new URLSearchParams({
    pax: `${adults}:0:0:0`,
    cabinClass: "ECONOMY",
    activeConnection: "0",
    connections,
    bookingFlow: "LEISURE",
  });
  return `https://www.klm.com/search/offers?${params}`;
}

function finnair({ from, to, departureDate, returnDate, adults }) {
  const flights = [{ origin: from, destination: to, departureDate }];
  if (returnDate) flights.push({ origin: to, destination: from, departureDate: returnDate });
  const json = JSON.stringify({
    flights,
    adults,
    children: 0,
    infants: 0,
    cabin: "ECONOMY",
  });
  return `https://www.finnair.com/es-es/booking/flight-selection?json=${encodeURIComponent(json)}`;
}

function vueling({ from, to, departureDate, returnDate, adults, flightNumber }) {
  const params = new URLSearchParams({
    o: from,
    d: to,
    dd: departureDate,
    adt: String(adults),
    chd: "0",
    inf: "0",
    c: "es-ES",
    cur: "EUR",
  });
  if (returnDate) params.set("rd", returnDate);
  const num = String(flightNumber || "").replace(/\s+/g, "").toUpperCase();
  if (num) params.set("ofn", num.startsWith("VY") ? num : `VY${num}`);
  return `https://tickets.vueling.com/booking?${params}`;
}

const BUILDERS = [
  [EASYJET, "easyJet", easyjet],
  [WIZZ, "Wizz Air", wizz],
  [RYANAIR, "Ryanair", ryanair],
  [VUELING, "Vueling", vueling],
  [BRITISH_AIRWAYS, "British Airways", britishAirways],
  [KLM, "KLM", klm],
  [FINNAIR, "Finnair", finnair],
];

// { url, airlineName } o null si esa aerolínea no tiene enlace conocido.
export function buildAirlineBookingUrl({
  airline, origin, destination, departureDate, returnDate, adults, flightNumber,
} = {}) {
  const code = codeOf(airline);
  const pair = airports(origin, destination);
  const dep = day(departureDate);
  if (!code || !pair || !dep) return null;
  const ret = day(returnDate);
  const found = BUILDERS.find(([set]) => set.has(code));
  if (!found) return null;
  const [, airlineName, build] = found;
  const url = build({
    from: pair.from,
    to: pair.to,
    departureDate: dep,
    returnDate: ret,
    adults: adultsOf(adults),
    flightNumber,
  });
  return { url, airlineName };
}
