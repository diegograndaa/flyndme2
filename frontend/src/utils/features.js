// VITE_GROUP_SALE=on enseña «Comprar los vuelos del grupo». Apagado por
// defecto: el cobro aún no confirma el pago en el servidor. El backend tiene
// su propio interruptor (GROUP_SALE_ENABLED); los dos tienen que estar
// encendidos para vender.

const RAW_GROUP_SALE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GROUP_SALE) || "";

export const GROUP_SALE_ON = String(RAW_GROUP_SALE).trim().toLowerCase() === "on";
