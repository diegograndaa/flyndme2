// ─── Analítica (Vercel Web Analytics) ────────────────────────────────────────
// track() solo envía datos cuando la app corre desplegada en Vercel; en `npm
// run dev` hace log a consola en modo debug, y fuera de Vercel es un no-op
// silencioso. Requiere DOS cosas para verse en el dashboard:
//   1. Web Analytics habilitado en el proyecto de Vercel (Settings → Analytics).
//   2. El componente <Analytics/> montado en el árbol (ver main.jsx).
import { track as vercelTrack } from "@vercel/analytics";

// Vercel solo acepta props con valores string | number | boolean. Saneamos:
// descartamos null/undefined y serializamos cualquier no-primitivo, para no
// perder el evento ni que Vercel lo rechace en silencio.
function sanitize(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}

export function track(event, props = {}) {
  try {
    vercelTrack(event, sanitize(props));
  } catch {
    /* la analítica nunca debe romper la app */
  }
}
