import { z } from "zod";
import { ACCEPTED_AISLES } from "./aisles";
import { SLUG_PATTERN, slugify } from "./slug";

// Mensajes de error de zod en español.
z.config(z.locales.es());

/** Secciones del súper: ver src/shared/aisles.ts (19 actuales + 8 antiguas aceptadas). */
export { ACCEPTED_AISLES, AISLES, type Aisle } from "./aisles";

export const PROTEINS = ["verdura", "legumbre", "pescado", "carne", "ave", "huevo"] as const;
export type Protein = (typeof PROTEINS)[number];

export const SUITS = ["lunch", "dinner", "both"] as const;
export type Suits = (typeof SUITS)[number];

export const UNITS = ["g", "kg", "ml", "l", "ud", "cda", "cdta", "pizca"] as const;
export type Unit = (typeof UNITS)[number];

export const COURSES = ["main", "side", "breakfast", "drink"] as const;
export type Course = (typeof COURSES)[number];

export const SLOTS = ["lunch", "dinner"] as const;
export type Slot = (typeof SLOTS)[number];

import { RECIPE_FORMAT } from "./formats";

export { RECIPE_FORMAT };

const text = (max: number) => z.string().trim().min(1, "No puede estar vacío").max(max);
const optionalText = (max: number) => text(max).nullish().default(null);

const recipeId = z
  .string()
  .max(80)
  .refine((id) => SLUG_PATTERN.test(id), {
    error: (issue) =>
      `Debe ser un slug (minúsculas, números y guiones), por ejemplo "${slugify(String(issue.input)) || "mi-receta"}"`,
  });

export const importIngredientSchema = z
  .strictObject({
    text: text(200),
    name: text(80).refine((name) => slugify(name).length > 0, "Debe contener letras o números"),
    quantity: z.number().positive().nullish().default(null),
    unit: z.enum(UNITS).nullish().default(null),
    estimated: z.boolean().default(false),
    aisle: z.enum(ACCEPTED_AISLES),
    pantry: z.boolean().default(false),
  })
  .superRefine((ing, ctx) => {
    // Sin las dos piezas no se pueden sumar cantidades en la lista de la compra.
    if (ing.quantity !== null && ing.unit === null) {
      ctx.addIssue({ code: "custom", path: ["unit"], message: "Si hay cantidad, falta la unidad" });
    }
    if (ing.quantity === null && ing.unit !== null) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Si hay unidad, falta la cantidad" });
    }
  });

export const importStepSchema = z.strictObject({
  text: text(2000),
  timer_seconds: z.number().int().positive().nullish().default(null),
  /** Nombre corto del temporizador ("Patatas", "Horno"). */
  timer_label: optionalText(30),
  /** Ingredientes que usa el paso, por nombre (como en ingredients[].name). */
  uses: z.array(text(80)).max(30).nullish().default(null),
});

export const recipeImportSchema = z.strictObject({
  format: z.literal(RECIPE_FORMAT, { error: `Debe ser "${RECIPE_FORMAT}"` }),
  id: recipeId,
  title: text(200),
  minutes: z.number().int().positive(),
  protein: z.enum(PROTEINS),
  suits: z.enum(SUITS),
  kcal_adult: z.number().int().positive().nullish().default(null),
  kcal_estimated: z.boolean().default(false),
  source_url: z.url({ protocol: /^https?$/ }).nullish().default(null),
  adaptation_notes: optionalText(4000),
  freezer_note: optionalText(1000),
  tags: z.array(text(40)).max(20).default([]),
  course: z.enum(COURSES).default("main"),
  ingredients: z.array(importIngredientSchema).min(1).max(60),
  steps: z.array(importStepSchema).min(1).max(40),
}).superRefine((recipe, ctx) => {
  // "uses" debe referirse a ingredientes de la propia receta (comparando por slug).
  const own = new Set(recipe.ingredients.map((ing) => slugify(ing.name)));
  recipe.steps.forEach((step, i) => {
    step.uses?.forEach((name, j) => {
      if (!own.has(slugify(name))) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "uses", j],
          message: `"${name}" no está entre los ingredientes de la receta`,
        });
      }
    });
  });
});

/** Receta tal como llega en el JSON (antes de aplicar valores por defecto). */
export type RecipeImportInput = z.input<typeof recipeImportSchema>;
/** Receta ya validada, con los valores por defecto aplicados. */
export type RecipeImport = z.output<typeof recipeImportSchema>;

export interface ValidationError {
  /** Ruta del campo, p. ej. "ingredients[3].unit". Vacía si el error es del objeto raíz. */
  field: string;
  message: string;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

export type ParseResult =
  | { ok: true; recipe: RecipeImport }
  | { ok: false; errors: ValidationError[] };

export function parseRecipeImport(input: unknown): ParseResult {
  const result = recipeImportSchema.safeParse(input);
  if (result.success) return { ok: true, recipe: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({ field: formatPath(issue.path), message: issue.message })),
  };
}
