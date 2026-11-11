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

// Los ids de cuentas y sesiones son correos y tokens: en el log va solo una
// huella corta, suficiente para seguir un fallo sin copiar el dato.
function idTag(id) {
  return require("crypto").createHash("sha256").update(String(id)).digest("hex").slice(0, 8);
}

function storeDown(namespace, cause) {
  const err = new Error(`store ${namespace} unavailable`);
  err.code = "STORE_UNAVAILABLE";
  err.cause = cause;
  return err;
}

// strict: cuentas, sesiones, identidades y ventas. Ahí un fallo de Redis NO
// puede leerse como «no existe» (el registro crearía una cuenta encima de la
// de otra persona) ni guardarse solo en memoria (un cobro sin rastro tras un
// reinicio): se lanza STORE_UNAVAILABLE y la ruta responde 503.
function createUpstashStore({ namespace, ttlMs, maxSize, sweepEveryMs, redis: injected, strict = false }) {
  // require perezoso: el módulo solo se carga (y solo hace falta en
  // node_modules) cuando el backend upstash está configurado. dev/tests no lo
  // necesitan ni lo importan (los tests inyectan un cliente falso).
  let redis = injected;
  if (!redis) {
    const { Redis } = require("@upstash/redis");
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  const key = (id) => `${namespace}:${id}`;
  const defaultTtlSec = Math.max(1, Math.round(ttlMs / 1000));
  // Respaldo en memoria: si Upstash falla al ESCRIBIR (base archivada, cupo
  // agotado, red), el recurso se guarda aquí en vez de devolver 500 → crear un
  // grupo o un enlace para compartir sigue funcionando (sin persistencia entre
  // reinicios, como antes de Upstash). Las lecturas lo consultan si Redis no
  // lo tiene o falla.
  const fallback = createMemoryStore({ namespace, ttlMs, maxSize, sweepEveryMs });

  return {
    backend: "upstash",
    async get(id) {
      try {
        const v = await redis.get(key(id)); // @upstash/redis (de)serializa JSON
        if (v != null) return v;
        if (strict) return null; // Redis respondió: de verdad no existe
      } catch (err) {
        console.error(`[kv:${namespace}] get(#${idTag(id)}) falló: ${err.message}`);
        if (strict) throw storeDown(namespace, err);
      }
      return fallback.get(id); // null si tampoco está: "no encontrado"
    },
    async set(id, value, opts = {}) {
      const ex = opts.ttlMs != null
        ? Math.max(1, Math.round(opts.ttlMs / 1000))
        : defaultTtlSec;
      try {
        await redis.set(key(id), value, { ex }); // TTL nativo: sin barrido manual
        // Si una versión anterior vivía en el respaldo, que no quede obsoleta
        if (!strict && await fallback.get(id)) await fallback.set(id, value);
      } catch (err) {
        if (strict) {
          console.error(`[kv:${namespace}] set(#${idTag(id)}) falló: ${err.message}`);
          throw storeDown(namespace, err);
        }
        console.error(`[kv:${namespace}] set(#${idTag(id)}) falló: ${err.message} — guardado en memoria`);
        await fallback.set(id, value);
      }
      return value;
    },
    async delete(id) {
      let removed = await fallback.delete(id);
      try {
        removed = (await redis.del(key(id))) > 0 || removed;
      } catch (err) {
        console.error(`[kv:${namespace}] del(#${idTag(id)}) falló: ${err.message}`);
        if (strict) throw storeDown(namespace, err);
      }
      return removed;
    },
    async size() {
      return null; // acotado por TTL; no hay conteo barato y no se necesita
    },
  };
}

// Registro del backend REALMENTE elegido por namespace (incluida la posible
// degradación a memoria), para poder verificarlo desde fuera vía /api/health.
const _backends = {};

// Devuelve el store adecuado según el entorno. upstash si está configurado;
// si su init falla, degrada a memoria avisando (mejor sin persistencia que caído).
function createStore(opts) {
  const hasUpstash =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
  let store;
  if (hasUpstash) {
    try {
      store = createUpstashStore(opts);
      console.log(`[kv:${opts.namespace}] backend=upstash (persistente)`);
    } catch (err) {
      console.error(
        `[kv:${opts.namespace}] init upstash falló (${err.message}) — usando memoria`
      );
    }
  }
  if (!store) store = createMemoryStore(opts);
  _backends[opts.namespace] = store.backend;
  return store;
}

// Backend elegido por namespace, p.ej. { group: "upstash", share: "upstash" }.
// Usado por /api/health para confirmar la persistencia sin leer los logs.
function storeBackends() {
  return { ..._backends };
}

// ─── Contadores monotónicos (métricas del loop de distribución) ─────────────
// A diferencia de los stores con TTL, NO caducan: cuentan eventos acumulados
// (enlaces share/grupo creados y abiertos). En Upstash usan INCR (ATÓMICO — sin
// el read-modify-write racy de get+set, que perdería conteos en concurrencia);
// en memoria, un objeto que se reinicia con el proceso (Render free reinicia,
// pero sirve para leer la tendencia del loop entre deploys). incr() traga sus
// propios errores: una métrica caída NUNCA debe añadir latencia ni tumbar la
// petición que la dispara, así que las rutas la llaman fire-and-forget.
function createCounters({ namespace = "metrics" } = {}) {
  const hasUpstash =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = (name) => `${namespace}:${name}`;

  if (hasUpstash) {
    try {
      const { Redis } = require("@upstash/redis");
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      return {
        backend: "upstash",
        async incr(name) {
          try {
            await redis.incr(key(name));
          } catch (err) {
            console.error(`[metrics] incr(${name}) falló: ${err.message}`);
          }
        },
        async snapshot(names) {
          try {
            const vals = await redis.mget(...names.map(key));
            const out = {};
            names.forEach((n, i) => { out[n] = Number(vals[i]) || 0; });
            return out;
          } catch (err) {
            console.error(`[metrics] snapshot falló: ${err.message}`);
            return null;
          }
        },
      };
    } catch (err) {
      console.error(`[metrics] init upstash falló (${err.message}) — usando memoria`);
    }
  }

  const mem = Object.create(null);
  return {
    backend: "memory",
    async incr(name) { mem[name] = (mem[name] || 0) + 1; },
    async snapshot(names) {
      const out = {};
      for (const n of names) out[n] = mem[n] || 0;
      return out;
    },
    _mem: mem, // solo tests
  };
}

module.exports = { createStore, createMemoryStore, createUpstashStore, storeBackends, createCounters };
