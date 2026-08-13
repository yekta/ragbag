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
});
