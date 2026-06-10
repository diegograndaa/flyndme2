# Scripts legacy (histórico)

`verify-simplify.js` y `verify35.js` validaban refactors concretos de rondas
antiguas (round 35 y la simplificación de la vista de resultados). Tras la
poda de App.jsx de mayo 2026 comprueban componentes que YA NO EXISTEN, por lo
que fallan siempre y no indican regresiones.

Se conservan solo como referencia histórica. La verificación vigente es:

```bash
cd backend  && npm test   # suite API (31 tests)
cd frontend && npm test   # helpers + i18n + lógica de resultados (32 tests)
```
