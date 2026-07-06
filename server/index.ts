import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./app.ts";

// CLI entry (npm run dev:server / start). The desktop app calls startServer()
// directly from the Electron main process instead.
const PORT = Number(process.env.PORT ?? 4321);
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = process.env.DEN_WEB_DIR ?? join(__dirname, "..", "dist", "web");

startServer({ port: PORT, webDir })
  .then(({ url }) => console.log(`🦊 den server on ${url}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
