// ─── WinnerCard ──────────────────────────────────────────────────────────────
// Extraída de App.jsx (Mejora 21). Tarjeta del destino ganador: precios
// animados, badge de verificación, desglose por origen, CTAs de reserva y
// acciones de compartir. Incluye sus helpers privados.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import {
  normalizeCode, cityOf, formatEur, formatDate, getBaseUrl, copyText,
  buildSkyscannerUrl, buildGoogleFlightsUrl, countryFlag, destQuickInfo, airportName, fairnessColor,
} from "../utils/helpers";
import { convertPrice, approxDistKm } from "../utils/resultsLogic";
import { getCityImage } from "../utils/cityImages";
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

const DEST_CATEGORIES = {
  beach:   new Set(["AGP","PMI","TFS","NCE","MLA","DBV","SPU","RHO","TLV"]),
  budget:  new Set(["OPO","NAP","KRK","BEG","OTP","SOF","TIA","RAK","TLL","RIX","VNO","SKG"]),
  capital: new Set(["LON","PAR","ROM","BER","MAD","LIS","VIE","PRG","ATH","CPH","BUD","DUB","BRU","WAW","OSL","HEL","STO"]),
};

function destCategoryTags(code, t) {
  const tags = [];
  if (DEST_CATEGORIES.beach.has(code))   tags.push({ key: "beach",   label: t("search.destCatBeach") });
  if (DEST_CATEGORIES.budget.has(code))  tags.push({ key: "budget",  label: t("search.destCatBudget") });
  if (DEST_CATEGORIES.capital.has(code)) tags.push({ key: "capital", label: t("search.destCatCapital") });
  return tags;
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
  breakdown.forEach((f) => {
    const k = String(f.origin).toUpperCase();
    priceMap[k] = f.price;
    offerMap[k] = f.offer || null;
  });

  // Price comparison vs last search
  const priceVsLast = useMemo(() => {
    if (!lastBestPrice || !dest?.averageCostPerTraveler || lastBestPrice === dest.averageCostPerTraveler) return null;
    const diff = dest.averageCostPerTraveler - lastBestPrice;
    const pct = Math.round((Math.abs(diff) / lastBestPrice) * 100);
    if (pct < 2) return null; // ignore tiny differences
    return { cheaper: diff < 0, pct, diff: Math.abs(diff) };
  }, [lastBestPrice, dest]);

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

  // Trip duration in days (roundtrip only)
  const tripDays = useMemo(() => {
    if (tripType !== "roundtrip") return 0;
    const d = dep || depDate;
    const r = ret;
    if (!d || !r) return 0;
    const diff = (new Date(r + "T00:00:00") - new Date(d + "T00:00:00")) / 86400000;
    return diff > 0 ? Math.round(diff) : 0;
  }, [tripType, dep, ret, depDate]);

  return (
    <div className={`wc-card${entered ? " wc-card--entered" : ""}`}>
      {/* Confetti burst on entrance */}
      {entered && (
        <div className="wc-confetti" aria-hidden="true">
          {[...Array(12)].map((_, i) => <span key={i} className="wc-confetti-piece" style={{ "--ci": i }} />)}
        </div>
      )}
      {/* Hero image */}
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          <div className="wc-badge-winner">{t("results.eyebrow")}</div>
          <span className="wc-dest-code">{city || code}</span>
          {city && <span className="wc-dest-city">{code}</span>}
          {/* Destination category tags */}
          {(() => {
            const cats = destCategoryTags(code, t);
            if (!cats.length) return null;
            return (
              <div className="wc-dest-categories">
                {cats.map(c => <span key={c.key} className={`wc-dest-cat wc-dest-cat--${c.key}`}>{c.label}</span>)}
              </div>
            );
          })()}
        </div>
        <button type="button" className={`wc-fav-btn${isFav ? " wc-fav-btn--active" : ""}`} onClick={onToggleFav} aria-label={t("results.favorite")} title={t("results.favorite")}>
          {isFav ? "❤️" : "🤍"}
        </button>
        {/* Savings + trip duration + countdown + vs last search chips */}
        <div className="wc-chips-overlay">
          {/* Verification badge (first so it's the most visible trust signal) */}
          <VerificationBadge dest={dest} />
          {/* Countdown to departure */}
          {(() => {
            const depD = dep || depDate;
            if (!depD) return null;
            const days = Math.ceil((new Date(depD + "T00:00:00") - new Date()) / 86400000);
            if (days < 0 || days > 365) return null;
            const urgency = days <= 3 ? "urgent" : days <= 14 ? "soon" : "normal";
            return (
              <span className={`wc-countdown-chip wc-countdown-chip--${urgency}`}>
                {days === 0 ? t("results.countdownToday") : days === 1 ? t("results.countdownTomorrow") : t("results.countdownDays", { n: days })}
              </span>
            );
          })()}
          {savingsPct > 5 && (
            <span className="wc-savings-chip">
              {t("results.savingsPct", { pct: savingsPct })}
            </span>
          )}
          {tripDays > 0 && (
            <span className="wc-trip-days-chip">
              {t("results.tripDays", { n: tripDays })}
            </span>
          )}
          {priceVsLast && (
            <span className={`wc-vs-last-chip${priceVsLast.cheaper ? " wc-vs-last-chip--cheaper" : " wc-vs-last-chip--pricier"}`}>
              {priceVsLast.cheaper
                ? t("results.vsLastCheaper", { pct: priceVsLast.pct })
                : t("results.vsLastPricier", { pct: priceVsLast.pct })}
            </span>
          )}
        </div>
      </div>

      {/* Destination quick info (timezone, language, currency) */}
      {(() => {
        const qi = destQuickInfo(code);
        if (!qi) return null;
        return (
          <div className="wc-quick-info">
            {qi?.tz && <span className="wc-quick-info-item">🕐 UTC{qi.tz}</span>}
            {qi?.lang && <span className="wc-quick-info-item">🗣️ {qi.lang}</span>}
            {qi?.currency && <span className="wc-quick-info-item">💱 {qi.currency}</span>}
          </div>
        );
      })()}

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
          <div className="wc-summary-label">{t("results.fairnessLabel")} <span className="wc-fairness-help">?</span></div>
          <div className="wc-summary-fairness">
            <svg className="wc-fairness-ring" viewBox="0 0 40 40" width="44" height="44">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
              <circle cx="20" cy="20" r="16" fill="none" stroke={fairness.color} strokeWidth="3"
                strokeDasharray={`${((dest.fairnessScore ?? 0) / 100) * 100.53} 100.53`}
                strokeLinecap="round" transform="rotate(-90 20 20)"
                style={{ transition: "stroke-dasharray .8s ease" }} />
              <text x="20" y="22" textAnchor="middle" fill={fairness.color} fontSize="11" fontWeight="800">
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
        {/* Criterion toggle */}
        <div className="wc-criterion-row">
          <div className="wc-criterion-pills">
            {[["total", t("results.criterionPrice")], ["fairness", t("results.criterionFairness")]].map(([v, l]) => (
              <button key={v} type="button"
                className={`wc-criterion-pill${uiCriterion === v ? " wc-criterion-pill--active" : ""}`}
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
            <button type="button" className="wc-booking-toggle" onClick={() => setBookingOpen((v) => !v)}>
              <div>
                <div className="wc-booking-title">{t("results.bookTitle")}</div>
                <div className="wc-booking-sub">{t("results.bookSub")}</div>
              </div>
              <span className={`wc-booking-chevron${bookingOpen ? " wc-booking-chevron--open" : ""}`}>▾</span>
            </button>

            <div className={`wc-booking-collapse${bookingOpen ? " wc-booking-collapse--open" : ""}`}>
            <div className="wc-booking-cards">
              {cleanOrigins.map((origin) => {
                const price = priceMap[origin];
                const offer = offerMap[origin];
                const originCity = cityOf(origin);
                const destCity = city || code;
                const ssUrl = buildSkyscannerUrl({ origin, destination: code, departureDate: dep, returnDate: ret, tripType });
                const gfUrl = buildGoogleFlightsUrl({ origin, destination: code, departureDate: dep, returnDate: ret, tripType });

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
                    <div className="wc-flight-route">
                      <div className="wc-flight-endpoint">
                        <span className="wc-flight-code">{countryFlag(origin)} {origin}</span>
                        <span className="wc-flight-city">{originCity}</span>
                      </div>
                      <div className="wc-flight-arrow-wrap">
                        <div className="wc-flight-line" />
                        <span className="wc-flight-plane">✈</span>
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
                        {typeof price === "number" && (() => {
                          const km = approxDistKm(origin, code);
                          if (!km || km < 50) return null;
                          const ppkm = (price / km).toFixed(2);
                          return <span className="wc-km-badge">€{ppkm}/km</span>;
                        })()}
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
                    {/* Duration comparison bar */}
                    {durationText && (() => {
                      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
                      if (!match) return null;
                      const mins = (parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0);
                      if (!mins) return null;
                      const maxMins = 12 * 60; // 12h reference
                      const pct = Math.min(100, (mins / maxMins) * 100);
                      const color = mins <= 120 ? "#22C55E" : mins <= 300 ? "var(--primary)" : "#F59E0B";
                      return (
                        <div className="wc-duration-bar-wrap">
                          <div className="wc-duration-bar">
                            <div className="wc-duration-bar-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="wc-duration-bar-label">{durationText}</span>
                        </div>
                      );
                    })()}
                    <div className="wc-flight-ctas">
                      {ssUrl && (
                        <a href={ssUrl} target="_blank" rel="noreferrer" className="wc-cta wc-cta--skyscanner">
                          <span className="wc-cta-icon">🔍</span>
                          Skyscanner
                        </a>
                      )}
                      {gfUrl && (
                        <a href={gfUrl} target="_blank" rel="noreferrer" className="wc-cta wc-cta--google">
                          <span className="wc-cta-icon">✈</span>
                          Google Flights
                        </a>
                      )}
                      <button type="button" className="wc-cta wc-cta--copy" onClick={() => {
                        const txt = `${originCity || origin} → ${destCity} · ${typeof price === "number" ? (currency === "EUR" ? formatEur(price, 0) : convertPrice(price, currency)) : "—"}${durationText ? ` · ${durationText}` : ""}`;
                        copyText(txt);
                      }} title={t("results.copyFlight")}>
                        📋
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

              {/* Flight time comparison mini-table */}
              {cleanOrigins.length > 1 && breakdown.length > 1 && (() => {
                const durations = breakdown.map((f) => {
                  const itin = f.offer?.itineraries?.[0];
                  const dur = itin?.duration || "";
                  const match = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
                  const mins = match ? (parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0) : 0;
                  const durText = dur ? dur.replace("PT", "").replace("H", "h ").replace("M", "m").trim() : "";
                  return { origin: String(f.origin).toUpperCase(), mins, durText, price: f.price };
                }).filter(d => d.mins > 0);
                if (durations.length < 2) return null;
                const maxMins = Math.max(...durations.map(d => d.mins));
                return (
                  <div className="wc-flight-compare-section">
                    <div className="wc-flight-compare-title">{t("results.flightComparison")}</div>
                    {durations.map((d) => {
                      const pct = maxMins > 0 ? (d.mins / maxMins) * 100 : 0;
                      const color = d.mins <= 120 ? "#22C55E" : d.mins <= 300 ? "var(--primary)" : "#F59E0B";
                      return (
                        <div key={d.origin} className="wc-flight-compare-row">
                          <span className="wc-flight-compare-origin">{d.origin}</span>
                          <div className="wc-flight-compare-bar-wrap">
                            <div className="wc-flight-compare-bar-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="wc-flight-compare-dur">{d.durText}</span>
                          <span className="wc-flight-compare-price">{currency === "EUR" ? formatEur(d.price, 0) : convertPrice(d.price, currency)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            </div>{/* /wc-booking-collapse */}
          </div>
        )}

        {/* Trip summary compact card */}
        {cleanOrigins.length > 0 && (
          <div className="wc-trip-summary">
            <div className="wc-trip-summary-item">
              <span className="wc-trip-summary-value">{cleanOrigins.length}</span>
              <span className="wc-trip-summary-label">{t("results.originsUsed")}</span>
            </div>
            <div className="wc-trip-summary-sep" />
            <div className="wc-trip-summary-item">
              <span className="wc-trip-summary-value">{currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}</span>
              <span className="wc-trip-summary-label">{t("results.avgPerPerson")}</span>
            </div>
            <div className="wc-trip-summary-sep" />
            <div className="wc-trip-summary-item">
              <span className="wc-trip-summary-value">{(dest.fairnessScore ?? 0).toFixed(0)}</span>
              <span className="wc-trip-summary-label">{t("results.fairnessLabel")}</span>
            </div>
            {tripDays > 0 && (
              <>
                <div className="wc-trip-summary-sep" />
                <div className="wc-trip-summary-item">
                  <span className="wc-trip-summary-value">{tripDays}</span>
                  <span className="wc-trip-summary-label">{t("results.tripSummaryDays")}</span>
                </div>
              </>
            )}
            {(() => {
              const km = approxDistKm(cleanOrigins[0], code);
              if (!km) return null;
              return (
                <>
                  <div className="wc-trip-summary-sep" />
                  <div className="wc-trip-summary-item">
                    <span className="wc-trip-summary-value">{Math.round(km).toLocaleString()}</span>
                    <span className="wc-trip-summary-label">km</span>
                  </div>
                </>
              );
            })()}
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
            <span className="wc-wa-icon">💬</span> WhatsApp
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--telegram" onClick={onShareTelegram}>
            ✈ Telegram
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--summary" onClick={() => {
            const lines = [
              `✈ ${city || code}`,
              `${t("results.groupTotal")}: ${currency === "EUR" ? formatEur(dest.totalCostEUR, 0) : convertPrice(dest.totalCostEUR, currency)}`,
              `${t("results.avgPerPerson")}: ${currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}`,
              `${t("results.fairnessLabel")}: ${(dest.fairnessScore ?? 0).toFixed(0)}/100`,
              "",
              ...breakdown.map((f) => `  ${f.origin}: ${currency === "EUR" ? formatEur(f.price, 0) : convertPrice(f.price, currency)}`),
            ];
            copyText(lines.join("\n"));
          }}>
            📋 {t("results.copySummary")}
          </button>
          <button type="button" className="wc-action-btn wc-action-btn--email" onClick={onShareEmail}>
            ✉ Email
          </button>
          {typeof navigator !== "undefined" && navigator.share && (
            <button type="button" className="wc-action-btn wc-action-btn--native" onClick={onShareNative}>
              📤 {t("results.shareNative")}
            </button>
          )}
          {onCopySearchLink && (
            <button type="button" className="wc-action-btn wc-action-btn--link" onClick={onCopySearchLink}>
              🔗 {t("results.copySearchLink")}
            </button>
          )}
          <button type="button" className="wc-share-img-btn" onClick={() => {
            const canvas = document.createElement("canvas");
            canvas.width = 600; canvas.height = 340;
            const ctx = canvas.getContext("2d");
            // Background gradient
            const bg = ctx.createLinearGradient(0, 0, 600, 340);
            bg.addColorStop(0, "#0062E3"); bg.addColorStop(1, "#7C3AED");
            ctx.fillStyle = bg; ctx.fillRect(0, 0, 600, 340);
            // Text
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.font = "bold 14px system-ui"; ctx.fillText("FlyndMe", 300, 35);
            ctx.font = "bold 32px system-ui"; ctx.fillText(city || code, 300, 80);
            ctx.font = "18px system-ui";
            ctx.fillText(`${t("results.groupTotal")}: ${currency === "EUR" ? formatEur(dest.totalCostEUR, 0) : convertPrice(dest.totalCostEUR, currency)}`, 300, 120);
            ctx.fillText(`${t("results.avgPerPerson")}: ${currency === "EUR" ? formatEur(dest.averageCostPerTraveler, 0) : convertPrice(dest.averageCostPerTraveler, currency)}`, 300, 150);
            ctx.fillText(`${t("results.fairnessLabel")}: ${(dest.fairnessScore ?? 0).toFixed(0)}/100`, 300, 180);
            // Per-origin breakdown
            ctx.font = "14px system-ui"; ctx.fillStyle = "rgba(255,255,255,.85)";
            breakdown.forEach((f, i) => {
              const km = approxDistKm(String(f.origin).toUpperCase(), code);
              const kmStr = km ? ` · ${Math.round(km)} km` : "";
              ctx.fillText(`${f.origin}: ${currency === "EUR" ? formatEur(f.price, 0) : convertPrice(f.price, currency)}${kmStr}`, 300, 220 + i * 24);
            });
            ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "11px system-ui";
            ctx.fillText("flyndme.com", 300, 330);
            canvas.toBlob((blob) => {
              if (!blob) return;
              try {
                const item = new ClipboardItem({ "image/png": blob });
                navigator.clipboard.write([item]);
              } catch { /* fallback: download */ }
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `flyndme-${code}.png`;
              a.click(); URL.revokeObjectURL(url);
            });
          }}>
            🖼️ Share as image
          </button>
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
