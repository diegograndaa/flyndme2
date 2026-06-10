// Minimal CORS shim (test-only). Supports origin: true | array-checking fn.
module.exports = (opts = {}) => (req, res, next) => {
  const origin = req.headers.origin;
  const finish = (allowed) => {
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      if (opts.methods) res.setHeader("Access-Control-Allow-Methods", String(opts.methods));
      if (opts.allowedHeaders) res.setHeader("Access-Control-Allow-Headers", String(opts.allowedHeaders));
    }
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    next();
  };
  if (typeof opts.origin === "function") {
    opts.origin(origin, (err, ok) => (err ? next(err) : finish(ok)));
  } else {
    finish(true);
  }
};
