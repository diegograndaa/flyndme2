# FlyndMe

PWA que encuentra el destino más barato para un grupo que vuela desde varios orígenes (multi-origen → mejor destino común). Optimiza por coste total o equidad. Beta funcional EN PRODUCCIÓN con datos reales. Última actualización: 2026-06-13.

## Orquestación (lee esto primero: eres el cerebro del proyecto)

Tú (la sesión principal) eres el orquestador. No implementas directamente el trabajo grande: lo delegas en los agentes de `.claude/agents/` y coordinas e integras sus resultados.

**Objetivo de Diego (jun-2026): PRODUCTO REDONDO primero.** Antes que ingresos o crecimiento, quiere una app rematada: rediseño Stitch mergeado y pulido, UX cuidada y precios fiables. Cuando dudes entre opciones, elige la que acerque a eso.

**Estilo de trabajo por defecto: rápido y funcional.** Shippear pronto e iterar; deuda técnica aceptable. Excepción innegociable: todo lo que toque precios, datos o confianza del usuario se hace con rigor (tests + validación), nunca rápido.

**Flujo de delegación:** flyndme-backend / flyndme-frontend implementan (en paralelo si no se pisan) → flyndme-qa valida SIEMPRE antes de cualquier push → flyndme-release commitea, pushea y verifica el deploy. flyndme-producto solo para decisiones de negocio/roadmap.

**Pregunta a Diego antes de:** mergear a main, borrar código no trivial, cambios visuales grandes no pedidos, y cualquier cosa que toque variables de producción (Render/Vercel). Para lo demás, decide tú y explica por qué.

## Stack
- **Frontend**: React + Vite + **Bootstrap** + CSS propio (NO Tailwind). Deploy: Vercel → flyndme2.vercel.app (flyndme.vercel.app está caído, no usar).
- **Backend**: Node + Express. Deploy: Render → flyndme-backend.onrender.com (keep-alive vía GitHub Actions cron */10).

## Proveedor de datos de vuelos
- **Travelpayouts/Aviasales Data API en producción** (`FLIGHT_PROVIDER=travelpayouts`). Precios = caché de búsquedas reales, NO ofertas verificables → `verificationStatus: "skipped"` y badge "precio orientativo". Fallback fechas vecinas: `TP_DATE_FLEX_DAYS=2`, mostrando siempre la fecha real.
- **Amadeus**: eliminado por completo el 11-jun-2026 (código del repo y variables de Render). No queda nada pendiente de la migración.
- **Capa 2 (SerpAPI Google Flights, 250 búsquedas gratis/mes)**: endpoint `POST /api/flights/verify` (backend/services/serpapiService.js) — el frontend verifica el GANADOR en segundo plano tras pintar resultados y el badge pasa de "orientativo" a ✓/↑↓. **ACTIVA en prod** (`SERPAPI_KEY` en Render desde 11-jun-2026; verificado: FCO 27€ confirmado por Google Flights). OJO: Google Flights NO acepta códigos de ciudad (ROM/LON/PAR → 200 "no results"), por eso se verifica contra el aeropuerto REAL del billete (`offer.tp.originAirport/destinationAirport`, con fallback al código de ciudad). Sin `SERPAPI_KEY` en Render responde `skipped` y todo queda como antes. Va aparte de /multi-origin a propósito: SerpAPI tarda 10-20s y el proxy de Render corta a ~30s. Quota guard doble (contador local + GET /account cacheado 10 min, margen 10), caché por tramo 60 min y por payload 30 min. Logs `[serpapi-verify]` registran la desviación cached vs Google por tramo, con `dateFallback=true/false`.
- Interfaz de servicio común: `getCheapestOffer / priceFlightOffer / budgetStatus` (los providers son drop-in, el frontend no cambia).

## Comandos
- Tests backend: `cd backend && npm test` (~91 tests, sin red, con mocks).
- Tests frontend: `cd frontend && npm test` (~57 tests, harness SSR propio en `tests/_loader.mjs`, incluye render completo de la App).
- Dev frontend: `cd frontend && npm run dev` · Build: `npm run build`.

## Estructura clave
- `backend/services/`: travelpayoutsService.js (activo), serpapiService.js (verificación capa 2), mockFlightService.js (USE_MOCK=true). TtlCache, quota guard mensual, rate limiting.
- `frontend/src/`: App.jsx (~1.350 líneas tras extraer componentes y podar imports muertos), SearchPage.jsx, WinnerCard.jsx, FlightResults.jsx, UiBits.jsx, Landing.jsx, ResultsPanels.jsx (incluye CostSplitCard), DestinationMap.jsx (mapa SVG con geodatos reales Natural Earth en europeGeo.js, regenerable con `frontend/scripts/build-map-geo.mjs`), hooks/ (useFocusTrap), utils/ (resultsLogic, urlParams, verification), styles/ (theme-stitch.css, results-simple.css), cityImages.js, i18n EN/ES.

## Diseño vigente (tema Stitch)
Granate #AE2F34 / coral #FF6B6B / lavanda (#FCF8FF fondo, #EEECFF contenedores) / azul #0059B8 / verde #00B179, Plus Jakarta Sans. **Solo 2 pantallas**: home (hero+form+cómo funciona+FAQ) y resultados (lista sobria estilo Skyscanner, clases `altl-*`). En jun-2026 se podaron ~45 widgets con datos inventados: NO resucitarlos. **Modo oscuro completo** (familia navy/lavanda #131434/#1B1C40/#2C2D52, granate aclarado #FFB3B0 con texto tinta #16173B): toggle en header + `prefers-color-scheme`, anti-flash inline en index.html, localStorage `flyndme_theme`. Contraste AA en ambos temas (medido); un solo control de ordenación ("Más barato | Más equitativo" en WinnerCard).

## Reglas duras
1. **Nunca inventar precios ni fingir verificación.** Sin datos → sin resultados. No fabricar aeropuertos de escala.
2. **Coste 0 en APIs durante el MVP**: respetar quota guard, caché agresiva, verificación solo para finalistas.
3. MVP: cambios incrementales, no rewrites; simplicidad antes que arquitectura bonita.
4. Todo cambio de backend lleva tests unitarios sin red.
5. sw.js (PWA) solo se registra con `import.meta.env.PROD` (en dev causó pantallas en blanco).
6. i18n: editar los JSON a mano, nunca reformatear programáticamente.
7. Tras mover código de App.jsx, verificar TODOS los imports (ya hubo dos pantallas en blanco por referencias rotas que los tests SSR no cazaron) → tests + arrancar dev y mirar.
8. No commitear node_modules ni crear symlinks dentro del repo (`git ls-files | grep node_modules` debe estar vacío).
9. `.claude/` está en .gitignore (los agentes son locales; copia maestra en `Fyndme\claude-agents\`).

## Monetización (estado 11-jun-2026)
Afiliación Travelpayouts/Aviasales, marker **738121**. Circuito COMPLETO: `buildAffiliateLink()` (con tests) + CTA "Reservar" desplegados, `TRAVELPAYOUTS_MARKER=738121` activo en Render y cuenta Travelpayouts activada. Verificado en prod con búsqueda real: todos los deep links llevan `&marker=738121`. Pendiente solo esperar las primeras reservas (comisión ~1,1-1,3%) — vigilar el dashboard de Travelpayouts. Nota API: la respuesta de /multi-origin anida los offers en `flights[].flights[].offer.link`.

## Backlog (ordenado según el objetivo "producto redondo")
1. Vigilancia continua capa 2: `[serpapi-verify]` en logs de Render (desviación date-fallback) y cupo en serpapi.com.
2. Resto: capturas para el README — HECHAS; backlog técnico vacío salvo vigilancias pasivas.

Hecho (11-jun-2026): rediseño Stitch mergeado a main y rama borrada; Amadeus eliminado (código + variables Render); monetización completa y verificada en prod (buildAffiliateLink + CTA + marker activo, 6 tests); capa 2 SerpAPI implementada, desplegada y VERIFICADA en prod (badge ✓ confirmado por Diego con búsqueda real; fix aeropuertos reales porque Google Flights no acepta códigos de ciudad); UX tanda 1 (control de ordenación único, a11y AA, responsive 360px) y tanda 2 (modo oscuro Stitch completo, lista abierta al cambiar criterio, fix crash de favoritos) aprobadas por Diego.

Hecho (16-jun-2026): capturas del README (`7de73ab`): 3 PNG en `docs/screenshots/` (home, resultados, mapa; tema claro, 1x ~1 MB total) generadas con la app en modo mock y el banner PWA oculto, sección "Capturas" añadida al README. Verificado que las 3 dan 200 en raw.githubusercontent. Smoke visual del lote del 13-jun confirmado OK en prod por Diego. **Migración vite@5→@8** (rama `chore/vite8`): vite@8.0.16 (bundler rolldown, ya no esbuild/rollup) + @vitejs/plugin-react@6.0.2 + @babel/core@7.29.7; `npm audit` pasó de 3 vulns (2 high esbuild/vite dev-only + 1 low babel) a **0**. QA: build OK (rolldown, ~350 ms, code-splitting intacto), 57/57 tests, smoke en navegador de DEV y PREVIEW (build prod) — home + búsqueda completa renderizan sin errores de consola. El loader de tests usa `@babel/core` directo (independiente del bundler); plugin-react@6 ya no arrastra babel. **Fix SEO/dominio** (`03d376d`): `flyndme.vercel.app` daba 404; corregidas las 5 refs de index.html (canonical/og/twitter/JSON-LD) + default de `FRONTEND_URL` del backend a `flyndme2.vercel.app`, añadidos robots.txt/sitemap.xml + test de regresión; `FRONTEND_URL` puesta en Render. **Analítica Vercel Web Analytics**: `@vercel/analytics` + `<Analytics/>` en main.jsx + `utils/analytics.js` (track saneado); `trackEvent` reconectado (activa los ~7 eventos ya existentes) y nuevo evento **`book_click`** en los 6 CTAs de reserva (winner+alts × travelpayouts/skyscanner/google) + evento `search`. Embudo search→search_complete→book_click verificado en navegador. PENDIENTE: Diego debe **habilitar Web Analytics en el dashboard de Vercel** para que recoja datos (sin eso, no hay error pero tampoco datos). OJO: el CTA Travelpayouts (`offer.link`) NO se renderiza en modo mock (lo añade el backend solo con provider real).

Hecho (12/13-jun-2026): tanda 3 de fixes publicada (`e9b193b`: sección de compra desplegable —selectores BEM—, deep links Skyscanner/Google Flights con aeropuertos reales, formato yymmdd, botón muted legible en oscuro); favicons generados en frontend/public (todas las referencias de index.html/manifest resuelven); npm audit fix (backend a 0 vulnerabilidades; frontend solo quedan esbuild/vite dev-only); Landing/CostSplitCard ya estaban extraídos en commits previos — se podaron 11 imports muertos de App.jsx; micro-a11y completado (separadores `aria-hidden`, `.rv-tab-badge` AA en todos los estados —estaba roto por un `var(--slate-600)` inexistente—, useFocusTrap en favoritos/atajos/drawer móvil); mapa de destinos rediseñado con geodatos reales Natural Earth 50m (chunk lazy 23,5 KB gzip, claro+oscuro, arcos Bézier, clamp para ciudades fuera de bbox tipo TFS); manifest.json de la PWA pasado a colores Stitch (theme #AE2F34, fondo #FCF8FF).

## Agentes
Hay 5 subagentes en `.claude/agents/` (backend, frontend, qa, release, producto). Delega el trabajo en ellos según el área; qa valida antes de cualquier push.
