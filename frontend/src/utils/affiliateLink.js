// «Reservar» abre Aviasales con el deep link del backend, que ya lleva el
// marker de afiliado. Es la salida que paga comisión. La web de la aerolínea,
// Skyscanner y Google Flights no. Un enlace que no sea https de Aviasales
// no se usa.
//
// El enlace de la caché es para 1 adulto (…/search/MAD2311LIS1: la última
// cifra son los pasajeros). Si de esa ciudad viajan más, se cambia esa cifra.
// El resto (billete, marker) no se toca.

const AVIASALES_HOST = /^(www\.)?aviasales\.(com|ru|kz|by|ua|uz|kg)$/i;
const SEARCH_PATH = /^\/search\/([A-Z]{3}\d{4}[A-Z]{3}(?:\d{4})?)(\d)$/;

export function affiliateLinkForAdults(link, adults = 1) {
  let url;
  try {
    url = new URL(String(link || ""));
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || !AVIASALES_HOST.test(url.hostname)) return "";
  const n = Math.min(9, Math.max(1, Math.floor(Number(adults)) || 1));
  const match = SEARCH_PATH.exec(url.pathname);
  if (match && n > 1) url.pathname = `/search/${match[1]}${n}`;
  return url.toString();
}
