import type { RecipeDetail, RecipeIngredient, RecipeStep, RecipeSummary } from "../../shared/api";
import type { Aisle, Protein, Suits, Unit } from "../../shared/recipe-format";

interface SummaryRow {
  id: string;
  title: string;
  minutes: number;
  protein: Protein;
  suits: Suits;
  kcal_adult: number | null;
  kcal_estimated: number;
  tags: string;
  cover_photo_key: string | null;
  archived: number;
  times_cooked: number;
  last_cooked_at: string | null;
  last_stars: number | null;
}

interface DetailRow extends SummaryRow {
  source_url: string | null;
  adaptation_notes: string | null;
  freezer_note: string | null;
  created_at: string;
  updated_at: string;
}

const SUMMARY_COLUMNS = `
  r.id, r.title, r.minutes, r.protein, r.suits, r.kcal_adult, r.kcal_estimated, r.tags,
  r.cover_photo_key, r.archived,
  (SELECT COUNT(*) FROM cook_logs l WHERE l.recipe_id = r.id) AS times_cooked,
  (SELECT MAX(l.cooked_at) FROM cook_logs l WHERE l.recipe_id = r.id) AS last_cooked_at,
  (SELECT l.stars FROM cook_logs l WHERE l.recipe_id = r.id AND l.stars IS NOT NULL
     ORDER BY l.cooked_at DESC, l.id DESC LIMIT 1) AS last_stars`;

function toSummary(row: SummaryRow): RecipeSummary {
  return {
    id: row.id,
    title: row.title,
    minutes: row.minutes,
    protein: row.protein,
    suits: row.suits,
    kcal_adult: row.kcal_adult,
    kcal_estimated: row.kcal_estimated === 1,
    tags: JSON.parse(row.tags) as string[],
    cover_photo_key: row.cover_photo_key,
    archived: row.archived === 1,
    times_cooked: row.times_cooked,
    last_cooked_at: row.last_cooked_at,
    last_stars: row.last_stars,
  };
}

export async function listRecipes(db: D1Database, options: { includeArchived: boolean }): Promise<RecipeSummary[]> {
  const { results } = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM recipes r WHERE ?1 = 1 OR r.archived = 0`)
    .bind(options.includeArchived ? 1 : 0)
    .all<SummaryRow>();
  return results.map(toSummary).sort((a, b) => a.title.localeCompare(b.title, "es"));
}

export async function getRecipe(db: D1Database, id: string): Promise<RecipeDetail | null> {
  const [recipeRes, ingredientsRes, stepsRes] = await db.batch([
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, r.source_url, r.adaptation_notes, r.freezer_note, r.created_at, r.updated_at
         FROM recipes r WHERE r.id = ?`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT ri.position, ri.display_text, ri.quantity, ri.unit, ri.estimated,
                i.id AS ingredient_id, i.name, i.aisle, i.pantry
         FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ri.recipe_id = ? ORDER BY ri.position`,
      )
      .bind(id),
    db.prepare("SELECT position, text, timer_seconds FROM recipe_steps WHERE recipe_id = ? ORDER BY position").bind(id),
  ]);

  const row = recipeRes?.results[0] as DetailRow | undefined;
  if (!row) return null;

  const ingredients = (ingredientsRes?.results ?? []).map((r) => {
    const ing = r as {
      position: number;
      display_text: string;
      quantity: number | null;
      unit: Unit | null;
      estimated: number;
      ingredient_id: string;
      name: string;
      aisle: Aisle;
      pantry: number;
    };
    return {
      position: ing.position,
      display_text: ing.display_text,
      quantity: ing.quantity,
      unit: ing.unit,
      estimated: ing.estimated === 1,
      ingredient: { id: ing.ingredient_id, name: ing.name, aisle: ing.aisle, pantry: ing.pantry === 1 },
    } satisfies RecipeIngredient;
  });

  return {
    ...toSummary(row),
    source_url: row.source_url,
    adaptation_notes: row.adaptation_notes,
    freezer_note: row.freezer_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ingredients,
    steps: (stepsRes?.results ?? []) as RecipeStep[],
  };
}
