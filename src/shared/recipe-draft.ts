import type { RecipeDetail } from "./api";
import { guessAisle, isAisle, type Aisle } from "./aisles";
import { RECIPE_FORMAT } from "./formats";
import type { Course, Protein, RecipeImportInput, Suits, Unit } from "./recipe-format";
import { slugify } from "./slug";

/**
 * Borrador del editor de recetas: lo que se edita en pantalla (cantidades como texto,
 * para poder escribir "1,5"), y su conversión a recipe@1 para validar y guardar con el
 * mismo esquema que la importación.
 */

export interface DraftIngredient {
  /** Clave estable para React (no se guarda). */
  key: string;
  text: string;
  name: string;
  quantity: string;
  unit: Unit | null;
  estimated: boolean;
  aisle: Aisle;
  pantry: boolean;
}

export interface DraftStep {
  key: string;
  text: string;
  timer_seconds: number | null;
  timer_label: string;
  /** Slugs de ingrediente; al guardar se quedan solo los que siguen en la receta. */
  uses: string[] | null;
}

export interface RecipeDraft {
  id: string;
  title: string;
  minutes: number;
  kcal: string;
  kcal_estimated: boolean;
  suits: Suits;
  protein: Protein;
  course: Course;
  freezer_note: string;
  adaptation_notes: string;
  source_url: string | null;
  tags: string[];
  ingredients: DraftIngredient[];
  steps: DraftStep[];
}

let counter = 0;
export const newKey = () => `k${(counter += 1)}`;

const decimal = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3, useGrouping: false });

export function draftFromRecipe(recipe: RecipeDetail): RecipeDraft {
  return {
    id: recipe.id,
    title: recipe.title,
    minutes: recipe.minutes,
    kcal: recipe.kcal_adult === null ? "" : String(recipe.kcal_adult),
    kcal_estimated: recipe.kcal_estimated,
    suits: recipe.suits,
    protein: recipe.protein,
    course: recipe.course,
    freezer_note: recipe.freezer_note ?? "",
    adaptation_notes: recipe.adaptation_notes ?? "",
    source_url: recipe.source_url,
    tags: recipe.tags,
    ingredients: recipe.ingredients.map((ing) => ({
      key: newKey(),
      text: ing.display_text,
      name: ing.ingredient.name,
      quantity: ing.quantity === null ? "" : decimal.format(ing.quantity),
      unit: ing.unit,
      estimated: ing.estimated,
      aisle: isAisle(ing.ingredient.aisle) ? ing.ingredient.aisle : "otros",
      pantry: ing.ingredient.pantry,
    })),
    steps: recipe.steps.map((step) => ({
      key: newKey(),
      text: step.text,
      timer_seconds: step.timer_seconds,
      timer_label: step.timer_label ?? "",
      uses: step.uses,
    })),
  };
}

export function emptyIngredient(): DraftIngredient {
  return { key: newKey(), text: "", name: "", quantity: "", unit: null, estimated: false, aisle: "otros", pantry: false };
}

export function emptyStep(): DraftStep {
  return { key: newKey(), text: "", timer_seconds: null, timer_label: "", uses: null };
}

/** "1,5" o "1.5" → 1.5; vacío → null; si no es un número, NaN (lo marcará la validación). */
export function parseQuantity(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (clean === "") return null;
  return /^\d+(\.\d+)?$|^\.\d+$/.test(clean) ? Number(clean) : Number.NaN;
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** Borrador → recipe@1 (antes de validar). */
export function draftToRecipe(draft: RecipeDraft): RecipeImportInput & { format: typeof RECIPE_FORMAT } {
  const slugs = new Set(draft.ingredients.map((i) => slugify(i.name)).filter(Boolean));
  const nameBySlug = new Map(draft.ingredients.map((i) => [slugify(i.name), i.name.trim()]));
  const kcal = parseQuantity(draft.kcal);
  return {
    format: RECIPE_FORMAT,
    id: draft.id,
    title: draft.title,
    minutes: draft.minutes,
    protein: draft.protein,
    suits: draft.suits,
    course: draft.course,
    kcal_adult: kcal,
    kcal_estimated: kcal === null ? false : draft.kcal_estimated,
    source_url: draft.source_url,
    adaptation_notes: orNull(draft.adaptation_notes),
    freezer_note: orNull(draft.freezer_note),
    tags: draft.tags,
    ingredients: draft.ingredients.map((ing) => ({
      // Sin texto propio, el de la lista es el nombre.
      text: ing.text.trim() || ing.name.trim(),
      name: ing.name,
      quantity: parseQuantity(ing.quantity),
      unit: ing.unit,
      estimated: ing.estimated,
      aisle: ing.aisle,
      pantry: ing.pantry,
    })),
    steps: draft.steps.map((step) => {
      // Solo los ingredientes que siguen en la receta (quitar o renombrar uno lo saca de aquí).
      const uses = step.uses?.filter((slug) => slugs.has(slug)).map((slug) => nameBySlug.get(slug) ?? slug) ?? null;
      return {
        text: step.text,
        timer_seconds: step.timer_seconds,
        timer_label: step.timer_seconds === null ? null : orNull(step.timer_label),
        uses: uses && uses.length > 0 ? uses : null,
      };
    }),
  };
}

/** Sección por defecto de un ingrediente nuevo. */
export const defaultAisle = (name: string): Aisle => guessAisle(slugify(name));

/** Paso del control de temporizador: de 1 en 1 hasta 10 min y de 5 en 5 después. */
export function timerStep(minutes: number, direction: 1 | -1): number {
  if (direction === 1) return minutes < 10 ? minutes + 1 : minutes + 5 - (minutes % 5);
  if (minutes <= 10) return Math.max(1, minutes - 1);
  return minutes % 5 === 0 ? minutes - 5 : minutes - (minutes % 5);
}
