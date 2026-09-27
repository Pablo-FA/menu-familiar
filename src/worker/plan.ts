import { Hono } from "hono";
import type { ApiError, DayMeal, DayResponse, PlanImportResponse, RatingPrompt } from "../shared/api";
import { addDays, isIsoDate, madridNow } from "../shared/dates";
import { nominalCookedAt } from "../shared/meals";
import {
  cookLogSchema,
  planImportSchema,
  planMealUpdateSchema,
  ratingSkipSchema,
  toValidationErrors,
} from "../shared/plan-format";
import { pickRatingPrompt, RATING_WINDOW_DAYS, type PastMeal } from "../shared/rating-prompt";
import { SLOTS, type Slot } from "../shared/recipe-format";
import type { AppEnv } from "./env";
import { photoUrl } from "./photos";
import { prepareRecipeWrites, recipeExists } from "./recipes/import";
import { getRecipe } from "./recipes/queries";

export const plan = new Hono<AppEnv>();

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

const INVALID_JSON: ApiError = { error: "El cuerpo de la petición no es JSON válido" };

function isSlot(value: string): value is Slot {
  return (SLOTS as readonly string[]).includes(value);
}

function upsertMeal(db: D1Database, date: string, slot: Slot, status: string, recipeId: string | null, note: string | null) {
  // Si cambia lo planificado, el aviso de valoración vuelve a empezar para esa comida.
  return db
    .prepare(
      `INSERT INTO plan_meals (date, slot, status, recipe_id, note) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (date, slot) DO UPDATE SET
         status = excluded.status, recipe_id = excluded.recipe_id, note = excluded.note,
         rating_skipped_at = CASE WHEN plan_meals.recipe_id IS excluded.recipe_id
                                  THEN plan_meals.rating_skipped_at ELSE NULL END`,
    )
    .bind(date, slot, status, recipeId, note);
}

// ---------- GET /api/day/:date ----------

plan.get("/day/:date", async (c) => {
  const date = c.req.param("date");
  if (!isIsoDate(date)) return c.json<ApiError>({ error: "Fecha no válida (AAAA-MM-DD)" }, 400);

  const { results } = await c.env.DB.prepare("SELECT slot, status, recipe_id, note FROM plan_meals WHERE date = ?")
    .bind(date)
    .all<{ slot: Slot; status: DayMeal["status"]; recipe_id: string | null; note: string | null }>();

  async function mealFor(slot: Slot): Promise<DayMeal> {
    const row = results.find((r) => r.slot === slot);
    if (!row) return { status: "empty", note: null, recipe: null };
    const recipe = row.recipe_id ? await getRecipe(c.env.DB, row.recipe_id) : null;
    return { status: row.status, note: row.note, recipe };
  }

  const [lunch, dinner] = await Promise.all([mealFor("lunch"), mealFor("dinner")]);
  return c.json<DayResponse>({ date, lunch, dinner });
});

// ---------- PUT /api/plan/:date/:slot ----------

plan.put("/plan/:date/:slot", async (c) => {
  const { date, slot } = c.req.param();
  if (!isIsoDate(date)) return c.json<ApiError>({ error: "Fecha no válida (AAAA-MM-DD)" }, 400);
  if (!isSlot(slot)) return c.json<ApiError>({ error: 'La franja debe ser "lunch" o "dinner"' }, 400);

  const json = await readJson(c.req.raw);
  if (!json.ok) return c.json(INVALID_JSON, 400);
  const parsed = planMealUpdateSchema.safeParse(json.body);
  if (!parsed.success) {
    return c.json<ApiError>({ error: "La comida no es válida", errors: toValidationErrors(parsed.error) }, 400);
  }
  const meal = parsed.data;
  if (meal.recipe_id && !(await recipeExists(c.env.DB, meal.recipe_id))) {
    return c.json<ApiError>({ error: `No existe la receta "${meal.recipe_id}"`, errors: [{ field: "recipe_id", message: "Receta no encontrada" }] }, 400);
  }

  await upsertMeal(c.env.DB, date, slot, meal.status, meal.recipe_id, meal.note).run();
  return c.json({ date, slot, status: meal.status, recipe_id: meal.recipe_id, note: meal.note });
});

// ---------- POST /api/plan/import ----------

plan.post("/plan/import", async (c) => {
  const json = await readJson(c.req.raw);
  if (!json.ok) return c.json(INVALID_JSON, 400);
  const parsed = planImportSchema.safeParse(json.body);
  if (!parsed.success) {
    return c.json<ApiError>({ error: "El menú no es válido", errors: toValidationErrors(parsed.error) }, 400);
  }
  const { meals, recipes } = parsed.data;
  const db = c.env.DB;

  // Qué recetas existen ya: las del plan que ya están en la base de datos no se tocan.
  const referenced = [...new Set([...recipes.map((r) => r.id), ...meals.flatMap((m) => (m.recipe_id ? [m.recipe_id] : []))])];
  const { results } = await db
    .prepare("SELECT id FROM recipes WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(referenced))
    .all<{ id: string }>();
  const existing = new Set(results.map((r) => r.id));
  const included = new Set(recipes.map((r) => r.id));

  const missing = meals.flatMap((meal, i) =>
    meal.recipe_id && !existing.has(meal.recipe_id) && !included.has(meal.recipe_id)
      ? [{ field: `meals[${i}].recipe_id`, message: `No existe la receta "${meal.recipe_id}" ni viene en "recipes"` }]
      : [],
  );
  if (missing.length > 0) return c.json<ApiError>({ error: "El menú no es válido", errors: missing }, 400);

  const statements: D1PreparedStatement[] = [];
  const createdIngredients = new Set<string>();
  const newRecipes = recipes.filter((r) => !existing.has(r.id));
  for (const recipe of newRecipes) {
    const prepared = await prepareRecipeWrites(db, recipe, { replace: false });
    statements.push(...prepared.statements);
    prepared.createdIngredients.forEach((id) => createdIngredients.add(id));
  }
  for (const meal of meals) {
    statements.push(upsertMeal(db, meal.date, meal.slot, meal.status, meal.recipe_id, meal.note));
  }

  await db.batch(statements); // una sola transacción: recetas + comidas

  return c.json<PlanImportResponse>({
    meals: meals.length,
    created_recipes: newRecipes.map((r) => r.id),
    existing_recipes: recipes.filter((r) => existing.has(r.id)).map((r) => r.id),
    created_ingredients: [...createdIngredients],
  });
});

// ---------- Aviso de valoración ----------

plan.get("/rating-prompt", async (c) => {
  const now = new Date();
  const { date: today } = madridNow(now);
  const db = c.env.DB;
  const [mealsRes, lastRes] = await db.batch([
    db
      .prepare(
        `SELECT pm.date, pm.slot, pm.recipe_id, pm.rating_skipped_at,
                EXISTS (SELECT 1 FROM cook_logs l WHERE l.plan_meal_date = pm.date AND l.plan_meal_slot = pm.slot) AS has_cook_log
         FROM plan_meals pm
         WHERE pm.status = 'planned' AND pm.recipe_id IS NOT NULL AND pm.date BETWEEN ? AND ?`,
      )
      .bind(addDays(today, -(RATING_WINDOW_DAYS + 1)), today),
    db.prepare(
      `SELECT MAX(t) AS last FROM (
         SELECT MAX(rating_skipped_at) AS t FROM plan_meals
         UNION ALL
         SELECT MAX(created_at) FROM cook_logs WHERE plan_meal_date IS NOT NULL)`,
    ),
  ]);
  const meals = ((mealsRes?.results ?? []) as (Omit<PastMeal, "has_cook_log"> & { has_cook_log: number })[]).map(
    (m) => ({ ...m, has_cook_log: m.has_cook_log === 1 }),
  );
  const last = (lastRes?.results[0] as { last: string | null } | undefined)?.last ?? null;

  const pick = pickRatingPrompt(meals, last, now);
  if (!pick) return c.json(null);

  const recipe = await db
    .prepare("SELECT id, title, cover_photo_key FROM recipes WHERE id = ?")
    .bind(pick.recipe_id)
    .first<{ id: string; title: string; cover_photo_key: string | null }>();
  if (!recipe) return c.json(null);

  return c.json<RatingPrompt>({
    date: pick.date,
    slot: pick.slot,
    recipe: { id: recipe.id, title: recipe.title, photo_url: recipe.cover_photo_key ? photoUrl(recipe.cover_photo_key) : null },
  });
});

plan.post("/rating-prompt/skip", async (c) => {
  const json = await readJson(c.req.raw);
  if (!json.ok) return c.json(INVALID_JSON, 400);
  const parsed = ratingSkipSchema.safeParse(json.body);
  if (!parsed.success) {
    return c.json<ApiError>({ error: "Datos no válidos", errors: toValidationErrors(parsed.error) }, 400);
  }
  const { date, slot } = parsed.data;
  const result = await c.env.DB.prepare(`UPDATE plan_meals SET rating_skipped_at = ${NOW} WHERE date = ? AND slot = ?`)
    .bind(date, slot)
    .run();
  if (result.meta.changes === 0) return c.json<ApiError>({ error: "Esa comida no está planificada" }, 404);
  return c.body(null, 204);
});

// ---------- POST /api/cook-logs ----------

plan.post("/cook-logs", async (c) => {
  const json = await readJson(c.req.raw);
  if (!json.ok) return c.json(INVALID_JSON, 400);
  const parsed = cookLogSchema.safeParse(json.body);
  if (!parsed.success) {
    return c.json<ApiError>({ error: "La valoración no es válida", errors: toValidationErrors(parsed.error) }, 400);
  }
  const log = parsed.data;
  const db = c.env.DB;

  if (!(await recipeExists(db, log.recipe_id))) {
    return c.json<ApiError>({ error: `No existe la receta "${log.recipe_id}"` }, 404);
  }
  let cookedAt = new Date().toISOString();
  if (log.plan_meal_date && log.plan_meal_slot) {
    const meal = await db
      .prepare("SELECT 1 FROM plan_meals WHERE date = ? AND slot = ?")
      .bind(log.plan_meal_date, log.plan_meal_slot)
      .first();
    if (!meal) return c.json<ApiError>({ error: "Esa comida no está planificada" }, 404);
    cookedAt = nominalCookedAt(log.plan_meal_date, log.plan_meal_slot);
  }

  const row = await db
    .prepare(
      `INSERT INTO cook_logs (recipe_id, plan_meal_date, plan_meal_slot, cooked_at, stars, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ${NOW}) RETURNING id`,
    )
    .bind(log.recipe_id, log.plan_meal_date ?? null, log.plan_meal_slot ?? null, cookedAt, log.stars ?? null, log.note)
    .first<{ id: number }>();
  return c.json({ id: row?.id, cooked_at: cookedAt }, 201);
});
