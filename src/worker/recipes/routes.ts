import { Hono } from "hono";
import { z } from "zod";
import { importAisle } from "../../shared/aisles";
import type { ApiError, ImportResponse, PhotoResponse, RecipePreviewResponse } from "../../shared/api";
import { exportRecipe } from "../../shared/recipe-export";
import { parseRecipeImport } from "../../shared/recipe-format";
import { slugify } from "../../shared/slug";
import type { AppEnv } from "../env";
import { photoUrl } from "../photos";
import { importRecipe, prepareRecipeWrites, recipeExists } from "./import";
import { getRecipe, listRecipes } from "./queries";

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

export const recipes = new Hono<AppEnv>();

recipes.post("/import", async (c) => {
  const read = await readJson(c.req.raw);
  if (!read.ok) return c.json<ApiError>({ error: "El cuerpo de la petición no es JSON válido" }, 400);

  const parsed = parseRecipeImport(read.body);
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

// POST /api/recipes/preview — qué pasaría al importar la receta, sin escribir nada.
recipes.post("/preview", async (c) => {
  const read = await readJson(c.req.raw);
  const empty: RecipePreviewResponse = {
    summary: null,
    ingredients_count: 0,
    steps_count: 0,
    timers_count: 0,
    new_ingredients: [],
    exists: false,
    errors: [],
  };
  if (!read.ok) return c.json<RecipePreviewResponse>({ ...empty, errors: [{ field: "", message: "No es JSON válido" }] });
  const parsed = parseRecipeImport(read.body);
  if (!parsed.ok) return c.json<RecipePreviewResponse>({ ...empty, errors: parsed.errors });

  const recipe = parsed.recipe;
  const db = c.env.DB;
  const existing = await db.prepare("SELECT cover_photo_key FROM recipes WHERE id = ?").bind(recipe.id).first<{ cover_photo_key: string | null }>();
  // Ingredientes que se crearían: uno por slug, con la sección que tendrán.
  const bySlug = new Map<string, { name: string; aisle: string }>();
  for (const ing of recipe.ingredients) {
    const slug = slugify(ing.name);
    if (!bySlug.has(slug)) bySlug.set(slug, { name: ing.name, aisle: ing.aisle });
  }
  const { results: known } = await db
    .prepare("SELECT id FROM ingredients WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify([...bySlug.keys()]))
    .all<{ id: string }>();
  const knownIds = new Set(known.map((k) => k.id));

  return c.json<RecipePreviewResponse>({
    summary: {
      id: recipe.id,
      title: recipe.title,
      minutes: recipe.minutes,
      protein: recipe.protein,
      suits: recipe.suits,
      course: recipe.course,
      kcal_adult: recipe.kcal_adult,
      kcal_estimated: recipe.kcal_estimated,
      adaptation_notes: recipe.adaptation_notes,
      photo_url: existing?.cover_photo_key ? photoUrl(existing.cover_photo_key) : null,
    },
    ingredients_count: recipe.ingredients.length,
    steps_count: recipe.steps.length,
    timers_count: recipe.steps.filter((s) => s.timer_seconds !== null).length,
    new_ingredients: [...bySlug]
      .filter(([slug]) => !knownIds.has(slug))
      .map(([slug, ing]) => ({ name: ing.name, aisle: importAisle(slug, ing.aisle) })),
    exists: existing !== null,
    errors: [],
  });
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

// PUT /api/recipes/:id — sustitución completa desde el editor (recipe@1 con el mismo id).
// Mismo lote atómico que importar con replace: se conservan foto, archived y cook_logs.
recipes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const read = await readJson(c.req.raw);
  if (!read.ok) return c.json<ApiError>({ error: "El cuerpo de la petición no es JSON válido" }, 400);
  const parsed = parseRecipeImport(read.body);
  if (!parsed.ok) return c.json<ApiError>({ error: "La receta no es válida", errors: parsed.errors }, 400);
  if (parsed.recipe.id !== id) {
    return c.json<ApiError>({ error: "El id de la receta no coincide", errors: [{ field: "id", message: `Debe ser "${id}"` }] }, 400);
  }
  if (!(await recipeExists(c.env.DB, id))) return c.json<ApiError>({ error: "Receta no encontrada" }, 404);
  const { statements, createdIngredients } = await prepareRecipeWrites(c.env.DB, parsed.recipe, { replace: true });
  await c.env.DB.batch(statements);
  return c.json<ImportResponse>({ id, replaced: true, created_ingredients: createdIngredients });
});

const patchSchema = z.strictObject({ archived: z.boolean() });

// PATCH /api/recipes/:id — archivar o recuperar. No cambia updated_at (no es la receta en sí).
recipes.patch("/:id", async (c) => {
  const read = await readJson(c.req.raw);
  const parsed = patchSchema.safeParse(read.ok ? read.body : undefined);
  if (!parsed.success) return c.json<ApiError>({ error: "Solo se puede cambiar archived (true o false)" }, 400);
  const res = await c.env.DB.prepare("UPDATE recipes SET archived = ? WHERE id = ?")
    .bind(parsed.data.archived ? 1 : 0, c.req.param("id"))
    .run();
  if (res.meta.changes === 0) return c.json<ApiError>({ error: "Receta no encontrada" }, 404);
  return c.json({ id: c.req.param("id"), archived: parsed.data.archived });
});

// GET /api/recipes/:id/export — la receta en recipe@1 (lo que se copia para Claude).
recipes.get("/:id/export", async (c) => {
  const recipe = await getRecipe(c.env.DB, c.req.param("id"));
  if (!recipe) return c.json<ApiError>({ error: "Receta no encontrada" }, 404);
  return c.json(exportRecipe(recipe));
});

/** Tamaño máximo de una foto de portada (ya redimensionada en el cliente). */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// POST /api/recipes/:id/photo — cuerpo: el JPEG en bruto (Content-Type: image/jpeg).
// Se guarda con una clave nueva (recipes/{id}/{timestamp}.jpg), así la URL se puede
// cachear para siempre; la foto anterior se borra después de actualizar la receta.
recipes.post("/:id/photo", async (c) => {
  const id = c.req.param("id");

  const current = await c.env.DB.prepare("SELECT cover_photo_key, cover_thumb_key FROM recipes WHERE id = ?")
    .bind(id)
    .first<{ cover_photo_key: string | null; cover_thumb_key: string | null }>();
  if (!current) return c.json<ApiError>({ error: "Receta no encontrada" }, 404);

  const body = await readJpeg(c.req.raw, MAX_PHOTO_BYTES);
  if ("error" in body) return c.json<ApiError>({ error: body.error }, body.status);

  const key = `recipes/${id}/${Date.now()}.jpg`;
  await c.env.PHOTOS.put(key, body.bytes, { httpMetadata: { contentType: "image/jpeg" } });
  // Sin tocar updated_at: la foto no cambia la receta (ni la lista de la compra).
  // La miniatura anterior deja de valer; el móvil sube la nueva justo después.
  await c.env.DB.prepare("UPDATE recipes SET cover_photo_key = ?, cover_thumb_key = NULL WHERE id = ?").bind(key, id).run();
  for (const old of [current.cover_photo_key, current.cover_thumb_key]) {
    if (old && old !== key) await c.env.PHOTOS.delete(old).catch(() => undefined);
  }

  return c.json<PhotoResponse>({ cover_photo_key: key, photo_url: photoUrl(key) }, 201);
});

/** Tamaño máximo de una miniatura (480 px). */
export const MAX_THUMB_BYTES = 1024 * 1024;

// POST /api/recipes/:id/photo/thumb — miniatura de la portada actual (JPEG en bruto).
// Se guarda junto a la portada ({clave}.thumb.jpg); si la portada ha cambiado entre
// medias, se rechaza para no mezclar fotos.
recipes.post("/:id/photo/thumb", async (c) => {
  const id = c.req.param("id");
  const expected = c.req.query("cover");
  const current = await c.env.DB.prepare("SELECT cover_photo_key, cover_thumb_key FROM recipes WHERE id = ?")
    .bind(id)
    .first<{ cover_photo_key: string | null; cover_thumb_key: string | null }>();
  if (!current) return c.json<ApiError>({ error: "Receta no encontrada" }, 404);
  if (!current.cover_photo_key || (expected && expected !== current.cover_photo_key)) {
    return c.json<ApiError>({ error: "La portada ha cambiado" }, 409);
  }
  const body = await readJpeg(c.req.raw, MAX_THUMB_BYTES);
  if ("error" in body) return c.json<ApiError>({ error: body.error }, body.status);
  const key = current.cover_photo_key.replace(/\.jpg$/, "") + ".thumb.jpg";
  await c.env.PHOTOS.put(key, body.bytes, { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare("UPDATE recipes SET cover_thumb_key = ? WHERE id = ?").bind(key, id).run();
  if (current.cover_thumb_key && current.cover_thumb_key !== key) await c.env.PHOTOS.delete(current.cover_thumb_key).catch(() => undefined);
  return c.json({ thumb_url: photoUrl(key) }, 201);
});

/** Lee un JPEG del cuerpo: tipo declarado, tamaño y firma (FF D8 FF). */
async function readJpeg(req: Request, max: number): Promise<{ bytes: Uint8Array } | { error: string; status: 400 | 413 | 415 }> {
  const contentType = req.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "image/jpeg") return { error: "La foto debe enviarse como image/jpeg", status: 415 };
  const limit = `La foto pesa más de ${Math.round(max / 1024 / 1024)} MB`;
  if (Number(req.headers.get("Content-Length") ?? "0") > max) return { error: limit, status: 413 };
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return { error: "La foto está vacía", status: 400 };
  if (bytes.byteLength > max) return { error: limit, status: 413 };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { error: "El archivo no es un JPEG válido", status: 415 };
  return { bytes };
}
