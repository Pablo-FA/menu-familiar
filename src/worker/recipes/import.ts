import type { RecipeImport } from "../../shared/recipe-format";
import { slugify } from "../../shared/slug";

export type ImportOutcome =
  | { status: "conflict" }
  | { status: "imported"; replaced: boolean; createdIngredients: string[] };

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Guarda una receta ya validada. Todas las escrituras van en un único db.batch(),
 * que D1 ejecuta como una transacción: o se aplica todo o nada.
 *
 * - Ingredientes nuevos: se crean en el catálogo con su sección y despensa.
 * - Ingredientes existentes: manda el catálogo (no se tocan sección ni despensa).
 * - Receta existente: conflicto, salvo con replace. Al reemplazar se actualiza la
 *   fila (no se borra), así se conservan cover_photo_key, archived, created_at y los
 *   cook_logs; ingredientes y pasos se sustituyen por completo.
 */
export async function importRecipe(
  db: D1Database,
  recipe: RecipeImport,
  options: { replace: boolean },
): Promise<ImportOutcome> {
  const existing = await recipeExists(db, recipe.id);
  if (existing && !options.replace) return { status: "conflict" };

  const { statements, createdIngredients } = await prepareRecipeWrites(db, recipe, { replace: options.replace });

  try {
    await db.batch(statements);
  } catch (err) {
    // Otra importación creó la misma receta entre la comprobación y el batch.
    if (!options.replace && /UNIQUE constraint failed: recipes\.id/.test(String(err))) {
      return { status: "conflict" };
    }
    throw err;
  }

  return { status: "imported", replaced: existing, createdIngredients };
}

export async function recipeExists(db: D1Database, id: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM recipes WHERE id = ?").bind(id).first());
}

/**
 * Prepara (sin ejecutar) las sentencias que guardan una receta, para poder
 * combinarlas con otras en un mismo db.batch() (p. ej. al importar un plan@1).
 */
export async function prepareRecipeWrites(
  db: D1Database,
  recipe: RecipeImport,
  options: { replace: boolean },
): Promise<{ statements: D1PreparedStatement[]; createdIngredients: string[] }> {
  // Un ingrediente por slug; si se repite en la receta, cuenta la primera aparición.
  const catalogEntries = new Map<string, { name: string; aisle: string; pantry: boolean }>();
  const lines = recipe.ingredients.map((ing) => {
    const ingredientId = slugify(ing.name);
    if (!catalogEntries.has(ingredientId)) {
      catalogEntries.set(ingredientId, { name: ing.name, aisle: ing.aisle, pantry: ing.pantry });
    }
    return { ...ing, ingredientId };
  });

  const known = await db
    .prepare("SELECT id FROM ingredients WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify([...catalogEntries.keys()]))
    .all<{ id: string }>();
  const knownIds = new Set(known.results.map((row) => row.id));
  const createdIngredients = [...catalogEntries.keys()].filter((id) => !knownIds.has(id));

  const statements: D1PreparedStatement[] = [];

  for (const [id, entry] of catalogEntries) {
    statements.push(
      db
        .prepare("INSERT INTO ingredients (id, name, aisle, pantry) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
        .bind(id, entry.name, entry.aisle, entry.pantry ? 1 : 0),
    );
  }

  const recipeValues = [
    recipe.id,
    recipe.title,
    recipe.minutes,
    recipe.protein,
    recipe.suits,
    recipe.kcal_adult,
    recipe.kcal_estimated ? 1 : 0,
    recipe.source_url,
    recipe.adaptation_notes,
    recipe.freezer_note,
    JSON.stringify(recipe.tags),
    recipe.course,
  ];
  const insertRecipe = `INSERT INTO recipes
      (id, title, minutes, protein, suits, kcal_adult, kcal_estimated, source_url, adaptation_notes, freezer_note, tags, course)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  if (options.replace) {
    // UPSERT y no INSERT OR REPLACE: este último borra la fila y arrastraría los cook_logs.
    statements.push(
      db
        .prepare(
          `${insertRecipe}
          ON CONFLICT (id) DO UPDATE SET
            title = excluded.title, minutes = excluded.minutes, protein = excluded.protein,
            suits = excluded.suits, kcal_adult = excluded.kcal_adult, kcal_estimated = excluded.kcal_estimated,
            source_url = excluded.source_url, adaptation_notes = excluded.adaptation_notes,
            freezer_note = excluded.freezer_note, tags = excluded.tags, course = excluded.course, updated_at = ${NOW}`,
        )
        .bind(...recipeValues),
      db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(recipe.id),
      db.prepare("DELETE FROM recipe_steps WHERE recipe_id = ?").bind(recipe.id),
    );
  } else {
    statements.push(db.prepare(insertRecipe).bind(...recipeValues));
  }

  lines.forEach((line, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO recipe_ingredients
            (recipe_id, position, display_text, quantity, unit, estimated, ingredient_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(recipe.id, index + 1, line.text, line.quantity, line.unit, line.estimated ? 1 : 0, line.ingredientId),
    );
  });

  recipe.steps.forEach((step, index) => {
    statements.push(
      db
        .prepare(
          "INSERT INTO recipe_steps (recipe_id, position, text, timer_seconds, timer_label, uses) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          recipe.id,
          index + 1,
          step.text,
          step.timer_seconds,
          step.timer_label,
          // Los nombres se guardan como slugs del catálogo, sin repetir.
          step.uses ? JSON.stringify([...new Set(step.uses.map(slugify))]) : null,
        ),
    );
  });

  return { statements, createdIngredients };
}
