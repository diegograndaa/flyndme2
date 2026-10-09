// Suma visible de la tarjeta («€67 + €37 = €104»).
// Solo se enseña si los importes REALES cuadran con el total del backend y,
// además, los importes YA REDONDEADOS (los que ve la persona) suman el total
// redondeado. Si no, «€11 + €11 = €21» o «£9 + £9 = £17» sería una cuenta falsa.
import { formatEur } from "./helpers.js";
import { convertPrice } from "./resultsLogic.js";

// Entero que pinta la UI para ese importe, en la divisa elegida.
// Se lee del MISMO formateador que la tarjeta (no un redondeo paralelo).
export function displayedInteger(eur, currency = "EUR") {
  const formatted = currency === "EUR" ? formatEur(eur, 0) : convertPrice(eur, currency);
  const digits = String(formatted).replace(/[^\d]/g, "");
  if (!digits) return null;
  return Number(digits);
}

/**
 * Partes de la ecuación, o null si no debe mostrarse.
 * - 2 a 6 orígenes (con uno no hay suma; con más de 6 no cabe).
 * - la suma real cuadra con el total del backend (±1 €, céntimos).
 * - la suma de lo que se VE cuadra con el total que se ve.
 */
export function visibleSumParts(parts, totalEur, currency = "EUR") {
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > 6) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const total = Number(totalEur);
  if (!Number.isFinite(total)) return null;
  const raw = nums.reduce((a, b) => a + b, 0);
  if (Math.abs(raw - total) > 1) return null;
  const shown = nums.map((n) => displayedInteger(n, currency));
  const shownTotal = displayedInteger(total, currency);
  if (shown.some((n) => n == null) || shownTotal == null) return null;
  if (shown.reduce((a, b) => a + b, 0) !== shownTotal) return null;
  // €73 + €73 = €146 no aporta: es el mismo importe que el total, repetido.
  if (shown.every((n) => n === shown[0])) return null;
  return nums;
}

/**
 * «N × precio = total» del detalle de un vuelo.
 * `showProduct` es false si el total del origen no es precio × viajeros
 * (p. ej. se reescribió solo totalForOrigin) o si el redondeo haría
 * «2 × €10 = €21».
 */
export function legEquation(price, pax, totalForOrigin, currency = "EUR") {
  const unit = Number(price);
  const n = Math.max(1, Math.floor(Number(pax)) || 1);
  if (!Number.isFinite(unit) || unit < 0) return null;
  const fromUnit = unit * n;
  const reported = Number(totalForOrigin);
  const total = Number.isFinite(reported) && Math.abs(reported - fromUnit) <= 0.05 ? reported : fromUnit;
  const shownUnit = displayedInteger(unit, currency);
  const shownTotal = displayedInteger(total, currency);
  const showProduct = shownUnit != null && shownTotal != null && shownUnit * n === shownTotal;
  return { pax: n, total, showProduct };
}
