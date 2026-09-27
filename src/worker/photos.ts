import { Hono } from "hono";
import type { AppEnv } from "./env";

/** URL pública (dentro de la app, detrás de Access) de un objeto de R2. */
export function photoUrl(key: string): string {
  return `/api/photos/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export const photos = new Hono<AppEnv>();

// Las claves de foto no se reutilizan (una foto nueva lleva una clave nueva), así que
// la respuesta se puede cachear para siempre en el navegador.
photos.get("/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/photos\//, ""));
  if (!key || key.startsWith("_health/")) return c.json({ error: "Foto no encontrada" }, 404);

  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.json({ error: "Foto no encontrada" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});
