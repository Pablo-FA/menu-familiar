import type { Protein } from "./recipe-format";

/** Orden de las columnas del equilibrio semanal. */
export const BALANCE_ORDER: Protein[] = ["verdura", "legumbre", "huevo", "pescado", "ave", "carne"];

export const PROTEIN_LABEL: Record<Protein, string> = {
  verdura: "Verdura",
  legumbre: "Legumbre",
  huevo: "Huevo",
  pescado: "Pescado",
  ave: "Ave",
  carne: "Carne",
};

/**
 * Mínimos semanales de raciones (comidas + cenas), según las recomendaciones de la
 * AESAN para población adulta: legumbres al menos 4 veces por semana y pescado al menos 3.
 * Único sitio donde se definen.
 */
export const WEEKLY_MINIMUMS: Partial<Record<Protein, number>> = { legumbre: 4, pescado: 3 };

export type BalanceTone = "below" | "zero" | "ok";

export interface BalanceItem {
  protein: Protein;
  count: number;
  minimum: number | null;
  tone: BalanceTone;
}

/** Cuenta las franjas planificadas con receta por proteína. */
export function weekBalance(slots: { status: string; protein: Protein | null }[]): BalanceItem[] {
  const counts = new Map<Protein, number>();
  for (const slot of slots) {
    if (slot.status === "planned" && slot.protein) counts.set(slot.protein, (counts.get(slot.protein) ?? 0) + 1);
  }
  return BALANCE_ORDER.map((protein) => {
    const count = counts.get(protein) ?? 0;
    const minimum = WEEKLY_MINIMUMS[protein] ?? null;
    const tone: BalanceTone = minimum !== null && count < minimum ? "below" : count === 0 ? "zero" : "ok";
    return { protein, count, minimum, tone };
  });
}
