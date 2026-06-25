// Almacén clave-valor asíncrono con TTL para los recursos share/group.
//
// Dos backends, seleccionados en tiempo de carga:
//   - "memory" (por defecto): mismo comportamiento que el Map original
//     (barrido periódico + tope de tamaño con evicción del más antiguo).
//     Cero red, cero secretos → dev, tests y la prod actual siguen igual.
//   - "upstash": Redis serverless por REST (@upstash/redis) con TTL por clave
//     nativo (SET … EX). Se activa SOLO si están UPSTASH_REDIS_REST_URL y
//     UPSTASH_REDIS_REST_TOKEN en el entorno.
//
// Por qué externo y no SQLite/fichero: el sistema de archivos de Render (free)
// es EFÍMERO — se borra en cada deploy y en el sleep por inactividad —, así que
// un fichero local NO sobreviviría a un reinicio. Solo un store externo persiste.
//
// Contrato (el mínimo que usan las rutas): get / set / delete / size. `set`
// acepta un { ttlMs } opcional para conservar el TTL RESTANTE en un
// read-modify-write (p.ej. añadir un miembro a un grupo sin reiniciar su
// caducidad de 14 días).

function createMemoryStore({ namespace, ttlMs, maxSize, sweepEveryMs }) {
  const map = new Map();

  // Barrido de caducados (unref para no mantener vivo el proceso).
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, v] of map.entries()) {
      if (v && typeof v.expiresAt === "number" && now > v.expiresAt) map.delete(id);
    }
  }, sweepEveryMs || ttlMs);
  if (timer && typeof timer.unref === "function") timer.unref();

  return {
    backend: "memory",
    async get(id) {
      return map.has(id) ? map.get(id) : null;
    },
    async set(id, value /* , opts */) {
      // Evicción del más antiguo si el store está lleno (igual que el original).
      if (maxSize && map.size >= maxSize && !map.has(id)) {
        const entries = [...map.entries()].sort(
          (a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0)
        );
        const toDelete = entries.slice(0, Math.max(1, entries.length - maxSize + 50));
        for (const [k] of toDelete) map.delete(k);
      }
      map.set(id, value);
      return value;
    },
    async delete(id) {
      return map.delete(id);
    },
    async size() {
      return map.size;
    },
    _map: map, // solo para tests
  };
}

function createUpstashStore({ namespace, ttlMs }) {
  // require perezoso: el módulo solo se carga (y solo hace falta en
  // node_modules) cuando el backend upstash está configurado. dev/tests no lo
  // necesitan ni lo importan.
  const { Redis } = require("@upstash/redis");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  const key = (id) => `${namespace}:${id}`;
  const defaultTtlSec = Math.max(1, Math.round(ttlMs / 1000));

  return {
    backend: "upstash",
    async get(id) {
      try {
        const v = await redis.get(key(id)); // @upstash/redis (de)serializa JSON
        return v == null ? null : v;
      } catch (err) {
        console.error(`[kv:${namespace}] get(${id}) falló: ${err.message}`);
        return null; // degradar como "no encontrado", nunca tumbar la petición
      }
    },
    async set(id, value, opts = {}) {
      const ex = opts.ttlMs != null
        ? Math.max(1, Math.round(opts.ttlMs / 1000))
        : defaultTtlSec;
      await redis.set(key(id), value, { ex }); // TTL nativo: sin barrido manual
      return value;
    },
    async delete(id) {
      try {
        return (await redis.del(key(id))) > 0;
      } catch (err) {
        console.error(`[kv:${namespace}] del(${id}) falló: ${err.message}`);
        return false;
      }
    },
    async size() {
      return null; // acotado por TTL; no hay conteo barato y no se necesita
    },
  };
}

// Devuelve el store adecuado según el entorno. upstash si está configurado;
// si su init falla, degrada a memoria avisando (mejor sin persistencia que caído).
function createStore(opts) {
  const hasUpstash =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
  if (hasUpstash) {
    try {
      const store = createUpstashStore(opts);
      console.log(`[kv:${opts.namespace}] backend=upstash (persistente)`);
      return store;
    } catch (err) {
      console.error(
        `[kv:${opts.namespace}] init upstash falló (${err.message}) — usando memoria`
      );
    }
  }
  return createMemoryStore(opts);
}

module.exports = { createStore, createMemoryStore };
