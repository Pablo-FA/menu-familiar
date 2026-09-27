/** Forma de la respuesta de GET /api/health (compartida entre Worker y cliente). */
export interface HealthResponse {
  ok: boolean;
  d1: { ok: boolean; detail: string; schemaVersion: string | null; recipeCount: number | null };
  r2: { ok: boolean; detail: string };
  access: { mode: "enforced" | "disabled-local"; email: string | null };
}
