// Sesión de la cuenta en este navegador y unión de destinos guardados.
// El token no es una contraseña: es la sesión que devuelve /api/auth.
import { normalizeFavoriteSearch, sameFavoriteSearch } from "./favoriteOpen.js";

const TOKEN_KEY = "flyndme_session";

function bucket(name) {
  try {
    const store = globalThis[name];
    if (store && typeof store.getItem === "function") return store;
  } catch { /* almacenamiento bloqueado */ }
  return null;
}

export function readToken() {
  return bucket("localStorage")?.getItem(TOKEN_KEY) || bucket("sessionStorage")?.getItem(TOKEN_KEY) || "";
}

export function writeToken(token, remember) {
  const local = bucket("localStorage");
  const session = bucket("sessionStorage");
  try {
    if (remember) {
      local?.setItem(TOKEN_KEY, token);
      session?.removeItem(TOKEN_KEY);
    } else {
      session?.setItem(TOKEN_KEY, token);
      local?.removeItem(TOKEN_KEY);
    }
  } catch { /* el usuario sigue dentro hasta recargar */ }
}

export function clearToken() {
  try { bucket("localStorage")?.removeItem(TOKEN_KEY); } catch { /* */ }
  try { bucket("sessionStorage")?.removeItem(TOKEN_KEY); } catch { /* */ }
}

function cleanFavorite(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const priceRaw = raw.price;
  let price = null;
  if (priceRaw !== null && priceRaw !== undefined && priceRaw !== "") {
    const n = Number(priceRaw);
    if (Number.isFinite(n) && n >= 0) price = n;
  }
  const ts = Number(raw.ts);
  const search = normalizeFavoriteSearch(raw.search);
  return {
    code,
    city: String(raw.city || "").slice(0, 48),
    price,
    ts: Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : 0,
    ...(search ? { search } : {}),
  };
}

export function sameFavorites(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((f, i) => f.code === b[i].code && f.ts === b[i].ts && f.price === b[i].price && sameFavoriteSearch(f.search, b[i].search));
}

// Misma regla que el servidor: por código gana el más reciente, y un precio
// que falta no borra el que ya estaba.
export function mergeFavoriteLists(stored, incoming) {
  const map = new Map();
  for (const raw of [...(stored || []), ...(incoming || [])]) {
    const fav = cleanFavorite(raw);
    if (!fav) continue;
    const prev = map.get(fav.code);
    if (!prev) {
      map.set(fav.code, fav);
      continue;
    }
    const favNewer = fav.ts >= prev.ts;
    const newer = { ...(favNewer ? fav : prev) };
    const older = favNewer ? prev : fav;
    if (newer.price == null && older.price != null) newer.price = older.price;
    if (!newer.search && older.search) newer.search = older.search;
    map.set(fav.code, newer);
  }
  return [...map.values()].sort((a, b) => b.ts - a.ts || a.code.localeCompare(b.code)).slice(0, 20);
}

export function accountInitial(user) {
  const src = String(user?.name || user?.email || "?").trim();
  const ch = src.slice(0, 1).toUpperCase();
  return ch || "?";
}

export function accountLabel(user) {
  const name = String(user?.name || "").trim();
  if (name) return name;
  const local = String(user?.email || "").split("@")[0];
  return local || "";
}
