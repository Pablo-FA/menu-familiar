import { Hono } from "hono";
import { z } from "zod";
import type { ApiError, PlanPreviewResponse, PlanRangeResponse, PlanSlotInfo, PreviewMeal } from "../shared/api";
import { buildClaudeContext, RECENT_DAYS, MAX_RATINGS, type ContextPlanRow, type ContextRating, type ContextRecipe } from "../shared/claude-context";
import { addDays, isIsoDate, madridNow } from "../shared/dates";
import { MEAL_STATUSES, type MealStatus } from "../shared/meals";
import { planImportSchema, toValidationErrors } from "../shared/plan-format";
import { SLOTS, type Protein, type Slot, type Suits } from "../shared/recipe-format";
import { isoWeekday } from "../shared/week";
import type { AppEnv } from "./env";
import { photoUrl } from "./photos";
import { checkMealRecipes, upsertMeal } from "./plan-common";
import { listRecipes } from "./recipes/queries";

/** Rutas del Planificador: rango de días, escrituras por lotes, vista previa y contexto para Claude. */
export const planner = new Hono<AppEnv>();

/** Máximo de días por petición de GET /api/plan. */
export const MAX_RANGE_DAYS = 62;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

interface RangeRow {
  date: string;
  slot: Slot;
  status: MealStatus;
  note: string | null;
  recipe_id: string | null;
  title: string | null;
  minutes: number | null;
  protein: Protein | null;
  suits: Suits | null;
  cover_photo_key: string | null;
  log_id: number | null;
  log_stars: number | null;
  log_note: string | null;
}

/** Franjas guardadas en un rango, con receta resumida y último cook_log. */
async function planRows(db: D1Database, from: string, to: string): Promise<RangeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT pm.date, pm.slot, pm.status, pm.note, pm.recipe_id,
              r.title, r.minutes, r.protein, r.suits, r.cover_photo_key,
              l.id AS log_id, l.stars AS log_stars, l.note AS log_note
       FROM plan_meals pm
       LEFT JOIN recipes r ON r.id = pm.recipe_id
       LEFT JOIN cook_logs l ON l.id = (
         SELECT id FROM cook_logs WHERE plan_meal_date = pm.date AND plan_meal_slot = pm.slot
         ORDER BY cooked_at DESC, id DESC LIMIT 1)
       WHERE pm.date BETWEEN ? AND ?`,
    )
    .bind(from, to)
    .all<RangeRow>();
  return results;
}

// ---------- GET /api/plan?from&to ----------

planner.get("/plan", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) return c.json<ApiError>({ error: "from y to deben ser fechas AAAA-MM-DD" }, 400);
  if (to < from) return c.json<ApiError>({ error: "to no puede ser anterior a from" }, 400);
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    return c.json<ApiError>({ error: `Como mucho ${MAX_RANGE_DAYS} días por petición` }, 400);
  }

  const rows = await planRows(c.env.DB, from, to);
  const byKey = new Map(rows.map((r) => [`${r.date}#${r.slot}`, r]));
  const slotInfo = (date: string, slot: Slot): PlanSlotInfo => {
    const r = byKey.get(`${date}#${slot}`);
    if (!r) return { status: "empty", note: null, recipe: null, cook_log: null };
    return {
      status: r.status,
      note: r.note,
      recipe:
        r.recipe_id && r.title !== null
          ? {
              id: r.recipe_id,
              title: r.title,
              minutes: r.minutes ?? 0,
              protein: r.protein as Protein,
              suits: r.suits as Suits,
              photo_url: r.cover_photo_key ? photoUrl(r.cover_photo_key) : null,
            }
          : null,
      cook_log: r.log_id !== null ? { id: r.log_id, stars: r.log_stars, note: r.log_note } : null,
    };
  };

  const days = Array.from({ length: daysBetween(from, to) }, (_, i) => addDays(from, i)).map((date) => ({
    date,
    lunch: slotInfo(date, "lunch"),
    dinner: slotInfo(date, "dinner"),
  }));
  return c.json<PlanRangeResponse>({ from, to, days });
});

// ---------- POST /api/plan/batch ----------

const batchMealSchema = z
  .strictObject({
    date: z.string().refine(isIsoDate, "Debe ser una fecha real con formato AAAA-MM-DD"),
    slot: z.enum(SLOTS),
    status: z.enum(MEAL_STATUSES),
    recipe_id: z.string().min(1).max(80).nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .superRefine((meal, ctx) => {
    if (meal.status === "planned" && !meal.recipe_id) {
      ctx.addIssue({ code: "custom", path: ["recipe_id"], message: 'Una comida "planned" necesita recipe_id' });
    }
    if (meal.status !== "planned" && meal.recipe_id) {
      ctx.addIssue({ code: "custom", path: ["recipe_id"], message: `Una comida "${meal.status}" no lleva receta` });
    }
  });

const batchSchema = z
  .strictObject({ meals: z.array(batchMealSchema).min(1).max(62) })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.meals.forEach((m, i) => {
      const key = `${m.date} ${m.slot}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["meals", i], message: `Repite ${key}` });
      seen.add(key);
    });
  });

/**
 * Escribe varias franjas de una vez, en una sola transacción (db.batch): mover,
 * intercambiar, deshacer y las acciones del Planificador.
 */
planner.post("/plan/batch", async (c) => {
  const parsed = batchSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) {
    return c.json<ApiError>({ error: "Los cambios no son válidos", errors: toValidationErrors(parsed.error) }, 400);
  }
  const { meals } = parsed.data;
  const { problems } = await checkMealRecipes(
    c.env.DB,
    meals.map((m) => ({ recipe_id: m.recipe_id ?? null })),
    [],
  );
  if (problems.length > 0) return c.json<ApiError>({ error: "Los cambios no son válidos", errors: problems }, 400);

  await c.env.DB.batch(meals.map((m) => upsertMeal(c.env.DB, m.date, m.slot, m.status, m.recipe_id ?? null, m.note || null)));
  return c.json({ meals: meals.length });
});

// ---------- POST /api/plan/preview ----------

/** Lo mismo que validaría POST /api/plan/import, pero sin escribir: qué cambiaría en cada franja. */
planner.post("/plan/preview", async (c) => {
  const body = await readJson(c.req.raw);
  const empty: PlanPreviewResponse = { meals: [], new_recipes: [], ignored_existing_recipes: [], errors: [] };
  if (body === undefined) return c.json<PlanPreviewResponse>({ ...empty, errors: [{ field: "", message: "No es JSON válido" }] });

  const parsed = planImportSchema.safeParse(body);
  if (!parsed.success) return c.json<PlanPreviewResponse>({ ...empty, errors: toValidationErrors(parsed.error) });
  const { meals, recipes } = parsed.data;
  const db = c.env.DB;

  const { problems, existing, titleOf } = await checkMealRecipes(db, meals, recipes);
  const dates = meals.map((m) => m.date).sort();
  const current = dates.length ? await planRows(db, dates[0] ?? "", dates[dates.length - 1] ?? "") : [];
  const currentOf = new Map(current.map((r) => [`${r.date}#${r.slot}`, r]));

  const previewMeals: PreviewMeal[] = meals.map((meal) => {
    const cur = currentOf.get(`${meal.date}#${meal.slot}`);
    const currentStatus: MealStatus = cur?.status ?? "empty";
    const currentRecipe = cur?.recipe_id ?? null;
    const same = currentStatus === meal.status && currentRecipe === meal.recipe_id;
    const change: PreviewMeal["change"] = same ? "same" : currentStatus === "empty" ? "add" : "replace";
    return {
      date: meal.date,
      slot: meal.slot,
      change,
      proposed: {
        status: meal.status,
        recipe_id: meal.recipe_id,
        title: meal.recipe_id ? (titleOf.get(meal.recipe_id) ?? null) : null,
        is_new: meal.recipe_id !== null && !existing.has(meal.recipe_id),
      },
      current: { status: currentStatus, recipe_id: currentRecipe, title: cur?.title ?? null, note: cur?.note ?? null },
    };
  });

  return c.json<PlanPreviewResponse>({
    meals: previewMeals,
    new_recipes: recipes.filter((r) => !existing.has(r.id)).map((r) => ({ id: r.id, title: r.title })),
    ignored_existing_recipes: recipes.filter((r) => existing.has(r.id)).map((r) => ({ id: r.id, title: titleOf.get(r.id) ?? r.title })),
    errors: problems,
  });
});

// ---------- GET /api/claude-context?week=AAAA-MM-DD ----------

planner.get("/claude-context", async (c) => {
  const monday = c.req.query("week") ?? "";
  if (!isIsoDate(monday) || isoWeekday(monday) !== 1) {
    return c.json<ApiError>({ error: "week debe ser el lunes de la semana (AAAA-MM-DD)" }, 400);
  }
  const db = c.env.DB;
  const now = new Date();
  const [rows, recipes, ratingsRes] = await Promise.all([
    planRows(db, addDays(monday, -RECENT_DAYS), addDays(monday, 6)),
    listRecipes(db, { includeArchived: false }),
    db
      .prepare(
        `SELECT l.plan_meal_date, l.plan_meal_slot, l.cooked_at, l.recipe_id, l.stars, l.note
         FROM cook_logs l
         WHERE l.stars IS NOT NULL OR (l.note IS NOT NULL AND l.note <> '')
         ORDER BY l.cooked_at DESC, l.id DESC LIMIT ?`,
      )
      .bind(MAX_RATINGS)
      .all<{ plan_meal_date: string | null; plan_meal_slot: Slot | null; cooked_at: string; recipe_id: string; stars: number | null; note: string | null }>(),
  ]);

  // Para el contexto hacen falta también tags y freezer_note, que el listado ligero no trae.
  const extra = await db
    .prepare("SELECT id, tags, freezer_note FROM recipes WHERE archived = 0 AND course = 'main'")
    .all<{ id: string; tags: string; freezer_note: string | null }>();
  const extraOf = new Map(extra.results.map((r) => [r.id, r]));

  const contextRecipes: ContextRecipe[] = recipes.map((r) => ({
    id: r.id,
    title: r.title,
    minutes: r.minutes,
    protein: r.protein,
    suits: r.suits,
    course: r.course,
    archived: r.archived,
    kcal_adult: r.kcal_adult,
    tags: r.tags,
    freezer_note: extraOf.get(r.id)?.freezer_note ?? null,
    times_cooked: r.times_cooked,
    last_cooked: r.last_cooked,
    avg_stars: r.avg_stars,
  }));
  const plan: ContextPlanRow[] = rows.map((r) => ({
    date: r.date,
    slot: r.slot,
    status: r.status,
    recipe_id: r.recipe_id,
    note: r.note,
    stars: r.log_stars,
  }));
  const ratings: ContextRating[] = ratingsRes.results.map((l) => ({
    date: l.plan_meal_date ?? madridNow(new Date(l.cooked_at)).date,
    slot: l.plan_meal_slot,
    recipe_id: l.recipe_id,
    stars: l.stars,
    note: l.note,
  }));

  return c.json(buildClaudeContext({ now, today: madridNow(now).date, monday, plan, recipes: contextRecipes, ratings }));
});
