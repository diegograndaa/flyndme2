// ─── PwaBits ─────────────────────────────────────────────────────────────────
// Avisos de la app instalable con voz de aeropuerto (sep-2026). Presentacionales:
// el estado vive en usePwaStatus (App).
//   · OfflineStrip  → franja "Sin conexión" dentro de la cabecera fija.
//   · UpdateBanner  → "Cambio de puerta": hay una versión nueva, recargar.
//   · InstallBanner → llevarse la app a la pantalla de inicio (Android/escritorio
//                     con botón; iOS con la pista Compartir → Añadir).
import React from "react";
import { useI18n } from "../i18n/useI18n";
import { X, WifiOff, RefreshCw, Share, Download } from "lucide-react";

export function OfflineStrip() {
  const { t } = useI18n();
  return (
    <div className="fm-offline" role="status">
      <WifiOff size={14} aria-hidden="true" />
      <span className="fm-offline-tag">{t("pwa.offline")}</span>
      <span className="fm-offline-text">{t("pwa.offlineText")}</span>
    </div>
  );
}

export function UpdateBanner({ onUpdate, onDismiss }) {
  const { t } = useI18n();
  return (
    <div className="fm-pwa-card fm-pwa-card--update" role="status">
      <span className="fm-pwa-card-tag">{t("pwa.updateTitle")}</span>
      <span className="fm-pwa-card-text">{t("pwa.updateText")}</span>
      <div className="fm-pwa-card-actions">
        <button type="button" className="fm-pwa-card-cta" onClick={onUpdate}>
          <RefreshCw size={14} aria-hidden="true" /> {t("pwa.updateCta")}
        </button>
        <button type="button" className="fm-pwa-card-close" onClick={onDismiss} aria-label={t("a11y.close")}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function InstallBanner({ mode, onInstall, onDismiss }) {
  const { t } = useI18n();
  return (
    <div className="fm-pwa-card fm-pwa-card--install" role="dialog" aria-label={t("pwa.installTitle")}>
      <img className="fm-pwa-card-logo" src="/icon-192.png?v=6" alt="" width="36" height="36" />
      <div className="fm-pwa-card-body">
        <span className="fm-pwa-card-tag">{t("pwa.installTitle")}</span>
        <span className="fm-pwa-card-text">
          {mode === "ios"
            ? <>{t("pwa.iosHintBefore")} <Share size={14} className="fm-pwa-ios-share" aria-label={t("pwa.iosShare")} /> {t("pwa.iosHintAfter")}</>
            : t("pwa.installHint")}
        </span>
      </div>
      <div className="fm-pwa-card-actions">
        {mode === "prompt" && (
          <button type="button" className="fm-pwa-card-cta" onClick={onInstall}>
            <Download size={14} aria-hidden="true" /> {t("pwa.install")}
          </button>
        )}
        <button type="button" className="fm-pwa-card-close" onClick={onDismiss} aria-label={t("pwa.later")}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
