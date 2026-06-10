// Minimal compression shim (test-only): pass-through middleware, no gzip.
module.exports = () => (req, res, next) => next();
