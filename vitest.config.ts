import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Los tests se ejecutan dentro del runtime de Workers (workerd) con una D1 y un R2
// locales en memoria. Cada archivo de test tiene su propio almacenamiento aislado.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: "2026-09-20",
        d1Databases: ["DB"],
        r2Buckets: ["PHOTOS"],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
