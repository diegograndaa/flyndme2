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
import { Heart, Calendar, Plane, Ticket, Search, Copy, MessageCircle, Link2 } from "lucide-react";
import VerificationBadge from "./VerificationBadge";
import { useCountUp } from "./UiBits";

function useFairnessLabel(score) {
  const { t } = useI18n();
  if (score >= 85) return { text: t("fairness.veryBalanced"),      color: fairnessColor(score) };
  if (score >= 65) return { text: t("fairness.fairlyBalanced"),    color: fairnessColor(score) };
  if (score >= 45) return { text: t("fairness.somewhatUnequal"),   color: fairnessColor(score) };
  return             { text: t("fairness.unequal"),                 color: fairnessColor(score) };
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

  if (!dest) return null;

  const code      = normalizeCode(dest.destination);
  const city      = cityOf(code);
  const imgUrl    = getCityImage(code, getBaseUrl(), { w: 1200, h: 500 });
  const fairness  = useFairnessLabel(dest.fairnessScore ?? 0);
  const dep       = dest.bestDate || "";
  const ret       = dest.bestReturnDate || (tripType === "roundtrip" ? returnDate : "");

  const cleanOrigins = (origins || []).map((o) => String(o).trim().toUpperCase()).filter(Boolean);
  const breakdown    = Array.isArray(dest.flights) ? dest.flights : [];

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
        <div className="wc-summary-divider" />
        <div className="wc-summary-item wc-summary-item--tooltip">
          <div className="wc-summary-label">{t("results.fairnessLabel")} <span className="wc-fairness-help" tabIndex={0} aria-label={t("results.fairnessHelp")}>?</span></div>
          <div className="wc-summary-fairness">
            <svg className="wc-fairness-ring" viewBox="0 0 40 40" width="44" height="44">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
              {/* stroke vía style: fairness.color es var(--fair-*) y los
                  atributos de presentación SVG no soportan var() */}
              <circle cx="20" cy="20" r="16" fill="none" strokeWidth="3"
                strokeDasharray={`${((dest.fairnessScore ?? 0) / 100) * 100.53} 100.53`}
                strokeLinecap="round" transform="rotate(-90 20 20)"
                style={{ stroke: fairness.color, transition: "stroke-dasharray .8s ease" }} />
              {/* Número en blanco: los tonos AA para fondo claro no contrastan
                  sobre la franja navy; el color semántico queda en el anillo */}
              <text x="20" y="22" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800">
                {(dest.fairnessScore ?? 0).toFixed(0)}
              </text>
            </svg>
          </div>
          <div className="wc-tooltip wc-tooltip--fairness">
            <div>{t("results.fairnessHelp")}</div>
            <div className="wc-tooltip-row" style={{ marginTop: 6 }}>
              <span>{t("results.maxSpread")}</span>
              <span>{formatEur(dest.priceSpread ?? 0, 0)}</span>
            </div>
          </div>
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

      {/* Body */}
      <div className="wc-body">
        {/* Criterion toggle: control único que gobierna ganador Y lista de
            alternativas (uiCriterion en App.jsx). */}
        <div className="wc-criterion-row">
          <div className="wc-criterion-pills" role="group" aria-label={t("results.criterionGroupLabel")}>
            {[["total", t("results.criterionPrice")], ["fairness", t("results.criterionFairness")]].map(([v, l]) => (
              <button key={v} type="button"
                className={`wc-criterion-pill${uiCriterion === v ? " wc-criterion-pill--active" : ""}`}
                aria-pressed={uiCriterion === v}
                onClick={() => onChangeCriterion(v)}>{l}</button>
            ))}
          </div>
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

        {/* Fairness detail (collapsible mini) */}
        <div className="wc-fairness-detail">
          <div className="wc-fairness-bar-full">
            <div className="wc-fairness-fill-full" style={{ width: `${Math.min(100, dest.fairnessScore ?? 0)}%` }} />
          </div>
          <div className="wc-fairness-row">
            <span className="wc-fairness-tag-full" style={{ color: fairness.color }}>{fairness.text}</span>
            <span className="wc-fairness-spread">{t("results.maxSpread")}: {formatEur(dest.priceSpread ?? 0, 0)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="wc-actions">
          <button type="button" className="wc-action-btn wc-action-btn--primary" onClick={onViewAlternatives}>
            {t("results.viewAlternatives")}
          </button>
          <button type="button" className="wc-action-btn" onClick={onShare}>
            {shareStatus === "ok" ? t("results.copied") : shareStatus === "saving" ? "…" : shareStatus === "fail" ? t("results.copyFailed") : t("results.share")}
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--whatsapp" onClick={onShareWhatsApp}>
            <span className="wc-wa-icon"><MessageCircle size={15} aria-hidden="true" /></span> WhatsApp
          </button>
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
