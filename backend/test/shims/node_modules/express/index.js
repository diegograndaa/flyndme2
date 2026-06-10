// ─── Minimal Express 4 shim (TEST-ONLY) ─────────────────────────────────────
// Implements the subset of the Express API that backend/ actually uses:
//   express(), express.json(), express.Router(), app.use/get/post/listen,
//   route params (:id), mounted routers, 404 fallthrough, 4-arity error
//   handlers, res.json/status/set/send/redirect, req.body/params/path.
// It exists so the test suite can run in sandboxes where npm install is
// blocked. NEVER use in production — `npm install` always takes precedence
// because a real node_modules/ wins over NODE_PATH resolution.
const http = require("http");

function compilePath(path) {
  // "/:id/og" → regex + param names. "/" matches root only.
  const names = [];
  const pattern = path
    .split("/")
    .filter((s, i) => !(i === 0 && s === ""))
    .map((seg) => {
      if (seg.startsWith(":")) { names.push(seg.slice(1)); return "([^/]+)"; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  const re = new RegExp("^/" + pattern + "/?$");
  return { re, names };
}

function makeLayer(method, path, handler) {
  const { re, names } = compilePath(path);
  return { method, re, names, handler, isRoute: true };
}

function enhanceRes(res) {
  res.status = function (code) { this.statusCode = code; return this; };
  res.set = function (k, v) {
    if (typeof k === "object") { for (const [a, b] of Object.entries(k)) this.setHeader(a, b); }
    else this.setHeader(k, v);
    return this;
  };
  res.json = function (obj) {
    if (!this.headersSent) this.setHeader("Content-Type", "application/json; charset=utf-8");
    this.end(JSON.stringify(obj));
    return this;
  };
  res.send = function (body) {
    if (typeof body === "object" && body !== null && !Buffer.isBuffer(body)) return this.json(body);
    if (!this.getHeader("Content-Type")) this.setHeader("Content-Type", "text/html; charset=utf-8");
    this.end(body == null ? "" : String(body));
    return this;
  };
  res.redirect = function (code, url) {
    if (typeof code === "string") { url = code; code = 302; }
    this.statusCode = code;
    this.setHeader("Location", url);
    this.end();
    return this;
  };
  return res;
}

function makeRouter() {
  const stack = [];
  function router(req, res, done) { dispatch(stack, req, res, done); }
  router.stack = stack;
  router.get  = (path, ...fns) => { fns.forEach((f) => stack.push(makeLayer("GET", path, f))); return router; };
  router.post = (path, ...fns) => { fns.forEach((f) => stack.push(makeLayer("POST", path, f))); return router; };
  router.use  = (...args) => {
    const path = typeof args[0] === "string" ? args.shift() : null;
    args.forEach((f) => stack.push({ method: null, mountPath: path, handler: f, isRoute: false }));
    return router;
  };
  router.__isRouter = true;
  return router;
}

function dispatch(stack, req, res, done) {
  let idx = 0;
  function next(err) {
    if (res.writableEnded) return;
    const layer = stack[idx++];
    if (!layer) return done ? done(err) : finalHandler(err, req, res);

    // Error mode: only 4-arity handlers run
    if (err) {
      if (!layer.isRoute && layer.handler.length === 4) {
        try { return layer.handler(err, req, res, next); } catch (e) { return next(e); }
      }
      return next(err);
    }
    if (!layer.isRoute) {
      if (layer.handler.length === 4) return next(); // skip error handlers in normal flow
      // Mounted middleware/router, with optional path prefix
      if (layer.mountPath && layer.mountPath !== "/") {
        const p = req.path;
        if (p === layer.mountPath || p.startsWith(layer.mountPath + "/")) {
          if (layer.handler.__isRouter) {
            const saved = req.path;
            req.path = p.slice(layer.mountPath.length) || "/";
            return layer.handler(req, res, (e) => { req.path = saved; next(e); });
          }
          try { return layer.handler(req, res, next); } catch (e) { return next(e); }
        }
        return next();
      }
      if (layer.handler.__isRouter) return layer.handler(req, res, next);
      try { return layer.handler(req, res, next); } catch (e) { return next(e); }
    }
    // Route layer
    if (layer.method && layer.method !== req.method) return next();
    const m = layer.re.exec(req.path);
    if (!m) return next();
    req.params = {};
    layer.names.forEach((n, i) => { req.params[n] = decodeURIComponent(m[i + 1]); });
    try {
      const out = layer.handler(req, res, next);
      if (out && typeof out.catch === "function") out.catch(next);
    } catch (e) { next(e); }
  }
  next();
}

function finalHandler(err, req, res) {
  if (res.writableEnded) return;
  res.statusCode = err ? 500 : 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ message: err ? "Internal Server Error" : "Not Found" }));
}

function express() {
  const stack = [];
  const app = {};
  app.use = (...args) => {
    const path = typeof args[0] === "string" ? args.shift() : null;
    args.forEach((f) => stack.push({ method: null, mountPath: path, handler: f, isRoute: false }));
    return app;
  };
  app.get  = (path, ...fns) => { fns.forEach((f) => stack.push(makeLayer("GET", path, f))); return app; };
  app.post = (path, ...fns) => { fns.forEach((f) => stack.push(makeLayer("POST", path, f))); return app; };
  app.handle = (req, res) => {
    const u = new URL(req.url, "http://localhost");
    req.path = u.pathname;
    req.query = Object.fromEntries(u.searchParams);
    enhanceRes(res);
    dispatch(stack, req, res, null);
  };
  app.listen = (port, cb) => http.createServer(app.handle).listen(port, cb);
  return app;
}

express.json = (opts = {}) => (req, res, next) => {
  const ct = String(req.headers["content-type"] || "");
  if (req.method === "GET" || req.method === "HEAD" || !ct.includes("application/json")) {
    req.body = req.body || {};
    return next();
  }
  let data = "";
  req.on("data", (c) => { data += c; });
  req.on("end", () => {
    if (!data) { req.body = {}; return next(); }
    try { req.body = JSON.parse(data); next(); }
    catch (e) { e.status = 400; e.type = "entity.parse.failed"; next(e); }
  });
  req.on("error", next);
};

express.Router = makeRouter;
module.exports = express;
