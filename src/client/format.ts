import type { RecipeIngredient } from "../shared/api";

const number = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/** "600 g", "2", "1 cda", "≈ 50 g" (estimada). Vacío si no hay cantidad. */
export function formatQuantity(ing: Pick<RecipeIngredient, "quantity" | "unit" | "estimated">): string {
  if (ing.quantity === null) return "";
  const value = number.format(ing.quantity);
  const text = !ing.unit || ing.unit === "ud" ? value : `${value} ${ing.unit}`;
  return ing.estimated ? `≈ ${text}` : text;
}

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-ES") + text.slice(1);
}

export function minutesLabel(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}
