import { z } from "zod";
import { isIsoDate } from "./dates";
import { MEAL_STATUSES } from "./meals";
import { SLOTS, formatPath, recipeImportSchema, type ValidationError } from "./recipe-format";

export const PLAN_FORMAT = "menu-familiar/plan@1";

const isoDate = z.string().refine(isIsoDate, "Debe ser una fecha real con formato AAAA-MM-DD");
const recipeId = z.string().min(1).max(80);
const note = z.string().trim().max(500).nullish().transform((v) => (v ? v : null));

/**
 * Estado de una comida. Una comida "planned" necesita receta; "away" (fuera de casa)
 * y "empty" no llevan receta. Si no se indica el estado, se deduce: con receta es
 * "planned" y sin receta "empty".
 */
const mealFields = {
  status: z.enum(MEAL_STATUSES).optional(),
  recipe_id: recipeId.nullish(),
  note,
};

function resolveMeal<T extends { status?: (typeof MEAL_STATUSES)[number] | undefined; recipe_id?: string | null | undefined }>(
  meal: T,
  ctx: z.RefinementCtx,
) {
  const recipe = meal.recipe_id ?? null;
  const status = meal.status ?? (recipe ? "planned" : "empty");
  if (status === "planned" && !recipe) {
    ctx.addIssue({ code: "custom", path: ["recipe_id"], message: 'Una comida "planned" necesita recipe_id' });
  }
  if (status !== "planned" && recipe) {
    ctx.addIssue({ code: "custom", path: ["recipe_id"], message: `Una comida "${status}" no lleva receta` });
  }
  return { ...meal, status, recipe_id: recipe };
}

/** Cuerpo de PUT /api/plan/:date/:slot */
export const planMealUpdateSchema = z
  .strictObject(mealFields)
  .transform((meal, ctx) => resolveMeal(meal, ctx));
export type PlanMealUpdate = z.output<typeof planMealUpdateSchema>;

export const planImportSchema = z
  .strictObject({
    format: z.literal(PLAN_FORMAT, { error: `Debe ser "${PLAN_FORMAT}"` }),
    meals: z
      .array(
        z
          .strictObject({ date: isoDate, slot: z.enum(SLOTS), ...mealFields })
          .transform((meal, ctx) => resolveMeal(meal, ctx)),
      )
      .min(1)
      .max(62),
    recipes: z.array(recipeImportSchema).max(30).default([]),
  })
  .superRefine((plan, ctx) => {
    const seenMeals = new Map<string, number>();
    plan.meals.forEach((meal, i) => {
      const key = `${meal.date} ${meal.slot}`;
      const first = seenMeals.get(key);
      if (first !== undefined) {
        ctx.addIssue({ code: "custom", path: ["meals", i], message: `Repite ${key} (ya está en meals[${first}])` });
      } else {
        seenMeals.set(key, i);
      }
    });
    const seenRecipes = new Map<string, number>();
    plan.recipes.forEach((recipe, i) => {
      const first = seenRecipes.get(recipe.id);
      if (first !== undefined) {
        ctx.addIssue({ code: "custom", path: ["recipes", i, "id"], message: `Receta repetida (ya está en recipes[${first}])` });
      } else {
        seenRecipes.set(recipe.id, i);
      }
    });
  });
export type PlanImport = z.output<typeof planImportSchema>;

export const cookLogSchema = z
  .strictObject({
    recipe_id: recipeId,
    plan_meal_date: isoDate.nullish(),
    plan_meal_slot: z.enum(SLOTS).nullish(),
    stars: z.number().int().min(1).max(5).nullish(),
    note,
  })
  .superRefine((log, ctx) => {
    if (Boolean(log.plan_meal_date) !== Boolean(log.plan_meal_slot)) {
      ctx.addIssue({ code: "custom", path: ["plan_meal_slot"], message: "plan_meal_date y plan_meal_slot van juntos" });
    }
  });
export type CookLogInput = z.output<typeof cookLogSchema>;

export const ratingSkipSchema = z.strictObject({ date: isoDate, slot: z.enum(SLOTS) });

export function toValidationErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({ field: formatPath(issue.path), message: issue.message }));
}
