import { Hono } from "hono";
import type { ApiError, ImportResponse } from "../../shared/api";
import { parseRecipeImport } from "../../shared/recipe-format";
import type { AppEnv } from "../env";
import { importRecipe } from "./import";
import { getRecipe, listRecipes } from "./queries";

export const recipes = new Hono<AppEnv>();

recipes.post("/import", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: "El cuerpo de la petición no es JSON válido" }, 400);
  }

  const parsed = parseRecipeImport(body);
  if (!parsed.ok) {
    return c.json<ApiError>({ error: "La receta no es válida", errors: parsed.errors }, 400);
  }

  const replace = c.req.query("replace") === "true";
  const outcome = await importRecipe(c.env.DB, parsed.recipe, { replace });
  if (outcome.status === "conflict") {
    return c.json<ApiError>(
      {
        error: `Ya existe una receta con id "${parsed.recipe.id}". Para reemplazarla usa ?replace=true (se conservan la portada y las valoraciones).`,
      },
      409,
    );
  }

  return c.json<ImportResponse>(
    { id: parsed.recipe.id, replaced: outcome.replaced, created_ingredients: outcome.createdIngredients },
    outcome.replaced ? 200 : 201,
  );
});

recipes.get("/", async (c) => {
  const includeArchived = c.req.query("include_archived") === "true";
  return c.json(await listRecipes(c.env.DB, { includeArchived }));
});

recipes.get("/:id", async (c) => {
  const recipe = await getRecipe(c.env.DB, c.req.param("id"));
  if (!recipe) return c.json<ApiError>({ error: "Receta no encontrada" }, 404);
  return c.json(recipe);
});
