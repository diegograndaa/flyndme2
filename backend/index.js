require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const flightsRoutes = require("./routes/flights");

const app = express();
const PORT = process.env.PORT || 5000;
const isDev = process.env.NODE_ENV !== "production";

// Security headers (relax CSP in dev so the API is callable from Vite)
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
  })
);

// CORS — open in dev, strict allow-list in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [
      "http://localhost:5173",
      "http://localhost:4173",
      "https://flyndme.vercel.app",
    ];

app.use(
  cors({
    origin: isDev
      ? true // allow all origins in development
      : (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin))
            return cb(null, true);
          cb(new Error(`CORS: origin '${origin}' not allowed`));
        },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "16kb" }));

// Rate limiter: 60 search requests per 10 min per IP
const searchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiadas peticiones. Por favor espera unos minutos." },
});

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "FlyndMe API", env: AMADEUS_ENV });
});

app.get("/api/ping", (_req, res) => {
  res.json({ message: "pong", timestamp: Date.now() });
});

app.use("/api/flights", searchLimiter, flightsRoutes);

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

const AMADEUS_ENV = process.env.AMADEUS_ENV || "test";

app.listen(PORT, () => {
  console.log(
    `✈  FlyndMe API → http://localhost:${PORT}  [${isDev ? "dev" : "prod"} · amadeus:${AMADEUS_ENV}]`
  );
});
