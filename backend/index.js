// Load .env relative to this file, not process.cwd(), so the server boots
// correctly regardless of where `node index.js` is invoked from.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
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

const USE_MOCK = String(process.env.USE_MOCK || "").toLowerCase() === "true";
// Debe coincidir con la lógica de routes/flights.js (misma derivación de env).
const FLIGHT_PROVIDER = USE_MOCK
  ? "mock"
  : String(process.env.FLIGHT_PROVIDER || "travelpayouts").trim().toLowerCase();
const KNOWN_PROVIDERS = ["travelpayouts", "mock"];

// ─── Version info ──────────────────────────────────────────────────────────
// Detect commit at boot. Render auto-injects RENDER_GIT_COMMIT / RENDER_GIT_BRANCH;
// generic CIs use GIT_COMMIT; in dev we fall back to `git rev-parse` so a local
// boot still reports the working SHA.
function detectCommit() {
  const fromEnv = process.env.RENDER_GIT_COMMIT
    || process.env.GIT_COMMIT
    || process.env.COMMIT_SHA;
  if (fromEnv) return fromEnv.trim();
  try {
    return require("child_process")
      .execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {
    return null;
  }
}

const VERSION = {
  commit:      detectCommit(),
  commitShort: null, // filled below
  branch:      process.env.RENDER_GIT_BRANCH || null,
  node:        process.version,
  startedAt:   new Date(startTime).toISOString(),
};
if (VERSION.commit) VERSION.commitShort = VERSION.commit.slice(0, 7);

// ─── Startup config validation ────────────────────────────────────────────
// In production, missing critical env vars are fatal unless explicitly
// overridden with ALLOW_INSECURE_PROD=true. In dev, only warns.
function validateConfig() {
  const errors = [];
  const warnings = [];

  if (!USE_MOCK) {
    if (!KNOWN_PROVIDERS.includes(FLIGHT_PROVIDER)) {
      errors.push(`FLIGHT_PROVIDER="${FLIGHT_PROVIDER}" no es válido ("travelpayouts").`);
    }
    if (FLIGHT_PROVIDER === "travelpayouts") {
      if (!process.env.TRAVELPAYOUTS_TOKEN) {
        errors.push("TRAVELPAYOUTS_TOKEN no está definida (requerida con FLIGHT_PROVIDER=travelpayouts).");
      }
      if (!process.env.TRAVELPAYOUTS_MARKER) {
        warnings.push("TRAVELPAYOUTS_MARKER no está definida — los deep links de Aviasales no llevarán marker de afiliado y las reservas no generarán comisión.");
      }
    }
  }

  if (!isDev) {
    if (USE_MOCK) {
      warnings.push("USE_MOCK=true en producción: el backend NO llamará al proveedor real de vuelos.");
    }
    if (!process.env.ALLOWED_ORIGINS) {
      warnings.push("ALLOWED_ORIGINS no está definida — usando fallback hardcoded (flyndme.vercel.app + flyndme2.vercel.app). Define la variable para tu dominio real.");
    }
    if (!process.env.FRONTEND_URL) {
      warnings.push("FRONTEND_URL no está definida — los meta tags OG de /api/share/:id/og usarán el default https://flyndme.vercel.app.");
    }
  }

  for (const w of warnings) console.warn(`⚠  CONFIG: ${w}`);
  for (const e of errors)   console.error(`✗  CONFIG: ${e}`);

  if (errors.length > 0 && !isDev) {
    const allowOverride = String(process.env.ALLOW_INSECURE_PROD || "").toLowerCase() === "true";
    if (!allowOverride) {
      console.error("\nArranque abortado. Corrige las variables o usa ALLOW_INSECURE_PROD=true para forzar (no recomendado).");
      process.exit(1);
    }
    console.warn("⚠  ALLOW_INSECURE_PROD=true: arrancando con configuración insegura.");
  }
}

validateConfig();

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
    provider: FLIGHT_PROVIDER,
    mock: USE_MOCK,
    features: ["flexDates", "shareLinks", "affiliateReady"],
  });
});

app.get("/api/ping", (_req, res) => {
  res.json({ message: "pong", timestamp: Date.now() });
});

// Lightweight version + env fingerprint. Use to confirm a deploy reflects the
// expected commit and runtime config; never exposes secrets.
app.get("/api/version", (_req, res) => {
  res.json({
    commit:      VERSION.commit,
    commitShort: VERSION.commitShort,
    branch:      VERSION.branch,
    node:        VERSION.node,
    node_env:    process.env.NODE_ENV || "development",
    provider:    FLIGHT_PROVIDER,
    mock:        USE_MOCK,
    startedAt:   VERSION.startedAt,
    uptime_s:    Math.floor((Date.now() - startTime) / 1000),
  });
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
    provider: FLIGHT_PROVIDER,
    mock: USE_MOCK,
    commit: VERSION.commitShort,
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
  // Body JSON malformado (error de body-parser): es un error del cliente,
  // no del servidor → 400 con código claro en lugar de un 500 genérico.
  if (err.type === "entity.parse.failed" || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({
      code: "INVALID_JSON",
      message: "El cuerpo de la petición no es JSON válido.",
    });
  }
  // Payload por encima del límite de express.json (128kb)
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({
      code: "PAYLOAD_TOO_LARGE",
      message: "El cuerpo de la petición es demasiado grande.",
    });
  }
  console.error("[Error]", err.message || err);
  res.status(500).json({ message: "Error interno del servidor." });
});

process.on("unhandledRejection", (reason) => {
  console.error("[UnhandledRejection]", reason);
});

// Una excepción síncrona no capturada deja el proceso en estado indefinido:
// registrar y salir (Render reinicia el servicio automáticamente).
process.on("uncaughtException", (err) => {
  console.error("[UncaughtException]", err);
  process.exit(1);
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
    `✈  FlyndMe API → http://localhost:${PORT}  [${isDev ? "dev" : "prod"} · provider:${FLIGHT_PROVIDER}]`
  );
  if (USE_MOCK) {
    console.log("⚠  USE_MOCK=true — serving deterministic fixtures, NOT calling any provider.");
  }
});

// Detrás del proxy de Render, el keepAliveTimeout por defecto de Node (5s)
// provoca 502 intermitentes cuando el proxy reutiliza una conexión que el
// backend acaba de cerrar. Debe ser mayor que el idle timeout del proxy.
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 66_000; // siempre > keepAliveTimeout
