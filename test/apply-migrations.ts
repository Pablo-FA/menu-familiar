import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Aplica las mismas migraciones que producción (carpeta migrations/) a la D1 local de los tests.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
