import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app lives in web/; during dev it proxies the terminal WebSocket and
// API to the Fastify server on :4321.
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:4321", ws: true },
      "/api": { target: "http://localhost:4321" },
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
