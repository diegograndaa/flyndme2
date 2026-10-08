// ─── GroupPlanner ────────────────────────────────────────────────────────────
// Collaborative trip planning: the organizer creates a group (one date + trip
// type) and shares a link; each traveler opens it and adds THEIR OWN departure
// city, instead of one person collecting everyone's origins by hand. When the
// roster is ready, anyone can run the normal search. Pure UI — the parent (App)
// owns the group state and the API calls; this component only collects input.
import React, { useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { FlapText } from "./FlapBoard";
import { Plus, X, Users, Link2, Search, RefreshCw, MapPin, Calendar, MessageCircle, Share2 } from "lucide-react";
import { AIRPORT_MAP, normalizeCode, cityOf, countryOf, formatDate, weekdayOf, countryFlag, searchAirports, foldText } from "../utils/helpers";

// Resolve free text ("madrid", "MAD", "Mad") to a known airport code when we
// can, so the search receives the same city codes the main form produces.
function resolveOrigin(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const code = normalizeCode(raw);
  if (AIRPORT_MAP[code]) return code;
  // Nombre exacto de la ciudad, también en español ("Bucarest", "Atenas")
  const hit = searchAirports(raw, { limit: 1 })[0];
  const exact = hit && [hit.city, hit.alias].some((n) => n && foldText(n) === foldText(raw));
  return exact ? hit.code : code;
}

function GroupPlanner({
  group, inviteUrl, copied,
  onAddMember, onRemoveMember, onSearch, onCopyLink, onRefresh, onExit,
  onShareWhatsApp, onShareNative,
  loading, busy,
}) {
  const { t } = useI18n();
  // The Web Share API only exists on (mostly mobile) clients; gate the native
  // button so it never renders during the SSR test harness or on desktop.
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [pax, setPax] = useState(1);
  const [acOpen, setAcOpen] = useState(false);
  const cityRef = useRef(null);

  const members = group?.members || [];
  const canSearch = members.length >= 1 && !loading;

  // Misma búsqueda que el formulario: código, nombre, nombres en español, país.
  const suggestions = useMemo(() => searchAirports(city, { limit: 6 }), [city]);

  function pickSuggestion(a) {
    setCity(a.code);
    setAcOpen(false);
    cityRef.current?.focus();
  }

  function submitMember(e) {
    e.preventDefault();
    const origin = resolveOrigin(city);
    if (!origin) { cityRef.current?.focus(); return; }
    onAddMember({ origin, passengers: pax, name: name.trim() });
    setName(""); setCity(""); setPax(1); setAcOpen(false);
    cityRef.current?.focus();
  }

  const tripLabel = group?.tripType === "roundtrip" ? t("search.roundtrip") : t("search.oneway");

  return (
    <section className="gp" aria-labelledby="gp-title">
      <div className="gp-eyebrow"><Users size={15} className="lucide" /> {t("group.eyebrow")}</div>
      <h1 id="gp-title" className="gp-title">{t("group.title")}</h1>
      <p className="gp-sub">{t("group.subtitle")}</p>

      <div className="gp-facts">
        <span className="gp-fact"><Calendar size={15} className="lucide" /> {formatDate(group?.departureDate)} · {weekdayOf(group?.departureDate)}</span>
        <span className="gp-fact-sep" aria-hidden="true">·</span>
        <span className="gp-fact">{tripLabel}</span>
      </div>

      {/* Invite link */}
      <div className="gp-invite">
        <div className="gp-invite-label"><Link2 size={15} className="lucide" /> {t("group.inviteLabel")}</div>
        <div className="gp-invite-row">
          <input className="gp-invite-url" type="text" readOnly value={inviteUrl}
            onFocus={(e) => e.target.select()} aria-label={t("group.inviteLabel")} />
          <button type="button" className="btn-fm-primary gp-copy" onClick={onCopyLink}>
            {copied ? t("group.copied") : t("group.copy")}
          </button>
        </div>
        <div className="gp-invite-share">
          <button type="button" className="wc-action-btn wc-action-btn--whatsapp" onClick={onShareWhatsApp}>
            <span className="wc-wa-icon"><MessageCircle size={15} aria-hidden="true" /></span> {t("group.shareWhatsApp")}
          </button>
          {canNativeShare && (
            <button type="button" className="wc-action-btn" onClick={onShareNative}>
              <Share2 size={14} className="lucide" aria-hidden="true" /> {t("group.share")}
            </button>
          )}
        </div>
        <p className="gp-invite-hint">{t("group.inviteHint")}</p>
      </div>

      {/* Roster */}
      <div className="gp-roster">
        <div className="gp-roster-head">
          <span className="gp-roster-title">{t("group.rosterTitle", { n: members.length })}</span>
          <button type="button" className="gp-refresh" onClick={onRefresh} disabled={busy} title={t("group.refresh")}>
            <RefreshCw size={14} className="lucide" /> {t("group.refresh")}
          </button>
        </div>
        {members.length === 0 ? (
          <div className="gp-empty">
            <MapPin size={22} className="lucide" />
            <span>{t("group.empty")}</span>
          </div>
        ) : (
          <ul className="gp-member-list">
            {members.map((m, i) => (
              <li key={i} className="gp-member">
                {/* Lista de pasajeros tipo terminal: código de origen en celdas de panel */}
                <span className="gp-member-code"><FlapText text={m.origin} size="sm" delay={i * 90} /></span>
                <span className="gp-member-main">
                  <span className="gp-member-name">{m.name || t("group.travelerN", { n: i + 1 })}</span>
                  <span className="gp-member-origin">{countryFlag(m.origin)} {cityOf(m.origin) || m.origin}</span>
                </span>
                {m.passengers > 1 && <span className="gp-member-pax">×{m.passengers}</span>}
                <button type="button" className="gp-member-remove" onClick={() => onRemoveMember(i)}
                  disabled={busy} aria-label={t("group.remove")}>
                  <X size={15} className="lucide" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add your city */}
      <form className="gp-add" onSubmit={submitMember}>
        <div className="gp-add-label">{t("group.addLabel")}</div>
        <div className="gp-add-row">
          <input className="gp-input gp-input-name" type="text" value={name}
            onChange={(e) => setName(e.target.value)} placeholder={t("group.namePlaceholder")}
            maxLength={40} />
          <div className="gp-city-wrap">
            <input ref={cityRef} className="gp-input gp-input-city" type="text" value={city}
              onChange={(e) => { setCity(e.target.value); setAcOpen(true); }}
              onFocus={() => setAcOpen(true)}
              onBlur={() => setTimeout(() => setAcOpen(false), 120)}
              placeholder={t("group.cityPlaceholder")} autoComplete="off" />
            {acOpen && suggestions.length > 0 && (
              <ul className="gp-ac">
                {suggestions.map((a) => (
                  <li key={a.code}>
                    <button type="button" className="gp-ac-item" onMouseDown={(e) => { e.preventDefault(); pickSuggestion(a); }}>
                      <span className="gp-ac-code">{a.code}</span>
                      <span className="gp-ac-city">{cityOf(a.code) || a.city}</span>
                      <span className="gp-ac-country">{countryOf(a.code) || a.country}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="gp-pax" role="group" aria-label={t("group.travelers")}>
            <button type="button" className="gp-pax-btn" onClick={() => setPax((p) => Math.max(1, p - 1))}
              aria-label={t("search.paxDecrease")} disabled={pax <= 1}>−</button>
            <span className="gp-pax-n" aria-live="polite">{pax}</span>
            <button type="button" className="gp-pax-btn" onClick={() => setPax((p) => Math.min(9, p + 1))}
              aria-label={t("search.paxIncrease")} disabled={pax >= 9}>+</button>
          </div>
          <button type="submit" className="gp-add-btn" disabled={busy || !city.trim()}>
            <Plus size={16} className="lucide" /> {t("group.add")}
          </button>
        </div>
      </form>

      {/* Search */}
      <button type="button" className="btn-fm-primary gp-search" onClick={onSearch} disabled={!canSearch}>
        <Search size={18} className="lucide" /> {loading ? t("search.searching") : t("group.findDestination")}
      </button>
      <p className="gp-search-hint">{t("group.searchHint")}</p>

      <button type="button" className="gp-exit" onClick={onExit}>{t("group.exit")}</button>
    </section>
  );
}

export default React.memo(GroupPlanner);
