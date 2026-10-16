// Vuelos que no entran en el cobro. Un botón a la web de la aerolínea,
// sin pedir otra vez los datos del viajero.
import React from "react";
import { buildSkyscannerUrl } from "../utils/helpers";
import { buildAirlineBookingUrl } from "../utils/airlineBooking";
import { airlineName } from "../utils/flightTime";

export function bookTarget(leg) {
  const booking = buildAirlineBookingUrl({
    airline: leg.airline,
    origin: leg.origin,
    destination: leg.destination,
    departureDate: leg.departureDate,
    returnDate: leg.returnDate || "",
    adults: leg.passengers,
    flightNumber: leg.flightNumber,
  });
  if (booking?.url) return { url: booking.url, airline: booking.airlineName };
  const url = buildSkyscannerUrl({
    origin: leg.origin,
    destination: leg.destination,
    departureDate: leg.departureDate,
    returnDate: leg.returnDate || "",
    tripType: leg.returnDate ? "roundtrip" : "oneway",
    adults: leg.passengers,
  });
  const name = airlineName(leg.airline) || leg.airline || "";
  return url ? { url, airline: name, sky: true } : { url: "", airline: name };
}

export default function SaleElsewhere({ legs = [], t }) {
  if (!legs.length) return null;
  return (
    <div className="wc-sale-else">
      {legs.map((leg) => {
        const target = bookTarget(leg);
        const name = target.airline || leg.origin;
        return (
          <div key={`${leg.origin}-${leg.flightNumber || ""}`} className="wc-sale-else-row">
            {!target.url && (
              <p>{t("results.saleNotHere", { origin: leg.origin })}</p>
            )}
            {target.url && (
              <a className="wc-sale-btn wc-sale-btn--ghost" href={target.url} target="_blank" rel="noopener noreferrer">
                {target.sky ? t("results.saleBookSky") : t("results.bookOnAirline", { airline: name })}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
