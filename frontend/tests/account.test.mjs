// Cuenta: unión de favoritos y que el diálogo de entrada se renderiza.
import "./_domStubs.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { renderToString } = await import("react-dom/server");
const React = (await import("react")).default;
const { I18nProvider } = await import("../src/i18n/useI18n.jsx");
const { mergeFavoriteLists, sameFavorites, accountInitial, accountLabel, writeToken, readToken, clearToken } = await import("../src/utils/account.js");

function render(element) {
  return renderToString(React.createElement(I18nProvider, null, element));
}

test("favoritos de la cuenta: gana el más reciente y se conserva el precio", () => {
  const merged = mergeFavoriteLists(
    [{ code: "MAD", city: "Madrid", price: 40, ts: 10 }],
    [{ code: "mad", city: "Madrid", price: null, ts: 20 }, { code: "nope", ts: 1 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].code, "MAD");
  assert.equal(merged[0].price, 40);
  assert.equal(merged[0].ts, 20);
  assert.equal(sameFavorites(merged, merged), true);
  assert.equal(sameFavorites(merged, []), false);
});

test("la inicial sale del nombre y, si no hay, del correo", () => {
  assert.equal(accountInitial({ name: "ana", email: "a@b.co" }), "A");
  assert.equal(accountLabel({ name: "", email: "ana@b.co" }), "ana");
});

test("recordarme guarda el token en localStorage; si no, solo en la pestaña", () => {
  const mem = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  clearToken();
  writeToken("token-de-prueba", false);
  assert.equal(readToken(), "token-de-prueba");
  assert.equal(localStorage.getItem("flyndme_session"), null);
  writeToken("token-largo", true);
  assert.equal(localStorage.getItem("flyndme_session"), "token-largo");
  assert.equal(mem.has("flyndme_session"), false);
  clearToken();
  assert.equal(readToken(), "");
});

test("la cabecera tiene el botón de entrar y el diálogo pide el correo", async () => {
  const { AccountButton, AuthDialog } = await import("../src/components/AuthDialog.jsx");
  const button = render(React.createElement(AccountButton, { user: null, restoring: false, onSignIn: () => {}, onLogout: () => {} }));
  assert.ok(button.includes("fm-auth-btn"));
  assert.ok(button.includes("Sign in") || button.includes("Iniciar sesión"));
  const restoring = render(React.createElement(AccountButton, { user: null, restoring: true, onSignIn: () => {}, onLogout: () => {} }));
  assert.ok(!restoring.includes("disabled"), "restaurar la sesión no bloquea Iniciar sesión");
  const signed = render(React.createElement(AccountButton, {
    user: { email: "ana@flynd.me", name: "Ana" },
    savedCount: 2,
    initialMenu: true,
    onSignIn: () => {},
    onLogout: () => {},
    onOpenSaved: () => {},
  }));
  assert.ok(signed.includes("fm-auth-mark"));
  assert.ok(signed.includes("Ana"));
  assert.ok(signed.includes("fm-auth-saved"));
  assert.ok(signed.includes("2 saved destinations") || signed.includes("2 destinos guardados"));
  const dialog = render(React.createElement(AuthDialog, { open: true, busy: false, error: "", onClose: () => {}, onSubmit: () => {} }));
  assert.ok(dialog.includes("fm-auth-dialog"));
  assert.ok(dialog.includes('type="email"'));
  assert.ok(dialog.includes('type="password"'));
  assert.ok(dialog.includes("Remember me") || dialog.includes("Recordarme"));
  assert.ok(!dialog.includes("fm-auth-provider"), "sin botón social que no entra");
  assert.ok(!dialog.includes("google"));
  const social = render(React.createElement(AuthDialog, {
    open: true,
    busy: false,
    error: "",
    providers: { google: "cliente.apps.googleusercontent.com", apple: "com.flyndme.web", facebook: "111" },
    onClose: () => {},
    onSubmit: () => {},
    onSocial: () => {},
  }));
  assert.equal((social.match(/class="fm-auth-provider"/g) || []).length, 3);
  assert.ok(social.includes("Google") && social.includes("Apple") && social.includes("Facebook"));
  assert.ok(!social.includes("cliente.apps.googleusercontent.com"), "el id del cliente no se pinta");
});

test("el arranque en frío no se corta a los pocos segundos", async () => {
  const { COLD_START_MS, fetchSignal } = await import("../src/utils/authFetch.js");
  assert.ok(COLD_START_MS >= 40000);
  const pending = fetchSignal(40);
  assert.equal(pending.signal.aborted, false);
  pending.done();
  const cut = fetchSignal(20);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(cut.signal.aborted, true);
  cut.done();
});

test("cerrar la ventana del proveedor no es un fallo", async () => {
  const { providerCancelled, providerBlocked } = await import("../src/utils/socialSignIn.js");
  assert.equal(providerCancelled("google", "popup_closed"), true);
  assert.equal(providerCancelled("apple", "popup_closed_by_user"), true);
  assert.equal(providerCancelled("google", "invalid_token"), false);
  assert.equal(providerCancelled("google", "popup_failed_to_open"), false);
  assert.equal(providerBlocked("google", "popup_failed_to_open"), true);
  assert.equal(providerBlocked("google", "popup_closed"), false);
});
