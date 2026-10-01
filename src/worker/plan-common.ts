import type { Slot } from "../shared/recipe-format";
import type { RecipeImport } from "../shared/recipe-format";

export const NOT_MAIN = (id: string, course: string) =>
  `"${id}" no es un plato principal (course "${course}"): no se puede planificar como comida o cena`;

/** Inserta o sustituye una franja. Si cambia la receta, el aviso de valoración se reinicia. */
export function upsertMeal(db: D1Database, date: string, slot: Slot, status: string, recipeId: string | null, note: string | null) {
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

/**
 * Comprueba las recetas que usan unas comidas: que existan (en la base de datos o entre
 * las recetas que trae el plan) y que sean plato principal. Las del plan que ya existen
 * no se modifican: manda lo que hay en la base de datos.
 */
export async function checkMealRecipes(
  db: D1Database,
  meals: { recipe_id: string | null }[],
  recipes: Pick<RecipeImport, "id" | "course" | "title">[],
  fieldPrefix = "meals",
) {
  const referenced = [...new Set([...recipes.map((r) => r.id), ...meals.flatMap((m) => (m.recipe_id ? [m.recipe_id] : []))])];
  const { results } = await db
    .prepare("SELECT id, course, title FROM recipes WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(referenced))
    .all<{ id: string; course: string; title: string }>();

  const courseOf = new Map<string, string>(recipes.map((r) => [r.id, r.course]));
  const titleOf = new Map<string, string>(recipes.map((r) => [r.id, r.title]));
  results.forEach((r) => {
    courseOf.set(r.id, r.course);
    titleOf.set(r.id, r.title);
  });
  const existing = new Set(results.map((r) => r.id));

  const problems = meals.flatMap((meal, i) => {
    if (!meal.recipe_id) return [];
    const course = courseOf.get(meal.recipe_id);
    const field = `${fieldPrefix}[${i}].recipe_id`;
    if (course === undefined) {
      return [{ field, message: `No existe la receta "${meal.recipe_id}" ni viene en "recipes"` }];
    }
    if (course !== "main") return [{ field, message: NOT_MAIN(meal.recipe_id, course) }];
    return [];
  });

  return { problems, existing, titleOf };
}
