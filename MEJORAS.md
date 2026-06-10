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

## Mejora 5 — Validación: travelClass, nonStop y fechas pasadas

**Qué** (en `POST /api/flights/multi-origin`):
- `travelClass` ahora se valida contra el enum real de Amadeus (ECONOMY,
  PREMIUM_ECONOMY, BUSINESS, FIRST), aceptando minúsculas. Antes, un valor
  arbitrario provocaba un 400 silencioso de Amadeus en CADA llamada → quota
  gastada y "sin resultados" inexplicable para el usuario.
- `nonStop` se normaliza a boolean (true/"true"); cualquier otro valor → sin
  filtro, en vez de mandar basura como query param.
- Fecha de salida en el pasado → `400 DEPARTURE_DATE_IN_PAST` (antes: N
  llamadas fallidas a Amadeus y respuesta vacía).
- El rango flex ya no genera candidatos anteriores a hoy (se recortan).

**Tests**: 4 nuevos. Suite: 25/25 pass.

**Pendiente**: validar también returnDate > ~360 días (límite de Amadeus);
poco frecuente, baja prioridad.

## Mejora 6 — Rendimiento: cache key de respuesta normalizada

**Qué**: la clave de la cache de respuestas de `/multi-origin` incluía el
array `destinations` crudo del body. `["rom ", "lis", "ROM"]` y
`["ROM","LIS"]` son la misma búsqueda pero generaban entradas distintas →
misses innecesarios y trabajo duplicado contra Amadeus. Ahora la clave se
construye con `destinationList` ya normalizada (mayúsculas, sin duplicados,
sin orígenes), moviendo el cálculo de tiers antes del chequeo de cache (es
barato, no toca red). Bonus: las peticiones con destinos 100% inválidos ya no
ocupan cache.

**Tests**: 1 nuevo (payloads idénticos para variantes equivalentes).
Suite: 26/26 pass.

**Pendiente**: nada.

## Mejora 7 — Calidad: TtlCache compartida (deduplicación)

**Qué**: la lógica Map+TTL+evicción+sweep estaba duplicada (con variaciones
sutiles) en `routes/flights.js` y `services/amadeusService.js`. Extraída a
`backend/utils/ttlCache.js` (clase `TtlCache` con stats integradas y sweeper
con `.unref()`). Ambos consumidores quedan en 2-4 líneas; el log de hit-rate
de Amadeus se conserva usando `cache.stats`. ~60 líneas duplicadas menos.

**Tests**: nuevo `test/ttlCache.test.js` (5 tests: TTL, maxSize, sweep,
stats, validación). Suite completa: 31/31 pass.

**Pendiente**: share.js mantiene su Map propio porque su semántica es
distinta (TTL por entrada fijo de 48h + evicción por lotes); unificarlo
aportaría poco.

## Mejora 8 — Docs: README.md

**Qué**: el repo no tenía README. Añadido con arquitectura, setup local
(incl. modo mock), cómo correr los tests y dónde están las variables de
entorno. Reduce la fricción de retomar el proyecto o de enseñárselo a alguien.

**Pendiente**: capturas de pantalla cuando la UI esté estabilizada.

## Mejora 9 — Robustez en producción: uncaughtException + keep-alive para Render

**Qué** (en `backend/index.js`):
- Handler de `uncaughtException`: registra y sale con código 1 (Render
  reinicia el servicio); antes una excepción síncrona no capturada dejaba el
  proceso en estado indefinido.
- `server.keepAliveTimeout = 65s` y `headersTimeout = 66s`: el default de
  Node (5s) es menor que el idle timeout del proxy de Render y causa 502
  intermitentes cuando el proxy reutiliza una conexión que el backend acaba
  de cerrar. Causa clásica de errores esporádicos difíciles de reproducir.

**Tests**: suite completa sin regresiones (31/31 pass).

**Pendiente**: si los 502 persistieran en Render, revisar también el
cold-start del plan free (keep-alive externo ya planificado en otra fase).

## Mejora 10 — Fix del propio proceso: los shims no estaban en git

**Qué**: `.gitignore` tiene `node_modules/`, que excluía silenciosamente
`backend/test/shims/node_modules/`. Los parches generados no contenían los
shims y la suite no corría en un clon limpio. Detectado al simular `git am`
sobre una copia limpia del baseline. Añadida excepción explícita en
`.gitignore` y verificado: baseline limpio + 10 parches → 31/31 tests.

---

# Cola de próximas mejoras (orden sugerido)

1. **App.jsx (3.588 líneas)**: trocear en módulos (`SearchForm`, `WinnerCard`,
   `ResultsView`...) — era el siguiente paso ya planificado. No se hizo en
   esta sesión: el entorno no podía descargar el archivo completo ni
   compilar JSX, y editarlo a ciegas viola la regla de no romper lo que
   funciona.
2. **Tests de frontend**: extraer la lógica pura de `helpers.js` que usa
   `import.meta` a funciones inyectables y testearlas con node:test o
   Vitest.
3. **Timeout global de búsqueda**: con API real y muchas combinaciones, la
   búsqueda puede exceder el timeout del proxy de Render; devolver
   resultados parciales tras ~25s.
4. **returnDate > ~360 días** → 400 (límite de Amadeus).
5. Conectar Amadeus producción + keep-alive de Render (fase ya planificada,
   fuera del alcance de esta sesión por instrucción explícita).

# Cómo aplicar estos cambios en tu repo local

```bash
cd C:\Users\diego\flyndme2        # tu clon real
git checkout -b mejoras-backend
git am "C:\Users\diego\flyndme2\Fyndme\flyndme2\cambios\*.patch"
cd backend && npm install && npm test   # 31/31 con deps reales
```

Los 10 parches solo tocan `backend/`, `README.md`, `MEJORAS.md` y
`.gitignore`. No tocan App.jsx, App.css, i18n, Amadeus real ni el stack.

---

# Sesión 2 (10 jun 2026, tarde) — repo real clonado en sandbox

## Mejora 11 — Bug UI: atajos de teclado con closures obsoletos

**Qué**: el manejador global de teclado de `App.jsx` se registra una sola vez
(`useEffect` con deps `[]`) pero leía `showShortcuts`/`showFavPanel`
directamente del closure → quedaban congelados en `false` para siempre.
Consecuencia: con el panel de atajos (o el de favoritos) abierto, Escape no
lo cerraba; en su lugar navegaba la vista hacia atrás con el panel encima.

**Cómo**: los paneles se leen ahora vía refs (`showShortcutsRef`,
`showFavPanelRef`) sincronizadas con su estado — mismo patrón que ya usaba
`viewRef` en ese mismo manejador. Las sincronizaciones viven junto a las
declaraciones de estado para evitar TDZ.

**Verificación**: parser JSX (@babel) OK sobre App.jsx; suite backend 31/31
sin regresiones. (El runtime de UI no es ejecutable en este sandbox — cambio
mínimo y del mismo patrón ya probado en el archivo.)

**Pendiente**: nada.

## Mejora 12 — Tests de frontend (primera suite): helpers puros + paridad i18n

**Qué**: el frontend no tenía ni un test. Nueva suite con `node --test` (cero
dependencias, no necesita navegador):
- `frontend/tests/helpers.test.mjs` (13 tests): aeropuertos sin duplicados,
  normalizeCode, formateo de moneda/fechas, URLs de Skyscanner/Google Flights
  (estructura, fechas, casos vacíos), fairnessColor, banderas, quick-info.
- `frontend/tests/i18n.test.mjs` (4 tests): paridad total de claves EN↔ES
  (451/451), tipos consistentes y las interpolaciones `{{var}}` idénticas en
  ambos idiomas — una traducción olvidada ya no puede llegar a la UI sin que
  un test falle.

**Cambios de soporte**: `"type": "module"` y script `"test": "node --test"`
en `frontend/package.json` (estándar en proyectos Vite; no afecta al build);
`getBaseUrl()` usa `import.meta.env?.BASE_URL` — fuera de Vite lanzaba
TypeError, ahora es seguro y testeable.

**Verificación**: frontend 17/17 · backend 31/31 · parser JSX OK.

**Pendiente**: extraer más lógica pura de App.jsx (pickBest, convertPrice,
approxDistKm…) a utils testeables — es el primer paso del troceo de App.jsx.

## Mejora 13 — Calidad: lógica pura de App.jsx extraída a utils/resultsLogic.js

**Qué**: primer paso real del troceo de App.jsx (3.596 → 3.538 líneas).
Extraídos a `frontend/src/utils/resultsLogic.js` (sin React, sin DOM):
`convertPrice` + tasas FX, `AIRPORT_COORDS` + `approxDistKm` (haversine),
`pickBest` (criterio total/fairness con desempate) y `buildResultsCsv`
(la parte pura del export CSV; la descarga sigue en App.jsx).

**Bonus**: el CSV ahora escapa comillas dobles según RFC 4180 (antes una
comilla en un dato rompía la fila).

**Tests**: nuevo `tests/resultsLogic.test.mjs` (9 tests: conversión, distancias
plausibles MAD-BCN/MAD-IST, coordenadas en rango, pickBest con empates, CSV
con escapado y datos ausentes). Frontend 26/26 · backend 31/31 · JSX OK.

**Pendiente**: seguir extrayendo (useDateWarnings, destCategoryTags, hooks) y
eventualmente los componentes grandes (WinnerCard, SearchPage) a archivos
propios.

## Mejora 14 — Bug React: pushState dentro del updater de estado

**Qué**: `setView` hacía `window.history.pushState(...)` DENTRO del updater
de `setViewRaw`. Los updaters deben ser puros: con `<React.StrictMode>`
(activo en main.jsx) React los ejecuta dos veces en desarrollo → cada cambio
de vista creaba DOS entradas de historial y el botón atrás necesitaba dos
pulsaciones. En producción funcionaba de rebote, pero es una violación de las
reglas de React que puede romperse con cualquier upgrade.

**Cómo**: el push se decide fuera del updater usando `viewRef` (que ya
existía para el manejador de teclado) como "vista anterior". `viewRef` se
declara ahora junto al estado `view` (antes quedaba por debajo de `setView`).

**Verificación**: frontend 26/26 · backend 31/31 · JSX OK. Comprobado además
que los scripts legacy `verify-simplify.js`/`verify35.js` fallaban IGUAL en
el baseline a0a5b27 (comprueban componentes eliminados en la poda de mayo) —
no son regresión; candidatos a retirarse.

**Pendiente**: retirar o actualizar verify-simplify.js / verify35.js.
