// ─── WinnerCard ──────────────────────────────────────────────────────────────
// Extraída de App.jsx (Mejora 21). Tarjeta del destino ganador: precios
// animados, badge de verificación, desglose por origen, CTAs de reserva y
// acciones de compartir. Incluye sus helpers privados.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import {
  normalizeCode, cityOf, formatEur, formatDate, getBaseUrl, copyText,
  buildSkyscannerUrl, buildGoogleFlightsUrl, countryFlag, airportName,
} from "../utils/helpers";
import { convertPrice, travelerSlot, paySpread } from "../utils/resultsLogic";
import { track } from "../utils/analytics";
import "../styles/results-simple.css";
import { getCityImage } from "../utils/cityImages";
import { Heart, Calendar, CalendarClock, Plane, Ticket, Search, Copy, MessageCircle, Link2, Share2, Send, Mail, ShieldCheck, Info, ChevronDown, Bell, BellRing } from "lucide-react";
import VerificationBadge from "./VerificationBadge";
import { Odometer } from "./Odometer";
import { tapHaptic } from "../utils/haptics";
import { FlapText } from "./FlapBoard";
import { TravelerDot } from "./TravelerBits";

// "HH:MM" de un instante ISO del proveedor (hora local de ese aeropuerto)
function hhmm(at) {
  const m = typeof at === "string" ? /T(\d{2}:\d{2})/.exec(at) : null;
  return m ? m[1] : "";
}

// Logo de aerolínea por código IATA. Primero el CDN de Aviasales (la misma
// fuente que los precios: cubre los códigos que devuelve, p. ej. W4 o MW, que
// en el de Kiwi no existen); si falla, el de Kiwi; si falla también, solo el
// código en su ficha (nunca un icono roto).
const AIRLINE_LOGO_SOURCES = [
  (c) => `https://pics.avs.io/72/24/${c}@2x.png`,
  (c) => `https://images.kiwi.com/airlines/64/${c}.png`,
];
function AirlineLogo({ code }) {
  const [src, setSrc] = useState(0);
  const iata = String(code || "").toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(iata) || src >= AIRLINE_LOGO_SOURCES.length) return null;
  return (
    <img key={src} src={AIRLINE_LOGO_SOURCES[src](iata)} alt="" className={`wc-airline-logo wc-airline-logo--s${src}`}
      loading="lazy" decoding="async" onError={() => setSrc((n) => n + 1)} />
  );
}

// Frase traducida con la cifra dentro ("Media €52 por persona"): se traduce con
// un marcador y la cifra va en odómetro, conservando el orden de cada idioma.
const SLOT = "\u0000";
function WithOdometer({ text, value }) {
  const [pre, post = ""] = String(text).split(SLOT);
  return <>{pre}<Odometer value={value} />{post}</>;
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
  watched = false, onToggleWatch,
  dateHint = null, // { text, actionLabel, onAction } fecha más barata para este destino
  mapSlot = null,  // mapa de rutas (nodo) que acompaña a la foto
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);
  const [openRoute, setOpenRoute] = useState(null); // origen con el detalle del vuelo abierto

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


  // Savings vs average of all destinations
  const savingsPct = useMemo(() => {
    if (!allFlights || allFlights.length < 2 || !dest?.averageCostPerTraveler) return 0;
    const avgAll = allFlights.reduce((s, f) => s + (f.averageCostPerTraveler || 0), 0) / allFlights.length;
    if (avgAll <= 0) return 0;
    return Math.round(((avgAll - dest.averageCostPerTraveler) / avgAll) * 100);
  }, [allFlights, dest]);

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

  const money = (v) => (currency === "EUR" ? formatEur(v, 0) : convertPrice(v, currency));
  const travelers = dest.totalPassengers
    || breakdown.reduce((n, f) => n + (Number(f.passengers) || 1), 0)
    || cleanOrigins.length;
  // Suma de lo que paga cada origen (precio × pasajeros) → total del grupo.
  // Solo se enseña si cuadra con el total del backend (nunca un total propio).
  const sumParts = (() => {
    if (singleOrigin || breakdown.length < 2 || breakdown.length > 6) return null;
    const parts = breakdown.map((f) => Number(f.totalForOrigin) || (Number(f.price) || 0) * (Number(f.passengers) || 1));
    const sum = parts.reduce((a2, v) => a2 + v, 0);
    return Math.abs(sum - (dest.totalCostEUR || 0)) <= 1 ? parts : null;
  })();

  return (
    <div className={`wc-card${entered ? " wc-card--entered" : ""}`}>
      {/* Foto del destino + mapa de rutas, lado a lado (oct-2026): el mapa ya
          no se esconde tras una pestaña al final de la página. */}
      <div className={`wc-top${mapSlot ? " wc-top--map" : ""}`}>
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        {/* Foto A COLOR con degradado oscuro abajo para leer el nombre (el
            duotono amarillo hacía que todas las ciudades parecieran la misma). */}
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          <div className="wc-badge-winner">{t("results.eyebrow")}</div>
          {/* Nombre del destino en panel de salidas: gira y se asienta en el
              valor REAL (el SSR/primer render ya pinta el nombre final). */}
          <span className="wc-dest-code wc-dest-code--flap"><FlapText text={city || code} size="lg" delay={250} /></span>
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
      {mapSlot && <div className="wc-map">{mapSlot}</div>}
      </div>

      {/* ══ Vuestros vuelos: lo que hay que comprar + el total del grupo ══
          Es el centro de la decisión (antes iba debajo de la matriz de precios,
          el reparto y el troquel, y además plegable). */}
      <div className="wc-buy">
        <div className="wc-buy-head">
          <div className="wc-buy-heading">
            <span className="wc-buy-kicker">
              {singleOrigin ? t("results.buyKickerOne") : t("results.buyKicker", { n: cleanOrigins.length })}
            </span>
            <h3 className="wc-buy-title">
              {singleOrigin ? t("results.buyTitleOne", { city: city || code }) : t("results.buyTitle", { city: city || code })}
            </h3>
            <p className="wc-buy-sub">{t("results.bookSub")}</p>
          </div>
          {/* Criterio: control único que gobierna ganador Y alternativas */}
          {!singleOrigin && (
            <div className="wc-criterion-pills" role="group" aria-label={t("results.criterionGroupLabel")}>
              {[["total", t("results.criterionPrice")], ["fairness", t("results.criterionFairness")]].map(([v, l]) => (
                <button key={v} type="button"
                  className={`wc-criterion-pill fm-switch${uiCriterion === v ? " wc-criterion-pill--active" : ""}`}
                  aria-pressed={uiCriterion === v}
                  onClick={() => { tapHaptic(); onChangeCriterion(v); }}><span className="fm-led" aria-hidden="true" />{l}</button>
              ))}
            </div>
          )}
        </div>

        {cleanOrigins.length > 0 && dep && (
          <div className="wc-booking-cards">
              {cleanOrigins.map((origin, cardIdx) => {
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
                const ssUrl = buildSkyscannerUrl({ origin: ssOrigin, destination: ssDest, departureDate: effDep, returnDate: effRet, tripType,
                  adults: Number(finfo.passengers) || Number(offer?.passengers) || 1 });
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

                // Detalle al abrir la ruta (datos del billete, nada inventado)
                const routeOpen = openRoute === origin;
                const depTime = hhmm(segments[0]?.departure?.at);
                const retTime = hhmm(retSegments[0]?.departure?.at);
                const flightNo = segments[0]?.carrierCode && segments[0]?.number ? `${segments[0].carrierCode} ${segments[0].number}` : "";
                const pax = Number(finfo.passengers) || Number(offer?.passengers) || 1;
                const legTotal = Number(finfo.totalForOrigin) || (typeof price === "number" ? price * pax : 0);

                return (
                  <div key={origin} className="wc-flight-card">
                    {finfo.dateFallback && (
                      <div className="wc-flight-meta" title={t("results.dateFallbackHint")}>
                        <span className="wc-flight-meta-item wc-flight-meta--stops">
                          <Calendar size={13} aria-hidden="true" /> {t("results.dateFallbackChip", { date: formatDate(effDep) })}{tripType === "roundtrip" && effRet ? ` → ${formatDate(effRet)}` : ""}
                        </span>
                      </div>
                    )}
                    {/* Ruta pulsable: abre el detalle del vuelo. Cerrada, un
                        destello de navegación recorre la línea cada 2,5 s;
                        al abrirla la línea se dibuja y el avión despega. */}
                    <button type="button"
                      className={`wc-flight-route${routeOpen ? " wc-flight-route--open" : ""}`}
                      aria-expanded={routeOpen} aria-controls={`wc-fd-${origin}`}
                      onClick={() => setOpenRoute((r) => (r === origin ? null : origin))}>
                      <span className="wc-flight-endpoint">
                        <span className="wc-flight-code">
                          {!singleOrigin && <TravelerDot origins={cleanOrigins} code={origin} />}
                          {countryFlag(origin)} {origin}
                        </span>
                        <span className="wc-flight-city">{originCity}</span>
                      </span>
                      <span className="wc-flight-arrow-wrap" style={{ "--k": cardIdx }}>
                        <span className="wc-flight-line" />
                        <span className="wc-flight-plane"><Plane size={14} aria-hidden="true" /></span>
                        <span className="wc-flight-line" />
                        <span className="wc-strobe-lane" aria-hidden="true"><span className="wc-strobe"><i /></span></span>
                        <span className="wc-route-draw" aria-hidden="true" />
                        <span className="wc-takeoff" aria-hidden="true"><span className="wc-takeoff-plane"><Plane size={14} /></span></span>
                      </span>
                      <span className="wc-flight-endpoint wc-flight-endpoint--right">
                        <span className="wc-flight-code">{code}</span>
                        <span className="wc-flight-city">{destCity}</span>
                      </span>
                      <span className="wc-flight-price-tag">
                        {typeof price === "number" ? <Odometer value={money(price)} /> : "—"}
                        {(offer?.passengers || 0) > 1 && (
                          <span className="wc-flight-pax-badge">×{offer.passengers}</span>
                        )}
                      </span>
                      <ChevronDown size={16} className="wc-flight-chev" aria-hidden="true" />
                      <span className="flap-sr">{routeOpen ? t("results.fdClose") : t("results.fdOpen")}</span>
                    </button>
                    {/* Detalle del vuelo: solo datos reales del billete (hora de
                        salida local tal cual la da el proveedor; la de llegada
                        no, porque no conocemos la zona horaria del destino). */}
                    {routeOpen && (
                      <dl id={`wc-fd-${origin}`} className="wc-fd">
                        {effDep && (
                          <div className="wc-fd-item">
                            <dt>{t("results.fdDeparture")}</dt>
                            <dd>{formatDate(effDep)}{depTime ? ` · ${depTime} ${t("results.fdLocal")}` : ""}</dd>
                          </div>
                        )}
                        {tripType === "roundtrip" && effRet && (
                          <div className="wc-fd-item">
                            <dt>{t("results.fdReturn")}</dt>
                            <dd>{formatDate(effRet)}{retTime ? ` · ${retTime} ${t("results.fdLocal")}` : ""}</dd>
                          </div>
                        )}
                        {flightNo && (
                          <div className="wc-fd-item">
                            <dt>{t("results.fdFlight")}</dt>
                            <dd>{flightNo}</dd>
                          </div>
                        )}
                        {typeof price === "number" && (
                          <div className="wc-fd-item">
                            <dt>{t("results.fdTravelers")}</dt>
                            <dd>{pax} × {money(price)} = <strong>{money(legTotal)}</strong></dd>
                          </div>
                        )}
                      </dl>
                    )}
                    {/* Outbound itinerary */}
                    {(airline || stops !== null || durationText) && (
                      <div className="wc-flight-meta">
                        <span className="wc-flight-meta-item wc-flight-meta-leg">{t("results.outbound")}</span>
                        {airline && <span className="wc-flight-meta-item wc-flight-meta-airline"><AirlineLogo code={airline} /><span className="wc-airline-badge">{airline}</span></span>}
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
        )}

        {/* Cómputo global: la suma de los vuelos = total del grupo (datos del
            backend; la suma solo se muestra si cuadra con su total). */}
        <div className="wc-total">
          <div className="wc-total-main">
            <span className="wc-total-label">{travelers === 1 ? t("results.totalOne") : t("results.groupTotal")}</span>
            {/* Cifras de odómetro: al cambiar de fecha, destino o criterio los
                dígitos se deslizan hasta el valor real (≤300 ms) */}
            <div className="wc-total-price"><Odometer value={money(dest.totalCostEUR)} /></div>
          </div>
          {sumParts && (
            <div className="wc-total-sum" aria-hidden="true">
              {sumParts.map((v, i) => <span key={i}>{i > 0 && <b> + </b>}{money(v)}</span>)}
              <b> = </b><strong>{money(dest.totalCostEUR)}</strong>
            </div>
          )}
          <div className="wc-total-meta">
            {!singleOrigin && <span>{t("results.flightsCount", { n: cleanOrigins.length })}</span>}
            <span>{travelers === 1 ? t("results.travelerOne") : t("board.travelers", { n: travelers })}</span>
            {!singleOrigin && <span><WithOdometer text={t("results.whoPaysAvg", { amount: SLOT })} value={money(dest.averageCostPerTraveler)} /></span>}
            {dep && <span>{tripType === "roundtrip" ? t("results.roundtripTag") : t("results.onewayTag")} · {tripType === "roundtrip" && ret ? `${formatDate(dep)} → ${formatDate(ret)}` : formatDate(dep)}</span>}
          </div>

          {/* Fecha más barata para ESTE destino: cambia el total, así que va aquí */}
          {dateHint && (
            <div className="wc-total-hint">
              <CalendarClock size={16} aria-hidden="true" />
              <span className="wc-total-hint-text">{dateHint.text}</span>
              <button type="button" className="wc-total-hint-btn" onClick={dateHint.onAction}>{dateHint.actionLabel}</button>
            </div>
          )}

          {/* Estimación honesta + comprobación en vivo bajo demanda (#5) */}
          <div className="wc-total-foot" aria-live="polite">
            {verifyPhase === "loading" ? (
              <span className="wc-verify-status">
                <span className="spinner-border spinner-border-sm" aria-hidden="true" /> {t("results.verifyChecking")}
              </span>
            ) : verifyPhase === "unavailable" ? (
              <span className="wc-verify-status">
                <Info size={14} aria-hidden="true" /> {t("results.verifyUnavailable")}
              </span>
            ) : dest.verificationStatus === "skipped" ? (
              <>
                <span className="wc-verify-caption">{t("results.verifyCaption")}</span>
                <button type="button" className="wc-verify-btn" onClick={onVerify}>
                  <ShieldCheck size={15} aria-hidden="true" /> {t("results.verifyCta")}
                </button>
              </>
            ) : dest.verificationStatus === "verified" || dest.verificationStatus === "changed" ? (
              <span className="wc-verify-caption wc-verify-caption--ok">
                <ShieldCheck size={14} aria-hidden="true" /> {dest.verificationStatus === "changed" ? t("results.totalChanged") : t("results.totalVerified")}
              </span>
            ) : (
              <span className="wc-verify-caption">{t("board.estimateNote")}</span>
            )}
          </div>
        </div>
      </div>

      {/* Troquel de tarjeta de embarque: separa la compra del resto. Decorativo
          salvo la línea de datos reales. */}
      <div className="wc-perf">
        <span className="wc-perf-text">
          {t("results.boardingPass")}
          {!singleOrigin && <> · {t("results.boardingMeta", { n: cleanOrigins.length })}</>}
        </span>
        {/* Sello de embarque: se estampa al aparecer la tarjeta y otra vez al
            cambiar de destino (key). Solo datos reales: código y fecha. */}
        <span key={code} className="wc-stamp" aria-hidden="true">
          <span className="wc-stamp-label">{t("results.stampLabel")}</span>
          <span className="wc-stamp-code">{code}</span>
          {dep && <span className="wc-stamp-date">{formatDate(dep)}</span>}
        </span>
        <span className="wc-perf-barcode" aria-hidden="true" />
      </div>

      {/* Body */}
      <div className="wc-body">
        {/* Actions */}
        <div className="wc-actions">
          {/* Baja al panel de salidas (solo si hay más de un destino). "Cambiar
              búsqueda" ya está en la cabecera del vuelo y en la barra fija. */}
          {flightsCount > 1 && (
            <button type="button" className="wc-action-btn wc-action-btn--primary" onClick={onViewAlternatives}>
              {t("results.viewAlternatives")}
            </button>
          )}
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
          {onToggleWatch && (
            <button type="button" className={`wc-action-btn wc-action-btn--watch${watched ? " wc-action-btn--on" : ""}`}
              onClick={onToggleWatch} aria-pressed={watched} title={t("watch.hint")}>
              {watched ? <BellRing size={14} aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />}
              {" "}{watched ? t("watch.on") : t("watch.cta")}
            </button>
          )}
        </div>
        {watched && <p className="wc-watch-note">{t("watch.hint")}</p>}

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

// "Quién paga qué" como indicador ILS (sep-2026): la media del grupo es el eje
// de pista (localizador) y un diamante por origen marca cuánto se desvía de
// ella su precio real por persona (izquierda = paga menos, derecha = paga
// más). Al tocar una fila, la torre lo traduce a lenguaje de amigos: quien
// paga menos que la media pone la diferencia en el bote común; quien paga más
// la toma. Mismo criterio que el reparto "a partes iguales" de CostSplitCard.
const ILS_EVEN = 2; // |desvío| < 2 € = centrado (igual que CostSplitCard)

export function WhoPaysStrip({ dest, currency = "EUR", origins = [] }) {
  const { t } = useI18n();
  const [sel, setSel] = useState(null);
  const rows = (Array.isArray(dest?.flights) ? dest.flights : [])
    .map((f) => ({ origin: String(f.origin).toUpperCase(), price: Number(f.price) || 0, pax: Number(f.passengers) || 1 }))
    .filter((r) => r.price > 0);
  if (rows.length < 2) return null;
  const avg = dest.averageCostPerTraveler || rows.reduce((a, r) => a + r.price, 0) / rows.length;
  const maxDev = Math.max(ILS_EVEN, ...rows.map((r) => Math.abs(r.price - avg)));
  const money = (v) => (currency === "EUR" ? formatEur(v, 0) : convertPrice(v, currency));
  const order = origins.length ? origins : rows.map((r) => r.origin);

  const tower = (r) => {
    const dev = r.price - avg;
    const abs = Math.abs(dev);
    if (abs < ILS_EVEN) return { read: `${r.origin}: ±${money(0)}`, say: t("results.ilsEven"), kind: "even" };
    const amount = money(abs);
    const say = dev < 0 ? t("results.ilsPuts", { amount }) : t("results.ilsTakes", { amount });
    const each = r.pax > 1 ? t("results.ilsEach", { n: r.pax, total: money(abs * r.pax) }) : "";
    return { read: `${r.origin}: ${dev < 0 ? "\u2212" : "+"}${amount}`, say, each, kind: dev < 0 ? "puts" : "takes" };
  };

  return (
    <div className="wc-fs wc-ils">
      <div className="wc-fs-head">
        <span className="wc-fs-title">{t("results.whoPaysTitle")}</span>
        {/* Dato neutro (la diferencia en €) en vez de un veredicto en rojo;
            solo se destaca, en verde, cuando el reparto es parejo. */}
        <span className={`wc-fs-verdict${(dest?.fairnessScore ?? 0) >= 65 ? " wc-fs-verdict--even" : ""}`}>
          {(dest?.fairnessScore ?? 0) >= 65 ? t("board.payEven") : t("board.paySpread", { amount: money(paySpread(dest)) })}
        </span>
      </div>
      {/* Escala del localizador: paga menos ← media → paga más */}
      <div className="wc-ils-scale" aria-hidden="true">
        <span>{t("results.ilsLess")}</span>
        <span className="wc-ils-scale-mid">{t("results.whoPaysAvg", { amount: money(avg) })}</span>
        <span>{t("results.ilsMore")}</span>
      </div>
      <div className="wc-ils-rows">
        {rows.map((r, i) => {
          const dev = r.price - avg;
          const k = Math.max(-1, Math.min(1, dev / maxDev));
          const centered = Math.abs(dev) < ILS_EVEN;
          // Color = identidad del viajero (el mismo en toda la app), no un
          // semáforo: quién paga más ya lo dice la posición del diamante.
          const color = "var(--trav, var(--slate-500))";
          const open = sel === r.origin;
          const tw = open ? tower(r) : null;
          return (
            <React.Fragment key={r.origin}>
              <button type="button" className={`wc-fs-row wc-ils-row trav-c${travelerSlot(order, r.origin)}${open ? " wc-ils-row--sel" : ""}`}
                style={{ "--i": i }} aria-expanded={open} aria-controls={`wc-twr-${r.origin}`}
                onClick={() => setSel((s) => (s === r.origin ? null : r.origin))}>
                <span className="wc-fs-code">{countryFlag(r.origin)} {r.origin}</span>
                <span className="wc-ils-track" aria-hidden="true">
                  <span className="wc-ils-bar" style={{ transform: `scaleX(${k.toFixed(3)})`, background: color }} />
                  <span className="wc-ils-pos" style={{ transform: `translateX(${(k * 42).toFixed(2)}%)` }}>
                    <span className={`wc-ils-diamond${centered ? " wc-ils-diamond--on" : ""}`} style={{ background: color }} />
                  </span>
                </span>
                <span className="wc-fs-price"><Odometer value={money(r.price)} /></span>
              </button>
              {open && (
                <div id={`wc-twr-${r.origin}`} className={`wc-twr wc-twr--${tw.kind}`} role="status">
                  <span className="wc-twr-tag">TWR</span>
                  <span className="wc-twr-read">[ {tw.read} ]</span>
                  <span className="wc-twr-arrow" aria-hidden="true">→</span>
                  <span className="wc-twr-say">{tw.say}{tw.each ? <span className="wc-twr-each"> {tw.each}</span> : null}</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {!sel && <div className="wc-ils-hint">{t("results.ilsHint")}</div>}
    </div>
  );
}
