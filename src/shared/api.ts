import type { Aisle, Protein, Suits, Unit } from "./recipe-format";

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
