import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initDb } from "./db.js";
import { settingsRouter } from "./routes/settings.js";
import { ingestRouter } from "./routes/ingest.js";
import { sessionRouter } from "./routes/session.js";
import { homeRouter } from "./routes/home.js";
import { itemsRouter } from "./routes/items.js";
import { transferRouter } from "./routes/transfer.js";
import { hasKey } from "./ai/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.TRACT_DB ?? path.resolve(__dirname, "../../data/tract.db");
initDb(dbPath);

const app = express();
app.use(express.json({ limit: "25mb" })); // image uploads arrive base64-encoded

// First-run gate: everything except settings requires a configured key.
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/settings") || hasKey()) return next();
  res.status(409).json({ error: "no_key" });
});

app.use("/api/settings", settingsRouter);
app.use("/api/ingest", ingestRouter);
app.use("/api/session", sessionRouter);
app.use("/api/home", homeRouter);
app.use("/api/items", itemsRouter);
app.use("/api", transferRouter);

// Serve the built client when present (production); dev uses Vite's proxy.
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

const PORT = 5174;
app.listen(PORT, () => {
  console.log(`Tract server listening on http://localhost:${PORT}`);
});
