// ─── High-quality city images via Unsplash ─────────────────────────────────────
// Using curated Unsplash photo IDs for beautiful, consistent city photography.
// Format: https://images.unsplash.com/photo-{ID}?w={width}&h={height}&fit=crop&q=80
//
// This replaces the low-quality local JPGs and covers ALL destination cities.

const UNSPLASH_BASE = "https://images.unsplash.com";

const CITY_PHOTO_IDS = {
  // ── Original 21 ──
  MAD: "1539037116277-4db20889f2d4",   // Madrid Royal Palace
  BCN: "1583422409516-2895a77efded",   // Barcelona Sagrada Familia
  LON: "1513635269975-59663e0ac1ad",   // London skyline
  PAR: "1502602898657-3e91760cbb34",   // Paris Eiffel Tower
  ROM: "1552832230-c0197dd311b5",      // Rome Colosseum
  MIL: "1520440229-6469add29b1e",      // Milan Duomo
  BER: "1560969184-10fe8719e047",      // Berlin Brandenburg Gate
  AMS: "1534351590666-13e3e96b5017",   // Amsterdam canals
  LIS: "1536663815808-535e2280d2c2",   // Lisbon tram
  DUB: "1549918864-48ac978761a4",      // Dublin Ha'penny Bridge
  VIE: "1516550893923-42d28e5677af",   // Vienna palace
  BRU: "1559113202-c916b8e44373",      // Brussels Grand Place
  PRG: "1519677100203-a0e668c92439",   // Prague Charles Bridge
  WAW: "1519197924294-4ba991a11128",   // Warsaw old town
  ATH: "1555993539-1732b0258235",      // Athens Acropolis
  CPH: "1513622470522-26c3c8a854bc",   // Copenhagen Nyhavn
  HEL: "1538332576228-eb5b4c4de6f5",   // Helsinki cathedral
  ZRH: "1515488764276-beab7607c1e6",   // Zurich lake
  OSL: "1531366936337-7c912a4589a7",   // Oslo opera house
  BUD: "1551867633-194f125bddfa",      // Budapest parliament
  IST: "1524231757912-21f4fe3a7200",   // Istanbul mosques
  // ── New destinations ──
  OPO: "1555881400-74d7acaacd8b",      // Porto riverside
  AGP: "1562883676-8b21862f5cf4",      // Malaga coast
  PMI: "1578912996078-305d92249a5e",   // Palma cathedral
  TFS: "1500233828083-a3d03e64bde6",   // Tenerife volcanic landscape
  NAP: "1516483638261-f4dbaf036963",   // Naples Vesuvius view
  MRS: "1524231757912-21f4fe3a7200",   // Marseille port
  NCE: "1533104816931-20fa691ff6ca",   // Nice Promenade
  GVA: "1530122037265-a5f1f91d3b99",   // Geneva jet d'eau
  EDI: "1506377585622-bedcbb027afc",   // Edinburgh castle
  KRK: "1558618666-fcd25c85f68e",      // Krakow old town
  BEG: "1590070759801-16a01b2e69d0",   // Belgrade fortress
  OTP: "1584646098378-0874589d76b1",   // Bucharest palace
  SOF: "1520250497591-112f2f40a3f4",   // Sofia cathedral
  ZAG: "1558350657-33d3f5804a6f",      // Zagreb cathedral
  DBV: "1555990793-47d53fc3e52c",      // Dubrovnik walls
  SPU: "1555990538-f0e90d4b9d6e",      // Split Diocletian palace
  TIA: "1600436516950-03b40ff40c3b",   // Tirana colorful buildings
  SKG: "1558710147-5ac54de24b0a",      // Thessaloniki waterfront
  RAK: "1489749798305-4fea3ae63d43",   // Marrakech Jemaa el-Fna
  TLL: "1560154169-9d0bfb23a33c",      // Tallinn old town
  RIX: "1558618666-fcd25c85f68e",      // Riga old town
  VNO: "1565013403-6cb8fb31e0cf",      // Vilnius old town
  STO: "1509356843151-3e7643f1e14e",   // Stockholm old town
  MLA: "1558018113-bd5765d1e6e9",      // Malta Valletta harbor
  RHO: "1563790089-2f1bc3bea8c0",      // Rhodes old town
  TLV: "1544982503-9f984c68de3e",      // Tel Aviv beach
  CMN: "1569383746-8b32c52da149",      // Casablanca mosque
  MUC: "1577462317287-62c53b73e78e",   // Munich Marienplatz
  FRA: "1534430480872-3498386e7856",   // Frankfurt skyline
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
