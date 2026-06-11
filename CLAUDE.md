# FlyndMe

PWA que encuentra el destino más barato para un grupo que vuela desde varios orígenes (multi-origen → mejor destino común). Optimiza por coste total o equidad. Beta funcional EN PRODUCCIÓN con datos reales. Última actualización: 2026-06-11.

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
- Capa 2 pendiente: verificación de finalistas con SerpAPI Google Flights (250 gratis/mes).
- Interfaz de servicio común: `getCheapestOffer / priceFlightOffer / budgetStatus` (los providers son drop-in, el frontend no cambia).

## Comandos
- Tests backend: `cd backend && npm test` (~62 tests, sin red, con mocks).
- Tests frontend: `cd frontend && npm test` (~42 tests, harness SSR propio en `tests/_loader.mjs`, incluye render completo de la App).
- Dev frontend: `cd frontend && npm run dev` · Build: `npm run build`.

## Estructura clave
- `backend/services/`: travelpayoutsService.js (activo), mockFlightService.js (USE_MOCK=true). TtlCache, quota guard mensual, rate limiting.
- `frontend/src/`: App.jsx (~2.000 líneas, sigue grande), SearchPage.jsx, WinnerCard.jsx, FlightResults.jsx, UiBits.jsx, Landing.jsx, utils/ (resultsLogic, urlParams), styles/ (theme-stitch.css, results-simple.css), cityImages.js, i18n EN/ES.

## Diseño vigente (tema Stitch)
Granate #AE2F34 / coral #FF6B6B / lavanda (#FCF8FF fondo, #EEECFF contenedores) / azul #0059B8 / verde #00B179, Plus Jakarta Sans. **Solo 2 pantallas**: home (hero+form+cómo funciona+FAQ) y resultados (lista sobria estilo Skyscanner, clases `altl-*`). En jun-2026 se podaron ~45 widgets con datos inventados: NO resucitarlos.

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
1. Fiabilidad de precios: capa 2 verificación SerpAPI + vigilar desviación de los date-fallback.
2. UX: accesibilidad, responsive, modo oscuro del tema Stitch, unificar doble control de ordenación en "Otras opciones".
3. Resto: npm audit fix, capturas README, extraer Landing/CostSplitCard de App.jsx.

Hecho (11-jun-2026): rediseño Stitch mergeado a main y rama borrada; Amadeus eliminado (código + variables Render); monetización completa y verificada en prod (buildAffiliateLink + CTA + marker activo, 6 tests).

## Agentes
Hay 5 subagentes en `.claude/agents/` (backend, frontend, qa, release, producto). Delega el trabajo en ellos según el área; qa valida antes de cualquier push.
