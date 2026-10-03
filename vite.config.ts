import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { serviceWorker } from "./scripts/vite-sw";

export default defineConfig({
  plugins: [react(), cloudflare(), serviceWorker()],
});
