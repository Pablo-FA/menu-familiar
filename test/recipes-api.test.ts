import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import katsukare from "../docs/ejemplos/katsukare.json";
import type { ApiError, ImportResponse, RecipeDetail, RecipeSummary } from "../src/shared/api";
import app from "../src/worker/index";

// Access desactivado para las pruebas de la API (solo funciona contra localhost).
const devEnv = { ...env, DEV_DISABLE_ACCESS: "true" };
const BASE = "http://localhost/api";

function importRecipe(body: unknown, query = "") {
  return app.request(
    `${BASE}/recipes/import${query}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    devEnv,
  );
}

function get(path: string) {
  return app.request(`${BASE}${path}`, {}, devEnv);
}

/** Copia de katsukare con otro id, para que cada test sea independiente. */
function recipeWithId(id: string, changes: Record<string, unknown> = {}) {
  return { ...structuredClone(katsukare), id, ...changes };
}

describe("POST /api/recipes/import", () => {
  it("importa katsukare y GET devuelve 12 ingredientes y 8 pasos en orden", async () => {
    const res = await importRecipe(katsukare);
    expect(res.status).toBe(201);
    const body = await res.json<ImportResponse>();
    expect(body.id).toBe("katsukare");
    expect(body.replaced).toBe(false);
    expect(body.created_ingredients).toHaveLength(12);

    const detail = await (await get("/recipes/katsukare")).json<RecipeDetail>();
    expect(detail.title).toBe("Katsukarē (curry japonés con pollo empanado)");
    expect(detail.tags).toEqual(["japonesa", "curry", "empanado"]);
    expect(detail.kcal_estimated).toBe(true);
    expect(detail.ingredients.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(detail.ingredients.map((i) => i.display_text)).toEqual(katsukare.ingredients.map((i) => i.text));
    expect(detail.steps.map((s) => s.text)).toEqual(katsukare.steps.map((s) => s.text));
    expect(detail.steps[4]?.timer_seconds).toBe(600);
    expect(detail.steps[0]?.timer_seconds).toBeNull();

    const agua = detail.ingredients[6];
    expect(agua).toMatchObject({ quantity: 600, unit: "ml", estimated: false });
    expect(agua?.ingredient).toEqual({ id: "agua", name: "agua", aisle: "otros", pantry: true });
    expect(detail.ingredients[5]).toMatchObject({ quantity: null, unit: null, estimated: true });
    expect(detail.ingredients[5]?.ingredient.id).toBe("preparado-de-curry-japones-suave");

    const catalog = await env.DB.prepare("SELECT id, aisle, pantry FROM ingredients ORDER BY id").all();
    expect(catalog.results).toContainEqual({ id: "arroz", aisle: "cereales-pan", pantry: 1 });
    expect(catalog.results).toContainEqual({ id: "pechuga-de-pollo", aisle: "carne-pescado", pantry: 0 });
  });

  it("no sobrescribe sección ni despensa de ingredientes que ya están en el catálogo", async () => {
    await env.DB.prepare("INSERT INTO ingredients (id, name, aisle, pantry) VALUES ('cebolleta', 'cebolleta', 'verdura-fruta', 1)").run();

    const recipe = {
      format: "menu-familiar/recipe@1",
      id: "revuelto-cebolleta",
      title: "Revuelto de cebolleta",
      minutes: 15,
      protein: "huevo",
      suits: "dinner",
      ingredients: [
        // Mismo slug que el catálogo ("Cebolleta" -> "cebolleta") con otra sección y despensa.
        { text: "2 cebolletas", name: "Cebolleta", quantity: 2, unit: "ud", aisle: "otros", pantry: false },
        { text: "4 huevos", name: "huevo-camperó", quantity: 4, unit: "ud", aisle: "huevos-lacteos" },
      ],
      steps: [{ text: "Pochar y cuajar." }],
    };
    const res = await importRecipe(recipe);
    expect(res.status).toBe(201);
    expect((await res.json<ImportResponse>()).created_ingredients).toEqual(["huevo-campero"]);

    const cebolleta = await env.DB.prepare("SELECT name, aisle, pantry FROM ingredients WHERE id = 'cebolleta'").first();
    expect(cebolleta).toEqual({ name: "cebolleta", aisle: "verdura-fruta", pantry: 1 });
  });

  it("responde 409 si la receta ya existe y no se pide reemplazo", async () => {
    expect((await importRecipe(recipeWithId("duplicada"))).status).toBe(201);
    const res = await importRecipe(recipeWithId("duplicada", { title: "Otra" }));
    expect(res.status).toBe(409);
    expect((await res.json<ApiError>()).error).toContain("?replace=true");

    const detail = await (await get("/recipes/duplicada")).json<RecipeDetail>();
    expect(detail.title).toBe(katsukare.title);
  });

  it("con ?replace=true reemplaza la receta y conserva portada y valoraciones", async () => {
    expect((await importRecipe(recipeWithId("reemplazable"))).status).toBe(201);
    await env.DB.batch([
      env.DB.prepare("UPDATE recipes SET cover_photo_key = 'recipes/reemplazable/cover.jpg' WHERE id = 'reemplazable'"),
      env.DB.prepare(
        "INSERT INTO cook_logs (recipe_id, cooked_at, stars, note) VALUES ('reemplazable', '2026-09-01T13:00:00.000Z', 3, 'bien')",
      ),
      env.DB.prepare(
        "INSERT INTO cook_logs (recipe_id, cooked_at, stars, note) VALUES ('reemplazable', '2026-09-20T13:00:00.000Z', 5, 'mejor')",
      ),
    ]);

    const replacement = recipeWithId("reemplazable", {
      title: "Katsukarē v2",
      minutes: 35,
      tags: ["japonesa"],
      ingredients: katsukare.ingredients.slice(0, 3),
      steps: [{ text: "Paso único." }],
    });
    const res = await importRecipe(replacement, "?replace=true");
    expect(res.status).toBe(200);
    expect((await res.json<ImportResponse>()).replaced).toBe(true);

    const detail = await (await get("/recipes/reemplazable")).json<RecipeDetail>();
    expect(detail).toMatchObject({
      title: "Katsukarē v2",
      minutes: 35,
      tags: ["japonesa"],
      cover_photo_key: "recipes/reemplazable/cover.jpg",
      times_cooked: 2,
      last_stars: 5,
      last_cooked_at: "2026-09-20T13:00:00.000Z",
    });
    expect(detail.ingredients).toHaveLength(3);
    expect(detail.steps).toEqual([{ position: 1, text: "Paso único.", timer_seconds: null, timer_label: null, uses: null }]);
  });

  it("?replace=true también sirve para una receta que no existía", async () => {
    const res = await importRecipe(recipeWithId("nueva-con-replace"), "?replace=true");
    expect(res.status).toBe(201);
    expect((await res.json<ImportResponse>()).replaced).toBe(false);
  });

  it("devuelve 400 con los campos que fallan y no escribe nada", async () => {
    const invalid = recipeWithId("invalida", { minutes: 0 });
    (invalid.ingredients[1] as Record<string, unknown>).aisle = "pasillo-3";
    const res = await importRecipe(invalid);
    expect(res.status).toBe(400);
    const body = await res.json<ApiError>();
    expect(body.error).toBe("La receta no es válida");
    expect(body.errors?.map((e) => e.field)).toEqual(["minutes", "ingredients[1].aisle"]);
    expect((await get("/recipes/invalida")).status).toBe(404);
  });

  it("devuelve 400 si el cuerpo no es JSON", async () => {
    const res = await app.request(`${BASE}/recipes/import`, { method: "POST", body: "{no es json" }, devEnv);
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).error).toBe("El cuerpo de la petición no es JSON válido");
  });

  it("es atómico: si falla una escritura no queda nada a medias", async () => {
    // Un ingrediente con cantidad negativa pasa zod solo si lo forzamos aquí a mano:
    // simulamos el fallo de la base de datos con un paso que viola un CHECK.
    const { importRecipe: importDirect } = await import("../src/worker/recipes/import");
    const recipe = recipeWithId("atomica");
    const parsed = (await import("../src/shared/recipe-format")).parseRecipeImport(recipe);
    if (!parsed.ok) throw new Error("ejemplo inválido");
    const broken = { ...parsed.recipe, steps: [{ text: "mal", timer_seconds: -1, timer_label: null, uses: null }] };
    await expect(importDirect(env.DB, broken, { replace: false })).rejects.toThrow();

    expect(await env.DB.prepare("SELECT 1 FROM recipes WHERE id = 'atomica'").first()).toBeNull();
  });
});

describe("GET /api/recipes", () => {
  it("lista recetas con datos ligeros y oculta las archivadas", async () => {
    await importRecipe(recipeWithId("visible"));
    await importRecipe(recipeWithId("archivada"));
    await env.DB.prepare("UPDATE recipes SET archived = 1 WHERE id = 'archivada'").run();

    const list = await (await get("/recipes")).json<RecipeSummary[]>();
    const visible = list.find((r) => r.id === "visible");
    expect(visible).toEqual({
      id: "visible",
      title: katsukare.title,
      minutes: 40,
      protein: "ave",
      suits: "lunch",
      course: "main",
      kcal_adult: 800,
      kcal_estimated: true,
      tags: ["japonesa", "curry", "empanado"],
      cover_photo_key: null,
      photo_url: null,
      archived: false,
      times_cooked: 0,
      last_cooked_at: null,
      last_stars: null,
    });
    expect(list.some((r) => r.id === "archivada")).toBe(false);

    const all = await (await get("/recipes?include_archived=true")).json<RecipeSummary[]>();
    expect(all.find((r) => r.id === "archivada")?.archived).toBe(true);
  });

  it("GET de una receta inexistente devuelve 404", async () => {
    expect((await get("/recipes/no-existe")).status).toBe(404);
  });
});

describe("protección de /api/recipes", () => {
  it("sin token de Access responde 401", async () => {
    const res = await app.request(`${BASE}/recipes`, {}, {
      ...env,
      ACCESS_TEAM_DOMAIN: "equipo.cloudflareaccess.com",
      ACCESS_AUD: "aud",
    });
    expect(res.status).toBe(401);
  });
});
