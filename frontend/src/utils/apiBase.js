// ─── URL del backend ─────────────────────────────────────────────────────────
// VITE_API_BASE_URL manda. Si falta:
//   · build de producción → backend de producción (respaldo histórico: si
//     Vercel no tuviera la variable, la web seguiría funcionando);
//   · desarrollo / tests → backend LOCAL, nunca producción por accidente.
export const PROD_API_BASE = "https://flyndme-backend.onrender.com";
export const DEV_API_BASE = "http://localhost:5000";

export function resolveApiBase(env = {}) {
  const fromEnv = String(env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  return env.PROD ? PROD_API_BASE : DEV_API_BASE;
}
