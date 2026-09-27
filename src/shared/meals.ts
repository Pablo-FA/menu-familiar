import { DINNER_FROM_HOUR, addDays } from "./dates";
import type { Slot } from "./recipe-format";

export const MEAL_STATUSES = ["planned", "away", "empty"] as const;
export type MealStatus = (typeof MEAL_STATUSES)[number];

/** Franja "actual" según la hora local: antes de las 17:00 la comida, después la cena. */
export function currentSlot(hour: number): Slot {
  return hour < DINNER_FROM_HOUR ? "lunch" : "dinner";
}

export function otherSlot(slot: Slot): Slot {
  return slot === "lunch" ? "dinner" : "lunch";
}

/**
 * Qué comida enseña Hoy al abrir: la de la franja actual; si esa no tiene receta
 * (fuera de casa o vacía) y la otra sí, la otra; si ninguna tiene receta, null.
 */
export function pickSlotToShow(hour: number, hasRecipe: Record<Slot, boolean>): Slot | null {
  const preferred = currentSlot(hour);
  if (hasRecipe[preferred]) return preferred;
  const other = otherSlot(preferred);
  return hasRecipe[other] ? other : null;
}

/** Orden total de franjas: permite comparar (fecha, franja). */
export function slotKey(date: string, slot: Slot): string {
  return `${date}#${slot === "lunch" ? 0 : 1}`;
}

/** Hora nominal (UTC) con la que se guarda cooked_at cuando se valora una comida planificada. */
export function nominalCookedAt(date: string, slot: Slot): string {
  // ≈ 14:00 y 21:00 en Madrid en horario de verano.
  return `${date}T${slot === "lunch" ? "12" : "19"}:00:00.000Z`;
}

/** Texto para el aviso de valoración: "Anoche cenasteis", "Hoy comisteis", "El jueves comisteis"… */
export function pastMealLabel(date: string, slot: Slot, today: string, weekday: (date: string) => string): string {
  const verb = slot === "lunch" ? "comisteis" : "cenasteis";
  if (date === today) return `Hoy ${verb}`;
  if (date === addDays(today, -1)) return slot === "dinner" ? "Anoche cenasteis" : "Ayer comisteis";
  return `El ${weekday(date)} ${verb}`;
}
