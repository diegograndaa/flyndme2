// Registra el loader de JSX/CSS/JSON para los tests de render.
// Uso: node --import ./tests/_register.mjs --test
import { register } from "node:module";
register("./_loader.mjs", import.meta.url);
