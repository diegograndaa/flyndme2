// ─── GroupPlanner ────────────────────────────────────────────────────────────
// Collaborative trip planning: the organizer creates a group (one date + trip
// type) and shares a link; each traveler opens it and adds THEIR OWN departure
// city, instead of one person collecting everyone's origins by hand. When the
// roster is ready, anyone can run the normal search. Pure UI — the parent (App)
// owns the group state and the API calls; this component only collects input.
import React, { useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { FlapText } from "./FlapBoard";
import { Plus, X, Users, Link2, Search, RefreshCw, MapPin, Calendar, MessageCircle, Share2, AlertTriangle } from "lucide-react";
import { AIRPORT_MAP, cityOf, countryOf, countryFlag, searchAirports, todayISO, resolveOriginCode } from "../utils/helpers";
import { formatDateLong } from "./DateField";
import { FriendlyError } from "./UiBits";

// Resolve free text ("madrid", "MAD", "Mad") to a known airport code when we
// can, so the search receives the same city codes the main form produces.
const resolveOrigin = resolveOriginCode;

function GroupPlanner({
  group, inviteUrl, copied,
  onAddMember, onRemoveMember, onSearch, onCopyLink, onRefresh, onExit,
  onShareWhatsApp, onShareNative,
  loading, busy, error,
}) {
  const { t, lang } = useI18n();
  // The Web Share API only exists on (mostly mobile) clients; gate the native
  // button so it never renders during the SSR test harness or on desktop.
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [pax, setPax] = useState(1);
  const [acOpen, setAcOpen] = useState(false);
  const [hl, setHl] = useState(0);
  // Código no reconocido pendiente de confirmar: un origen sin precios deja a
  // todo el grupo sin resultados, así que se pide una segunda pulsación.
  const [unknownAsk, setUnknownAsk] = useState(null);
  const cityRef = useRef(null);

  const members = group?.members || [];
  // Un grupo vive 14 días: su fecha puede pasar antes de que caduque el enlace.
  const datePast = Boolean(group?.departureDate) && group.departureDate < todayISO();
  const canSearch = members.length >= 1 && !loading && !datePast;

  // Misma búsqueda que el formulario: código, nombre, nombres en español, país.
  const suggestions = useMemo(() => searchAirports(city, { limit: 6 }), [city]);

  function pickSuggestion(a) {
    setCity(a.code);
    setAcOpen(false);
    cityRef.current?.focus();
  }

  const listOpen = acOpen && suggestions.length > 0;
  function onCityKey(e) {
    if (!listOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && suggestions[hl]) { e.preventDefault(); pickSuggestion(suggestions[hl]); }
    else if (e.key === "Escape") { e.preventDefault(); setAcOpen(false); }
  }

  function submitMember(e) {
    e.preventDefault();
    const origin = resolveOrigin(city);
    if (!origin) { cityRef.current?.focus(); return; }
    if (!AIRPORT_MAP[origin] && unknownAsk !== origin) {
      setUnknownAsk(origin);
      setAcOpen(false);
      cityRef.current?.focus();
      return;
    }
    onAddMember({ origin, passengers: pax, name: name.trim() });
    setName(""); setCity(""); setPax(1); setAcOpen(false); setUnknownAsk(null);
    cityRef.current?.focus();
  }

  const tripLabel = group?.tripType === "roundtrip" ? t("search.roundtrip") : t("search.oneway");

  return (
    <section className="gp" aria-labelledby="gp-title">
      <div className="gp-eyebrow"><Users size={15} className="lucide" /> {t("group.eyebrow")}</div>
      <h1 id="gp-title" className="gp-title">{t("group.title")}</h1>
      <p className="gp-sub">{t("group.subtitle")}</p>

      <div className="gp-facts">
        <span className="gp-fact"><Calendar size={15} className="lucide" /> {formatDateLong(group?.departureDate, lang)}
          {group?.tripType === "roundtrip" && group?.returnDate ? ` – ${formatDateLong(group.returnDate, lang)}` : ""}</span>
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
            aria-label={t("group.namePlaceholder")} autoComplete="given-name"
            maxLength={40} />
          <div className="gp-city-wrap">
            <input ref={cityRef} className="gp-input gp-input-city" type="text" value={city}
              onChange={(e) => { setCity(e.target.value); setAcOpen(true); setHl(0); setUnknownAsk(null); }}
              onFocus={() => { setAcOpen(true); setHl(0); }}
              onBlur={() => setTimeout(() => setAcOpen(false), 120)}
              onKeyDown={onCityKey}
              placeholder={t("group.cityPlaceholder")} autoComplete="off"
              aria-label={t("group.cityPlaceholder")}
              aria-describedby={unknownAsk ? "gp-add-warn" : undefined}
              role="combobox" aria-autocomplete="list" aria-expanded={listOpen} aria-controls="gp-ac-list"
              aria-activedescendant={listOpen && suggestions[hl] ? `gp-ac-${suggestions[hl].code}` : undefined} />
            {listOpen && (
              <ul className="gp-ac" role="listbox" id="gp-ac-list" aria-label={t("search.acMatches")}>
                {suggestions.map((a, i) => (
                  <li key={a.code} id={`gp-ac-${a.code}`} role="option" aria-selected={i === hl}
                    className={`gp-ac-item${i === hl ? " gp-ac-item--hl" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(a); }}
                    onMouseEnter={() => setHl(i)}>
                    <span className="gp-ac-code">{a.code}</span>
                    <span className="gp-ac-city">{cityOf(a.code) || a.city}</span>
                    <span className="gp-ac-country">{countryOf(a.code) || a.country}</span>
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
        {unknownAsk && (
          <p className="gp-add-warn" id="gp-add-warn" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{t("group.unknownCity", { code: unknownAsk })}</span>
          </p>
        )}
      </form>

      {datePast && (
        <p className="gp-add-warn gp-date-past" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{t("group.datePast", { date: formatDateLong(group.departureDate, lang) })}</span>
        </p>
      )}
      {error && !loading && <FriendlyError message={error} />}

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
