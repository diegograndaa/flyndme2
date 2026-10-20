// Pide el token al SDK del proveedor. No toca window al importarse: los tests
// de render no cargan ningún script. Cerrar la ventana es una cancelación,
// no un error.

const GOOGLE_SRC = "https://accounts.google.com/gsi/client";
const APPLE_SRC = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

export function providerCancelled(provider, detail) {
  const code = String(detail || "");
  if (provider === "google") return /popup_closed|popup_failed_to_open|access_denied/.test(code);
  if (provider === "apple") return code === "popup_closed_by_user" || code === "user_cancelled_authorize";
  return false;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && existing.dataset.ready === "1") { resolve(); return; }
    const el = existing || document.createElement("script");
    const done = () => { el.dataset.ready = "1"; resolve(); };
    const fail = () => reject(new Error("provider"));
    el.addEventListener("load", done, { once: true });
    el.addEventListener("error", fail, { once: true });
    if (!existing) {
      el.src = src;
      el.async = true;
      document.head.appendChild(el);
    }
  });
}

function nonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function requestGoogle(clientId) {
  return loadScript(GOOGLE_SRC).then(() => new Promise((resolve, reject) => {
    const oauth = window.google && window.google.accounts && window.google.accounts.oauth2;
    if (!oauth) { reject(new Error("provider")); return; }
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: (resp) => {
        if (resp && resp.access_token) { finish(resolve, { credential: resp.access_token }); return; }
        const code = resp && resp.error;
        if (providerCancelled("google", code)) { finish(resolve, { cancelled: true }); return; }
        finish(reject, new Error("provider"));
      },
      error_callback: (err) => {
        const code = err && (err.type || err.message || err);
        if (providerCancelled("google", code)) { finish(resolve, { cancelled: true }); return; }
        finish(reject, new Error("provider"));
      },
    });
    try { client.requestAccessToken(); }
    catch (err) { finish(reject, err); }
  }));
}

function requestApple(clientId) {
  return loadScript(APPLE_SRC).then(async () => {
    const apple = window.AppleID && window.AppleID.auth;
    if (!apple) throw new Error("provider");
    const raw = nonce();
    apple.init({
      clientId,
      scope: "name email",
      redirectURI: window.location.origin,
      usePopup: true,
      nonce: raw,
    });
    try {
      const res = await apple.signIn();
      const credential = res && res.authorization && res.authorization.id_token;
      if (!credential) return { cancelled: true };
      const person = res.user && res.user.name;
      const name = person ? [person.firstName, person.lastName].filter(Boolean).join(" ") : "";
      return { credential, nonce: raw, name };
    } catch (err) {
      const code = err && (err.error || err.message || err);
      if (providerCancelled("apple", code)) return { cancelled: true };
      throw new Error("provider");
    }
  });
}

function requestFacebook(appId, lang) {
  const locale = lang === "es" ? "es_ES" : "en_US";
  const src = `https://connect.facebook.net/${locale}/sdk.js`;
  return new Promise((resolve, reject) => {
    let opened = false;
    const open = () => {
      if (opened || !window.FB) return;
      opened = true;
      if (window.FB.__flyndme !== appId) {
        window.FB.init({ appId, cookie: false, xfbml: false, version: "v21.0" });
        window.FB.__flyndme = appId;
      }
      window.FB.login((resp) => {
        const token = resp && resp.authResponse && resp.authResponse.accessToken;
        if (!token) { resolve({ cancelled: true }); return; }
        resolve({ credential: token });
      }, { scope: "email,public_profile" });
    };
    if (window.FB) { open(); return; }
    window.fbAsyncInit = open;
    loadScript(src).then(() => {
      if (!window.FB) reject(new Error("provider"));
      else open();
    }).catch(reject);
  });
}

export function requestProviderCredential(provider, clientId, { lang } = {}) {
  if (!clientId) return Promise.reject(new Error("provider"));
  if (provider === "google") return requestGoogle(clientId);
  if (provider === "apple") return requestApple(clientId);
  if (provider === "facebook") return requestFacebook(clientId, lang);
  return Promise.reject(new Error("provider"));
}
