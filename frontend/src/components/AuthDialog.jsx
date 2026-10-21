// Cuenta en la cabecera. El diálogo va fuera de la cabecera: el blur del
// header crearía un containing block y un `fixed` de dentro no cubriría la página.
import React, { useEffect, useState } from "react";
import { User, X } from "lucide-react";
import { useI18n } from "../i18n/useI18n";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { accountInitial, accountLabel } from "../utils/account";

export function AccountButton({ user, restoring, savedCount = 0, onSignIn, onLogout, onOpenSaved, initialMenu = false }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(initialMenu);
  const menuRef = useFocusTrap(menu, () => setMenu(false));

  useEffect(() => {
    if (!menu) return undefined;
    const onPointer = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenu(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [menu, menuRef]);

  if (user) {
    const label = accountLabel(user);
    return (
      <div className="fm-auth" ref={menuRef}>
        <button
          type="button"
          className="fm-auth-btn fm-auth-btn--in"
          aria-haspopup="dialog"
          aria-expanded={menu}
          aria-label={t("auth.menuLabel")}
          onClick={() => setMenu((v) => !v)}
        >
          <span className="fm-auth-mark" aria-hidden="true">{accountInitial(user)}</span>
          <span className="fm-auth-btn-label">{label}</span>
        </button>
        {menu && (
          <div className="fm-auth-menu" role="dialog" aria-label={t("auth.menuLabel")}>
            <p className="fm-auth-menu-email">{user.email}</p>
            <p className="fm-auth-menu-state">{t("auth.signedInAs")}</p>
            <button type="button" className="fm-auth-saved" onClick={() => { setMenu(false); onOpenSaved?.(); }}>
              {savedCount === 1 ? t("auth.savedOne") : t("auth.savedMany", { count: savedCount })}
            </button>
            <button type="button" className="fm-auth-signout" onClick={() => { setMenu(false); onLogout(); }}>
              {t("auth.signOut")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="fm-auth-btn"
      onClick={onSignIn}
      aria-busy={restoring || undefined}
    >
      <User size={16} aria-hidden="true" />
      <span className="fm-auth-btn-label">{t("auth.signIn")}</span>
    </button>
  );
}

export function AuthDialog({ open, busy, error, providers, onClose, onSubmit, onSocial }) {
  const { t } = useI18n();
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(true);
  const trapRef = useFocusTrap(open, onClose);

  useEffect(() => {
    if (open) return;
    setMode("in");
    setEmail("");
    setPassword("");
    setName("");
    setRemember(true);
  }, [open]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    onSubmit({ email, password, name, remember, mode });
  };

  return (
    <>
      <div className="fm-auth-overlay" onClick={onClose} />
      <div
        className="fm-auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fm-auth-title"
        ref={trapRef}
      >
        <h2 id="fm-auth-title" className="fm-auth-title">{mode === "up" ? t("auth.createTitle") : t("auth.title")}</h2>
        <p className="fm-auth-lead">{t("auth.lead")}</p>
        {(providers && (providers.google || providers.apple || providers.facebook)) ? (
          <div className="fm-auth-social">
            {providers.google ? (
              <button type="button" className="fm-auth-provider" disabled={busy} onClick={() => onSocial?.("google", { remember })}>
                <span className="fm-auth-provider-mark" aria-hidden="true">G</span>
                {t("auth.withGoogle")}
              </button>
            ) : null}
            {providers.apple ? (
              <button type="button" className="fm-auth-provider" disabled={busy} onClick={() => onSocial?.("apple", { remember })}>
                <span className="fm-auth-provider-mark" aria-hidden="true">A</span>
                {t("auth.withApple")}
              </button>
            ) : null}
            {providers.facebook ? (
              <button type="button" className="fm-auth-provider" disabled={busy} onClick={() => onSocial?.("facebook", { remember })}>
                <span className="fm-auth-provider-mark" aria-hidden="true">f</span>
                {t("auth.withFacebook")}
              </button>
            ) : null}
            <p className="fm-auth-or">{t("auth.or")}</p>
          </div>
        ) : null}
        <form onSubmit={submit}>
          <label className="fm-auth-field">
            <span>{t("auth.email")}</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck="false"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              required
            />
          </label>
          {mode === "up" && (
            <label className="fm-auth-field">
              <span>{t("auth.name")}</span>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("auth.namePlaceholder")}
                maxLength={40}
              />
            </label>
          )}
          <label className="fm-auth-field">
            <span>{t("auth.password")}</span>
            <input
              type="password"
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={72}
            />
          </label>
          <button
            type="button"
            className={`fm-auth-remember${remember ? " fm-auth-remember--on" : ""}`}
            role="switch"
            aria-checked={remember}
            onClick={() => setRemember((v) => !v)}
          >
            <span className="fm-auth-led" aria-hidden="true" />
            {t("auth.remember")}
          </button>
          {error && <p className="fm-auth-error" role="alert">{t(error)}</p>}
          <button type="submit" className="fm-auth-continue" disabled={busy}>
            {busy ? t("auth.busy") : mode === "up" ? t("auth.create") : t("auth.continue")}
          </button>
        </form>
        <button
          type="button"
          className="fm-auth-switch"
          onClick={() => setMode((m) => (m === "up" ? "in" : "up"))}
        >
          {mode === "up" ? t("auth.haveAccount") : t("auth.needAccount")}
        </button>
        <button type="button" className="fm-auth-close" onClick={onClose} aria-label={t("a11y.close")}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
