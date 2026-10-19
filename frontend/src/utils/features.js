// Interruptores de producto que se fijan en el build (variables de Vercel).
//
// VITE_GROUP_SALE=on enseña «Comprar los vuelos del grupo» (cobro con Duffel
// dentro de FlyndMe). Apagado por defecto: el cobro aún no confirma el pago en
// el servidor ni es idempotente, y falta la base legal (aviso legal,
// privacidad, condiciones de venta). El backend tiene su propio interruptor
// (GROUP_SALE_ENABLED); los dos tienen que estar encendidos para vender.

// Optional chaining: fuera de Vite (tests con node, SSR) import.meta.env no existe.
const RAW_GROUP_SALE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GROUP_SALE) || "";

export const GROUP_SALE_ON = String(RAW_GROUP_SALE).trim().toLowerCase() === "on";
