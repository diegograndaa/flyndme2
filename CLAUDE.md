# FlyndMe

PWA que encuentra el destino más barato para un grupo que vuela desde varios orígenes (multi-origen → mejor destino común). Optimiza por coste total o equidad. Beta funcional EN PRODUCCIÓN con datos reales. Última actualización: 2026-06-11.

## Stack
- **Frontend**: React + Vite + **Bootstrap** + CSS propio (NO Tailwind). Deploy: Vercel → flyndme2.vercel.app (flyndme.vercel.app está caído, no usar).
- **Backend**: Node + Express. Deploy: Render → flyndme-backend.onrender.com (keep-alive vía GitHub Actions cron */10).

## Proveedor de datos de vuelos
- **Travelpayouts/Aviasales Data API en producción** (`FLIGHT_PROVIDER=travelpayouts`). Precios = caché de búsquedas reales, NO ofertas verificables → `verificationStatus: "skipped"` y badge "precio orientativo". Fallback fechas vecinas: `TP_DATE_FLEX_DAYS=2`, mostrando siempre la fecha real.
- **Amadeus muere el 17-jul-2026** (cierre portal self-service). Es solo respaldo: limpiar código y variables de Render antes de esa fecha.
- Capa 2 pendiente: verificación de finalistas con SerpAPI Google Flights (250 gratis/mes).
- Interfaz de servicio común: `getCheapestOffer / priceFlightOffer / budgetStatus` (los providers son drop-in, el frontend no cambia).

## Comandos
- Tests backend: `cd backend && npm test` (~39 tests, sin red, con mocks).
- Tests frontend: `cd frontend && npm test` (~40 tests, harness SSR propio en `tests/_loader.mjs`, incluye render completo de la App).
- Dev frontend: `cd frontend && npm run dev` · Build: `npm run build`.

## Estructura clave
- `backend/services/`: travelpayoutsService.js (activo), amadeusService.js (legacy), mockAmadeusService.js. TtlCache, quota guard mensual, rate limiting.
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
Afiliación Travelpayouts/Aviasales, marker **738121**. `buildAffiliateLink()` + CTA "Reservar" implementados en local SIN commit/deploy. Falta: `TRAVELPAYOUTS_MARKER=738121` en Render, push, y activar cuenta Travelpayouts. Hoy ingresos = 0 €.

## Backlog (orden sugerido)
1. Cerrar circuito de monetización (lo único que genera ingresos).
2. Rama `redesign-stitch`: validar visualmente y mergear a main.
3. Capa 2 verificación SerpAPI.
4. Limpieza Amadeus (antes del 17-jul).
5. Accesibilidad/responsive, modo oscuro del tema Stitch, npm audit fix, capturas README, extraer Landing/CostSplitCard de App.jsx, unificar doble control de ordenación en "Otras opciones".

## Agentes
Hay 5 subagentes en `.claude/agents/` (backend, frontend, qa, release, producto). Delega el trabajo en ellos según el área; qa valida antes de cualquier push.
