require("dotenv").config();
const express = require("express");
const cors = require("cors");

const flightsRoutes = require("./routes/flights");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("✅ FlyndMe API funcionando correctamente!");
});

app.use("/api/flights", flightsRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Servidor FlyndMe escuchando en http://localhost:${PORT}`);
});
