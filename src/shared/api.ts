import type { MealStatus } from "./meals";
import type { Aisle, Protein, Slot, Suits, Unit } from "./recipe-format";

/** Elemento de GET /api/recipes. */
export interface RecipeSummary {
  id: string;
  title: string;
  minutes: number;
  protein: Protein;
  suits: Suits;
  kcal_adult: number | null;
  kcal_estimated: boolean;
  tags: string[];
  cover_photo_key: string | null;
  /** URL para mostrar la portada (/api/photos/…), o null si no hay. */
  photo_url: string | null;
  archived: boolean;
  times_cooked: number;
  last_cooked_at: string | null;
  /** Estrellas del último registro de cocinado que tenga valoración. */
  last_stars: number | null;
}

export interface RecipeIngredient {
  position: number;
  display_text: string;
  quantity: number | null;
  unit: Unit | null;
  estimated: boolean;
  ingredient: { id: string; name: string; aisle: Aisle; pantry: boolean };
}

export interface RecipeStep {
  position: number;
  text: string;
  timer_seconds: number | null;
}

/** GET /api/recipes/:id */
export interface RecipeDetail extends RecipeSummary {
  source_url: string | null;
  adaptation_notes: string | null;
  freezer_note: string | null;
  created_at: string;
  updated_at: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
}

/** POST /api/recipes/import */
export interface ImportResponse {
  id: string;
  replaced: boolean;
  /** Ingredientes que no existían y se han añadido al catálogo. */
  created_ingredients: string[];
}

export interface ApiError {
  error: string;
  errors?: { field: string; message: string }[];
}

export interface DayMeal {
  status: MealStatus;
  note: string | null;
  recipe: RecipeDetail | null;
}

/** GET /api/day/:date */
export interface DayResponse {
  date: string;
  lunch: DayMeal;
  dinner: DayMeal;
}

/** GET /api/rating-prompt */
export interface RatingPrompt {
  date: string;
  slot: Slot;
  recipe: { id: string; title: string; photo_url: string | null };
}

/** POST /api/plan/import */
export interface PlanImportResponse {
  meals: number;
  created_recipes: string[];
  /** Recetas incluidas en el plan que ya existían: no se modifican. */
  existing_recipes: string[];
  created_ingredients: string[];
}
