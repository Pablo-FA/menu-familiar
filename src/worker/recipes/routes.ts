import { Hono } from "hono";
import type { ApiError, ImportResponse, PhotoResponse } from "../../shared/api";
import { parseRecipeImport } from "../../shared/recipe-format";
import type { AppEnv } from "../env";
import { photoUrl } from "../photos";
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

/** Tamaño máximo de una foto de portada (ya redimensionada en el cliente). */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// POST /api/recipes/:id/photo — cuerpo: el JPEG en bruto (Content-Type: image/jpeg).
// Se guarda con una clave nueva (recipes/{id}/{timestamp}.jpg), así la URL se puede
// cachear para siempre; la foto anterior se borra después de actualizar la receta.
recipes.post("/:id/photo", async (c) => {
  const id = c.req.param("id");
  const contentType = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "image/jpeg") {
    return c.json<ApiError>({ error: "La foto debe enviarse como image/jpeg" }, 415);
  }
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > MAX_PHOTO_BYTES) return c.json<ApiError>({ error: "La foto pesa más de 10 MB" }, 413);

  const current = await c.env.DB.prepare("SELECT cover_photo_key FROM recipes WHERE id = ?")
    .bind(id)
    .first<{ cover_photo_key: string | null }>();
  if (!current) return c.json<ApiError>({ error: "Receta no encontrada" }, 404);

  const body = new Uint8Array(await c.req.arrayBuffer());
  if (body.byteLength === 0) return c.json<ApiError>({ error: "La foto está vacía" }, 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return c.json<ApiError>({ error: "La foto pesa más de 10 MB" }, 413);
  // Firma JPEG (FF D8 FF): que el tipo declarado sea el real.
  if (body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
    return c.json<ApiError>({ error: "El archivo no es un JPEG válido" }, 415);
  }

  const key = `recipes/${id}/${Date.now()}.jpg`;
  await c.env.PHOTOS.put(key, body, { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare(
    "UPDATE recipes SET cover_photo_key = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
  )
    .bind(key, id)
    .run();
  if (current.cover_photo_key && current.cover_photo_key !== key) {
    await c.env.PHOTOS.delete(current.cover_photo_key).catch(() => undefined);
  }

  return c.json<PhotoResponse>({ cover_photo_key: key, photo_url: photoUrl(key) }, 201);
});
