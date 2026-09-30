// ─── usePwaStatus ────────────────────────────────────────────────────────────
// Todo lo "de app instalable" en un sitio (sep-2026):
//   · Registra el service worker (solo en producción, regla dura #5).
//   · Nueva versión: el SW nuevo toma el control solo (skipWaiting); si la
//     página ya estaba controlada por uno anterior, avisamos para recargar
//     (evita pedir trozos JS de un deploy que ya no existe). Al volver a la
//     app se busca actualización (como mucho cada 30 min).
//   · Conexión: online/offline para avisar de que los precios necesitan red.
//   · Instalación: Android/escritorio con beforeinstallprompt; iOS no tiene
//     ese evento → pista manual (Compartir → Añadir a pantalla de inicio).
//     Se ofrece SOLO tras un momento útil (`engaged`, p. ej. tras ver
//     resultados) y, si se cierra, no vuelve a salir en 14 días.
import { useCallback, useEffect, useRef, useState } from "react";

const DISMISS_KEY = "flyndme_install_dismissed_at";
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATE_CHECK_MS = 30 * 60 * 1000;

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch { return false; }
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS se presenta como Mac con pantalla táctil
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export function usePwaStatus({ engaged = false } = {}) {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const [updateReady, setUpdateReady] = useState(false);
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(recentlyDismissed);
  const [installed, setInstalled] = useState(isStandalone);
  const regRef = useRef(null);

  // Service worker + aviso de versión nueva
  useEffect(() => {
    if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const hadController = !!navigator.serviceWorker.controller;
    const onChange = () => { if (hadController) setUpdateReady(true); };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    navigator.serviceWorker.register("/sw.js").then((reg) => { regRef.current = reg; }).catch(() => {});

    let lastCheck = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !regRef.current) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      regRef.current.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Conexión
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // Instalación (Android / escritorio)
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvent(e); };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return null;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    return outcome;
  }, [installEvent]);

  const dismissInstall = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* */ }
    setDismissed(true);
  }, []);

  const applyUpdate = useCallback(() => { window.location.reload(); }, []);
  const dismissUpdate = useCallback(() => setUpdateReady(false), []);

  const eligible = engaged && !dismissed && !installed;
  const install = !eligible ? null : installEvent ? "prompt" : isIOS() ? "ios" : null;

  return { online, updateReady, applyUpdate, dismissUpdate, install, promptInstall, dismissInstall };
}
