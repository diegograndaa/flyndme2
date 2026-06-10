// ─── Hooks de la app ─────────────────────────────────────────────────────────
// Extraídos de App.jsx (Mejora 28): tema, favoritos, preferencias de
// accesibilidad y estado del backend.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  });

  const toggle = useCallback((dest) => {
    setFavs((prev) => {
      const code = normalizeCode(dest.destination);
      const exists = prev.find((f) => f.code === code);
      const updated = exists
        ? prev.filter((f) => f.code !== code)
        : [{ code, city: cityOf(code) || code, price: dest.averageCostPerTraveler, ts: Date.now() }, ...prev].slice(0, 20);
      try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch { /* */ }
      return updated;
    });
  }, []);

  const isFav = useCallback((destCode) => {
    return favs.some((f) => f.code === normalizeCode(destCode));
  }, [favs]);

  return { favs, toggle, isFav };
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
    const check = () => {
      fetch(`${apiBase}/api/ping`, { cache: "no-store", signal: AbortSignal.timeout?.(5000) })
        .then(res => { if (!cancelled) setStatus(res.ok ? "online" : "offline"); })
        .catch(() => { if (!cancelled) setStatus("offline"); });
    };
    check();
    const id = setInterval(check, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [apiBase]);
  return status;
}
