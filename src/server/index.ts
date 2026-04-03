import "dotenv/config";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { handleApiRequest } from "./routes.js";
import { loadLevels } from "./services/level-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

async function start() {
  // Load level definitions
  const levelsDir = path.resolve(__dirname, "../../levels");
  loadLevels(levelsDir);

  // Vite dev server for frontend
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "";

    // API routes
    if (url.startsWith("/api/")) {
      try {
        const handled = await handleApiRequest(req, res);
        if (!handled) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        }
      } catch (err) {
        console.error("Unhandled API error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // Everything else → Vite (frontend, HMR, static assets)
    vite.middlewares(req, res);
  });

  server.timeout = 120000;
  server.keepAliveTimeout = 120000;

  server.listen(PORT, () => {
    console.log(`DUX running on http://localhost:${PORT}`);
  });
}

start();
