import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Mirrors the `@/*` paths mapping in tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Read VITE_* vars from the repo-root .env shared with server/compose.
  envDir: "../..",
  server: {
    port: 5173,
    // The API is fronted by the dev server so auth cookies stay first-party.
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  // `server.proxy` doesn't apply to preview, so repeat it; otherwise the
  // production bundle can't reach auth and the preview is unusable for the
  // performance checks it exists for.
  preview: {
    port: 4173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
