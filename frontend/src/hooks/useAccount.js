// Sesión de la cuenta. El efecto de restaurar no corre en el render de tests
// (SSR); en el navegador despierta el backend igual que el plan de grupo.
import { useCallback, useEffect, useRef, useState } from "react";
import { isOffline } from "../utils/network";
import { clearToken, mergeFavoriteLists, readToken, sameFavorites, writeToken } from "../utils/account";
import { requestProviderCredential } from "../utils/socialSignIn";

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

async function wake(apiBase) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(`${apiBase}/api/ping`, { cache: "no-store", signal: AbortSignal.timeout?.(5000) });
      if (res.ok) return;
    } catch { /* el servidor puede estar arrancando */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function authRequest(apiBase, path, { method = "GET", token, body } = {}) {
  if (isOffline()) throw new Error("offline");
  await wake(apiBase);
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${apiBase}/api/auth${path}`, {
        method,
        headers,
        cache: "no-store",
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout?.(20000),
      });
      if (![502, 503, 504].includes(res.status)) return res;
      last = res;
    } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
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
      setProviders({
        google: typeof data.google === "string" ? data.google : "",
        apple: typeof data.apple === "string" ? data.apple : "",
        facebook: typeof data.facebook === "string" ? data.facebook : "",
      });
    } catch { /* sin proveedores, el diálogo sigue con correo y contraseña */ }
  }, [apiBase]);

  const signInSocial = useCallback(async (provider, { remember } = {}) => {
    setBusy(true);
    setError("");
    try {
      const clientId = providers[provider];
      const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
      const asked = await requestProviderCredential(provider, clientId, { lang });
      if (!asked || asked.cancelled) return false;
      const res = await authRequest(apiBase, "/social", {
        method: "POST",
        body: {
          provider,
          credential: asked.credential,
          nonce: asked.nonce,
          name: asked.name,
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
      setError(err && err.message === "offline" ? "auth.offline" : "auth.providerFailed");
      return false;
    } finally {
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
