import { DINNER_FROM_HOUR } from "./dates";
import type { Slot } from "./recipe-format";

export type Theme = "day" | "night";

/**
 * Regla de tema:
 * - Sistema en modo oscuro: siempre "night".
 * - Pantalla Hoy mostrando una comida: comida "day", cena "night".
 * - Resto: "day" hasta las 17:00 (hora de Madrid) y "night" después.
 */
export function resolveTheme(input: { systemDark: boolean; todaySlot: Slot | null; hour: number }): Theme {
  if (input.systemDark) return "night";
  if (input.todaySlot) return input.todaySlot === "lunch" ? "day" : "night";
  return input.hour < DINNER_FROM_HOUR ? "day" : "night";
}

/** Color de la barra del sistema (meta theme-color) para cada tema. */
export const THEME_COLOR: Record<Theme, string> = { day: "#DDE0E4", night: "#0A0E14" };
