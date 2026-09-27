import { addDays, madridNow } from "./dates";
import { currentSlot, slotKey } from "./meals";
import type { Slot } from "./recipe-format";

/** Días durante los que se sigue preguntando por una comida sin valorar. */
export const RATING_WINDOW_DAYS = 2;

export interface PastMeal {
  date: string;
  slot: Slot;
  recipe_id: string;
  /** Última vez que se pospuso el aviso de esta comida (ISO UTC), o null. */
  rating_skipped_at: string | null;
  has_cook_log: boolean;
}

/**
 * Regla del aviso "¿qué tal estuvo?".
 *
 * @param meals comidas planificadas con receta de los últimos días (valoradas o no).
 * @param lastPromptActionAt última vez (ISO UTC) que se respondió a un aviso: se pospuso
 *   o se guardó una valoración de una comida planificada. null si nunca.
 *
 * - Se mira solo la comida planificada MÁS RECIENTE que ya haya pasado. Antes de las
 *   17:00 la franja actual es la comida de hoy, así que lo último pasado es la cena de
 *   ayer; desde las 17:00 lo es la comida de hoy. No se retrocede a comidas anteriores.
 * - Si ya tiene valoración (cook_log), no se pregunta.
 * - Si tiene más de RATING_WINDOW_DAYS días, no se pregunta ("si en 2 días no se ha
 *   valorado, no vuelve a preguntar").
 * - Como mucho una vez al día: si hoy ya se pospuso o guardó un aviso, no se pregunta.
 *   Posponer, por tanto, aplaza el aviso a la primera apertura del día siguiente.
 */
export function pickRatingPrompt(meals: PastMeal[], lastPromptActionAt: string | null, now: Date): PastMeal | null {
  const { date: today, hour } = madridNow(now);
  if (lastPromptActionAt && madridNow(new Date(lastPromptActionAt)).date === today) return null;

  const currentKey = slotKey(today, currentSlot(hour));
  const past = meals
    .filter((m) => slotKey(m.date, m.slot) < currentKey)
    .sort((a, b) => (slotKey(a.date, a.slot) < slotKey(b.date, b.slot) ? 1 : -1));
  const latest = past[0];

  if (!latest || latest.has_cook_log) return null;
  if (latest.date < addDays(today, -RATING_WINDOW_DAYS)) return null;
  return latest;
}
