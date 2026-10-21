// Al entrar, las listas pasan a ser las de esa cuenta. Al salir, vuelve la
// copia del invitado. El guardado espera a que el estado ya sea el de la cuenta:
// si no, subiría los destinos de quien estaba antes.
import { useEffect, useRef } from "react";
import { todayISO } from "../utils/helpers";
import { activeWatches, safeStorage, writeWatches } from "../utils/priceWatch";
import {
  RECENT_KEY,
  listsForAccount, listsOnLogout,
  readGuestSnapshot, readOwner, writeGuestSnapshot, writeOwner,
} from "../utils/personal";

function writeRecent(storage, list) {
  try { storage?.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* cuota */ }
}

export function usePersonalCabinet({
  user, personal, savePersonal, replaceFavs, favs, recent, setRecent, watches, setWatches,
}) {
  const seenSeq = useRef(0);
  const appliedEmail = useRef("");
  const savedJson = useRef("");
  const pending = useRef(null);
  const prevEmail = useRef(user?.email || "");
  const email = user?.email || "";

  useEffect(() => {
    if (!email || !personal || personal.seq === seenSeq.current) return undefined;
    seenSeq.current = personal.seq;
    const storage = safeStorage();
    const local = { favorites: favs, recent, watches };
    const decided = listsForAccount(email, personal, local, readOwner(storage));
    if (decided.stashGuest) writeGuestSnapshot(storage, local);
    writeOwner(storage, email);
    const nextFavs = replaceFavs(decided.favorites);
    const nextWatches = activeWatches(decided.watches, todayISO());
    writeRecent(storage, decided.recent);
    setRecent(decided.recent);
    writeWatches(storage, nextWatches);
    setWatches(nextWatches);
    pending.current = {
      email,
      json: JSON.stringify({ favorites: nextFavs, recent: decided.recent, watches: nextWatches }),
    };
    appliedEmail.current = "";
    savedJson.current = "";
    const upload = { ...decided.upload };
    if (nextWatches.length !== decided.watches.length) upload.watches = nextWatches;
    if (Object.keys(upload).length) savePersonal(upload);
    return undefined;
  }, [email, personal, favs, recent, watches, replaceFavs, savePersonal, setRecent, setWatches]);

  useEffect(() => {
    if (!email || !pending.current || pending.current.email !== email) return;
    const json = JSON.stringify({ favorites: favs, recent, watches });
    if (json !== pending.current.json) return;
    savedJson.current = json;
    appliedEmail.current = email;
    pending.current = null;
  }, [email, favs, recent, watches]);

  useEffect(() => {
    if (!email || appliedEmail.current !== email) return undefined;
    const body = { favorites: favs, recent, watches };
    const json = JSON.stringify(body);
    if (json === savedJson.current) return undefined;
    savedJson.current = json;
    const timer = setTimeout(() => {
      if (appliedEmail.current === email) savePersonal(body);
    }, 300);
    return () => clearTimeout(timer);
  }, [email, favs, recent, watches, savePersonal]);

  useEffect(() => {
    const previous = prevEmail.current;
    prevEmail.current = email;
    if (!previous || email) return;
    const storage = safeStorage();
    const restored = listsOnLogout(readGuestSnapshot(storage));
    pending.current = null;
    appliedEmail.current = "";
    savedJson.current = "";
    replaceFavs(restored.favorites);
    writeRecent(storage, restored.recent);
    setRecent(restored.recent);
    writeWatches(storage, restored.watches);
    setWatches(restored.watches);
    writeOwner(storage, restored.owner);
  }, [email, replaceFavs, setRecent, setWatches]);
}
