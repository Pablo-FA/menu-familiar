/**
 * Convierte un nombre en un identificador estable: minúsculas, sin tildes ni
 * diacríticos (la ñ pasa a n), y cualquier otro carácter se sustituye por guiones.
 *   "Pechuga de Pollo" -> "pechuga-de-pollo"
 *   "Jamón  serrano"   -> "jamon-serrano"
 */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
