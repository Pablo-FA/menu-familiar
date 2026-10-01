import type { RecipeIngredient, RecipeStep } from "./api";

/** minúsculas, sin tildes y con cualquier signo convertido en espacio. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Plural simple en español de una palabra: +s si acaba en vocal, +es si no. */
function plural(word: string): string[] {
  return /[aeiou]$/.test(word) ? [`${word}s`] : [`${word}es`, `${word}s`];
}

/**
 * Formas en que un ingrediente puede aparecer en el texto: el nombre, su plural simple y,
 * en nombres compuestos ("pechuga de pollo"), el plural de la primera palabra
 * ("pechugas de pollo").
 */
export function nameVariants(name: string): string[] {
  const base = normalizeText(name);
  if (!base) return [];
  const words = base.split(" ");
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  const variants = new Set([base]);
  plural(last).forEach((p) => variants.add([...words.slice(0, -1), p].join(" ")));
  if (words.length > 1) plural(first).forEach((p) => variants.add([p, ...words.slice(1)].join(" ")));
  return [...variants];
}

/**
 * Ingredientes que usa un paso, en el orden de la receta:
 * - si el paso trae "uses" (ids del catálogo), esos;
 * - si no, los que se nombran en el texto, comparando palabras completas (así "ajo" no
 *   aparece dentro de "trabajo") sin tildes ni mayúsculas y aceptando el plural simple.
 */
export function stepIngredients(
  step: Pick<RecipeStep, "text" | "uses">,
  ingredients: RecipeIngredient[],
): RecipeIngredient[] {
  if (step.uses) {
    const used = new Set(step.uses);
    return ingredients.filter((ing) => used.has(ing.ingredient.id));
  }
  const haystack = ` ${normalizeText(step.text)} `;
  const seen = new Set<string>();
  return ingredients.filter((ing) => {
    if (seen.has(ing.ingredient.id)) return false;
    const found = nameVariants(ing.ingredient.name).some((v) => haystack.includes(` ${v} `));
    if (found) seen.add(ing.ingredient.id);
    return found;
  });
}
