import { describe, expect, it } from "vitest";
import katsukare from "../docs/ejemplos/katsukare.json";
import { parseRecipeImport } from "../src/shared/recipe-format";

function withChanges(changes: Record<string, unknown>) {
  return { ...structuredClone(katsukare), ...changes };
}

function errorsOf(input: unknown) {
  const result = parseRecipeImport(input);
  if (result.ok) throw new Error("se esperaba un error de validación");
  return result.errors;
}

describe("validación del formato recipe@1", () => {
  it("acepta el ejemplo de katsukare", () => {
    const result = parseRecipeImport(katsukare);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.ingredients).toHaveLength(12);
    expect(result.recipe.steps).toHaveLength(8);
  });

  it("aplica valores por defecto a los campos opcionales", () => {
    const result = parseRecipeImport({
      format: "menu-familiar/recipe@1",
      id: "tortilla",
      title: "Tortilla",
      minutes: 20,
      protein: "huevo",
      suits: "dinner",
      ingredients: [{ text: "4 huevos", name: "huevo", quantity: 4, unit: "ud", aisle: "huevos-lacteos" }],
      steps: [{ text: "Batir y cuajar." }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe).toMatchObject({
      kcal_adult: null,
      kcal_estimated: false,
      source_url: null,
      adaptation_notes: null,
      freezer_note: null,
      tags: [],
    });
    expect(result.recipe.ingredients[0]).toMatchObject({ estimated: false, pantry: false });
    expect(result.recipe.steps[0]?.timer_seconds).toBeNull();
  });

  it("rechaza un formato desconocido", () => {
    expect(errorsOf(withChanges({ format: "menu-familiar/recipe@2" }))).toContainEqual({
      field: "format",
      message: 'Debe ser "menu-familiar/recipe@1"',
    });
  });

  it("rechaza un id que no es slug y sugiere uno", () => {
    const [error] = errorsOf(withChanges({ id: "Katsu Karē" }));
    expect(error?.field).toBe("id");
    expect(error?.message).toContain('"katsu-kare"');
  });

  it("indica la ruta exacta del campo que falla", () => {
    const recipe = structuredClone(katsukare);
    (recipe.ingredients[3] as Record<string, unknown>).unit = "cucharada";
    (recipe.steps[4] as Record<string, unknown>).timer_seconds = -5;
    const fields = errorsOf(recipe).map((e) => e.field);
    expect(fields).toEqual(["ingredients[3].unit", "steps[4].timer_seconds"]);
  });

  it("exige cantidad y unidad juntas", () => {
    const recipe = structuredClone(katsukare);
    (recipe.ingredients[0] as Record<string, unknown>).unit = null;
    (recipe.ingredients[10] as Record<string, unknown>).unit = "cda";
    expect(errorsOf(recipe)).toEqual([
      { field: "ingredients[0].unit", message: "Si hay cantidad, falta la unidad" },
      { field: "ingredients[10].quantity", message: "Si hay unidad, falta la cantidad" },
    ]);
  });

  it("rechaza valores fuera de las listas cerradas", () => {
    const fields = errorsOf(withChanges({ protein: "tofu", suits: "breakfast" })).map((e) => e.field);
    expect(fields).toEqual(["protein", "suits"]);
  });

  it("rechaza campos desconocidos (p. ej. erratas)", () => {
    const errors = errorsOf(withChanges({ minutos: 40 }));
    expect(errors[0]?.message).toContain("minutos");
  });

  it("rechaza recetas sin ingredientes o sin pasos", () => {
    const fields = errorsOf(withChanges({ ingredients: [], steps: [] })).map((e) => e.field);
    expect(fields).toEqual(["ingredients", "steps"]);
  });

  it("rechaza tipos incorrectos con mensajes en español", () => {
    const [error] = errorsOf(withChanges({ minutes: "40" }));
    expect(error).toEqual({ field: "minutes", message: "Entrada inválida: se esperaba número, recibido texto" });
  });

  it("rechaza URLs de origen que no son http(s)", () => {
    expect(errorsOf(withChanges({ source_url: "ftp://ejemplo.com" }))[0]?.field).toBe("source_url");
  });
});
