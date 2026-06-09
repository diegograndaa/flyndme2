import { createContext, useCallback, useContext, useEffect, useState } from "react";
import en from "./en.json";
import es from "./es.json";

const translations = { en, es };
const STORAGE_KEY = "flyndme_lang";
const DEFAULT_LANG = "en";

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
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && translations[saved]) return saved;
    } catch { /* SSR / no localStorage */ }
    return DEFAULT_LANG;
  });

  // Persist language choice
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    // Update <html lang="..."> for accessibility / SEO
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l) => {
    if (translations[l]) setLangState(l);
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
