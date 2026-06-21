// ─── Loader ESM para tests de render (sin Vite) ──────────────────────────────
// Transforma .jsx/.js de src/ con un mini-plugin JSX→createElement construido
// sobre @babel/core (ya presente en node_modules como dependencia de
// @vitejs/plugin-react). CSS → módulo vacío. JSON → export default.
// SOLO se usa en tests (node --import ./tests/_register.mjs --test).
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const t = require("@babel/types");

const REACT_NS = "__jsxReact__";

function jsxName(node) {
  if (node.type === "JSXIdentifier") {
    return /^[a-z]/.test(node.name) ? t.stringLiteral(node.name) : t.identifier(node.name);
  }
  if (node.type === "JSXMemberExpression") {
    return t.memberExpression(jsxName(node.object), t.identifier(node.property.name));
  }
  throw new Error("JSX tag no soportado: " + node.type);
}

function attrsToProps(attrs) {
  if (!attrs.length) return t.nullLiteral();
  return t.objectExpression(attrs.map((a) => {
    if (a.type === "JSXSpreadAttribute") return t.spreadElement(a.argument);
    const name = a.name.type === "JSXNamespacedName"
      ? `${a.name.namespace.name}:${a.name.name.name}` : a.name.name;
    let value;
    if (a.value == null) value = t.booleanLiteral(true);
    else if (a.value.type === "JSXExpressionContainer") value = a.value.expression;
    else value = a.value; // StringLiteral
    return t.objectProperty(t.stringLiteral(name), value);
  }));
}

function childExprs(children) {
  const out = [];
  for (const c of children) {
    if (c.type === "JSXText") {
      const txt = c.value.replace(/\s+/g, " ");
      if (txt.trim() !== "") out.push(t.stringLiteral(txt));
    } else if (c.type === "JSXExpressionContainer") {
      if (c.expression.type !== "JSXEmptyExpression") out.push(c.expression);
    } else {
      out.push(c); // ya transformado (visita en exit)
    }
  }
  return out;
}

const jsxPlugin = () => ({
  manipulateOptions(_opts, parserOpts) { parserOpts.plugins.push("jsx"); },
  visitor: {
    JSXElement: {
      exit(path) {
        const n = path.node;
        path.replaceWith(t.callExpression(
          t.memberExpression(t.identifier(REACT_NS), t.identifier("createElement")),
          [jsxName(n.openingElement.name), attrsToProps(n.openingElement.attributes), ...childExprs(n.children)]
        ));
      },
    },
    JSXFragment: {
      exit(path) {
        path.replaceWith(t.callExpression(
          t.memberExpression(t.identifier(REACT_NS), t.identifier("createElement")),
          [t.memberExpression(t.identifier(REACT_NS), t.identifier("Fragment")), t.nullLiteral(), ...childExprs(path.node.children)]
        ));
      },
    },
  },
});

export async function resolve(specifier, context, nextResolve) {
  // CSS/SCSS (propio o de bootstrap) → módulo vacío
  if (/\.(css|scss|sass)$/.test(specifier)) {
    return { url: "data:text/css-stub," + encodeURIComponent(specifier), shortCircuit: true };
  }
  // Imports relativos sin extensión (estilo Vite) → probar .jsx / .js
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of [".jsx", ".js", "/index.jsx", "/index.js"]) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch { /* probar siguiente */ }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("data:text/css-stub,")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  if (url.endsWith(".json")) {
    const json = readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${json};`, shortCircuit: true };
  }
  if (/\/src\/.*\.(jsx|js)$/.test(url)) {
    const src = readFileSync(fileURLToPath(url), "utf8");
    const out = babel.transformSync(src, {
      filename: fileURLToPath(url),
      plugins: [jsxPlugin],
      sourceType: "module",
      configFile: false, babelrc: false,
      retainLines: true,
    });
    const prefix = `import * as ${REACT_NS} from "react";\n`;
    return { format: "module", source: prefix + out.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
