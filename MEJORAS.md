# MEJORAS.md — Registro de mejoras (sesión Cowork, 10 jun 2026)

## Contexto del entorno de trabajo (importante)

Esta sesión se ejecutó en un sandbox **sin acceso a npm/pip/CDNs** (red
bloqueada por allowlist) y sin acceso a la carpeta local del repo (la carpeta
seleccionada `Fyndme/` no contiene el código). El repo se reconstruyó archivo
a archivo desde la API de GitHub (`main @ 1b4b2ab`), verificando cada archivo
por su SHA de blob git (byte-exacto).

**Archivos NO incluidos en esta copia** (no afectan a las mejoras; todos los
archivos modificados son byte-exactos respecto a tu `main`):
- `frontend/src/App.jsx` y `frontend/src/App.css` (superan el límite de
  descarga del entorno; por eso NO se han tocado — no se edita a ciegas un
  archivo de 3.588 líneas que no se puede compilar ni testear aquí)
- `frontend/src/i18n/en.json` / `es.json`
- `backend/package-lock.json`, `frontend/package-lock.json`
- imágenes binarias (`frontend/public/destinations/*`, `og-preview.png`)
- `CLAUDE.md` contiene un placeholder (no tocar/commitear desde aquí)

**Cómo aplicar estos cambios a tu repo local**: usa los parches en
`cambios/*.patch` (git format-patch) — se aplican con
`git am cambios/*.patch` desde la raíz de tu repo. Cada parche = una mejora.

---

## Mejora 1 — Tests ejecutables sin npm (shims de test)

**Qué**: `backend/test/shims/` con implementaciones mínimas de express, cors,
helmet, express-rate-limit, compression, dotenv y axios, usadas SOLO vía
`NODE_PATH` cuando no existe `node_modules/` (en tu máquina nunca se activan).

**Por qué**: la prioridad nº 2 del ciclo de trabajo son los tests como red de
seguridad. El sandbox no puede hacer `npm install`, así que sin esto ninguna
mejora posterior sería verificable. Con los shims, la suite existente
(`smoke.test.js`, 13 tests) corre y pasa 13/13.

**Verificación**: `NODE_PATH="$PWD/test/shims/node_modules" node --test`
→ 13 pass / 0 fail.

**Pendiente**: nada. En local sigue usándose `npm test` con deps reales.

## Mejora 2 — Bug: travelClass/currencyCode fuera de la clave de cache de Amadeus

**Qué**: `makeCacheKey()` en `backend/services/amadeusService.js` no incluía
`travelClass` ni `currencyCode`. Una búsqueda en BUSINESS podía recibir el
precio ECONOMY cacheado de la misma ruta/fecha (y viceversa) durante 15 min.
Precio incorrecto mostrado al usuario = violación directa del principio
"reliability over fake precision".

**Cómo**: ambos campos añadidos a la clave (con `currencyCode` defaulting a
"EUR" para no invalidar la cache existente del caso común). Se exponen
internals vía `module.exports.__test` para poder testearlo sin red.

**Además**: los 3 `setInterval` de limpieza (amadeusService, flights, share)
ahora llevan `.unref()` — mantenían vivo el proceso Node, lo que colgaba
`node --test` al requerir los servicios y retrasaba el cierre elegante.

**Tests**: nuevo `backend/test/cacheKey.test.js` (5 tests de regresión).
Suite completa: 18/18 pass.

**Pendiente**: nada.

## Mejora 3 — Robustez: JSON malformado → 400 INVALID_JSON (antes 500)

**Qué**: un body JSON inválido en cualquier POST acababa en el error handler
global y devolvía `500 Error interno del servidor.` Es un error del cliente:
ahora devuelve `400 {code: "INVALID_JSON"}` y `413 {code: "PAYLOAD_TOO_LARGE"}`
si supera el límite de 128kb de express.json. Mantiene el contrato de errores
con `code` legible que ya usaba el resto de la API.

**Tests**: nuevo test en smoke.test.js. Suite: 19/19 pass.

**Pendiente**: el frontend podría mapear INVALID_JSON a un mensaje i18n, pero
en la práctica nunca envía JSON malformado (baja prioridad).

## Mejora 4 — Seguridad: rate limit en creación de share links + validación de id

**Qué**: `POST /api/share` no tenía ningún límite: un bucle trivial podía
crear 500 entradas de 64KB (32MB) y, peor, expulsar del store los enlaces
legítimos de otros usuarios (la evicción borra los más antiguos). Ahora:
- `POST /api/share` limitado a 20 creaciones / 10 min / IP (configurable con
  `SHARE_CREATE_LIMIT`), respuesta `429 {code: "RATE_LIMITED"}`.
- `GET /api/share/:id` y `/og` validan el formato del id (base64url 4-24
  chars) antes de tocar el store; ids basura → 404/redirect inmediato.

**Tests**: 2 nuevos en smoke.test.js. Suite: 21/21 pass.

**Pendiente**: persistencia del shareStore (Redis o similar) si algún día hay
varios procesos — hoy es un único proceso en Render y el store en memoria es
una decisión consciente del MVP.
