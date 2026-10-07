// Salud del proveedor durante UNA búsqueda, a partir de options.stats
// ({calls, errors}) que rellenan los servicios de vuelos:
//   "down"     → falló al menos la mitad de las consultas (sin resultados →
//                502, no "sin vuelos")
//   "degraded" → falló una parte apreciable (puede faltar algún destino)
//   "ok"       → en otro caso
function providerHealth(stats) {
  const calls = Number(stats?.calls) || 0;
  const errors = Number(stats?.errors) || 0;
  if (calls === 0 || errors === 0) return "ok";
  const ratio = errors / calls;
  if (ratio >= 0.5) return "down";
  if (ratio >= 0.2 && errors >= 2) return "degraded";
  return "ok";
}

module.exports = { providerHealth };
