// Bindings disponibles en los tests (ver vitest.config.ts).
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    PHOTOS: R2Bucket;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
