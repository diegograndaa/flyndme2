// ─── High-quality city images via Unsplash ─────────────────────────────────────
// Using curated Unsplash photo IDs for beautiful, consistent city photography.
// Format: https://images.unsplash.com/photo-{ID}?w={width}&h={height}&fit=crop&q=80
//
// This replaces the low-quality local JPGs and covers ALL destination cities.
// Photo IDs audited & fixed (jun-2026): 20 dead IDs and 7 wrong-city photos
// replaced with verified landmark shots (checked visually via Unsplash).

const UNSPLASH_BASE = "https://images.unsplash.com";

const CITY_PHOTO_IDS = {
  // ── Original 21 ──
  MAD: "1539037116277-4db20889f2d4",   // Madrid Royal Palace
  BCN: "1583422409516-2895a77efded",   // Barcelona Sagrada Familia
  LON: "1681407979872-0a4cbde28391",   // London Westminster & Big Ben
  PAR: "1502602898657-3e91760cbb34",   // Paris Eiffel Tower
  ROM: "1552832230-c0197dd311b5",      // Rome Colosseum
  MIL: "1610016302534-6f67f1c968d8",      // Milan Duomo at sunset
  BER: "1560969184-10fe8719e047",      // Berlin Brandenburg Gate
  AMS: "1534351590666-13e3e96b5017",   // Amsterdam canals
  LIS: "1536663815808-535e2280d2c2",   // Lisbon tram
  DUB: "1663509851482-56ffbd1cf076",      // Dublin Ha'penny Bridge
  VIE: "1516550893923-42d28e5677af",   // Vienna palace
  BRU: "1559113202-c916b8e44373",      // Brussels Grand Place
  PRG: "1519677100203-a0e668c92439",   // Prague Charles Bridge
  WAW: "1577133192629-5140c5371590",   // Warsaw old town & Royal Castle
  ATH: "1555993539-1732b0258235",      // Athens Acropolis
  CPH: "1513622470522-26c3c8a854bc",   // Copenhagen Nyhavn
  HEL: "1538332576228-eb5b4c4de6f5",   // Helsinki cathedral
  ZRH: "1515488764276-beab7607c1e6",   // Zurich lake
  OSL: "1751635234283-7e3e64cb32fe",   // Oslo Opera House
  BUD: "1616432902940-b7a1acbc60b3",      // Budapest Parliament
  IST: "1524231757912-21f4fe3a7200",   // Istanbul mosques
  // ── New destinations ──
  OPO: "1555881400-74d7acaacd8b",      // Porto riverside
  AGP: "1641667710644-fb8a6abf2a06",      // Malaga cathedral & rooftops
  PMI: "1629537744044-04a035cbf675",   // Palma La Seu cathedral
  TFS: "1605182054023-17d71f44aa11",   // Tenerife coast
  NAP: "1567202170721-bd01fbdea30a",   // Naples bay & Vesuvius
  MRS: "1566838217578-1903568a76d9",   // Marseille Vieux-Port & Notre-Dame de la Garde
  NCE: "1643914729809-4aa59fdc4c17",   // Nice Promenade des Anglais aerial
  GVA: "1633022326182-1b36700bc49a",   // Geneva Jet d'Eau
  EDI: "1506377585622-bedcbb027afc",   // Edinburgh castle
  KRK: "1719343641931-c21c489d56ce",      // Krakow Main Square at night
  BEG: "1568234942177-2b37de78f6da",   // Belgrade Kalemegdan fortress
  OTP: "1584646098378-0874589d76b1",   // Bucharest palace
  SOF: "1738071406138-1e0221a761b1",   // Sofia Alexander Nevsky Cathedral
  ZAG: "1663086480502-47e1156bb594",      // Zagreb St Mark's Church
  DBV: "1555990793-da11153b2473",      // Dubrovnik old town & walls
  SPU: "1628502301579-bf8b22d3c685",      // Split Riva waterfront
  TIA: "1742500481926-f61a4be9abfe",   // Tirana Skanderbeg Square
  SKG: "1613538384222-cd71e8488d7a",      // Thessaloniki White Tower
  RAK: "1677837488142-a85ffbffe408",   // Marrakech Jemaa el-Fna
  TLL: "1724235425392-fe352694d4c8",      // Tallinn old town spires
  RIX: "1567669721460-221b82865ee0",      // Riga old town skyline
  VNO: "1660562278746-72e961bb9644",      // Vilnius old town rooftops
  STO: "1600290601473-3b73e4c531c9",   // Stockholm Stortorget
  MLA: "1756641157225-4a6517e48973",      // Valletta Grand Harbour
  RHO: "1595942820590-f855c6b8ba88",      // Rhodes old town
  TLV: "1500990702037-7620ccb6a60a",      // Tel Aviv beach & skyline
  CMN: "1538230575309-59dfc388ae36",      // Casablanca Hassan II Mosque
  MUC: "1705075833771-1f5e5b99ddeb",   // Munich Marienplatz town hall
  FRA: "1607879344639-d5f8dec22a60",   // Frankfurt skyline at dusk
};

/**
 * Get a high-quality city image URL.
 * @param {string} code - IATA airport code (e.g. "MAD")
 * @param {object} opts - { w: width, h: height }
 * @returns {string} Unsplash image URL or placeholder
 */
export function getCityImageUrl(code, { w = 800, h = 400 } = {}) {
  const id = CITY_PHOTO_IDS[code?.toUpperCase()];
  if (!id) return null;
  return `${UNSPLASH_BASE}/photo-${id}?w=${w}&h=${h}&fit=crop&q=80&auto=format`;
}

/**
 * Get image URL with local fallback.
 * Tries Unsplash first, falls back to local /destinations/{code}.jpg
 */
export function getCityImage(code, baseUrl = "/", { w = 800, h = 400 } = {}) {
  const unsplash = getCityImageUrl(code, { w, h });
  return unsplash || `${baseUrl}destinations/${code}.jpg`;
}

export default CITY_PHOTO_IDS;
