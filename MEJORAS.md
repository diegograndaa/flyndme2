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

## Mejora 15 — Robustez: parámetros de URL validados (utils/urlParams.js)

**Qué**: el efecto que carga búsquedas desde URL (`?o=MAD&dep=...`, función
"copiar enlace de búsqueda") inyectaba los parámetros al estado sin validar:
`?cabin=FOO` → 400 evitable del backend; `?cur=BTC`, fechas malformadas o
`?trip=banana` entraban tal cual al estado de React. Extraído a
`utils/urlParams.js` con validación estricta por parámetro (IATA, fechas ISO,
enums de cabina/criterio/divisa); lo inválido se descarta sin romper lo
válido. App.jsx se reduce y queda más declarativo.

**Tests**: nuevo `tests/urlParams.test.mjs` (6 tests). Frontend 32/32 ·
backend 31/31 · JSX OK.

**Pendiente**: aplicar el mismo tratamiento al flujo `?share=` (id ya se
valida en backend).

## Mejora 16 — Limpieza: scripts de verificación obsoletos retirados a scripts/legacy/

**Qué**: `verify-simplify.js` y `verify35.js` (raíz del repo) validaban
refactors de rondas antiguas y desde la poda de mayo fallan siempre (16/34 y
29/39) porque comprueban componentes eliminados. Ejecutarlos sugería
regresiones falsas. Movidos a `scripts/legacy/` con README explicando su
estado y cuál es la verificación vigente (las dos suites npm test).

**Verificación**: frontend 32/32 · backend 31/31.

**Pendiente**: nada.

## Mejora 17 — Troceo de App.jsx (II): componentes presentacionales a UiBits.jsx

**Qué**: `ResultsSkeleton`, `ScrollProgressBar`, `KeyboardShortcutsOverlay`,
`Breadcrumb` y `FriendlyError` extraídos tal cual (sin cambios de lógica) a
`frontend/src/components/UiBits.jsx`. Son presentacionales puros sin estado
de negocio. App.jsx: 3.538 → 3.448 líneas.

**Verificación**: usos intactos en App.jsx (5 referencias), JSX OK,
frontend 32/32, backend 31/31.

**Pendiente**: siguientes candidatos del troceo — LandingMiniDemo (~250
líneas), SearchHistoryPanel, CostSplitCard, y a medio plazo WinnerCard y
SearchPage a archivos propios.

## Mejora 18 — Validación: horizonte máximo de fechas (360 días)

**Qué**: Amadeus solo admite búsquedas hasta ~361 días vista. Una fecha más
lejana (salida o vuelta) producía un error de Amadeus POR CADA llamada del
abanico origen×destino×fecha — quota quemada para devolver un "sin
resultados" confuso. Ahora: `400 DATE_TOO_FAR` inmediato sin tocar Amadeus,
considerando también la fecha de vuelta.

**Tests**: 1 nuevo con 3 casos (salida lejana, vuelta lejana, dentro del
horizonte OK). Backend 32/32 · frontend 32/32.

**Pendiente**: nada. (Con esto queda cerrada toda la cola de validación de
fechas.)

## Mejora 19 — Tests de render (SSR) para el frontend: la red de seguridad que faltaba

**Qué**: hasta ahora solo se podía parsear el JSX, no ejecutarlo (el sandbox
no puede instalar esbuild/vitest). Nuevo harness de render que NO añade
dependencias — reutiliza lo que ya hay en node_modules:
- `tests/_loader.mjs`: loader ESM de Node que transforma JSX→createElement al
  vuelo con un mini-plugin propio sobre @babel/core (dependencia existente de
  @vitejs/plugin-react), resuelve imports sin extensión estilo Vite, y stubea
  CSS/JSON.
- `tests/_domStubs.mjs`: stubs mínimos de browser (localStorage, matchMedia,
  document, history…).
- `tests/render.test.mjs`: 6 smoke tests con `react-dom/server`:
  **la App completa renderiza** (vista landing), FlightResults con fixtures y
  vacío, VerificationBadge en sus 5 estados, UiBits, CompareChart y
  DestinationMap. Detectan ReferenceError/TypeError reales en el cuerpo de los
  componentes — exactamente lo que un parser no ve.

**Bug encontrado por el propio harness**: `API_BASE` usaba
`import.meta.env.VITE_API_BASE_URL` sin optional chaining → TypeError fuera
de Vite (tests/SSR). Corregido.

**Verificación**: frontend 38/38 (incl. 6 de render) · backend 32/32.

**Pendiente**: con esta red ya es seguro extraer SearchPage y WinnerCard de
App.jsx (siguiente ciclo).

## Mejora 20 — Troceo de App.jsx (III): SearchPage a su propio archivo

**Qué**: el componente más grande de App.jsx — el formulario de búsqueda
completo (orígenes, pasajeros, fechas con avisos, destinos, opciones
avanzadas) — extraído a `components/SearchPage.jsx` junto con sus dos hooks
privados (`useDateWarnings`, `useTypingPlaceholder`, solo usados por él).
Movimiento mecánico sin cambios de lógica. **App.jsx: 3.448 → 2.735 líneas**
(desde el inicio de la sesión: 3.587 → 2.735, −24%).

**Verificación**: render SSR directo de SearchPage con props completas
(nuevo test) + render de App completa + suites: frontend 39/39 · backend
32/32. El análisis previo confirmó que SearchPage solo dependía de 2 símbolos
del módulo (sus hooks privados) — cero riesgo de closures rotos.

**Pendiente**: WinnerCard (588 líneas) — siguiente extracción.

## Mejora 21 — Troceo de App.jsx (IV): WinnerCard a su propio archivo

**Qué**: WinnerCard (585 líneas — tarjeta del ganador con precios animados,
verificación, desglose, CTAs y compartir) extraída a
`components/WinnerCard.jsx` con sus helpers privados (`useFairnessLabel`,
`airlineLogo`, `AnimatedPrice`, `destCategoryTags`). `useCountUp` y
`AnimatedStat` (compartidos con App) viven ahora en UiBits.jsx.
**App.jsx: 2.735 → 2.072 líneas** (3.587 al empezar la sesión: −42%).

**Nota**: el harness de render demostró su valor — detectó 3 imports
olvidados (useRef, fairnessColor, formatEur) que el parser daba por buenos y
habrían sido pantallazos en blanco en producción.

**Verificación**: render directo de WinnerCard con fixture + App completa.
Frontend 40/40 · backend 32/32.

**Pendiente**: App.jsx aún contiene Landing (206), CostSplitCard y varios
paneles menores — extraíbles con el mismo método cuando toque.

## Mejora 22 — Hotfix: shims renombrados para eliminar la excepción de .gitignore

**Qué**: la excepción `!backend/test/shims/node_modules/` añadida en la
Mejora 10 desactiva la optimización con la que git se salta los directorios
`node_modules/` ignorados: git pasó a escanearlos enteros (lento en Windows)
y, combinado con un symlink accidental, provocó el error
"Filename too long" al hacer pull. Los shims viven ahora en
`backend/test/shims/modules/` (NODE_PATH no exige que el directorio se llame
node_modules) y la excepción desaparece — git vuelve a saltarse todos los
node_modules sin mirar dentro.

**Uso actualizado**: `NODE_PATH="$PWD/test/shims/modules" node --test`
(documentado en backend/test/shims/README.md y README.md).

**Verificación**: suite backend con shims 39/39 · con deps reales verificada
antes del incidente (la vista del sandbox sobre node_modules quedó inestable
después; en tu máquina `npm test` funciona igual).

**Pendiente**: nada.

## Mejora 23 — URGENTE: eliminar symlinks node_modules committeados por error

**Qué**: durante el lote 2, los symlinks de desarrollo del sandbox
(`backend/node_modules` y `frontend/node_modules`, apuntando a rutas
absolutas del entorno de trabajo) entraron en los commits: el patrón
`node_modules/` de .gitignore solo ignora DIRECTORIOS, no symlinks. Llegaron
a GitHub main y podían romper los deploys (Vercel/Render checkoutean un
symlink colgante donde npm espera poder instalar) y bloqueaban `git pull` en
copias locales con node_modules reales.

**Cómo**: `git rm --cached` de ambos (backend salió ya con el rename de la
Mejora 22; este commit quita el de frontend). Lección incorporada: en los
entornos de trabajo, los symlinks de desarrollo se crean FUERA del árbol del
repo a partir de ahora.

**Verificación**: `git ls-files | grep node_modules` → solo
backend/test/shims/modules/ (código del repo). Suite backend con shims 39/39.

---

# Sesión 3 (10 jun 2026, noche)

## Mejora 24 — Higiene: shims fuera de test/ y @babel/core como devDependency

**Qué**: (1) `node --test` ejecuta todo lo que cuelga de carpetas `test/`,
así que los 7 archivos de los shims aparecían como "tests" triviales en la
salida (ruido y ~0,5s de arranque). Movidos a `backend/dev-shims/` — la suite
vuelve a reportar exactamente sus 32 tests. (2) `@babel/core` queda declarado
como devDependency del frontend (^7.28.5): los tests de render lo usan
directamente y dependían de que llegara como transitiva de
@vitejs/plugin-react.

**Verificación**: backend 32/32 · frontend 40/40.

## Mejora 25 — Robustez: presupuesto de tiempo de búsqueda con resultados parciales

**Qué**: con la API real de Amadeus, una búsqueda grande (varios orígenes ×
flex ±5 días) puede superar el timeout del proxy de Render (~30s): el usuario
esperaba medio minuto para recibir un 502, con la quota ya gastada. Ahora el
backend tiene un presupuesto de tiempo (`SEARCH_TIME_BUDGET_MS`, default
25s; 0 = sin límite): al agotarse, corta el bucle de tiers y responde 200 con
lo acumulado y `partial: true`. Las respuestas parciales no se cachean (un
reintento puede completarse) y omiten la verificación del ganador
(`verificationStatus: "skipped"` → la UI ya lo muestra como "indicativo").
El frontend muestra un aviso claro de resultados parciales (i18n EN/ES) sobre
los resultados.

**Tests**: 2 nuevos en smoke.test.js (backend dedicado con presupuesto de
100ms y mock lento → partial=true, sin verificación, sin cache; búsqueda
normal → partial=false). Backend 34/34 · frontend 40/40.

**Pendiente**: el frontend podría ofrecer un botón "completar búsqueda" que
reintente automáticamente — de momento el aviso sugiere reintentar.

## Mejora 26 — Troceo de App.jsx (V): Landing a su propio archivo

**Qué**: la página de inicio (hero, demo animada, stats, FAQ y CTAs) extraída
a `components/Landing.jsx` con sus privados `FaqItem` y `LandingMiniDemo`
(261 líneas, autocontenida — solo dependía de useI18n, countryFlag y
AnimatedStat). **App.jsx: 2.081 → 1.818 líneas** (3.587 al inicio del día:
**−49%**).

**Verificación**: render SSR directo de Landing (test nuevo) + App completa.
Frontend 41/41 · backend 34/34.

**Pendiente del troceo**: quedan en App.jsx los paneles menores
(CostSplitCard, SearchHistoryPanel, TopDestinationsPodium, etc.) y el shell
de la app — extraíbles con el mismo patrón cuando toque.

## Mejora 27 — Troceo de App.jsx (VI): shell y paneles de resultados

**Qué**: 12 componentes más fuera de App.jsx, en dos archivos coherentes:
- `components/ChromeBits.jsx`: ThemeToggle, ScrollToTopBtn, LangSelector,
  Toast, LoadingTips y SearchSkeleton (shell de la app y carga).
- `components/ResultsPanels.jsx`: CostSplitCard, PlanYourTripCTA,
  SearchHistoryPanel, DestImageBanner, ResultsShareLink y
  TopDestinationsPodium (paneles de la vista de resultados).

**App.jsx: 1.818 → 1.391 líneas** (3.587 al inicio del día: **−61%**). Lo que
queda es esencialmente el estado, los handlers y el layout de las vistas —
el "cerebro" de la app, como debe ser.

**Verificación**: test de render que ejercita los 12 componentes con fixtures
+ render de App completa. Frontend 42/42 · backend 34/34.

**Pendiente del troceo**: hooks (useTheme, useFavorites, useA11yPrefs,
useBackendStatus) a un hooks/ — última pieza del plan original.

## Mejora 28 — Troceo de App.jsx (VII, final del plan): hooks a hooks/useAppHooks.js

**Qué**: `useTheme`, `useFavorites`, `useA11yPrefs` y `useBackendStatus`
extraídos a `frontend/src/hooks/useAppHooks.js`. Con esto se completa el plan
de troceo original: **App.jsx queda en 1.288 líneas (3.587 esta mañana,
−64%)** y contiene solo estado, handlers y el layout de las tres vistas.
Estructura final: components/ (12 archivos), hooks/, utils/ (4 módulos),
i18n/ — cada pieza testeada por render SSR o unit tests.

**Verificación**: frontend 42/42 · backend 34/34 (el render de App ejercita
los 4 hooks: sus inicializadores corren en SSR).

**Pendiente**: nada del plan de troceo. Siguientes frentes sugeridos:
accesibilidad/responsive (prioridad 6) y npm audit fix.
