import { addDays } from "./dates";
import type { Protein, Slot } from "./recipe-format";
import { normalizeText } from "./step-ingredients";

/** Datos de receta que usa el selector (subconjunto de GET /api/recipes). */
export interface PickerRecipe {
  id: string;
  title: string;
  minutes: number;
  protein: Protein;
  suits: "lunch" | "dinner" | "both";
  course: string;
  archived: boolean;
  last_cooked: string | null;
  avg_stars: number | null;
}

export type PickerSort = "oldest" | "best" | "fastest";

export const QUICK_MINUTES = 45;

export interface PickerFilters {
  slot: Slot;
  query: string;
  quick: boolean;
  protein: Protein | null;
  /** Incluir también las recetas pensadas para la otra franja. */
  includeOther: boolean;
  sort: PickerSort;
}

/** Recetas que se pueden planificar en esa franja (sin aplicar búsqueda ni filtros). */
export function eligibleForSlot(recipe: PickerRecipe, slot: Slot, includeOther: boolean): boolean {
  if (recipe.course !== "main" || recipe.archived) return false;
  return includeOther || recipe.suits === "both" || recipe.suits === slot;
}

export function filterAndSort<T extends PickerRecipe>(recipes: T[], f: PickerFilters): T[] {
  const query = normalizeText(f.query);
  const list = recipes.filter(
    (r) =>
      eligibleForSlot(r, f.slot, f.includeOther) &&
      (!query || normalizeText(r.title).includes(query)) &&
      (!f.quick || r.minutes <= QUICK_MINUTES) &&
      (!f.protein || r.protein === f.protein),
  );
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title, "es");
  const compare: Record<PickerSort, (a: T, b: T) => number> = {
    // Primero las nunca cocinadas; luego la que hace más tiempo que no se hace.
    oldest: (a, b) => {
      if (a.last_cooked === b.last_cooked) return byTitle(a, b);
      if (a.last_cooked === null) return -1;
      if (b.last_cooked === null) return 1;
      return a.last_cooked < b.last_cooked ? -1 : 1;
    },
    best: (a, b) => (b.avg_stars ?? -1) - (a.avg_stars ?? -1) || byTitle(a, b),
    fastest: (a, b) => a.minutes - b.minutes || byTitle(a, b),
  };
  return list.sort(compare[f.sort]);
}

/** "Hecha hoy", "Hecha ayer", "Hecha hace 6 días", "Hecha hace 3 semanas", "Sin estrenar". */
export function lastCookedLabel(lastCooked: string | null, today: string): string {
  if (!lastCooked) return "Sin estrenar";
  if (lastCooked >= today) return "Hecha hoy";
  if (lastCooked === addDays(today, -1)) return "Hecha ayer";
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastCooked}T12:00:00Z`)) / 86_400_000);
  if (days < 14) return `Hecha hace ${days} días`;
  return `Hecha hace ${Math.floor(days / 7)} semanas`;
}

/** "4,5" */
export function formatStars(avg: number): string {
  return avg.toLocaleString("es-ES", { maximumFractionDigits: 1 });
}

/** "lunes", "lunes y jueves", "lunes, martes y jueves". */
export function joinDays(days: string[]): string {
  if (days.length <= 1) return days[0] ?? "";
  return `${days.slice(0, -1).join(", ")} y ${days[days.length - 1]}`;
}
