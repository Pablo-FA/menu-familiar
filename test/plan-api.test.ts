import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import katsukare from "../docs/ejemplos/katsukare.json";
import type { ApiError, DayResponse, PlanImportResponse, RatingPrompt } from "../src/shared/api";
import { addDays, madridNow } from "../src/shared/dates";
import app from "../src/worker/index";

const devEnv = { ...env, DEV_DISABLE_ACCESS: "true" };
const BASE = "http://localhost/api";

function send(method: string, path: string, body?: unknown) {
  return app.request(
    `${BASE}${path}`,
    { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    devEnv,
  );
}

const recipe = (id: string, title = `Receta ${id}`) => ({ ...structuredClone(katsukare), id, title });

describe("POST /api/plan/import", () => {
  it("importa recetas nuevas y comidas en un paso, y GET /api/day las devuelve completas", async () => {
    const res = await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: "2026-10-05", slot: "lunch", recipe_id: "plan-a" },
        { date: "2026-10-05", slot: "dinner", status: "away", note: "Cena en casa de los abuelos" },
      ],
      recipes: [recipe("plan-a")],
    });
    expect(res.status).toBe(200);
    const body = await res.json<PlanImportResponse>();
    expect(body).toMatchObject({ meals: 2, created_recipes: ["plan-a"], existing_recipes: [] });

    const day = await (await send("GET", "/day/2026-10-05")).json<DayResponse>();
    expect(day.lunch.status).toBe("planned");
    expect(day.lunch.recipe?.id).toBe("plan-a");
    expect(day.lunch.recipe?.ingredients).toHaveLength(12);
    expect(day.lunch.recipe?.steps).toHaveLength(8);
    expect(day.lunch.recipe?.photo_url).toBeNull();
    expect(day.dinner).toEqual({ status: "away", note: "Cena en casa de los abuelos", recipe: null });
  });

  it("no modifica recetas que ya existen y permite planificar recetas ya guardadas", async () => {
    await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [{ date: "2026-10-06", slot: "lunch", recipe_id: "plan-b" }],
      recipes: [recipe("plan-b", "Título original")],
    });
    const res = await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: "2026-10-06", slot: "lunch", recipe_id: "plan-b" },
        { date: "2026-10-06", slot: "dinner", recipe_id: "plan-b" },
      ],
      recipes: [recipe("plan-b", "Título cambiado")],
    });
    expect((await res.json<PlanImportResponse>()).existing_recipes).toEqual(["plan-b"]);
    const day = await (await send("GET", "/day/2026-10-06")).json<DayResponse>();
    expect(day.dinner.recipe?.title).toBe("Título original");
  });

  it("sustituye lo planificado para un día y franja ya existentes", async () => {
    const plan = (recipeId: string) => ({
      format: "menu-familiar/plan@1",
      meals: [{ date: "2026-10-07", slot: "dinner", recipe_id: recipeId }],
      recipes: [recipe(recipeId)],
    });
    await send("POST", "/plan/import", plan("plan-c1"));
    await send("POST", "/plan/import", plan("plan-c2"));
    const day = await (await send("GET", "/day/2026-10-07")).json<DayResponse>();
    expect(day.dinner.recipe?.id).toBe("plan-c2");
  });

  it("rechaza con errores legibles y no escribe nada", async () => {
    const res = await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: "2026-02-30", slot: "lunch", recipe_id: "plan-d" },
        { date: "2026-10-08", slot: "merienda" },
        { date: "2026-10-08", slot: "dinner", status: "planned" },
        { date: "2026-10-08", slot: "lunch", status: "away", recipe_id: "plan-d" },
      ],
      recipes: [recipe("plan-d")],
    });
    expect(res.status).toBe(400);
    const body = await res.json<ApiError>();
    expect(body.error).toBe("El menú no es válido");
    expect(body.errors?.map((e) => e.field)).toEqual([
      "meals[0].date",
      "meals[1].slot",
      "meals[2].recipe_id",
      "meals[3].recipe_id",
    ]);
    expect(await env.DB.prepare("SELECT 1 FROM recipes WHERE id = 'plan-d'").first()).toBeNull();
  });

  it("rechaza comidas con recetas que no existen ni vienen en el plan", async () => {
    const res = await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: "2026-10-09", slot: "lunch", recipe_id: "plan-e" },
        { date: "2026-10-09", slot: "dinner", recipe_id: "no-existe" },
      ],
      recipes: [recipe("plan-e")],
    });
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).errors).toEqual([
      { field: "meals[1].recipe_id", message: 'No existe la receta "no-existe" ni viene en "recipes"' },
    ]);
    expect(await env.DB.prepare("SELECT 1 FROM recipes WHERE id = 'plan-e'").first()).toBeNull();
  });

  it("rechaza franjas repetidas en el mismo plan", async () => {
    const res = await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: "2026-10-10", slot: "lunch", status: "away" },
        { date: "2026-10-10", slot: "lunch", status: "empty" },
      ],
    });
    expect((await res.json<ApiError>()).errors?.[0]).toEqual({
      field: "meals[1]",
      message: "Repite 2026-10-10 lunch (ya está en meals[0])",
    });
  });
});

describe("GET /api/day y PUT /api/plan", () => {
  it("un día sin nada planificado devuelve dos franjas vacías", async () => {
    const day = await (await send("GET", "/day/2030-01-01")).json<DayResponse>();
    expect(day).toEqual({
      date: "2030-01-01",
      lunch: { status: "empty", note: null, recipe: null },
      dinner: { status: "empty", note: null, recipe: null },
    });
  });

  it("valida fecha y franja", async () => {
    expect((await send("GET", "/day/2026-13-01")).status).toBe(400);
    expect((await send("PUT", "/plan/2026-10-11/merienda", { status: "away" })).status).toBe(400);
  });

  it("PUT planifica, cambia y vacía una franja", async () => {
    await send("POST", "/recipes/import", recipe("put-a"));
    expect((await send("PUT", "/plan/2026-10-11/lunch", { recipe_id: "put-a" })).status).toBe(200);
    let day = await (await send("GET", "/day/2026-10-11")).json<DayResponse>();
    expect(day.lunch.recipe?.id).toBe("put-a");

    expect((await send("PUT", "/plan/2026-10-11/lunch", { status: "away", note: "Cumple" })).status).toBe(200);
    day = await (await send("GET", "/day/2026-10-11")).json<DayResponse>();
    expect(day.lunch).toEqual({ status: "away", note: "Cumple", recipe: null });
  });

  it("PUT rechaza recetas inexistentes y combinaciones sin sentido", async () => {
    expect((await send("PUT", "/plan/2026-10-12/lunch", { recipe_id: "fantasma" })).status).toBe(400);
    const res = await send("PUT", "/plan/2026-10-12/lunch", { status: "planned" });
    expect((await res.json<ApiError>()).errors?.[0]?.field).toBe("recipe_id");
  });
});

describe("aviso de valoración y cook-logs (con la fecha real de hoy)", () => {
  it("pregunta por la comida pasada más reciente, guarda la valoración y no vuelve a preguntar", async () => {
    const { date: today } = madridNow();
    const yesterday = addDays(today, -1);
    await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [{ date: yesterday, slot: "dinner", recipe_id: "aviso-a" }],
      recipes: [recipe("aviso-a", "Cena de ayer")],
    });

    const prompt = await (await send("GET", "/rating-prompt")).json<RatingPrompt | null>();
    expect(prompt).toEqual({
      date: yesterday,
      slot: "dinner",
      recipe: { id: "aviso-a", title: "Cena de ayer", photo_url: null },
    });

    const saved = await send("POST", "/cook-logs", {
      recipe_id: "aviso-a",
      plan_meal_date: yesterday,
      plan_meal_slot: "dinner",
      stars: 4,
      note: "A las niñas les encantó",
    });
    expect(saved.status).toBe(201);
    expect((await saved.json<{ cooked_at: string }>()).cooked_at).toBe(`${yesterday}T19:00:00.000Z`);

    expect(await (await send("GET", "/rating-prompt")).json()).toBeNull();

    const log = await env.DB.prepare("SELECT stars, note, created_at FROM cook_logs WHERE recipe_id = 'aviso-a'").first<{
      stars: number;
      note: string;
      created_at: string;
    }>();
    expect(log).toMatchObject({ stars: 4, note: "A las niñas les encantó" });
    expect(log?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const detail = await (await send("GET", `/day/${yesterday}`)).json<DayResponse>();
    expect(detail.dinner.recipe).toMatchObject({ times_cooked: 1, last_stars: 4 });
  });

  it("posponer lo aplaza: hoy ya no vuelve a preguntar", async () => {
    await env.DB.exec("DELETE FROM cook_logs; UPDATE plan_meals SET rating_skipped_at = NULL;");
    const { date: today } = madridNow();
    const twoDaysAgo = addDays(today, -2);
    // La más reciente pasada será esta (el resto de comidas de los tests son de 2026 o futuras).
    await send("POST", "/plan/import", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: addDays(today, -1), slot: "lunch", status: "away" },
        { date: addDays(today, -1), slot: "dinner", recipe_id: "aviso-b" },
        { date: twoDaysAgo, slot: "dinner", recipe_id: "aviso-b" },
      ],
      recipes: [recipe("aviso-b")],
    });
    const prompt = await (await send("GET", "/rating-prompt")).json<RatingPrompt>();
    expect(prompt.date).toBe(addDays(today, -1));

    expect((await send("POST", "/rating-prompt/skip", { date: prompt.date, slot: prompt.slot })).status).toBe(204);
    expect(await (await send("GET", "/rating-prompt")).json()).toBeNull();
  });

  it("valida las valoraciones", async () => {
    let res = await send("POST", "/cook-logs", { recipe_id: "aviso-a", stars: 6 });
    expect((await res.json<ApiError>()).errors?.[0]?.field).toBe("stars");
    res = await send("POST", "/cook-logs", { recipe_id: "aviso-a", plan_meal_date: "2026-10-01" });
    expect((await res.json<ApiError>()).errors?.[0]?.field).toBe("plan_meal_slot");
    res = await send("POST", "/cook-logs", { recipe_id: "no-existe", stars: 3 });
    expect(res.status).toBe(404);
    res = await send("POST", "/cook-logs", { recipe_id: "aviso-a" });
    expect(res.status).toBe(201); // sin estrellas ni nota también vale (se cocinó)
  });

  it("skip de una comida no planificada da 404", async () => {
    expect((await send("POST", "/rating-prompt/skip", { date: "2031-01-01", slot: "lunch" })).status).toBe(404);
  });
});

describe("GET /api/photos/*", () => {
  it("sirve el objeto de R2 con caché inmutable y 404 si no existe", async () => {
    await env.PHOTOS.put("recipes/katsu/portada 1.jpg", new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const res = await send("GET", "/photos/recipes/katsu/portada%201.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    expect((await send("GET", "/photos/recipes/no-existe.jpg")).status).toBe(404);
    expect((await send("GET", "/photos/_health/check.txt")).status).toBe(404);
  });
});
