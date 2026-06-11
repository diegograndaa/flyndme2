# FlyndMe

PWA que encuentra el destino más barato para que un grupo que sale de
ciudades distintas se encuentre. Compara vuelos desde múltiples orígenes
hacia múltiples destinos y optimiza por coste total del grupo o por equidad
entre viajeros (fairness score).

**Demo**: https://flyndme2.vercel.app · **API**: https://flyndme-backend.onrender.com

## Arquitectura

```
frontend/   React 18 + Vite + Bootstrap (PWA, i18n EN/ES)  → Vercel
backend/    Node + Express                                  → Render
            ├── routes/flights.js   búsqueda multi-origen por tiers de destinos
            ├── routes/share.js     enlaces compartibles (TTL 48h, en memoria)
            ├── services/travelpayoutsService.js  Aviasales Data API (rate limit, retry, cache)
            ├── services/mockFlightService.js     fixtures deterministas (USE_MOCK=true)
            └── utils/ttlCache.js   cache en memoria con TTL compartida
```

El backend busca por niveles (tiers) de destinos y corta en cuanto alcanza
`TARGET_RESULTS`, verifica el precio del ganador vía el proveedor
(`priceFlightOffer`) y etiqueta el resultado
(`verified/changed/partial/failed/timeout/skipped`) sin re-rankear.

## Desarrollo local

```bash
# Backend (puerto 5000)
cd backend
npm install
cp .env.example .env        # rellena TRAVELPAYOUTS_TOKEN o usa USE_MOCK=true
npm run dev

# Frontend (puerto 5173)
cd frontend
npm install
npm run dev
```

Con `USE_MOCK=true` en `backend/.env` la app funciona completa sin llamadas
externas (datos deterministas).

## Tests

```bash
cd backend
npm test        # node --test (requiere npm install previo)
```

62 tests: contrato de la API (smoke end-to-end en modo mock), matemática
multi-pasajero, verificación de precios, deep links de afiliado, validaciones,
rate limits, cache y unidades de TtlCache. En entornos sin acceso a npm, ver
`backend/dev-shims/README.md`.

## Variables de entorno

Ver `backend/.env.example` (servidor, mock, token y marker de Travelpayouts,
tuning de rate limit/cache, CORS) y `frontend/.env.production.example`
(`VITE_API_BASE_URL`, afiliado Skyscanner opcional).

## Registro de cambios

Ver `MEJORAS.md`.
