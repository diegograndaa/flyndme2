# FlyndMe

PWA que encuentra el destino más barato para un grupo que vuela desde varias ciudades. Ordena por coste total o por equidad. En producción en **flyndme.com** con datos reales.

Este archivo describe el proyecto **como está hoy** (rehecho el 11-nov-2026). El registro de sesiones anteriores, con sus métodos y lecciones, está en `docs/HISTORIAL.md`. La revisión completa del proyecto y lo que queda pendiente está en `Fyndme/revision-final-2026-11.md` (proyecto de Claude, fuera del repo).

## Cómo trabajar aquí

- **Objetivo de Diego: producto redondo.** UX cuidada y precios fiables antes que ingresos o crecimiento.
- **Rápido y funcional por defecto.** Excepción innegociable: todo lo que toque precios, datos personales, cuentas o cobro se hace con rigor (tests y validación).
- **Publica en `main` sin preguntar** cuando el cambio está probado (Diego, 19-oct-2026).
- **Pregunta antes de:** borrar código no trivial, hacer cambios visuales grandes no pedidos, o tocar variables de producción (Render o Vercel).
- **Antes de cerrar una tarea:** `npm test` en `backend` y en `frontend`, `npm run build` si tocaste el frontend, y verifica el despliegue por contenido (ver «Despliegue»).
- Si hay agentes en `.claude/agents/` (backend, frontend, qa, release, producto), la sesión principal puede delegar en ellos; `.claude/` no está en el repo.

## Reglas duras

1. **Nunca inventar precios ni fingir verificación.** Sin datos, sin resultado. No fabricar aeropuertos de escala ni horas.
2. **Coste cero en APIs.** Respetar los cupos y las cachés.
3. Cambios incrementales, sin reescrituras.
4. Todo cambio de backend lleva tests **sin red** (mocks e inyección de transporte).
5. `sw.js` solo se registra con `import.meta.env.PROD`.
6. i18n: editar `es.json` y `en.json` a mano, sin reformatear el archivo. Las dos lenguas llevan las mismas claves (hay test).
7. Tras mover código de `App.jsx`: comprobar imports, tests y mirar la app en `dev`.
8. No commitear `node_modules`, `.env` ni secretos.
9. **No escribir colores literales en reglas `[data-theme="dark"]`**: van en tokens.

## Stack y despliegue

- **Frontend:** React 18 + Vite 8, subset Sass de Bootstrap y CSS propio. Sin Tailwind, sin router, sin Redux. Vercel → `flyndme.com` (`www` y `flyndme2.vercel.app` redirigen).
- **Backend:** Node + Express (CommonJS). Render gratuito → `flyndme-backend.onrender.com`. Se duerme a los 15 min; `keep-alive.yml` no basta (GitHub retrasa el cron horas). Falta un pinger externo cada 5 min a `/api/ping`.
- **Almacén:** Upstash Redis vía `backend/utils/kvStore.js`. `GET /api/health` dice qué almacén usa cada espacio.
- **Verificar un despliegue:** `GET /api/version` devuelve el commit del backend. En Vercel los hashes no coinciden con el build local: descarga el HTML o el CSS de producción y busca una cadena propia del cambio.

## Datos de vuelos

- **Travelpayouts / Aviasales** (`travelpayoutsService.js`): precios de **caché** de búsquedas reales, solo clase turista, gratis. No son ofertas reservables.
  - Solo ida: precio de la fecha exacta o nada. Ida y vuelta: calendario semanal y, si no hay, el mes. **Ya no se sustituye la fecha** por una vecina (desde el 6-nov-2026): las fechas cercanas se devuelven aparte en `dateOptions` para que el usuario las elija.
  - Si a un origen le falta precio, el destino entero se descarta.
- **SerpAPI / Google Flights** (`serpapiService.js`, `POST /api/flights/verify`): comprueba **solo el destino de la tarjeta**, contra el aeropuerto real del billete. Si la comprobación es completa, ese precio pasa a ser el mostrado; nunca se reordena.
  - El frontend la lanza **sola** en cada búsqueda (`App.jsx`, `handleVerifyWinner`). Gasta una consulta por origen y el plan gratuito da 250 al mes: unas 80 búsquedas de tres orígenes. Pendiente decidir si se pasa a bajo demanda o se amplía el plan.
- **La búsqueda** (`POST /api/flights/multi-origin`) consulta los 24 destinos del pool (`DEFAULT_DESTINATION_TIERS`) y devuelve los 6 mejores ya ordenados, más el mejor según el otro criterio si no está entre ellos. Tope de tiempo de 25 s (`partial: true`).
  - La pantalla pide por defecto `destBasis: "cheaper"`: una lista corta de 12 ciudades con tarifas recientes bajas (`cheaperDestinations.js`) que se consulta **primero**, y detrás las 24 habituales que no estén ya. Sola, la lista corta dejaba búsquedas con un único destino.
- **Mock:** `USE_MOCK=true` en el backend. Lo usan los tests y el desarrollo local.

## Cuentas (`backend/routes/auth.js`, `frontend/src/hooks/useAccount.js`)

- Correo y contraseña (scrypt), y Google, Apple o Facebook si el servidor tiene sus credenciales (el token se verifica en servidor).
- Sesión: token opaco en Redis, 30 días con «Recordarme» o 12 horas. Cada cuenta tiene `sessionsAfter`: las sesiones anteriores a esa marca no valen.
- Ciclo de vida: `POST /forgot` y `/reset` (enlace de un solo uso, 1 h), `/verify` (confirmar correo, 7 días), `/password` (cambiarla), `GET /export`, `DELETE /me`.
- Diez contraseñas falladas bloquean esa cuenta una hora. Además hay límite por IP.
- Los almacenes de cuentas, sesiones, identidades, enlaces de correo y ventas son `strict`: si Redis falla se responde 503, nunca «no existe».
- **El correo sale por Brevo.** Sin `BREVO_API_KEY` en Render no hay enlaces de contraseña ni de confirmación (`/forgot` responde `AUTH_MAIL_OFF`).

## Venta de billetes (Duffel) — APAGADA

- Código en `backend/services/groupSale.js`, `saleMail.js` y `frontend/src/components/CheckoutPage.jsx`, `DuffelPay.jsx`, `GroupSalePanel.jsx`.
- **Interruptor:** sin `SALE_ENABLED=true` en Render no se ofrece «Comprar» ni se abren presupuestos. `/api/health` devuelve `sale: open|closed` y `payments: off|test|live`.
- **No abrir con dinero real** hasta arreglar los bloqueantes B1–B3 del informe: la emisión no guarda estado tramo a tramo, una respuesta dudosa de Duffel se reembolsa como si no hubiera billete, y la pantalla puede decir «No se ha cobrado» cuando sí.

## Endpoints

| Ruta | Para qué |
|---|---|
| `GET /api/ping` · `/api/version` · `/api/health` | despertar · commit · estado, almacenes y contadores |
| `POST /api/flights/multi-origin` | búsqueda principal |
| `POST /api/flights/verify` | comprobar el destino de la tarjeta (SerpAPI) |
| `POST /api/flights/cheaper-date` · `/price-check` · `/trip-length-hint` | fecha más barata · vigilar precio · otra duración |
| `GET /api/flights/budget` | cupos |
| `/api/flights/group-sale/*` | venta (apagada) |
| `/api/auth/*` | cuentas |
| `/api/share` · `/api/groups` | resultado compartido (48 h) · plan de grupo (14 días) |
| `GET /api/og` · `/api/sog` *(Edge, en Vercel)* | imagen y HTML de vista previa al compartir |

Límites: 300 peticiones cada 10 min por IP en todo `/api` (`/ping` exento), 60 en `/api/flights`, 20 en registro, entrada y enlaces de correo.

## Frontend

- `App.jsx` (unas 2.700 líneas) es dueño del estado y de casi todas las llamadas; los componentes son de presentación. La cuenta vive en `hooks/useAccount.js`.
- Pantallas: portada con formulario y mapa vivo, resultados (tarjeta de decisión, «Salidas», comparar), plan de grupo (`?group=`), caja de pago (`?caja=`), y páginas estáticas `/privacidad/`, `/quedar/…` y `/meet/…` (generadas con `npm run seo:build`).
- **Estilos:** los tokens y casi todo lo vigente están en `styles/board.css` y `styles/revision.css`. `App.css`, `theme-stitch.css` y `results-simple.css` vienen de diseños anteriores y siguen cargándose. El 11-nov-2026 se quitaron las reglas de 178 clases que ya no usa ningún componente (comparando capturas antes y después); lo que queda ahí está en uso o pisa a Bootstrap: antes de borrar nada más, comprobar en navegador.
- **Fuentes:** IBM Plex Sans y Mono servidas desde `public/fonts/` (`plex.css`). No volver a Google Fonts.

## Diseño: «terminal de aeropuerto»

- Claro: crema `#F5F3EF`, papel `#FBF9F5`, tinta `#1A1A1A`. Oscuro: `#121316`, texto hueso `#E6E8EC`. Prohibido navy, violeta y degradados.
- Un solo acento: amarillo de señalética `#FFC20E` (`--sign`), siempre con tinta encima y en los mismos sitios en los dos temas. `--primary` es tinta en claro y hueso en oscuro, nunca amarillo.
- El relleno amarillo en resultados es solo para «Reservar» y el botón principal. «Reservar» va a su ancho en escritorio (ancho completo solo en móvil); la cifra más grande de la pantalla es el total del grupo.
- Nada de filas de iconos sin nombre: bajo cada vuelo, enlaces con texto (aerolínea, Skyscanner, Google Flights, Copiar); bajo la tarjeta, «Compartir» (despliega los canales, o abre la hoja del sistema) y «Vigilar precio».
- Los filtros van plegados en todos los anchos: el botón «Filtros» abre el panel lateral. En escritorio la decisión ocupa el centro a 1040 px.
- Portada en escritorio: los tres pasos van bajo el mapa; la sección «en 3 pasos» queda para el móvil.
- Un color por viajero (`--trav-1…8`), siempre junto al código de la ciudad.
- La equidad no se comunica en negativo: barras «quién paga qué» y un dato neutro.
- Texto mínimo 12 px, campos a 16 px (iOS hace zoom por debajo), dianas táctiles de 40 px o más.
- Tras tocar colores: `node frontend/scripts/theme-parity-audit.mjs 390` y `1366` deben dar 0 diferencias.

## Comandos

- Tests: `cd backend && npm test` (308) · `cd frontend && npm test` (273). Sin red.
- Local con datos de prueba: `cd backend && USE_MOCK=true PORT=5000 node index.js` y `cd frontend && VITE_API_BASE_URL=http://localhost:5000 npm run dev`. Enlace que rellena el formulario: `http://localhost:5173/?o=MAD&o=LON&o=BER&dep=AAAA-MM-DD&trip=oneway`.
- No matar procesos con `pkill -f "node index.js"` desde una orden que contenga ese texto: mata la propia shell. Matar por PID.

## Variables de entorno

- **Render:** `TRAVELPAYOUTS_TOKEN` (obligatoria) · `TRAVELPAYOUTS_MARKER` · `SERPAPI_KEY` · `UPSTASH_REDIS_REST_URL` y `_TOKEN` · `ALLOWED_ORIGINS` · `FRONTEND_URL` · `BREVO_API_KEY` y `SALE_MAIL_FROM` (correo) · `DUFFEL_ACCESS_TOKEN` y `SALE_ENABLED` (venta) · las de acceso social (ver `backend/.env.example`).
- **Ajuste fino:** `SEARCH_TARGET_RESULTS`, `SEARCH_MAX_RETURNED`, `SEARCH_TIME_BUDGET_MS`, `API_GENERAL_LIMIT`, `AUTH_ATTEMPT_LIMIT`, `AUTH_ACCOUNT_FAILS`, `SERPAPI_MONTHLY_BUDGET`.
- **Vercel:** `VITE_API_BASE_URL`.

## Deuda conocida

- **Claves antiguas de Amadeus en el historial de git** (`backend/.env`, primeros commits). El repo es público: darlas por comprometidas y confirmar que están revocadas.
- La política CSP completa está en modo informe (`frontend/vercel.json`); solo se aplican `frame-ancestors`, `object-src` y `base-uri`. Para aplicarla entera hay que probar los tres accesos sociales.
- Código que ya no se ejecuta: la rama `dateFallback` (backend, frontend y `/verify`), y `verifyDestination` / `priceFlightOffer` (se conservan a propósito para un proveedor que sepa re-tarifar).
- `README.md` describe lo general; `MEJORAS.md` es histórico.
