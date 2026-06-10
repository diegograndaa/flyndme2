// Minimal express-rate-limit shim (test-only): real fixed-window counting per IP.
module.exports = function rateLimit(opts = {}) {
  const windowMs = opts.windowMs || 60000;
  const max = opts.max || 60;
  const hits = new Map(); // ip → { count, resetAt }
  return (req, res, next) => {
    const ip = (req.socket && req.socket.remoteAddress) || "unknown";
    const now = Date.now();
    let e = hits.get(ip);
    if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; hits.set(ip, e); }
    e.count += 1;
    if (e.count > max) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify(opts.message || { message: "Too many requests" }));
    }
    next();
  };
};
