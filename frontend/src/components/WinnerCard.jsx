// ─── WinnerCard ──────────────────────────────────────────────────────────────
// Extraída de App.jsx (Mejora 21). Tarjeta del destino ganador: precios
// animados, badge de verificación, desglose por origen, CTAs de reserva y
// acciones de compartir. Incluye sus helpers privados.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import {
  normalizeCode, cityOf, formatEur, formatDate, getBaseUrl, copyText,
  buildSkyscannerUrl, buildGoogleFlightsUrl, countryFlag, airportName, fairnessColor,
} from "../utils/helpers";
import { convertPrice } from "../utils/resultsLogic";
import { track } from "../utils/analytics";
import "../styles/results-simple.css";
import { getCityImage } from "../utils/cityImages";
import { Heart, Calendar, Plane, Ticket, Search, Copy, MessageCircle, Link2, Share2, Send, Mail, ShieldCheck, Info } from "lucide-react";
import VerificationBadge from "./VerificationBadge";
import { useCountUp } from "./UiBits";

function useFairnessLabel(score) {
  const { t } = useI18n();
  if (score >= 85) return { text: t("fairness.veryBalanced"),      color: fairnessColor(score) };
  if (score >= 65) return { text: t("fairness.fairlyBalanced"),    color: fairnessColor(score) };
  if (score >= 45) return { text: t("fairness.somewhatUnequal"),   color: fairnessColor(score) };
  return             { text: t("fairness.unequal"),                 color: fairnessColor(score) };
}

// Colour a "who pays what" bar by how far this traveler's fare is from the
// group's per-person average (cheaper/at-average = green, a bit over = amber,
// well over = red). Real prices in, no invented data.
function payColor(price, avg) {
  const r = avg > 0 ? price / avg : 1;
  if (r <= 1.05) return "var(--fair-high, #15803D)";
  if (r <= 1.25) return "var(--fair-low, #B45309)";
  return "var(--fair-bad, #DC2626)";
}

function airlineLogo(iata) {
  if (!iata || iata.length < 2) return null;
  return `https://images.kiwi.com/airlines/64/${iata}.png`;
}

function AnimatedPrice({ value, decimals = 2, className = "" }) {
  const formatted = useCountUp(value, 800, decimals);
  return <div className={`${className} price-animate`}>{formatted}</div>;
}

const WinnerCard = React.memo(function WinnerCard({
  dest, origins, tripType, returnDate, departureDate: depDate,
  uiCriterion, onChangeCriterion,
  flightsCount, allFlights = [], lastBestPrice = 0,
  onShare, onShareWhatsApp, onShareTelegram, onShareEmail, onShareNative, onCopySearchLink, shareStatus,
  onViewAlternatives, onChangeSearch,
  onVerify, verifyPhase = null,
  currency = "EUR",
  searchBadges = [],
  isFav = false, onToggleFav,
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(true);

  useEffect(() => {
    if (dest) {
      const timer = setTimeout(() => setEntered(true), 50);
      return () => clearTimeout(timer);
    }
  }, [dest]);

  // Derivados null-safe que necesitan los hooks de abajo. Van ANTES del early
  // return para que TODOS los hooks se llamen incondicionalmente (si `dest`
  // pasara de objeto a null, alterar el orden de hooks rompería el render).
  const cleanOrigins = (origins || []).map((o) => String(o).trim().toUpperCase()).filter(Boolean);
  const breakdown    = Array.isArray(dest?.flights) ? dest.flights : [];
  // Con un único origen no hay dimensión de equidad: todos salen de la misma
  // ciudad → fairness siempre "perfecta" y spread 0. Ocultamos la UI de equidad
  // (anillo, toggle precio/equidad y barra) para no mostrar métricas triviales.
  const singleOrigin = cleanOrigins.length <= 1;

  const fairness = useFairnessLabel(dest?.fairnessScore ?? 0);

  // Cheapest origin (for highlighting in booking cards)
  const cheapestOrigin = useMemo(() => {
    if (!breakdown.length) return "";
    return breakdown.reduce((best, f) => (!best || (f.price < best.price)) ? f : best, null)?.origin?.toUpperCase() || "";
  }, [breakdown]);

  // Savings vs average of all destinations
  const savingsPct = useMemo(() => {
    if (!allFlights || allFlights.length < 2 || !dest?.averageCostPerTraveler) return 0;
    const avgAll = allFlights.reduce((s, f) => s + (f.averageCostPerTraveler || 0), 0) / allFlights.length;
    if (avgAll <= 0) return 0;
    return Math.round(((avgAll - dest.averageCostPerTraveler) / avgAll) * 100);
  }, [allFlights, dest]);

  // "Who pays what": real per-person fare for each origin, scaled to the
  // priciest, with the group average marked. Makes the fairness/spread legible
  // (replaces the abstract 0-100 ring). Hidden for single-origin (no spread).
  const payRows = useMemo(() => {
    if (singleOrigin || breakdown.length < 2) return null;
    const rows = breakdown
      .map((f) => ({ origin: String(f.origin).toUpperCase(), price: Number(f.price) || 0 }))
      .filter((r) => r.price > 0);
    if (rows.length < 2) return null;
    const maxP = Math.max(...rows.map((r) => r.price));
    const sum = rows.reduce((s, r) => s + r.price, 0);
    const avg = dest?.averageCostPerTraveler || (sum / rows.length);
    return { rows, maxP, avg };
  }, [breakdown, singleOrigin, dest]);

  // Todos los hooks ya se han llamado de forma incondicional → early return seguro.
  if (!dest) return null;

  const code   = normalizeCode(dest.destination);
  const city   = cityOf(code);
  const imgUrl = getCityImage(code, getBaseUrl(), { w: 1200, h: 500 });
  const dep    = dest.bestDate || "";
  const ret    = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");

  // Web Share API present (mobile/PWA): one "Share" opens the native OS sheet
  // (WhatsApp/Telegram/Email/…). On desktop it's absent, so we show explicit
  // copy + Telegram + Email buttons instead. Guarded for the SSR test render.
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Build price map + itinerary info from breakdown
  const priceMap = {};
  const offerMap = {};
  const flightInfoMap = {};
  breakdown.forEach((f) => {
    const k = String(f.origin).toUpperCase();
    priceMap[k] = f.price;
    offerMap[k] = f.offer || null;
    flightInfoMap[k] = f;
  });

  return (
    <div className={`wc-card${entered ? " wc-card--entered" : ""}`}>
      {/* Hero image */}
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          <div className="wc-badge-winner">{t("results.eyebrow")}</div>
          <span className="wc-dest-code">{city || code}</span>
          {city && <span className="wc-dest-city">{code}</span>}
        </div>
        <button type="button" className={`wc-fav-btn${isFav ? " wc-fav-btn--active" : ""}`} onClick={onToggleFav} aria-label={t("results.favorite")} aria-pressed={isFav} title={t("results.favorite")}>
          {isFav ? <Heart size={18} fill="currentColor" aria-hidden="true" /> : <Heart size={18} aria-hidden="true" />}
        </button>
        {/* Savings + trip duration + countdown + vs last search chips */}
        <div className="wc-chips-overlay">
          {/* Verification badge (first so it's the most visible trust signal) */}
          <VerificationBadge dest={dest} />
          {/* Algún origen usa precio de una fecha vecina (sin dato exacto) */}
          {dest.hasDateFallback && (
            <span className="wc-trip-days-chip" title={t("results.dateFallbackHint")}>
              <Calendar size={13} aria-hidden="true" /> {t("results.dateFallbackBadge")}
            </span>
          )}
          {savingsPct > 5 && (
            <span className="wc-savings-chip">
              {t("results.savingsPct", { pct: savingsPct })}
            </span>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="wc-summary">
        <div className="wc-summary-item wc-summary-item--tooltip">
          <div className="wc-summary-label">{t("results.groupTotal")}</div>
          {currency === "EUR"
            ? <AnimatedPrice value={dest.totalCostEUR} decimals={0} className="wc-summary-price" />
            : <div className="wc-summary-price price-animate">{convertPrice(dest.totalCostEUR, currency)}</div>
          }
          {/* Per-origin breakdown tooltip */}
          {breakdown.length > 0 && (
            <div className="wc-tooltip">
              {breakdown.map((f, i) => (
                <div key={i} className="wc-tooltip-row">
                  <span>{f.origin}</span>
                  <span>{currency === "EUR" ? formatEur(f.price, 0) : convertPrice(f.price, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="wc-summary-divider" />
        <div className="wc-summary-item">
          <div className="wc-summary-label">{t("results.avgPerPerson")}</div>
          {currency === "EUR"
            ? <AnimatedPrice value={dest.averageCostPerTraveler} decimals={0} className="wc-summary-price wc-summary-price--secondary" />
            : <div className="wc-summary-price wc-summary-price--secondary price-animate">{convertPrice(dest.averageCostPerTraveler, currency)}</div>
          }
        </div>
        {dep && (
          <>
            <div className="wc-summary-divider" />
            <div className="wc-summary-item">
              <div className="wc-summary-label">
                {tripType === "roundtrip" ? t("results.roundtripTag") : t("results.onewayTag")}
              </div>
              <div className="wc-summary-date">
                {tripType === "roundtrip"
                  ? `${formatDate(dep)} → ${formatDate(ret)}`
                  : formatDate(dep)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* On-demand live price check (#5). Default is the honest "cached estimate"
          caveat + a button; we only call SerpAPI when the user asks (the cached
          feed is an estimate, not a verified fare). Once confirmed, the ✓/↑↓
          VerificationBadge over the hero takes over, so we hide this control. */}
      {(verifyPhase === "loading" || verifyPhase === "unavailable" || dest.verificationStatus === "skipped") && (
        <div className="wc-verify" aria-live="polite">
          {verifyPhase === "loading" ? (
            <span className="wc-verify-status">
              <span className="spinner-border spinner-border-sm" aria-hidden="true" /> {t("results.verifyChecking")}
            </span>
          ) : verifyPhase === "unavailable" ? (
            <span className="wc-verify-status">
              <Info size={14} aria-hidden="true" /> {t("results.verifyUnavailable")}
            </span>
          ) : (
            <>
              <span className="wc-verify-caption">{t("results.verifyCaption")}</span>
              <button type="button" className="wc-verify-btn" onClick={onVerify}>
                <ShieldCheck size={15} aria-hidden="true" /> {t("results.verifyCta")}
              </button>
            </>
          )}
        </div>
      )}

      {/* Who pays what — makes the per-person spread (fairness) legible */}
      {payRows && (
        <div className="wc-fs">
          <div className="wc-fs-head">
            <span className="wc-fs-title">{t("results.whoPaysTitle")}</span>
            <span className="wc-fs-verdict" style={{ color: fairness.color }}>
              {t("results.whoPaysSpread", { amount: formatEur(dest.priceSpread ?? 0, 0) })} · {fairness.text}
            </span>
          </div>
          {payRows.rows.map((r) => (
            <div key={r.origin} className="wc-fs-row">
              <span className="wc-fs-code">{countryFlag(r.origin)} {r.origin}</span>
              <div className="wc-fs-track">
                <div className="wc-fs-fill" style={{ width: `${Math.max(6, (r.price / payRows.maxP) * 100)}%`, background: payColor(r.price, payRows.avg) }} />
                <div className="wc-fs-avg" style={{ left: `${Math.min(100, (payRows.avg / payRows.maxP) * 100)}%` }} title={t("results.whoPaysAvg", { amount: formatEur(payRows.avg, 0) })} />
              </div>
              <span className="wc-fs-price">{currency === "EUR" ? formatEur(r.price, 0) : convertPrice(r.price, currency)}</span>
            </div>
          ))}
          <div className="wc-fs-avglabel">
            <span className="wc-fs-avgtick" aria-hidden="true" /> {t("results.whoPaysAvg", { amount: currency === "EUR" ? formatEur(payRows.avg, 0) : convertPrice(payRows.avg, currency) })}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="wc-body">
        {/* Criterion toggle: control único que gobierna ganador Y lista de
            alternativas (uiCriterion en App.jsx). */}
        <div className="wc-criterion-row">
          {!singleOrigin && (
          <div className="wc-criterion-pills" role="group" aria-label={t("results.criterionGroupLabel")}>
            {[["total", t("results.criterionPrice")], ["fairness", t("results.criterionFairness")]].map(([v, l]) => (
              <button key={v} type="button"
                className={`wc-criterion-pill${uiCriterion === v ? " wc-criterion-pill--active" : ""}`}
                aria-pressed={uiCriterion === v}
                onClick={() => onChangeCriterion(v)}>{l}</button>
            ))}
          </div>
          )}
          <div className="wc-stats-mini">
            {t("results.destsAnalyzed")}: <strong>{flightsCount}</strong>
          </div>
        </div>

        {/* ── Booking section (collapsible) ── */}
        {cleanOrigins.length > 0 && dep && (
          <div className="wc-booking">
            <button type="button" className="wc-booking-toggle" onClick={() => setBookingOpen((v) => !v)} aria-expanded={bookingOpen}>
              <div>
                <div className="wc-booking-title">{t("results.bookTitle")}</div>
                <div className="wc-booking-sub">{t("results.bookSub")}</div>
              </div>
              <span className={`wc-booking-chevron${bookingOpen ? " wc-booking-chevron--open" : ""}`} aria-hidden="true">▾</span>
            </button>

            <div className={`wc-booking-collapse${bookingOpen ? " wc-booking-collapse--open" : ""}`}>
            <div className="wc-booking-cards">
              {cleanOrigins.map((origin) => {
                const price = priceMap[origin];
                const offer = offerMap[origin];
                const finfo = flightInfoMap[origin] || {};
                // Fecha real del precio (fallback de fecha vecina): los deep
                // links deben apuntar a la fecha que tiene ese precio.
                const effDep = finfo.flightDate || dep;
                const effRet = tripType === "roundtrip" ? (finfo.flightReturnDate || ret) : ret;
                const originCity = cityOf(origin);
                const destCity = city || code;
                // Aeropuertos reales del billete (mejor deep link que el
                // código de ciudad ROM/LON; Google Flights ni lo acepta).
                const ssOrigin = offer?.tp?.originAirport || origin;
                const ssDest   = offer?.tp?.destinationAirport || code;
                const ssUrl = buildSkyscannerUrl({ origin: ssOrigin, destination: ssDest, departureDate: effDep, returnDate: effRet, tripType });
                const gfUrl = buildGoogleFlightsUrl({ origin: ssOrigin, destination: ssDest, departureDate: effDep, returnDate: effRet, tripType });

                // Extract itinerary details (outbound)
                const itin = offer?.itineraries?.[0];
                const segments = itin?.segments || [];
                const stops = segments.length > 0 ? segments.length - 1 : null;
                const airline = offer?.validatingAirlineCodes?.[0] || "";
                const duration = itin?.duration || "";
                const durationText = duration
                  ? duration.replace("PT", "").replace("H", "h ").replace("M", "m").trim()
                  : "";
                const depAirport = segments[0]?.departure?.iataCode || "";
                const arrAirport = segments[segments.length - 1]?.arrival?.iataCode || "";
                const depName = airportName(depAirport);
                const arrName = airportName(arrAirport);

                // Extract return itinerary (roundtrip only)
                const retItin = tripType === "roundtrip" ? offer?.itineraries?.[1] : null;
                const retSegments = retItin?.segments || [];
                const retStops = retSegments.length > 0 ? retSegments.length - 1 : null;
                const retDuration = retItin?.duration || "";
                const retDurationText = retDuration
                  ? retDuration.replace("PT", "").replace("H", "h ").replace("M", "m").trim()
                  : "";
                const retDepAirport = retSegments[0]?.departure?.iataCode || "";
                const retArrAirport = retSegments[retSegments.length - 1]?.arrival?.iataCode || "";
                const retDepName = airportName(retDepAirport);
                const retArrName = airportName(retArrAirport);

                return (
                  <div key={origin} className={`wc-flight-card${cleanOrigins.length > 1 && origin === cheapestOrigin ? " wc-flight-card--cheapest" : ""}`}>
                    {cleanOrigins.length > 1 && origin === cheapestOrigin && (
                      <div className="wc-cheapest-label">{t("results.cheapestOrigin")}</div>
                    )}
                    {finfo.dateFallback && (
                      <div className="wc-flight-meta" title={t("results.dateFallbackHint")}>
                        <span className="wc-flight-meta-item wc-flight-meta--stops">
                          <Calendar size={13} aria-hidden="true" /> {t("results.dateFallbackChip", { date: formatDate(effDep) })}{tripType === "roundtrip" && effRet ? ` → ${formatDate(effRet)}` : ""}
                        </span>
                      </div>
                    )}
                    <div className="wc-flight-route">
                      <div className="wc-flight-endpoint">
                        <span className="wc-flight-code">{countryFlag(origin)} {origin}</span>
                        <span className="wc-flight-city">{originCity}</span>
                      </div>
                      <div className="wc-flight-arrow-wrap">
                        <div className="wc-flight-line" />
                        <span className="wc-flight-plane"><Plane size={14} aria-hidden="true" /></span>
                        <div className="wc-flight-line" />
                      </div>
                      <div className="wc-flight-endpoint wc-flight-endpoint--right">
                        <span className="wc-flight-code">{code}</span>
                        <span className="wc-flight-city">{destCity}</span>
                      </div>
                      <div className="wc-flight-price-tag">
                        {typeof price === "number" ? (currency === "EUR" ? formatEur(price, 0) : convertPrice(price, currency)) : "—"}
                        {(offer?.passengers || 0) > 1 && (
                          <span className="wc-flight-pax-badge">×{offer.passengers}</span>
                        )}
                      </div>
                    </div>
                    {/* Outbound itinerary */}
                    {(airline || stops !== null || durationText) && (
                      <div className="wc-flight-meta">
                        <span className="wc-flight-meta-item wc-flight-meta-leg">{t("results.outbound")}</span>
                        {airline && <span className="wc-flight-meta-item wc-flight-meta-airline"><img src={airlineLogo(airline)} alt={airline} className="wc-airline-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} /><span className="wc-airline-badge">{airline}</span></span>}
                        {durationText && <span className="wc-flight-meta-item">{durationText}</span>}
                        {stops !== null && (
                          <span className={`wc-flight-meta-item ${stops === 0 ? "wc-flight-meta--direct" : "wc-flight-meta--stops"}`}>
                            {stops === 0 ? t("results.direct") : t("results.stops", { n: stops })}
                          </span>
                        )}
                        {(depName || arrName) && (
                          <span className="wc-flight-meta-item wc-flight-meta-airport">
                            {depAirport}{depName ? ` ${depName}` : ""} → {arrAirport}{arrName ? ` ${arrName}` : ""}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Return itinerary */}
                    {retItin && (retStops !== null || retDurationText) && (
                      <div className="wc-flight-meta wc-flight-meta--return">
                        <span className="wc-flight-meta-item wc-flight-meta-leg">{t("results.returnLeg")}</span>
                        {retDurationText && <span className="wc-flight-meta-item">{retDurationText}</span>}
                        {retStops !== null && (
                          <span className={`wc-flight-meta-item ${retStops === 0 ? "wc-flight-meta--direct" : "wc-flight-meta--stops"}`}>
                            {retStops === 0 ? t("results.direct") : t("results.stops", { n: retStops })}
                          </span>
                        )}
                        {(retDepName || retArrName) && (
                          <span className="wc-flight-meta-item wc-flight-meta-airport">
                            {retDepAirport}{retDepName ? ` ${retDepName}` : ""} → {retArrAirport}{retArrName ? ` ${retArrName}` : ""}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="wc-flight-ctas">
                      {/* CTA principal: deep link de Aviasales con marker de
                          afiliado (única vía de monetización). Lleva la búsqueda
                          exacta de este precio ya hecha. */}
                      {offer?.link && (
                        <a href={offer.link} target="_blank" rel="noreferrer" className="wc-cta wc-cta--book"
                          onClick={() => track("book_click", { provider: "travelpayouts", dest: code, origin, where: "winner" })}>
                          <span className="wc-cta-icon"><Ticket size={16} aria-hidden="true" /></span>
                          {t("results.bookCta")}
                        </a>
                      )}
                      {ssUrl && (
                        <a href={ssUrl} target="_blank" rel="noreferrer" className="wc-cta"
                          onClick={() => track("book_click", { provider: "skyscanner", dest: code, origin, where: "winner" })}>
                          <span className="wc-cta-icon"><Search size={16} aria-hidden="true" /></span>
                          Skyscanner
                        </a>
                      )}
                      {gfUrl && (
                        <a href={gfUrl} target="_blank" rel="noreferrer" className="wc-cta wc-cta--google"
                          onClick={() => track("book_click", { provider: "google", dest: code, origin, where: "winner" })}>
                          <span className="wc-cta-icon"><Plane size={16} aria-hidden="true" /></span>
                          Google Flights
                        </a>
                      )}
                      <button type="button" className="wc-cta wc-cta--copy" onClick={() => {
                        const txt = `${originCity || origin} → ${destCity} · ${typeof price === "number" ? (currency === "EUR" ? formatEur(price, 0) : convertPrice(price, currency)) : "—"}${durationText ? ` · ${durationText}` : ""}`;
                        copyText(txt);
                      }} title={t("results.copyFlight")} aria-label={t("results.copyFlight")}>
                        <Copy size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            </div>{/* /wc-booking-collapse */}
          </div>
        )}

        {/* Actions */}
        <div className="wc-actions">
          <button type="button" className="wc-action-btn wc-action-btn--primary" onClick={onViewAlternatives}>
            {t("results.viewAlternatives")}
          </button>
          {/* Mobile: one "Share" → native OS sheet (covers WhatsApp/Telegram/Email/…).
              Desktop (no Web Share API): copy-link + explicit Telegram/Email so those
              channels stay reachable. */}
          {canNativeShare ? (
            <button type="button" className="wc-action-btn wc-action-btn--share" onClick={onShareNative}>
              <Share2 size={14} aria-hidden="true" /> {t("results.share")}
            </button>
          ) : (
            <button type="button" className="wc-action-btn" onClick={onShare}>
              {shareStatus === "ok" ? t("results.copied") : shareStatus === "saving" ? "…" : shareStatus === "fail" ? t("results.copyFailed") : t("results.share")}
            </button>
          )}
          <button type="button" className="wc-action-btn wc-action-btn--whatsapp" onClick={onShareWhatsApp}>
            <span className="wc-wa-icon"><MessageCircle size={15} aria-hidden="true" /></span> WhatsApp
          </button>
          {!canNativeShare && (
            <>
              <button type="button" className="wc-action-btn" onClick={onShareTelegram}>
                <Send size={14} aria-hidden="true" /> Telegram
              </button>
              <button type="button" className="wc-action-btn" onClick={onShareEmail}>
                <Mail size={14} aria-hidden="true" /> Email
              </button>
            </>
          )}
          {onCopySearchLink && (
            <button type="button" className="wc-action-btn wc-action-btn--link" onClick={onCopySearchLink}>
              <Link2 size={14} aria-hidden="true" /> {t("results.copySearchLink")}
            </button>
          )}
          <button type="button" className="wc-action-btn wc-action-btn--link" onClick={onChangeSearch}>
            {t("results.changeSearch")}
          </button>
        </div>

        {/* Search badges */}
        {searchBadges.length > 0 && (
          <div className="wc-badges">
            {searchBadges.map((b, i) => (
              <span key={i} className="wc-badge">{b}</span>
            ))}
          </div>
        )}

        <div className="wc-disclaimer">{t("results.disclaimer")}</div>
      </div>
    </div>
  );
});

export default WinnerCard;
