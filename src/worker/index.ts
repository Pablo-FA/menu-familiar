import { Hono } from "hono";
import type { HealthResponse } from "../shared/health";
import { isLocalBypass, verifyAccess } from "./access";

export interface Bindings {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Solo para desarrollo local (.dev.vars). Ver isLocalBypass. */
  DEV_DISABLE_ACCESS?: string;
}

interface Variables {
  userEmail: string | null;
  accessMode: "enforced" | "disabled-local";
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().basePath("/api");

// Toda la API exige un JWT de Access válido.
app.use("*", async (c, next) => {
  if (isLocalBypass(c.req.raw, c.env.DEV_DISABLE_ACCESS)) {
    c.set("userEmail", null);
    c.set("accessMode", "disabled-local");
    return next();
  }

  const result = await verifyAccess(c.req.raw, {
    teamDomain: c.env.ACCESS_TEAM_DOMAIN,
    aud: c.env.ACCESS_AUD,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }
  c.set("userEmail", result.email);
  c.set("accessMode", "enforced");
  return next();
});

interface CheckResult {
  ok: boolean;
  detail: string;
}

async function checkD1(db: D1Database): Promise<CheckResult & { schemaVersion: string | null }> {
  try {
    const row = await db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .bind("schema_version")
      .first<{ value: string }>();
    if (!row) {
      return { ok: false, detail: "No existe la fila schema_version en app_meta", schemaVersion: null };
    }
    return { ok: true, detail: `Esquema versión ${row.value}`, schemaVersion: row.value };
  } catch (err) {
    return { ok: false, detail: errorMessage(err), schemaVersion: null };
  }
}

const R2_HEALTH_KEY = "_health/check.txt";

async function checkR2(bucket: R2Bucket): Promise<CheckResult> {
  try {
    const written = new Date().toISOString();
    await bucket.put(R2_HEALTH_KEY, written);
    const obj = await bucket.get(R2_HEALTH_KEY);
    if (!obj) return { ok: false, detail: "El objeto de prueba no se pudo leer" };
    const read = await obj.text();
    if (read !== written) return { ok: false, detail: "El objeto leído no coincide con el escrito" };
    return { ok: true, detail: "Escritura y lectura correctas" };
  } catch (err) {
    return { ok: false, detail: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

app.get("/health", async (c) => {
  const [d1, r2] = await Promise.all([checkD1(c.env.DB), checkR2(c.env.PHOTOS)]);
  const ok = d1.ok && r2.ok;
  const body: HealthResponse = {
    ok,
    d1,
    r2,
    access: { mode: c.get("accessMode"), email: c.get("userEmail") },
  };
  return c.json(body, ok ? 200 : 503);
});

app.notFound((c) => c.json({ error: "No encontrado" }, 404));

export default app;
