import type { MealStatus } from "./meals";
import type { Aisle, Course, Protein, Slot, Suits, Unit } from "./recipe-format";

/** Elemento de GET /api/recipes. */
export interface RecipeSummary {
  id: string;
  title: string;
  minutes: number;
  protein: Protein;
  suits: Suits;
  /** Solo los "main" se pueden planificar como comida o cena. */
  course: Course;
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
  /** Fecha (AAAA-MM-DD, Madrid) del último cocinado, o null. */
  last_cooked: string | null;
  /** Media de las valoraciones con estrellas, a 1 decimal, o null. */
  avg_stars: number | null;
  /** Nombres (del catálogo) de sus ingredientes, para buscar en la galería. */
  ingredient_names: string[];
  /** Tiene nota de congelación. */
  has_freezer: boolean;
  created_at: string;
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
  timer_label: string | null;
  /** Ids de ingrediente (slugs) que usa el paso; null si no se indicó al importar. */
  uses: string[] | null;
}

/** Una vez que se cocinó (historial de la ficha). */
export interface CookHistoryEntry {
  id: number;
  cooked_at: string;
  /** Fecha en Madrid (AAAA-MM-DD). */
  date: string;
  /** Franja planificada, o la que corresponde a la hora si se cocinó sin planificar. */
  slot: Slot;
  planned: boolean;
  stars: number | null;
  note: string | null;
}

/** GET /api/recipes/:id */
export interface RecipeDetail extends RecipeSummary {
  source_url: string | null;
  adaptation_notes: string | null;
  freezer_note: string | null;
  updated_at: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  /** Del más reciente al más antiguo. */
  history: CookHistoryEntry[];
}

/** POST /api/recipes/preview: qué se importaría, sin escribir nada. */
export interface RecipePreviewResponse {
  summary: {
    id: string;
    title: string;
    minutes: number;
    protein: Protein;
    suits: Suits;
    course: Course;
    kcal_adult: number | null;
    kcal_estimated: boolean;
    adaptation_notes: string | null;
    /** Portada de la receta existente, si la hay. */
    photo_url: string | null;
  } | null;
  ingredients_count: number;
  steps_count: number;
  timers_count: number;
  new_ingredients: { name: string; aisle: Aisle }[];
  exists: boolean;
  errors: { field: string; message: string }[];
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

export interface CookLog {
  id: number;
  cooked_at: string;
  stars: number | null;
  note: string | null;
}

export interface DayMeal {
  status: MealStatus;
  note: string | null;
  recipe: RecipeDetail | null;
  /** Registro de cocinado de esta comida (el más reciente), si existe. */
  cook_log: CookLog | null;
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
  /** Si la comida ya se registró como cocinada sin estrellas, se actualiza ese registro. */
  cook_log_id: number | null;
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

/** POST /api/recipes/:id/photo */
export interface PhotoResponse {
  cover_photo_key: string;
  photo_url: string;
}

/** Una franja en GET /api/plan. */
export interface PlanSlotInfo {
  status: MealStatus;
  note: string | null;
  recipe: { id: string; title: string; minutes: number; protein: Protein; suits: Suits; photo_url: string | null } | null;
  cook_log: { id: number; stars: number | null; note: string | null } | null;
}

/** GET /api/plan?from&to */
export interface PlanRangeResponse {
  from: string;
  to: string;
  days: { date: string; lunch: PlanSlotInfo; dinner: PlanSlotInfo }[];
}

/** Una comida para POST /api/plan/batch (y su deshacer). */
export interface PlanMealWrite {
  date: string;
  slot: Slot;
  status: MealStatus;
  recipe_id: string | null;
  note: string | null;
}

export interface PreviewMeal {
  date: string;
  slot: Slot;
  change: "add" | "replace" | "same";
  proposed: { status: MealStatus; recipe_id: string | null; title: string | null; is_new: boolean };
  current: { status: MealStatus; recipe_id: string | null; title: string | null; note: string | null };
}

/** POST /api/plan/preview */
export interface PlanPreviewResponse {
  meals: PreviewMeal[];
  new_recipes: { id: string; title: string }[];
  ignored_existing_recipes: { id: string; title: string }[];
  errors: { field: string; message: string }[];
}

// ---------- Lista de la compra ----------

/** Línea de la lista. id es null solo en el móvil, mientras no se ha sincronizado una línea creada sin conexión. */
export interface ShoppingItem {
  id: number | null;
  client_id: string | null;
  ingredient_id: string | null;
  name: string;
  quantity_text: string | null;
  aisle: string;
  pantry: boolean;
  status: "review" | "buy" | "home";
  bought: boolean;
  manual: boolean;
  carried: boolean;
}

/** GET /api/shopping (o null si no hay lista). */
export interface ShoppingListResponse {
  id: number;
  from_date: string;
  to_date: string;
  meals_count: number;
  items: ShoppingItem[];
  /** Cambios del menú desde que se hizo la lista: cuántos y el primero contado en una frase. */
  changes: { count: number; first: string } | null;
}

export interface ShoppingCandidate {
  date: string;
  slot: Slot;
  recipe_id: string;
  title: string;
}

/** GET /api/shopping/candidates?from&to */
export interface ShoppingCandidatesResponse {
  meals: ShoppingCandidate[];
  /** Líneas por comprar de la lista actual (para «Pasar lo que no compraste»). */
  pending: number;
}

/** POST /api/shopping/update */
export interface ShoppingUpdateResponse {
  list: ShoppingListResponse;
  added: number;
  removed: number;
  changed: number;
}

/** GET /api/ingredients?q= */
export interface IngredientSuggestion {
  id: string;
  name: string;
  aisle: string;
}
