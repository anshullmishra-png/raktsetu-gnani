import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend needs no env vars: it only talks to same-origin /api/*.
// In local dev, /api is proxied to a serverless dev server on port 3000 (harmless if unused).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
