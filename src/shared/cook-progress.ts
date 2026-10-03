import type { CookTimer } from "./timers";

/** Pasado este tiempo, el progreso guardado se descarta y se empieza de cero. */
export const PROGRESS_TTL_MS = 12 * 60 * 60 * 1000;

export interface CookProgress {
  /** Índice del paso actual (0…n-1). */
  step: number;
  /** Posiciones de los ingredientes marcados como preparados. */
  checked: number[];
  timers: CookTimer[];
  /** true si se pulsó "Terminar" y se está en la pantalla final. */
  finished: boolean;
  savedAt: number;
}

export function progressKey(date: string, slot: string): string {
  return `cocina:${date}:${slot}`;
}

/** «Cocinar ahora» (sin comida del plan). */
export function recipeProgressKey(recipeId: string): string {
  return `cocina:receta:${recipeId}`;
}

export function emptyProgress(now: number): CookProgress {
  return { step: 0, checked: [], timers: [], finished: false, savedAt: now };
}

/** Interpreta lo guardado; null si no hay, está corrupto o tiene más de 12 h. */
export function parseProgress(raw: string | null, now: number): CookProgress | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<CookProgress>;
    if (typeof data.savedAt !== "number" || now - data.savedAt > PROGRESS_TTL_MS) return null;
    return {
      step: typeof data.step === "number" && data.step >= 0 ? Math.floor(data.step) : 0,
      checked: Array.isArray(data.checked) ? data.checked.filter((n) => typeof n === "number") : [],
      timers: Array.isArray(data.timers) ? data.timers : [],
      finished: data.finished === true,
      savedAt: data.savedAt,
    };
  } catch {
    return null;
  }
}
