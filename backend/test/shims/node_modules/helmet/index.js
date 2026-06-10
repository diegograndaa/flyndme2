// Minimal helmet shim (test-only): sets a couple of common security headers.
module.exports = (_opts = {}) => (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
};
