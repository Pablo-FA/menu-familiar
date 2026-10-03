import { PROTEIN_LABEL } from "./balance";
import { QUICK_MINUTES } from "./picker";
import type { Protein, Slot } from "./recipe-format";
import { normalizeText } from "./step-ingredients";

/** Lo que usa la galería de cada receta (subconjunto de GET /api/recipes). */
export interface GalleryRecipe {
  id: string;
  title: string;
  minutes: number;
  protein: Protein;
  suits: "lunch" | "dinner" | "both";
  course: string;
  archived: boolean;
  times_cooked: number;
  last_cooked_at: string | null;
  avg_stars: number | null;
  has_freezer: boolean;
  created_at: string;
  ingredient_names: string[];
}

export type GallerySort = "best" | "recent" | "oldest" | "az";

export const GALLERY_SORTS: GallerySort[] = ["best", "recent", "oldest", "az"];

export const SORT_LABEL: Record<GallerySort, string> = {
  best: "Mejor valoradas",
  recent: "Añadidas hace poco",
  oldest: "Hace más tiempo",
  az: "A–Z",
};

export interface GalleryFilters {
  query: string;
  slot: Slot | null;
  quick: boolean;
  protein: Protein | null;
  unstarted: boolean;
  freezer: boolean;
  /** Panes y guarniciones (course ≠ main). Sin él, solo platos principales. */
  sides: boolean;
  /** Solo las archivadas. Sin él, nunca salen. */
  archived: boolean;
}

export const NO_FILTERS: GalleryFilters = {
  query: "",
  slot: null,
  quick: false,
  protein: null,
  unstarted: false,
  freezer: false,
  sides: false,
  archived: false,
};

export const hasFilters = (f: GalleryFilters) =>
  f.query.trim() !== "" || f.slot !== null || f.quick || f.protein !== null || f.unstarted || f.freezer || f.sides || f.archived;

/**
 * Busca en el título y en los nombres de los ingredientes, sin distinguir tildes ni
 * mayúsculas. Con varias palabras, tienen que estar todas (en cualquiera de los dos).
 */
export function matchesQuery(recipe: Pick<GalleryRecipe, "title" | "ingredient_names">, query: string): boolean {
  const words = normalizeText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeText([recipe.title, ...recipe.ingredient_names].join(" "));
  return words.every((w) => haystack.includes(w));
}

export function filterGallery<T extends GalleryRecipe>(recipes: T[], f: GalleryFilters): T[] {
  return recipes.filter((r) => {
    if (r.archived !== f.archived) return false;
    if (f.sides ? r.course === "main" : r.course !== "main") return false;
    if (f.slot && r.suits !== "both" && r.suits !== f.slot) return false;
    if (f.quick && r.minutes > QUICK_MINUTES) return false;
    if (f.protein && r.protein !== f.protein) return false;
    if (f.unstarted && r.times_cooked > 0) return false;
    if (f.freezer && !r.has_freezer) return false;
    return matchesQuery(r, f.query);
  });
}

const byTitle = (a: GalleryRecipe, b: GalleryRecipe) => a.title.localeCompare(b.title, "es");
const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/**
 * - Mejor valoradas: media de estrellas (sin valorar al final), luego veces cocinada,
 *   luego las añadidas más recientemente.
 * - Añadidas hace poco: created_at descendente.
 * - Hace más tiempo: primero las nunca cocinadas, luego la que se cocinó hace más.
 * - A–Z.
 */
export function sortGallery<T extends GalleryRecipe>(recipes: T[], sort: GallerySort): T[] {
  const list = [...recipes];
  switch (sort) {
    case "best":
      return list.sort(
        (a, b) => (b.avg_stars ?? -1) - (a.avg_stars ?? -1) || b.times_cooked - a.times_cooked || desc(a.created_at, b.created_at) || byTitle(a, b),
      );
    case "recent":
      return list.sort((a, b) => desc(a.created_at, b.created_at) || byTitle(a, b));
    case "oldest":
      return list.sort((a, b) => {
        if (a.last_cooked_at === null || b.last_cooked_at === null) {
          return Number(a.last_cooked_at !== null) - Number(b.last_cooked_at !== null) || byTitle(a, b);
        }
        return a.last_cooked_at.localeCompare(b.last_cooked_at) || byTitle(a, b);
      });
    case "az":
      return list.sort(byTitle);
  }
}

/** "27 recetas · 15 sin estrenar": solo platos principales no archivados. */
export function gallerySubtitle(recipes: GalleryRecipe[]): string {
  const mains = recipes.filter((r) => r.course === "main" && !r.archived);
  const fresh = mains.filter((r) => r.times_cooked === 0).length;
  const total = `${mains.length} ${mains.length === 1 ? "receta" : "recetas"}`;
  return fresh > 0 ? `${total} · ${fresh} sin estrenar` : total;
}

const SLOT_FOR: Record<Slot, string> = { lunch: "para comida", dinner: "para cena" };

/** Título de «sin resultados» que describe los filtros: "Ninguna receta de pescado para comida". */
export function emptyTitle(f: GalleryFilters): string {
  const parts = [f.archived ? "Ninguna receta archivada" : f.sides ? "Ningún pan ni guarnición" : "Ninguna receta"];
  if (f.protein) parts.push(`de ${PROTEIN_LABEL[f.protein].toLowerCase()}`);
  if (f.slot) parts.push(SLOT_FOR[f.slot]);
  if (f.quick) parts.push(`de ≤ ${QUICK_MINUTES} min`);
  if (f.unstarted) parts.push("sin estrenar");
  if (f.freezer) parts.push("para congelar");
  if (f.query.trim()) parts.push(`con «${f.query.trim()}»`);
  return parts.join(" ");
}

/** Petición de «Pedir ideas a Claude» cuando el recetario anda corto de una proteína. */
export function ideasRequestText(protein: Protein, slot: Slot | null, titles: string[]): string {
  const what = PROTEIN_LABEL[protein].toLowerCase();
  const when = slot ? ` ${SLOT_FOR[slot]}` : "";
  return [
    `Mi recetario de Menú familiar anda corto de recetas de ${what}${when}. Propónme 3 recetas nuevas que encajen con la familia y las reglas de casa, distintas de las que ya tengo.`,
    "Devuélvemelas en formato menu-familiar/recipe@1, cada una en su propio bloque ```json, para poder copiarlas de una en una.",
    "",
    "Recetas que ya tengo:",
    ...titles.map((t) => `- ${t}`),
  ].join("\n");
}
