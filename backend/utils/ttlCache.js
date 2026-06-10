// ─── TtlCache ────────────────────────────────────────────────────────────────
// Cache en memoria con TTL y tope de tamaño. Extraída de la lógica duplicada
// en routes/flights.js y services/amadeusService.js (Mejora 7).
//
//   const cache = new TtlCache({ ttlMs: 600000, maxSize: 200 });
//   cache.set("k", value);          // expira en ttlMs
//   cache.get("k");                 // valor o null (y borra si expiró)
//   cache.size                      // entradas actuales
//   cache.stats                     // { hits, misses, requests } (acumulados)
//
// El timer interno de limpieza usa .unref(): nunca mantiene vivo el proceso.

class TtlCache {
  constructor({ ttlMs, maxSize, sweepEveryMs } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("TtlCache: ttlMs requerido (> 0)");
    this.ttlMs = ttlMs;
    this.maxSize = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : Infinity;
    this.map = new Map();
    this.stats = { hits: 0, misses: 0, requests: 0 };

    const every = Number.isFinite(sweepEveryMs) && sweepEveryMs > 0 ? sweepEveryMs : ttlMs;
    this._sweeper = setInterval(() => this.sweep(), every);
    if (typeof this._sweeper.unref === "function") this._sweeper.unref();
  }

  get size() { return this.map.size; }

  get(key) {
    this.stats.requests++;
    const e = this.map.get(key);
    if (!e) { this.stats.misses++; return null; }
    if (Date.now() > e.expiresAt) {
      this.map.delete(key);
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return e.value;
  }

  set(key, value) {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    // Tope de tamaño: expulsa las entradas que caducan antes
    if (this.map.size > this.maxSize) {
      const entries = Array.from(this.map.entries());
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toDelete = entries.slice(0, entries.length - this.maxSize);
      for (const [k] of toDelete) this.map.delete(k);
    }
  }

  sweep() {
    const now = Date.now();
    for (const [k, e] of this.map.entries()) {
      if (now > e.expiresAt) this.map.delete(k);
    }
  }

  resetStats() { this.stats = { hits: 0, misses: 0, requests: 0 }; }

  // Para tests: parar el timer de limpieza
  dispose() { clearInterval(this._sweeper); }
}

module.exports = { TtlCache };
