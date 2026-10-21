// Sesión de la cuenta. El efecto de restaurar no corre en el render de tests
// (SSR); en el navegador despierta el backend igual que el plan de grupo.
import { useCallback, useEffect, useRef, useState } from "react";
import { isOffline } from "../utils/network";
import { clearToken, mergeFavoriteLists, readToken, sameFavorites, writeToken } from "../utils/account";
import { requestProviderCredential, warmProvider } from "../utils/socialSignIn";
import { COLD_START_MS, fetchSignal } from "../utils/authFetch";

const ERROR_KEYS = {
  AUTH_INVALID: "auth.invalid",
  AUTH_EXISTS: "auth.exists",
  AUTH_WEAK_PASSWORD: "auth.weak",
  AUTH_BAD_EMAIL: "auth.badEmail",
  RATE_LIMITED: "auth.rate",
  AUTH_NO_EMAIL: "auth.noEmail",
  AUTH_PROVIDER_FAILED: "auth.providerFailed",
  AUTH_PROVIDER_OFF: "auth.providerFailed",
  AUTH_PROVIDER_TAKEN: "auth.providerTaken",
};

const EMPTY_PROVIDERS = { google: "", apple: "", facebook: "" };

function errorKey(data) {
  if (data && data.code === "AUTH_USE_PROVIDER") {
    if (data.provider === "google") return "auth.useGoogle";
    if (data.provider === "apple") return "auth.useApple";
    if (data.provider === "facebook") return "auth.useFacebook";
    return "auth.useProvider";
  }
  return ERROR_KEYS[(data && data.code) || ""] || "auth.failed";
}

// Un solo despertar a la vez: abrir la cuenta y el botón de Google no deben
// encadenar dos esperas de arranque en frío.
let wakeTask = null;

function wake(apiBase) {
  if (wakeTask) return wakeTask;
  wakeTask = (async () => {
    const timer = fetchSignal(COLD_START_MS);
    try {
      const res = await fetch(`${apiBase}/api/ping`, { cache: "no-store", signal: timer.signal });
      if (res.ok) return;
    } catch { /* el servidor puede estar arrancando */ }
    finally {
      timer.done();
      wakeTask = null;
    }
  })();
  return wakeTask;
}

async function authRequest(apiBase, path, {
  method = "GET", token, body, awake = false, timeoutMs = COLD_START_MS, attempts = 2,
} = {}) {
  if (isOffline()) throw new Error("offline");
  if (!awake) await wake(apiBase);
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const timer = fetchSignal(timeoutMs);
    try {
      const res = await fetch(`${apiBase}/api/auth${path}`, {
        method,
        headers,
        cache: "no-store",
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: timer.signal,
      });
      if (![502, 503, 504].includes(res.status)) return res;
      last = res;
    } catch (err) { last = err; }
    finally { timer.done(); }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800));
  }
  if (last instanceof Response) return last;
  throw last || new Error("network");
}

export function useAccount(apiBase, favBridge) {
  const bridge = useRef(favBridge);
  bridge.current = favBridge;
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(() => Boolean(readToken()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState(EMPTY_PROVIDERS);
  const socialLock = useRef(false);

  const applyFavorites = useCallback((serverList) => {
    const local = bridge.current?.getFavs?.() || [];
    const merged = mergeFavoriteLists(local, serverList || []);
    if (!sameFavorites(local, merged)) bridge.current?.replaceFavs?.(merged);
    return merged;
  }, []);

  const saveFavorites = useCallback(async (list) => {
    const token = readToken();
    if (!token) return;
    try {
      const res = await authRequest(apiBase, "/favorites", { method: "POST", token, body: { favorites: list } });
      if (res.status === 401) { clearToken(); setUser(null); }
    } catch { /* el navegador ya los tiene; al entrar se vuelven a unir */ }
  }, [apiBase]);

  useEffect(() => {
    const token = readToken();
    if (!token) { setRestoring(false); return undefined; }
    let cancel = false;
    authRequest(apiBase, "/me", { token })
      .then(async (res) => {
        if (cancel) return;
        if (!res.ok) { clearToken(); setUser(null); return; }
        const data = await res.json().catch(() => ({}));
        setUser(data.user || null);
        const merged = applyFavorites(data.favorites);
        if (!sameFavorites(merged, data.favorites || [])) saveFavorites(merged);
      })
      .catch(() => { /* sin red: se queda el token y se reintenta al recargar */ })
      .finally(() => { if (!cancel) setRestoring(false); });
    return () => { cancel = true; };
  }, [apiBase, applyFavorites, saveFavorites]);

  const submit = useCallback(async ({ email, password, name, remember, mode }) => {
    setBusy(true);
    setError("");
    try {
      const res = await authRequest(apiBase, mode === "up" ? "/register" : "/login", {
        method: "POST",
        body: {
          email,
          password,
          name,
          remember: Boolean(remember),
          favorites: bridge.current?.getFavs?.() || [],
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorKey(data));
        return false;
      }
      writeToken(data.token, remember);
      setUser(data.user || null);
      if (Array.isArray(data.favorites)) bridge.current?.replaceFavs?.(data.favorites);
      return true;
    } catch (err) {
      setError(err && err.message === "offline" ? "auth.offline" : "auth.failed");
      return false;
    } finally {
      setBusy(false);
    }
  }, [apiBase]);

  const loadProviders = useCallback(async () => {
    try {
      const res = await authRequest(apiBase, "/providers");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const next = {
        google: typeof data.google === "string" ? data.google : "",
        apple: typeof data.apple === "string" ? data.apple : "",
        facebook: typeof data.facebook === "string" ? data.facebook : "",
      };
      setProviders(next);
      const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
      if (next.google) warmProvider("google");
      if (next.apple) warmProvider("apple");
      if (next.facebook) warmProvider("facebook", lang);
    } catch { /* sin proveedores, el diálogo sigue con correo y contraseña */ }
  }, [apiBase]);

  const signInSocial = useCallback(async (provider, { remember } = {}) => {
    if (socialLock.current) return false;
    socialLock.current = true;
    setError("");
    // El servidor despierta mientras la persona elige la cuenta de Google.
    // «Un momento…» solo cubre la comprobación, no la ventana del proveedor.
    const waking = wake(apiBase);
    try {
      const clientId = providers[provider];
      const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
      const asked = await requestProviderCredential(provider, clientId, { lang });
      if (!asked || asked.cancelled) return false;
      if (asked.blocked) {
        setError("auth.popupBlocked");
        return false;
      }
      setBusy(true);
      const socialBody = {
        provider,
        credential: asked.credential,
        nonce: asked.nonce,
        name: asked.name,
        remember: Boolean(remember),
        favorites: bridge.current?.getFavs?.() || [],
      };
      // No esperar al ping: la propia petición es la que Render mantiene
      // abierta hasta arrancar. Si contesta 502 al momento, el ping que
      // salió al abrir Google ya está despertando el proceso.
      let res = await authRequest(apiBase, "/social", {
        method: "POST",
        awake: true,
        attempts: 1,
        body: socialBody,
      });
      if ([502, 503, 504].includes(res.status)) {
        await waking;
        res = await authRequest(apiBase, "/social", {
          method: "POST",
          awake: true,
          attempts: 1,
          timeoutMs: 20000,
          body: socialBody,
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorKey(data));
        return false;
      }
      writeToken(data.token, remember);
      setUser(data.user || null);
      if (Array.isArray(data.favorites)) bridge.current?.replaceFavs?.(data.favorites);
      return true;
    } catch (err) {
      setError(err && err.message === "offline" ? "auth.offline" : "auth.providerFailed");
      return false;
    } finally {
      socialLock.current = false;
      setBusy(false);
    }
  }, [apiBase, providers]);

  const logout = useCallback(async () => {
    const token = readToken();
    clearToken();
    setUser(null);
    setError("");
    if (!token) return;
    try { await authRequest(apiBase, "/logout", { method: "POST", token }); } catch { /* la sesión local ya se cerró */ }
  }, [apiBase]);

  const clearError = useCallback(() => setError(""), []);

  return { user, restoring, busy, error, providers, loadProviders, submit, signInSocial, logout, saveFavorites, clearError };
}
