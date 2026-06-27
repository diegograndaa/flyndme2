// Singleton de contadores del loop de distribución (share/grupo). Un único store
// compartido por las rutas (que incrementan) y por /api/health (que lee), para
// no abrir conexiones Upstash duplicadas. Ver utils/kvStore.createCounters.
//
// Por qué este conteo en servidor y no Vercel Analytics: los eventos
// personalizados de Vercel son de PAGO (en Hobby muestran "-"), así que estos
// contadores son la instrumentación REAL del loop. Son la base para decidir si
// invitar/compartir multiplica visitas antes de invertir en SEO/contenido.
const { createCounters } = require("./kvStore");

// Eventos del loop. snapshot() lee EXACTAMENTE estos nombres.
//   *_created           → alguien GENERÓ un enlace (share/grupo)
//   *_landing           → alguien ABRIÓ ese enlace y el SPA cargó los datos = visita
//   group_member_added  → un viajero se sumó al grupo (el multiplicador real del loop)
//
// Nota honesta de medición: group_landing cuenta cada GET /api/groups/:id, lo que
// incluye los refrescos del propio organizador → es una cota SUPERIOR de "aperturas".
// group_member_added, en cambio, es inequívoco. share_landing es limpio (el SPA
// carga un share una sola vez, sin polling).
const METRIC_NAMES = [
  "share_created",
  "share_landing",
  "group_created",
  "group_landing",
  "group_member_added",
];

const counters = createCounters({ namespace: "metrics" });

module.exports = { counters, METRIC_NAMES };
