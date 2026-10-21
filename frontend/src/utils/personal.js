// Listas de cada cuenta. El navegador guarda una copia y quién es el dueño
// de esa copia. Así los destinos de una persona no entran en la cuenta de otra
// que inicie sesión en el mismo dispositivo.
import { mergeFavoriteLists, sameFavorites } from "./account.js";
import { recentSearchKey } from "./recentSearch.js";
import { MAX_WATCHES } from "./priceWatch.js";

export const OWNER_KEY = "flyndme_personal_owner";
export const GUEST_KEY = "flyndme_personal_guest";
export const FAV_KEY = "flyndme_favorites";
export const RECENT_KEY = "flyndme_recent";

export function readOwner(storage) {
  try { return storage?.getItem(OWNER_KEY) || ""; } catch { return ""; }
}

export function writeOwner(storage, owner) {
  try { storage?.setItem(OWNER_KEY, owner || "guest"); } catch { /* bloqueado */ }
}

export function readGuestSnapshot(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(GUEST_KEY) || "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return {
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
      recent: Array.isArray(raw.recent) ? raw.recent : [],
      watches: Array.isArray(raw.watches) ? raw.watches : [],
    };
  } catch { return null; }
}

export function writeGuestSnapshot(storage, snap) {
  try {
    storage?.setItem(GUEST_KEY, JSON.stringify({
      favorites: snap?.favorites || [],
      recent: snap?.recent || [],
      watches: snap?.watches || [],
    }));
  } catch { /* bloqueado */ }
}

export function mergeRecentLists(stored, incoming) {
  const map = new Map();
  for (const raw of [...(stored || []), ...(incoming || [])]) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.origins)) continue;
    const key = recentSearchKey(raw);
    const prev = map.get(key);
    if (!prev || (Number(raw.ts) || 0) >= (Number(prev.ts) || 0)) map.set(key, raw);
  }
  return [...map.values()].sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0)).slice(0, 5);
}

export function mergeWatchLists(stored, incoming) {
  const map = new Map();
  for (const raw of [...(stored || []), ...(incoming || [])]) {
    if (!raw || typeof raw !== "object" || !raw.id) continue;
    const prev = map.get(raw.id);
    if (!prev || (Number(raw.createdAt) || 0) >= (Number(prev.createdAt) || 0)) map.set(raw.id, raw);
  }
  return [...map.values()]
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, MAX_WATCHES);
}

function sameRecent(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, i) => recentSearchKey(item) === recentSearchKey(b[i]) && (Number(item.ts) || 0) === (Number(b[i].ts) || 0));
}

function sameWatches(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, i) => item.id === b[i].id
    && item.savedTotalEUR === b[i].savedTotalEUR
    && (Number(item.createdAt) || 0) === (Number(b[i].createdAt) || 0));
}

function decideList(owner, email, server, local, merge, same) {
  const srv = Array.isArray(server) ? server : [];
  const loc = Array.isArray(local) ? local : [];
  if (owner === email) {
    const list = merge(srv, loc);
    return { list, upload: !same(list, srv) };
  }
  // Otra cuenta dejó su copia en este navegador: no es del invitado ni de esta.
  if (owner && owner !== "guest") return { list: srv, upload: false };
  if (srv.length === 0) return { list: loc, upload: loc.length > 0 };
  return { list: srv, upload: false };
}

/**
 * Qué listas mostrar y cuáles subir.
 * owner === email: une la copia local (por si se añadió sin red).
 * owner invitado o vacío y la cuenta no tiene esa lista: la primera vez se adopta.
 * owner invitado o vacío y la cuenta ya tiene esa lista: manda la cuenta.
 * owner de otro correo: manda la cuenta, sin guardar la copia ajena como invitado.
 */
export function listsForAccount(email, server, local, owner) {
  const favorites = decideList(owner, email, server?.favorites, local?.favorites, mergeFavoriteLists, sameFavorites);
  const recent = decideList(owner, email, server?.recent, local?.recent, mergeRecentLists, sameRecent);
  const watches = decideList(owner, email, server?.watches, local?.watches, mergeWatchLists, sameWatches);
  const foreign = Boolean(owner && owner !== "guest" && owner !== email);
  const upload = {};
  if (favorites.upload) upload.favorites = favorites.list;
  if (recent.upload) upload.recent = recent.list;
  if (watches.upload) upload.watches = watches.list;
  return {
    favorites: favorites.list,
    recent: recent.list,
    watches: watches.list,
    upload,
    stashGuest: !foreign && owner !== email,
  };
}

export function listsOnLogout(snapshot) {
  const snap = snapshot || {};
  return {
    favorites: Array.isArray(snap.favorites) ? snap.favorites : [],
    recent: Array.isArray(snap.recent) ? snap.recent : [],
    watches: Array.isArray(snap.watches) ? snap.watches : [],
    owner: "guest",
  };
}
