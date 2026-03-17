require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");

const flightsRoutes = require("./routes/flights");
const shareRoutes   = require("./routes/share");

const app = express();
const PORT = process.env.PORT || 5000;
const isDev = process.env.NODE_ENV !== "production";
const startTime = Date.now();

const AMADEUS_ENV = process.env.AMADEUS_ENV || "test";

// ─── Middleware: Gzip compression ─────────────────────────────────────────
app.use(compression());

// ─── Middleware: Request logging ──────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? "warn" : "info";
    console[logLevel](
      `[${req.method}] ${req.path} → ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// Security headers (relax CSP in dev so the API is callable from Vite)
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────
// Accept: strict allowlist in prod, Vercel preview URLs (*.vercel.app), + localhost in dev

function isVercelPreviewUrl(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [
      "http://localhost:5173",
      "http://localhost:4173",
      "https://flyndme.vercel.app",
      "https://flyndme2.vercel.app",
    ];

app.use(
  cors({
    origin: isDev
      ? true // allow all origins in development
      : (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin) || isVercelPreviewUrl(origin)) {
            return cb(null, true);
          }
          cb(new Error(`CORS: origin '${origin}' not allowed`));
        },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "128kb" }));

// Rate limiter: 60 search requests per 10 min per IP
const searchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiadas peticiones. Por favor espera unos minutos." },
});

// ─── Routes ──────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "FlyndMe API",
    env: AMADEUS_ENV,
    features: ["flexDates", "shareLinks", "affiliateReady"],
  });
});

app.get("/api/ping", (_req, res) => {
  res.json({ message: "pong", timestamp: Date.now() });
});

// Health endpoint with more detailed info
app.get("/api/health", (_req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const memUsage = process.memoryUsage();

  res.json({
    status: "healthy",
    uptime,
    uptime_s: `${uptime}s`,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    amadeus_env: AMADEUS_ENV,
    timestamp: Date.now(),
  });
});

app.use("/api/flights", searchLimiter, flightsRoutes);
app.use("/api/share", shareRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ message: "Ruta no encontrada." });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("[Error]", err.message || err);
  res.status(500).json({ message: "Error interno del servidor." });
});

process.on("unhandledRejection", (reason) => {
  console.error("[UnhandledRejection]", reason);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────

let server;

function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Iniciando cierre elegante...`);

  if (server) {
    server.close(() => {
      console.log("✈  Servidor cerrado limpiamente.");
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error("Forzando cierre después de 10s.");
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

server = app.listen(PORT, () => {
  console.log(
    `✈  FlyndMe API → http://localhost:${PORT}  [${isDev ? "dev" : "prod"} · amadeus:${AMADEUS_ENV}]`
  );
});
