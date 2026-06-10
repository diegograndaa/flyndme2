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
            ├── services/amadeusService.js      Amadeus real (rate limit, retry, cache)
            ├── services/mockAmadeusService.js  fixtures deterministas (USE_MOCK=true)
            └── utils/ttlCache.js   cache en memoria con TTL compartida
```

El backend busca por niveles (tiers) de destinos y corta en cuanto alcanza
`TARGET_RESULTS`, verifica el precio del ganador vía Flight Offers Price y
etiqueta el resultado (`verified/changed/partial/failed/timeout`) sin
re-rankear.

## Desarrollo local

```bash
# Backend (puerto 5000)
cd backend
npm install
cp .env.example .env        # rellena AMADEUS_API_KEY/SECRET o usa USE_MOCK=true
npm run dev

# Frontend (puerto 5173)
cd frontend
npm install
npm run dev
```

Con `USE_MOCK=true` en `backend/.env` la app funciona completa sin consumir
quota de Amadeus (datos deterministas).

## Tests

```bash
cd backend
npm test        # node --test (requiere npm install previo)
```

31 tests: contrato de la API (smoke end-to-end en modo mock), matemática
multi-pasajero, verificación de precios, validaciones, rate limits, cache y
unidades de TtlCache/cache key. En entornos sin acceso a npm, ver
`backend/test/shims/README.md`.

## Variables de entorno

Ver `backend/.env.example` (servidor, mock, credenciales Amadeus, tuning de
rate limit/cache, CORS) y `frontend/.env.production.example`
(`VITE_API_BASE_URL`, afiliado Skyscanner opcional).

## Registro de cambios

Ver `MEJORAS.md`.
