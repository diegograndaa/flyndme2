// El cobro que se enseña tiene que ser el que se carga. Se compara en céntimos,
// con las cifras que ya mandó el servidor: aquí no se recalcula la comisión.

export function centsOf(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function quoteAddsUp(quote) {
  const legs = Array.isArray(quote?.legs) ? quote.legs : [];
  if (!legs.length) return false;
  for (const field of ["fare", "commission", "cardFee", "charge"]) {
    let sum = 0;
    for (const leg of legs) {
      const part = centsOf(leg?.[field]);
      if (part == null) return false;
      sum += part;
    }
    if (sum !== centsOf(quote[field])) return false;
  }
  for (const leg of legs) {
    if (centsOf(leg.fare) + centsOf(leg.commission) + centsOf(leg.cardFee) !== centsOf(leg.charge)) return false;
  }
  return centsOf(quote.fare) + centsOf(quote.commission) + centsOf(quote.cardFee) === centsOf(quote.charge);
}

export function checkoutPath(quoteId) {
  return `/?caja=${encodeURIComponent(quoteId)}`;
}

export const SALE_CHANNEL = "flyndme-caja";
