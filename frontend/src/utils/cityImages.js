// ─── High-quality city images via Unsplash ─────────────────────────────────────
// Using curated Unsplash photo IDs for beautiful, consistent city photography.
// Format: https://images.unsplash.com/photo-{ID}?w={width}&h={height}&fit=crop&q=80
//
// This replaces the low-quality local JPGs and covers ALL destination cities.

const UNSPLASH_BASE = "https://images.unsplash.com";

const CITY_PHOTO_IDS = {
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
