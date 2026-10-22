// ─── Hooks de la app ─────────────────────────────────────────────────────────
// Extraídos de App.jsx (Mejora 28): tema, favoritos, preferencias de
// accesibilidad y estado del backend.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredList, isFavoriteEntry } from "../utils/storage";
import { normalizeFavoriteSearch } from "../utils/favoriteOpen";
// useFavorites los usaba sin importar: el toggle de favoritos lanzaba
// "normalizeCode is not defined" en runtime (los tests SSR no lo cazaban).
import { normalizeCode, cityOf } from "../utils/helpers";
import { fetchSignal } from "../utils/authFetch";

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem("flyndme_theme") || "system"; } catch { return "system"; }
  });

  const resolved = useMemo(() => {
    if (theme === "system") {
      return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  // Listen for system preference changes
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    try { localStorage.setItem("flyndme_theme", t); } catch { /* */ }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  return { theme, resolved, setTheme, toggle };
}

export function useFavorites() {
  const KEY = "flyndme_favorites";
  const [favs, setFavs] = useState(() => readStoredList(KEY, isFavoriteEntry));
  const favsRef = useRef(favs);
  favsRef.current = favs;

  const write = useCallback((list) => {
    const updated = list.slice(0, 20);
    try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch { /* */ }
    favsRef.current = updated;
    return updated;
  }, []);

  const toggle = useCallback((dest) => {
    const code = normalizeCode(dest.destination);
    const prev = favsRef.current;
    const exists = prev.find((f) => f.code === code);
    const search = normalizeFavoriteSearch(dest.search);
    const next = write(exists
      ? prev.filter((f) => f.code !== code)
      : [{ code, city: cityOf(code) || code, price: dest.averageCostPerTraveler, ts: Date.now(), ...(search ? { search } : {}) }, ...prev]);
    setFavs(next);
    return next;
  }, [write]);

  const replace = useCallback((list) => {
    const next = write((Array.isArray(list) ? list : []).filter(isFavoriteEntry));
    setFavs(next);
    return next;
  }, [write]);

  const isFav = useCallback((destCode) => {
    return favs.some((f) => f.code === normalizeCode(destCode));
  }, [favs]);

  return { favs, toggle, isFav, replace };
}

export function useA11yPrefs() {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  });
  const [highContrast, setHighContrast] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-contrast: more)")?.matches || false;
  });

  useEffect(() => {
    const mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqContrast = window.matchMedia("(prefers-contrast: more)");
    const hMotion = (e) => setReducedMotion(e.matches);
    const hContrast = (e) => setHighContrast(e.matches);
    mqMotion.addEventListener("change", hMotion);
    mqContrast.addEventListener("change", hContrast);
    return () => {
      mqMotion.removeEventListener("change", hMotion);
      mqContrast.removeEventListener("change", hContrast);
    };
  }, []);

  return { reducedMotion, highContrast };
}

export function useBackendStatus(apiBase) {
  const [status, setStatus] = useState("unknown"); // unknown | online | offline
  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    const check = () => {
      stop();
      const timer = fetchSignal();
      stop = () => timer.abort();
      fetch(`${apiBase}/api/ping`, { cache: "no-store", signal: timer.signal })
        .then(res => { if (!cancelled) setStatus(res.ok ? "online" : "offline"); })
        .catch(() => { if (!cancelled) setStatus("offline"); })
        .finally(() => timer.done());
    };
    check();
    const id = setInterval(check, 60000);
    return () => { cancelled = true; stop(); clearInterval(id); };
  }, [apiBase]);
  return status;
}
