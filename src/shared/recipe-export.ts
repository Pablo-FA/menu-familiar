import type { RecipeDetail } from "./api";
import { RECIPE_FORMAT } from "./formats";
import type { RecipeImportInput } from "./recipe-format";

/**
 * Receta guardada → recipe@1. Es lo que se copia en «Mejorar con Claude» y el punto de
 * partida del editor. Importarla con replace da exactamente la misma receta (test de ida
 * y vuelta): los nombres de ingrediente son los del catálogo (su slug es el id) y `uses`
 * pasa de slugs a esos mismos nombres.
 */
export function exportRecipe(recipe: RecipeDetail): RecipeImportInput & { format: typeof RECIPE_FORMAT } {
  const nameBySlug = new Map(recipe.ingredients.map((ing) => [ing.ingredient.id, ing.ingredient.name]));
  return {
    format: RECIPE_FORMAT,
    id: recipe.id,
    title: recipe.title,
    minutes: recipe.minutes,
    protein: recipe.protein,
    suits: recipe.suits,
    course: recipe.course,
    kcal_adult: recipe.kcal_adult,
    kcal_estimated: recipe.kcal_estimated,
    source_url: recipe.source_url,
    adaptation_notes: recipe.adaptation_notes,
    freezer_note: recipe.freezer_note,
    tags: recipe.tags,
    ingredients: recipe.ingredients.map((ing) => ({
      text: ing.display_text,
      name: ing.ingredient.name,
      quantity: ing.quantity,
      unit: ing.unit,
      estimated: ing.estimated,
      aisle: ing.ingredient.aisle,
      pantry: ing.ingredient.pantry,
    })),
    steps: recipe.steps.map((step) => ({
      text: step.text,
      timer_seconds: step.timer_seconds,
      timer_label: step.timer_label,
      uses: step.uses ? step.uses.map((slug) => nameBySlug.get(slug) ?? slug) : null,
    })),
  };
}

/** Texto de «Mejorar con Claude»: la petición (con hueco para el cambio) y la receta actual. */
export function improveRequestText(recipe: RecipeDetail): string {
  return [
    "Quiero cambiar esta receta de Menú familiar: [escribe o dicta aquí el cambio]. Devuélvemela completa en formato menu-familiar/recipe@1 con el mismo id, dentro de un bloque ```json.",
    "",
    "```json",
    JSON.stringify(exportRecipe(recipe), null, 2),
    "```",
  ].join("\n");
}

/** Texto de «Adaptar una receta de internet». */
export function adaptRequestText(url: string): string {
  return `Adapta esta receta para Menú familiar y devuélvemela en formato menu-familiar/recipe@1 dentro de un bloque \`\`\`json: ${url.trim()}`;
}

