# Shims de test (solo para entornos sin acceso a npm)

Esta carpeta contiene implementaciones mínimas de `express`, `cors`, `helmet`,
`express-rate-limit`, `compression`, `dotenv` y `axios` que permiten ejecutar
la suite de tests (`backend/test/smoke.test.js`) en sandboxes donde
`npm install` está bloqueado (sin red).

**Nunca se usan si `backend/node_modules/` existe**: la resolución de módulos
de Node siempre prefiere `node_modules/` local sobre `NODE_PATH`.

Uso (solo cuando no puedes hacer `npm install`):

```bash
cd backend
NODE_PATH="$PWD/test/shims/node_modules" node --test
```

En desarrollo normal usa siempre las dependencias reales:

```bash
cd backend
npm install
npm test
```

Limitaciones deliberadas del shim: sin gzip real, sin cabeceras helmet
completas, axios siempre rechaza (no hay red), rate-limit con ventana fija
en memoria. Suficiente —y honesto— para validar la lógica de negocio del
backend en modo mock; no sustituye a las dependencias reales en producción.
