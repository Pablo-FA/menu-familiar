import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import katsukare from "../docs/ejemplos/katsukare.json";
import type { ApiError, CookLog, DayResponse, PhotoResponse, RatingPrompt, RecipeDetail } from "../src/shared/api";
import { addDays, madridNow } from "../src/shared/dates";
import { parseRecipeImport } from "../src/shared/recipe-format";
import app from "../src/worker/index";

const devEnv = { ...env, DEV_DISABLE_ACCESS: "true" };
const BASE = "http://localhost/api";

function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body !== undefined) init.body = body instanceof Uint8Array ? body : JSON.stringify(body);
  return app.request(`${BASE}${path}`, init, devEnv);
}

const recipe = (id: string, changes: Record<string, unknown> = {}) => ({ ...structuredClone(katsukare), id, ...changes });

describe("recipe@1: course, uses y timer_label", () => {
  it("course es opcional (main por defecto) y solo admite valores conocidos", () => {
    const ok = parseRecipeImport(recipe("x"));
    expect(ok.ok && ok.recipe.course).toBe("main");
    const side = parseRecipeImport(recipe("x", { course: "side" }));
    expect(side.ok && side.recipe.course).toBe("side");
    const bad = parseRecipeImport(recipe("x", { course: "postre" }));
    expect(!bad.ok && bad.errors[0]?.field).toBe("course");
  });

  it("uses debe referirse a ingredientes de la receta (sin importar tildes ni mayúsculas)", () => {
    const steps = [
      { text: "Pica la cebolla.", uses: ["Cebolla", "zanahoria"] },
      { text: "Cuece.", uses: ["arroz", "quinoa"] },
    ];
    const result = parseRecipeImport(recipe("x", { steps }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { field: "steps[1].uses[1]", message: '"quinoa" no está entre los ingredientes de la receta' },
    ]);
  });

  it("guarda uses como slugs del catálogo y timer_label, y los devuelve", async () => {
    const steps = [
      { text: "Prepara el curry japonés.", uses: ["Preparado de curry japonés suave", "agua", "agua"], timer_seconds: 600, timer_label: "Curry" },
      { text: "Sirve." },
    ];
    expect((await send("POST", "/recipes/import", recipe("con-uses", { steps, course: "main" }))).status).toBe(201);
    const detail = await (await send("GET", "/recipes/con-uses")).json<RecipeDetail>();
    expect(detail.course).toBe("main");
    expect(detail.steps[0]).toMatchObject({
      uses: ["preparado-de-curry-japones-suave", "agua"],
      timer_label: "Curry",
      timer_seconds: 600,
    });
    expect(detail.steps[1]).toMatchObject({ uses: null, timer_label: null });
  });
});

describe("course al planificar", () => {
  it("plan@1 rechaza recetas que no son plato principal, nuevas o ya existentes", async () => {
    await send("POST", "/recipes/import", recipe("pan-harcha", { title: "Pan harcha", course: "side" }));
    const res = await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: "2026-11-02", slot: "lunch", recipe_id: "pan-harcha" },
        { date: "2026-11-02", slot: "dinner", recipe_id: "english-muffins" },
      ],
      recipes: [recipe("english-muffins", { title: "English muffins", course: "side" })],
    });
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).errors).toEqual([
      {
        field: "meals[0].recipe_id",
        message: '"pan-harcha" no es un plato principal (course "side"): no se puede planificar como comida o cena',
      },
      {
        field: "meals[1].recipe_id",
        message: '"english-muffins" no es un plato principal (course "side"): no se puede planificar como comida o cena',
      },
    ]);
    expect(await env.DB.prepare("SELECT 1 FROM recipes WHERE id = 'english-muffins'").first()).toBeNull();
  });

  it("PUT /api/plan también lo rechaza", async () => {
    const res = await send("PUT", "/plan/2026-11-03/lunch", { recipe_id: "pan-harcha" });
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).errors?.[0]?.field).toBe("recipe_id");
  });

  it("la migración marca los dos panes como side", async () => {
    await env.DB.prepare("UPDATE recipes SET course = 'main' WHERE id = 'pan-harcha'").run();
    // Misma sentencia que migrations/0004_modo_cocina.sql.
    await env.DB.prepare("UPDATE recipes SET course = 'side' WHERE id IN ('pan-harcha', 'english-muffins')").run();
    const row = await env.DB.prepare("SELECT course FROM recipes WHERE id = 'pan-harcha'").first<{ course: string }>();
    expect(row?.course).toBe("side");
  });
});

describe("cocinar, valorar después y aviso", () => {
  it("un cook_log sin estrellas deja el aviso pendiente; al valorarlo con PATCH deja de salir", async () => {
    const yesterday = addDays(madridNow().date, -1);
    await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [{ date: yesterday, slot: "dinner", recipe_id: "cocinada" }],
      recipes: [recipe("cocinada")],
    });

    // "Valorar después" al terminar de cocinar: cook_log sin estrellas, cooked_at = ahora.
    const now = new Date().toISOString();
    const created = await send("POST", "/cook-logs", {
      recipe_id: "cocinada",
      plan_meal_date: yesterday,
      plan_meal_slot: "dinner",
      cooked_at: now,
    });
    expect(created.status).toBe(201);
    const { id, cooked_at } = await created.json<{ id: number; cooked_at: string }>();
    expect(cooked_at).toBe(now);

    const day = await (await send("GET", `/day/${yesterday}`)).json<DayResponse>();
    expect(day.dinner.cook_log).toEqual({ id, cooked_at: now, stars: null, note: null });

    // Mañana (o tras otra apertura) el aviso pregunta por ella y trae el id para actualizarla.
    await env.DB.prepare("UPDATE cook_logs SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(id).run();
    const prompt = await (await send("GET", "/rating-prompt")).json<RatingPrompt>();
    expect(prompt).toMatchObject({ date: yesterday, slot: "dinner", cook_log_id: id });

    const patched = await send("PATCH", `/cook-logs/${id}`, { stars: 5, note: "  Repetir  " });
    expect(await patched.json<CookLog>()).toEqual({ id, cooked_at: now, stars: 5, note: "Repetir" });
    expect(await (await send("GET", "/rating-prompt")).json()).toBeNull();
  });

  it("PATCH valida y responde 404 si el registro no existe", async () => {
    expect((await send("PATCH", "/cook-logs/999999", { stars: 3 })).status).toBe(404);
    expect((await send("PATCH", "/cook-logs/1", { stars: 0 })).status).toBe(400);
    expect((await send("PATCH", "/cook-logs/1", {})).status).toBe(400);
    expect((await send("PATCH", "/cook-logs/abc", { stars: 3 })).status).toBe(400);
  });
});

describe("POST /api/recipes/:id/photo", () => {
  const jpeg = (byte: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, byte, byte, 0xff, 0xd9]);

  it("guarda la foto, actualiza la portada y borra la anterior", async () => {
    await send("POST", "/recipes/import", recipe("con-foto"));
    const first = await send("POST", "/recipes/con-foto/photo", jpeg(1), { "Content-Type": "image/jpeg" });
    expect(first.status).toBe(201);
    const a = await first.json<PhotoResponse>();
    expect(a.cover_photo_key).toMatch(/^recipes\/con-foto\/\d+\.jpg$/);
    expect(a.photo_url).toBe(`/api/photos/${a.cover_photo_key}`);

    const served = await send("GET", a.photo_url.replace("/api", ""));
    expect(served.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(jpeg(1));

    await new Promise((r) => setTimeout(r, 5)); // otra marca de tiempo
    const b = await (await send("POST", "/recipes/con-foto/photo", jpeg(2), { "Content-Type": "image/jpeg" })).json<PhotoResponse>();
    expect(b.cover_photo_key).not.toBe(a.cover_photo_key);
    expect(await env.PHOTOS.get(a.cover_photo_key)).toBeNull();

    const detail = await (await send("GET", "/recipes/con-foto")).json<RecipeDetail>();
    expect(detail.photo_url).toBe(b.photo_url);
  });

  it("valida tipo, contenido y receta", async () => {
    expect((await send("POST", "/recipes/con-foto/photo", jpeg(1), { "Content-Type": "image/png" })).status).toBe(415);
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect((await send("POST", "/recipes/con-foto/photo", notJpeg, { "Content-Type": "image/jpeg" })).status).toBe(415);
    expect((await send("POST", "/recipes/no-existe/photo", jpeg(1), { "Content-Type": "image/jpeg" })).status).toBe(404);
    expect((await send("POST", "/recipes/con-foto/photo", new Uint8Array(), { "Content-Type": "image/jpeg" })).status).toBe(400);
  });
});
