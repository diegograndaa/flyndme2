// ─── WinnerCard ──────────────────────────────────────────────────────────────
// Extraída de App.jsx (Mejora 21). Tarjeta del destino ganador: precios
// animados, badge de verificación, desglose por origen, CTAs de reserva y
// acciones de compartir. Incluye sus helpers privados.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import {
  normalizeCode, cityOf, formatEur, formatDate, getBaseUrl, copyText,
  buildSkyscannerUrl, buildGoogleFlightsUrl, countryFlag,
} from "../utils/helpers";
import { buildAirlineBookingUrl } from "../utils/airlineBooking";
import { airlineName, legSchedule } from "../utils/flightTime";
import GroupSalePanel from "./GroupSalePanel";
import { saleMoney } from "./SaleBreakdown";
import { quoteAddsUp } from "../utils/saleCheckout";
import { convertPrice, travelerSlot, paySpread } from "../utils/resultsLogic";
import { visibleSumParts, legEquation } from "../utils/sumEquation";
import { track } from "../utils/analytics";
import "../styles/results-simple.css";
import { getCityImage } from "../utils/cityImages";
import { Heart, Calendar, Plane, Ticket, Search, Copy, Check, MessageCircle, Link2, Share2, Send, Mail, ShieldCheck, Info, ChevronDown, Bell, BellRing } from "lucide-react";
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
function durationLabel(parts, t) {
  if (!parts) return "";
  if (parts.h > 0 && parts.m > 0) return t("results.durHM", { h: parts.h, m: parts.m });
  if (parts.h > 0) return t("results.durH", { h: parts.h });
  if (parts.m > 0) return t("results.durM", { m: parts.m });
  return "";
}

function LegStrip({ kicker, schedule, t }) {
  if (!schedule) return null;
  const { from, to, dep, arr, stops, carrier, duration } = schedule;
  const dur = durationLabel(duration, t);
  const name = airlineName(carrier) || carrier;
  const stopsLabel = stops == null ? "" : (stops === 0 ? t("results.direct") : t("results.stops", { n: stops }));
  if (!dep && !arr && !dur && stops == null && !name && !from && !to) return null;
  return (
    <div className="wc-leg">
      {(name || kicker) && (
        <div className="wc-leg-airline">
          {carrier ? <AirlineLogo code={carrier} /> : null}
          {name ? <span className="wc-leg-name">{name}</span> : null}
          {kicker ? <span className="wc-leg-kicker">{kicker}</span> : null}
        </div>
      )}
      {(from || to || dep || arr || dur || stopsLabel) && (
        <div className="wc-leg-row">
          <div className="wc-leg-end">
            {dep ? <span className="wc-leg-hhmm">{dep}</span> : null}
            {from ? <span className="wc-leg-iata">{from}</span> : null}
          </div>
          <div className="wc-leg-mid">
            {dur ? <span className="wc-leg-dur">{dur}</span> : null}
            <span className="wc-leg-track" aria-hidden="true">
              <span className="wc-leg-line" />
              <Plane size={12} />
            </span>
            {stopsLabel ? (
              <span className={stops === 0 ? "wc-leg-kind wc-leg-kind--direct" : "wc-leg-kind"}>{stopsLabel}</span>
            ) : null}
          </div>
          <div className="wc-leg-end wc-leg-end--arr">
            {arr ? <span className="wc-leg-hhmm">{arr}</span> : null}
            {to ? <span className="wc-leg-iata">{to}</span> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function AirlineLogo({ code }) {
  const [src, setSrc] = useState(0);
  const iata = String(code || "").toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(iata) || src >= AIRLINE_LOGO_SOURCES.length) return null;
  return (
    <img key={src} src={AIRLINE_LOGO_SOURCES[src](iata)} alt="" className={`wc-airline-logo wc-airline-logo--s${src}`}
      loading="lazy" decoding="async" onError={() => setSrc((n) => n + 1)} />
  );
}

const WinnerCard = React.memo(function WinnerCard({
  dest, origins, tripType, returnDate, departureDate: depDate,
  uiCriterion, onChangeCriterion,
  flightsCount, allFlights = [], lastBestPrice = 0,
  onShare, onShareWhatsApp, onShareTelegram, onShareEmail, onShareNative, onCopySearchLink, shareStatus,
  onViewAlternatives, onChangeSearch,
  verifyPhase = null,
  currency = "EUR",
  searchBadges = [],
  isFav = false, onToggleFav,
  watched = false, onToggleWatch,
  mapSlot = null,  // mapa de rutas (nodo) que acompaña a la foto
  onRequestSale, sale = null,
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);
  const [openRoute, setOpenRoute] = useState(null); // origen con el detalle del vuelo abierto
  const [copied, setCopied] = useState(null); // { origin, ok } del último «copiar vuelo»
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(id);
  }, [copied]);

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
  // Con un cobro que cuadra, la cifra grande es lo que se paga. La estimación
  // de la búsqueda deja de ser el titular: no es el importe del botón.
  const payable = sale?.quote && quoteAddsUp(sale.quote) ? sale.quote : null;
  const payMoney = (amount) => saleMoney(amount, payable?.currency || "EUR");
  const travelers = dest.totalPassengers
    || breakdown.reduce((n, f) => n + (Number(f.passengers) || 1), 0)
    || cleanOrigins.length;
  // Suma de lo que paga cada origen (precio × pasajeros) → total del grupo.
  // Solo si cuadra con el total del backend Y con los enteros que se pintan
  // (si no, «€11 + €11 = €21»). Con un solo origen no hay suma que enseñar.
  // Cada parte conserva su ciudad: «MAD €25 + LON €29», no una cuenta suelta.
  const sumRows = (() => {
    if (singleOrigin || payable) return null;
    const rows = breakdown.map((f) => ({
      origin: String(f.origin || "").toUpperCase(),
      amount: Number(f.totalForOrigin) || (Number(f.price) || 0) * (Number(f.passengers) || 1),
    }));
    if (!visibleSumParts(rows.map((r) => r.amount), dest.totalCostEUR, currency)) return null;
    return rows;
  })();
  const saleLegs = cleanOrigins.map((origin) => {
    const offer = offerMap[origin];
    const finfo = flightInfoMap[origin] || {};
    const segs = offer?.itineraries?.[0]?.segments || [];
    const first = segs[0] || {};
    const last = segs[segs.length - 1] || first;
    const effDep = finfo.flightDate || dep;
    const effRet = tripType === "roundtrip" ? (finfo.flightReturnDate || ret) : "";
    return {
      origin: offer?.tp?.originAirport || first.departure?.iataCode || origin,
      destination: offer?.tp?.destinationAirport || last.arrival?.iataCode || code,
      departureDate: effDep,
      returnDate: effRet || undefined,
      airline: first.carrierCode || offer?.validatingAirlineCodes?.[0] || "",
      flightNumber: first.number || "",
      passengers: Number(finfo.passengers) || Number(offer?.passengers) || 1,
    };
  });
  // El cobro puede traer el aeropuerto (LHR) y el formulario la ciudad (LON).
  // El color y el código que se leen son los de la búsqueda.
  const colorOf = (airport) => {
    const code = String(airport || "").toUpperCase();
    if (cleanOrigins.includes(code)) return code;
    const i = saleLegs.findIndex((s) => String(s.origin).toUpperCase() === code);
    return i >= 0 ? cleanOrigins[i] : code;
  };
  const sumPart = (key, code, amountText, i) => (
    <span className="wc-total-part" key={key}>
      {i > 0 && <b aria-hidden="true">+</b>}
      {code && <TravelerDot origins={cleanOrigins} code={code} />}
      {code && <span className="wc-total-code">{code}</span>}
      <span className="wc-total-amt">{amountText}</span>
    </span>
  );
  // Con el cobro delante, las fichas de la búsqueda repetían otro vuelo y otro
  // precio. Esas ciudades ya están en el total o se reservan en su web.
  const coveredOrigins = new Set();
  if (payable) {
    const airports = new Set([
      ...(payable.legs || []).map((leg) => leg.origin),
      ...(payable.external || []).map((leg) => leg.origin),
    ]);
    saleLegs.forEach((sent, i) => {
      if (airports.has(sent.origin)) coveredOrigins.add(cleanOrigins[i]);
    });
  }
  return (
    <div className={`wc-card${entered ? " wc-card--entered" : ""}`}>
      {/* Foto del destino a todo el ancho. El mapa va debajo de las salidas. */}
      <div className={`wc-top${mapSlot ? " wc-top--map" : ""}`}>
      <div className="wc-image-wrap">
        <img src={imgUrl} alt={city || code} className="wc-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `${getBaseUrl()}destinations/placeholder.jpg`; }} />
        {/* Foto A COLOR con degradado oscuro abajo para leer el nombre (el
            duotono amarillo hacía que todas las ciudades parecieran la misma). */}
        <div className="wc-image-overlay" />
        <div className="wc-image-label">
          {/* Nombre del destino: gira y se asienta en el valor REAL. */}
          <span className="wc-dest-code wc-dest-code--flap"><FlapText text={city || code} size="lg" delay={250} /></span>
        </div>
        <button type="button" className={`wc-fav-btn${isFav ? " wc-fav-btn--active" : ""}`} onClick={onToggleFav} aria-label={t("results.favorite")} aria-pressed={isFav} title={t("results.favorite")}>
          {isFav ? <Heart size={18} fill="currentColor" aria-hidden="true" /> : <Heart size={18} aria-hidden="true" />}
        </button>
        {/* Solo si el precio no es de la fecha pedida: es un dato, no un adorno. */}
        {dest.hasDateFallback && (
          <div className="wc-chips-overlay">
            <span className="wc-trip-days-chip">
              <Calendar size={13} aria-hidden="true" /> {t("results.dateFallbackBadge")}
            </span>
          </div>
        )}
      </div>
      {mapSlot && <div className="wc-map">{mapSlot}</div>}
      </div>

      {/* ══ Vuestros vuelos: lo que hay que comprar + el total del grupo ══
          Es el centro de la decisión (antes iba debajo de la matriz de precios,
          el reparto y el troquel, y además plegable). */}
      <div className="wc-buy">
        <span className="sr-only" role="status">{copied ? t(copied.ok ? "results.copied" : "results.copyFailed") : ""}</span>
        {/* Primero el cómputo del grupo; debajo, el precio de cada viajero. */}
        <div className="wc-total" aria-busy={verifyPhase === "loading" ? "true" : undefined}>
          <div className="wc-total-main">
            <span className="wc-total-label sr-only">{travelers === 1 ? t("results.totalOne") : t("results.groupTotal")}</span>
            <div className="wc-total-figure">
              <div className="wc-total-price"><Odometer value={payable ? payMoney(payable.charge) : money(dest.totalCostEUR)} /></div>
            </div>
            {payable && payable.legs.length > 1 ? (
              <div className="wc-total-sum">
                {payable.legs.map((leg, i) => sumPart(`${leg.origin}-${i}`, colorOf(leg.origin), payMoney(leg.charge), i))}
              </div>
            ) : sumRows && (
              <div className="wc-total-sum">
                {sumRows.map((row, i) => sumPart(row.origin || i, row.origin, money(row.amount), i))}
              </div>
            )}
          </div>
          <div className="wc-total-foot">
            <div aria-live="polite">
            {payable ? (
              <span className="wc-verify-caption">{t("results.saleFinal")}</span>
            ) : verifyPhase === "loading" ? (
              <span className="wc-verify-status">
                <span className="spinner-border spinner-border-sm" aria-hidden="true" /> {t("results.verifyChecking")}
              </span>
            ) : verifyPhase === "unavailable" ? (
              <span className="wc-verify-status">
                <Info size={14} aria-hidden="true" /> {t("results.verifyUnavailable")}
              </span>
            ) : dest.verificationStatus === "verified" || dest.verificationStatus === "changed" ? (
              <span className="wc-verify-caption wc-verify-caption--ok">
                <ShieldCheck size={14} aria-hidden="true" /> {dest.verificationStatus === "changed" ? t("results.totalChanged") : t("results.totalVerified")}
              </span>
            ) : (
              <span className="wc-verify-caption">{t("board.estimateNote")}</span>
            )}
            </div>
            <div className="wc-total-meta">
              {(dep || depDate) && (
                <span>
                  {formatDate(dep || depDate)}
                  {tripType === "roundtrip" && ret ? ` → ${formatDate(ret)}` : ""}
                </span>
              )}
              <span>{tripType === "roundtrip" ? t("search.roundtrip") : t("search.oneway")}</span>
              <span>{travelers === 1 ? t("results.travelerOne") : t("board.travelers", { n: travelers })}</span>
            </div>
          </div>
          {!singleOrigin && (
            <GroupSalePanel
              legs={saleLegs}
              sale={sale}
              onRequest={onRequestSale}
            />
          )}
        </div>
        <div className="wc-buy-head">
          <h3 className="wc-buy-title sr-only">
            {singleOrigin ? t("results.buyTitleOne", { city: city || code }) : t("results.buyTitle", { city: city || code })}
          </h3>
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

        {cleanOrigins.some((origin) => !coveredOrigins.has(origin)) && dep && (
          <div className="wc-booking-cards">
              {cleanOrigins.map((origin, cardIdx) => {
                if (coveredOrigins.has(origin)) return null;
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

                // Horario del billete. La salida es la hora local del texto;
                // la llegada solo si el instante trae zona y conocemos la del
                // destino. Una escala sin segmentos no lleva relojes.
                const itin = offer?.itineraries?.[0];
                const segments = itin?.segments || [];
                const out = legSchedule({
                  itinerary: itin,
                  transfers: offer?.transfers,
                  from: ssOrigin,
                  to: ssDest,
                  airline: offer?.validatingAirlineCodes?.[0] || "",
                });
                const retItin = tripType === "roundtrip" ? offer?.itineraries?.[1] : null;
                const retSegments = retItin?.segments || [];
                const back = retItin ? legSchedule({
                  itinerary: retItin,
                  transfers: offer?.returnTransfers,
                  from: ssDest,
                  to: ssOrigin,
                  airline: retSegments[0]?.carrierCode || "",
                }) : null;

                const routeOpen = openRoute === origin;
                const depTime = out?.dep || hhmm(segments[0]?.departure?.at);
                const arrTime = out?.arr || "";
                const retTime = back?.dep || "";
                const retArr = back?.arr || "";
                const durationText = durationLabel(out?.duration, t);
                const flightNo = segments[0]?.carrierCode && segments[0]?.number ? `${segments[0].carrierCode} ${segments[0].number}` : "";
                const pax = Number(finfo.passengers) || Number(offer?.passengers) || 1;
                const airlineCode = segments[0]?.carrierCode || offer?.validatingAirlineCodes?.[0] || "";
                const booking = buildAirlineBookingUrl({
                  airline: airlineCode,
                  origin: ssOrigin,
                  destination: ssDest,
                  departureDate: effDep,
                  returnDate: tripType === "roundtrip" ? effRet : "",
                  adults: pax,
                  flightNumber: segments[0]?.number || "",
                });
                // Sin web de la aerolínea, Reservar abre Skyscanner con la
                // misma ruta, fecha y viajeros. No se inventa otra aerolínea.
                const book = booking
                  ? {
                    url: booking.url,
                    provider: "airline",
                    airline: booking.airlineName,
                  }
                  : (ssUrl
                    ? {
                      url: ssUrl,
                      provider: "skyscanner",
                      airline: "Skyscanner",
                    }
                    : null);
                const legEq = typeof price === "number"
                  ? legEquation(price, pax, finfo.totalForOrigin, currency)
                  : null;

                return (
                  <div key={origin} className="wc-flight-card">
                    {finfo.dateFallback && (
                      <div className="wc-flight-meta">
                        <span className="wc-flight-meta-item wc-flight-meta--stops">
                          <Calendar size={13} aria-hidden="true" /> {t("results.dateFallbackChip", { date: formatDate(effDep) })}{tripType === "roundtrip" && effRet ? ` → ${formatDate(effRet)}` : ""}
                        </span>
                      </div>
                    )}
                    {/* Ruta pulsable: abre el detalle del vuelo. Cerrada, la luz
                        recorre la línea una sola vez al aparecer; al abrirla
                        la línea se dibuja y el avión despega. */}
                    <button type="button"
                      className={`wc-flight-route${routeOpen ? " wc-flight-route--open" : ""}`}
                      aria-expanded={routeOpen} aria-controls={`wc-fd-${origin}`}
                      onClick={() => setOpenRoute((r) => (r === origin ? null : origin))}>
                      <span className="wc-flight-endpoint">
                        <span className="wc-flight-code">
                          {!singleOrigin && <TravelerDot origins={cleanOrigins} code={origin} />}
                          {countryFlag(origin)} {origin}
                        </span>
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
                    {/* Detalle: salida = dígitos locales del proveedor. Llegada
                        solo cuando el instante trae zona y conocemos la del
                        aeropuerto (si no, la franja tampoco la pinta). */}
                    {routeOpen && (
                      <dl id={`wc-fd-${origin}`} className="wc-fd">
                        {effDep && (
                          <div className="wc-fd-item">
                            <dt>{t("results.fdDeparture")}</dt>
                            <dd>{formatDate(effDep)}{depTime ? ` · ${depTime} ${t("results.fdLocal")}` : ""}</dd>
                          </div>
                        )}
                        {arrTime && (
                          <div className="wc-fd-item">
                            <dt>{t("results.fdArrival")}</dt>
                            <dd>{arrTime} {t("results.fdLocal")}</dd>
                          </div>
                        )}
                        {tripType === "roundtrip" && effRet && (
                          <div className="wc-fd-item">
                            <dt>{t("results.fdReturn")}</dt>
                            <dd>{formatDate(effRet)}{(retTime || retArr) ? ` · ${[retTime, retArr].filter(Boolean).join(" → ")} ${t("results.fdLocal")}` : ""}</dd>
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
                            <dd>{pax} × {money(price)}{legEq?.showProduct && <> = <strong>{money(legEq.total)}</strong></>}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                    <LegStrip schedule={out} t={t} />
                    {back && <LegStrip kicker={t("results.returnLeg")} schedule={back} t={t} />}
                    <div className="wc-flight-ctas">
                      {/* Reservar abre la web de esa aerolínea. Si no la
                          tenemos, el mismo botón abre Skyscanner. */}
                      {book && (
                        <a href={book.url} target="_blank" rel="noreferrer" className="wc-cta wc-cta--book"
                          aria-label={book.airline ? `${t("results.bookCta")} · ${book.airline}` : t("results.bookCta")}
                          onClick={() => track("book_click", { provider: book.provider, airline: book.airline, dest: code, origin, where: "winner" })}>
                          <span className="wc-cta-icon"><Ticket size={16} aria-hidden="true" /></span>
                          {t("results.bookCta")}
                        </a>
                      )}
                      {ssUrl && book?.provider !== "skyscanner" && (
                        <a href={ssUrl} target="_blank" rel="noreferrer" className="wc-cta wc-cta--icon"
                          aria-label="Skyscanner"
                          onClick={() => track("book_click", { provider: "skyscanner", dest: code, origin, where: "winner" })}>
                          <span className="wc-cta-icon"><Search size={16} aria-hidden="true" /></span>
                        </a>
                      )}
                      {gfUrl && (
                        <a href={gfUrl} target="_blank" rel="noreferrer" className="wc-cta wc-cta--icon wc-cta--google"
                          aria-label="Google Flights"
                          onClick={() => track("book_click", { provider: "google", dest: code, origin, where: "winner" })}>
                          <span className="wc-cta-icon"><Plane size={16} aria-hidden="true" /></span>
                        </a>
                      )}
                      <button type="button" className="wc-cta wc-cta--copy" onClick={async () => {
                        const when = (out?.dep || out?.arr)
                          ? [out.dep, out.from, "→", out.arr, out.to].filter(Boolean).join(" ")
                          : "";
                        const txt = `${originCity || origin} → ${destCity}${when ? ` · ${when}` : ""} · ${typeof price === "number" ? (currency === "EUR" ? formatEur(price, 0) : convertPrice(price, currency)) : "—"}${durationText ? ` · ${durationText}` : ""} (${t("board.estimateNote")})`;
                        setCopied({ origin, ok: await copyText(txt) });
                      }} title={t("results.copyFlight")} aria-label={t("results.copyFlight")}>
                        {copied?.origin === origin && copied.ok
                          ? <Check size={15} aria-hidden="true" />
                          : <Copy size={15} aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

      </div>

      {/* Body */}
      <div className="wc-body">
        {/* Actions */}
        <div className="wc-actions">
          {/* Baja al panel de salidas (solo si hay más de un destino). "Cambiar
              búsqueda" ya está en la cabecera del vuelo y en la barra fija. */}
          {canNativeShare ? (
            <button type="button" className="wc-action-btn wc-action-btn--share" onClick={onShareNative} aria-label={t("results.share")}>
              <Share2 size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="wc-action-btn" onClick={onShare}
              aria-label={shareStatus === "ok" ? t("results.copied") : shareStatus === "fail" ? t("results.copyFailed") : t("results.share")}>
              {shareStatus === "ok" ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="wc-action-btn wc-action-btn--whatsapp" onClick={onShareWhatsApp} aria-label="WhatsApp">
            <span className="wc-wa-icon"><MessageCircle size={16} aria-hidden="true" /></span>
          </button>
          {!canNativeShare && (
            <>
              <button type="button" className="wc-action-btn" onClick={onShareTelegram} aria-label="Telegram">
                <Send size={16} aria-hidden="true" />
              </button>
              <button type="button" className="wc-action-btn" onClick={onShareEmail} aria-label="Email">
                <Mail size={16} aria-hidden="true" />
              </button>
            </>
          )}
          {onCopySearchLink && (
            <button type="button" className="wc-action-btn wc-action-btn--link" onClick={onCopySearchLink} aria-label={t("results.copySearchLink")}>
              <Link2 size={16} aria-hidden="true" />
            </button>
          )}
          {onToggleWatch && (
            <button type="button" className={`wc-action-btn wc-action-btn--watch${watched ? " wc-action-btn--on" : ""}`}
              onClick={onToggleWatch} aria-pressed={watched}
              aria-label={watched ? t("watch.on") : t("watch.cta")}>
              {watched ? <BellRing size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
            </button>
          )}
        </div>

        {/* Search badges */}
        {searchBadges.length > 0 && (
          <div className="wc-badges">
            {searchBadges.map((b, i) => (
              <span key={i} className="wc-badge">{b}</span>
            ))}
          </div>
        )}
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
    </div>
  );
}
