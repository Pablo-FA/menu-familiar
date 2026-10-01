import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import katsukare from "../docs/ejemplos/katsukare.json";
import type { ApiError, PlanPreviewResponse, PlanRangeResponse, RecipeSummary } from "../src/shared/api";
import type { ClaudeContext } from "../src/shared/claude-context";
import app from "../src/worker/index";

const devEnv = { ...env, DEV_DISABLE_ACCESS: "true" };
const BASE = "http://localhost/api";

function send(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request(`${BASE}${path}`, init, devEnv);
}

const recipe = (id: string, extra: Record<string, unknown> = {}) => ({ ...structuredClone(katsukare), id, title: `Receta ${id}`, ...extra });

async function seed() {
  await send("POST", "/plan/import", {
    format: "menu-familiar/plan@1",
    meals: [
      { date: "2027-03-01", slot: "lunch", recipe_id: "pa" },
      { date: "2027-03-01", slot: "dinner", status: "away", note: "Abuelos" },
      { date: "2027-03-02", slot: "lunch", recipe_id: "pb" },
    ],
    recipes: [recipe("pa"), recipe("pb", { protein: "pescado" }), recipe("pc")],
  });
}

describe("GET /api/plan", () => {
  it("devuelve cada día con sus dos franjas, receta resumida y cook_log", async () => {
    await seed();
    await send("POST", "/cook-logs", { recipe_id: "pa", plan_meal_date: "2027-03-01", plan_meal_slot: "lunch", stars: 4, note: "Bien" });
    const res = await (await send("GET", "/plan?from=2027-03-01&to=2027-03-03")).json<PlanRangeResponse>();
    expect(res.days.map((d) => d.date)).toEqual(["2027-03-01", "2027-03-02", "2027-03-03"]);
    expect(res.days[0]?.lunch).toMatchObject({
      status: "planned",
      recipe: { id: "pa", title: "Receta pa", minutes: 40, protein: "ave", suits: "lunch", photo_url: null },
      cook_log: { stars: 4, note: "Bien" },
    });
    expect(res.days[0]?.dinner).toEqual({ status: "away", note: "Abuelos", recipe: null, cook_log: null });
    expect(res.days[2]?.lunch).toEqual({ status: "empty", note: null, recipe: null, cook_log: null });
  });

  it("valida el rango (máx. 62 días)", async () => {
    expect((await send("GET", "/plan?from=2027-03-01&to=2027-05-02")).status).toBe(400);
    expect((await send("GET", "/plan?from=2027-03-05&to=2027-03-01")).status).toBe(400);
    expect((await send("GET", "/plan?from=x&to=2027-03-01")).status).toBe(400);
  });
});

describe("POST /api/plan/batch", () => {
  it("intercambia dos franjas en una sola operación", async () => {
    const res = await send("POST", "/plan/batch", {
      meals: [
        { date: "2027-03-01", slot: "dinner", status: "planned", recipe_id: "pb" },
        { date: "2027-03-02", slot: "lunch", status: "away", note: "Abuelos" },
      ],
    });
    expect(res.status).toBe(200);
    const plan = await (await send("GET", "/plan?from=2027-03-01&to=2027-03-02")).json<PlanRangeResponse>();
    expect(plan.days[0]?.dinner.recipe?.id).toBe("pb");
    expect(plan.days[1]?.lunch).toMatchObject({ status: "away", note: "Abuelos", recipe: null });
  });

  it("es atómico: si una comida no es válida no se escribe ninguna", async () => {
    await send("POST", "/recipes/import", recipe("pan-x", { course: "side" }));
    const before = await (await send("GET", "/plan?from=2027-03-01&to=2027-03-02")).json<PlanRangeResponse>();
    const res = await send("POST", "/plan/batch", {
      meals: [
        { date: "2027-03-01", slot: "lunch", status: "empty" },
        { date: "2027-03-02", slot: "lunch", status: "planned", recipe_id: "pan-x" },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).errors?.[0]?.field).toBe("meals[1].recipe_id");
    const after = await (await send("GET", "/plan?from=2027-03-01&to=2027-03-02")).json<PlanRangeResponse>();
    expect(after).toEqual(before);
  });

  it("es atómico también si falla la base de datos a mitad", async () => {
    const before = await (await send("GET", "/plan?from=2027-03-01&to=2027-03-02")).json<PlanRangeResponse>();
    // La segunda sentencia viola el CHECK de slot: D1 deshace la primera.
    await expect(
      env.DB.batch([
        env.DB.prepare("UPDATE plan_meals SET status = 'empty', recipe_id = NULL WHERE date = '2027-03-01' AND slot = 'lunch'"),
        env.DB.prepare("INSERT INTO plan_meals (date, slot, status) VALUES ('2027-03-03', 'merienda', 'empty')"),
      ]),
    ).rejects.toThrow();
    const after = await (await send("GET", "/plan?from=2027-03-01&to=2027-03-02")).json<PlanRangeResponse>();
    expect(after).toEqual(before);
  });

  it("valida estados, duplicados y fechas", async () => {
    const bad = await send("POST", "/plan/batch", {
      meals: [
        { date: "2027-02-30", slot: "lunch", status: "empty" },
        { date: "2027-03-04", slot: "lunch", status: "planned" },
        { date: "2027-03-04", slot: "lunch", status: "away", recipe_id: "pa" },
      ],
    });
    expect((await bad.json<ApiError>()).errors?.map((e) => e.field)).toEqual([
      "meals[0].date",
      "meals[1].recipe_id",
      "meals[2].recipe_id",
      "meals[2]",
    ]);
  });
});

describe("POST /api/plan/preview", () => {
  it("clasifica añadidos, sustituciones y sin cambios, y no escribe nada", async () => {
    await send("POST", "/plan/batch", {
      meals: [
        { date: "2027-04-05", slot: "lunch", status: "planned", recipe_id: "pa" },
        { date: "2027-04-05", slot: "dinner", status: "away" },
      ],
    });
    const res = await send("POST", "/plan/preview", {
      format: "menu-familiar/plan@1",
      meals: [
        { date: "2027-04-05", slot: "lunch", recipe_id: "pa" }, // igual
        { date: "2027-04-05", slot: "dinner", recipe_id: "nueva-1" }, // sustituye "fuera de casa"
        { date: "2027-04-06", slot: "lunch", recipe_id: "pb" }, // añade
        { date: "2027-04-06", slot: "dinner", status: "away" }, // añade
      ],
      recipes: [recipe("nueva-1", { title: "Garbanzos con espinacas" }), recipe("pb", { title: "Otro título" })],
    });
    const preview = await res.json<PlanPreviewResponse>();
    expect(preview.errors).toEqual([]);
    expect(preview.meals.map((m) => m.change)).toEqual(["same", "replace", "add", "add"]);
    expect(preview.meals[1]).toMatchObject({
      proposed: { status: "planned", recipe_id: "nueva-1", title: "Garbanzos con espinacas", is_new: true },
      current: { status: "away", recipe_id: null, title: null },
    });
    expect(preview.meals[2]?.proposed).toMatchObject({ recipe_id: "pb", title: "Receta pb", is_new: false });
    expect(preview.new_recipes).toEqual([{ id: "nueva-1", title: "Garbanzos con espinacas" }]);
    expect(preview.ignored_existing_recipes).toEqual([{ id: "pb", title: "Receta pb" }]);

    expect(await env.DB.prepare("SELECT 1 FROM recipes WHERE id = 'nueva-1'").first()).toBeNull();
    const plan = await (await send("GET", "/plan?from=2027-04-06&to=2027-04-06")).json<PlanRangeResponse>();
    expect(plan.days[0]?.lunch.status).toBe("empty");
  });

  it("devuelve errores legibles (formato, recetas que faltan o que no son plato principal)", async () => {
    let preview = await (await send("POST", "/plan/preview", { format: "otra-cosa", meals: [] })).json<PlanPreviewResponse>();
    expect(preview.errors.map((e) => e.field)).toContain("format");

    preview = await (
      await send("POST", "/plan/preview", {
        format: "menu-familiar/plan@1",
        meals: [
          { date: "2027-04-07", slot: "lunch", recipe_id: "no-existe" },
          { date: "2027-04-07", slot: "dinner", recipe_id: "pan-x" },
        ],
      })
    ).json<PlanPreviewResponse>();
    expect(preview.errors.map((e) => e.field)).toEqual(["meals[0].recipe_id", "meals[1].recipe_id"]);
    expect(preview.errors[1]?.message).toContain("no es un plato principal");
  });
});

describe("GET /api/claude-context y GET /api/recipes", () => {
  it("el listado de recetas trae last_cooked y avg_stars", async () => {
    await send("POST", "/cook-logs", { recipe_id: "pb", plan_meal_date: "2027-03-01", plan_meal_slot: "dinner", stars: 5 });
    await send("POST", "/cook-logs", { recipe_id: "pb", stars: 4, cooked_at: "2027-03-10T19:00:00.000Z" });
    const list = await (await send("GET", "/recipes")).json<RecipeSummary[]>();
    expect(list.find((r) => r.id === "pb")).toMatchObject({ times_cooked: 2, last_cooked: "2027-03-10", avg_stars: 4.5 });
  });

  it("exige el lunes de la semana y devuelve contexto@1 con la semana pedida", async () => {
    expect((await send("GET", "/claude-context?week=2027-03-02")).status).toBe(400);
    const ctx = await (await send("GET", "/claude-context?week=2027-03-01")).json<ClaudeContext>();
    expect(ctx.format).toBe("menu-familiar/contexto@1");
    expect(ctx.week).toEqual({ from: "2027-03-01", to: "2027-03-07" });
    expect(ctx.planned).toContainEqual({ date: "2027-03-01", slot: "dinner", recipe_id: "pb" });
    expect(ctx.recipes.some((r) => r.id === "pan-x")).toBe(false);
    expect(ctx.ratings[0]).toMatchObject({ recipe_id: "pb", stars: 4 });
  });
});
