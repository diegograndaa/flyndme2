import { createContext, useCallback, useContext, useEffect, useState } from "react";
import en from "./en.json";
import es from "./es.json";

import { setCityLang } from "../utils/helpers";

const translations = { en, es };
const STORAGE_KEY = "flyndme_lang";
// Marca de que el idioma guardado lo ELIGIÓ el usuario (botón EN/ES). Antes se
// guardaba también el valor por defecto, así que un "en" guardado sin esta
// marca no es una preferencia: se vuelve a detectar del navegador.
const CHOSEN_KEY = "flyndme_lang_chosen";
const DEFAULT_LANG = "en";

// Idioma del navegador (primera coincidencia con un idioma que tengamos).
export function detectLang(languages) {
  for (const l of languages || []) {
    const base = String(l || "").toLowerCase().split("-")[0];
    if (translations[base]) return base;
  }
  return DEFAULT_LANG;
}

function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && translations[saved] && localStorage.getItem(CHOSEN_KEY) === "1") return saved;
  } catch { /* SSR / sin localStorage */ }
  try {
    if (typeof navigator !== "undefined") {
      return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
    }
  } catch { /* ignore */ }
  return DEFAULT_LANG;
}

const I18nContext = createContext(null);

/**
 * Resolve a dot-notation key like "landing.hero.title" from a nested object.
 * Supports simple {{var}} interpolation.
 */
function resolve(obj, path) {
  return path.split(".").reduce((acc, k) => acc?.[k], obj);
}

function interpolate(template, vars) {
  if (!vars || typeof template !== "string") return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{{${key}}}`));
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  // Los nombres de ciudad siguen al idioma (Milán, Roma, Lisboa…). Se fija
  // durante el render para que los hijos ya lean el nombre correcto.
  setCityLang(lang);

  useEffect(() => {
    // Update <html lang="..."> for accessibility / SEO
    document.documentElement.lang = lang;
  }, [lang]);

  // Solo se guarda cuando el usuario lo elige con el selector EN/ES.
  const setLang = useCallback((l) => {
    if (!translations[l]) return;
    try { localStorage.setItem(STORAGE_KEY, l); localStorage.setItem(CHOSEN_KEY, "1"); } catch { /* ignore */ }
    setLangState(l);
  }, []);

  /**
   * Translation function.
   *  t("landing.title")          → string
   *  t("search.budgetHintOn", { amount: "€200" }) → interpolated string
   *  t("landing.chips")          → array (returned as-is)
   */
  const t = useCallback(
    (key, vars) => {
      const val = resolve(translations[lang], key);
      if (val === undefined) {
        // Fallback to English
        const fb = resolve(translations[DEFAULT_LANG], key);
        if (fb === undefined) return key; // key itself as last resort
        if (typeof fb === "string") return interpolate(fb, vars);
        return fb;
      }
      if (typeof val === "string") return interpolate(val, vars);
      return val; // arrays, objects returned as-is
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
