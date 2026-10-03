import type { Slot, Unit } from "./recipe-format";
import { dayTitle } from "./week";

/**
 * Reglas de la lista de la compra, sin base de datos: suma de cantidades, estado
 * inicial, arrastre de la lista anterior, cambios del menú y la cola sin conexión.
 */

export type ItemStatus = "review" | "buy" | "home";

// ---------- Cantidades ----------

export interface QuantityPart {
  quantity: number | null;
  unit: Unit | null;
  estimated: boolean;
}

type Family = "ud" | "g" | "ml" | "cda" | "cdta" | "pizca";

/** Orden en que se escriben las familias ("2 ud + 200 g"). */
const FAMILY_ORDER: Family[] = ["ud", "g", "ml", "cda", "cdta", "pizca"];

const TO_FAMILY: Record<Unit, { family: Family; factor: number }> = {
  g: { family: "g", factor: 1 },
  kg: { family: "g", factor: 1000 },
  ml: { family: "ml", factor: 1 },
  l: { family: "ml", factor: 1000 },
  ud: { family: "ud", factor: 1 },
  cda: { family: "cda", factor: 1 },
  cdta: { family: "cdta", factor: 1 },
  pizca: { family: "pizca", factor: 1 },
};

const int = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: false });
const oneDecimal = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, useGrouping: false });
const twoDecimals = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, useGrouping: false });

function formatFamily(family: Family, total: number): string {
  switch (family) {
    case "g":
      return Math.round(total) >= 1000 ? `${oneDecimal.format(total / 1000)} kg` : `${int.format(Math.round(total))} g`;
    case "ml":
      return Math.round(total) >= 1000 ? `${oneDecimal.format(total / 1000)} l` : `${int.format(Math.round(total))} ml`;
    case "ud":
      // Se compra entero: 2,5 huevos son 3.
      return `${Math.ceil(total - 1e-9)} ud`;
    default:
      return `${twoDecimals.format(total)} ${family}`;
  }
}

/**
 * Suma las cantidades de un ingrediente: g y kg en gramos, ml y l en mililitros, ud
 * redondeado hacia arriba, cda/cdta/pizca cada una por su lado y las familias que no
 * se pueden sumar unidas con " + ". Las cantidades null no suman; si todas lo son, no
 * hay cantidad (null). "≈ " delante si alguna parte es estimada.
 */
export function sumQuantities(parts: QuantityPart[]): string | null {
  const totals = new Map<Family, number>();
  let estimated = false;
  for (const p of parts) {
    if (p.quantity === null || p.unit === null) continue;
    const { family, factor } = TO_FAMILY[p.unit];
    totals.set(family, (totals.get(family) ?? 0) + p.quantity * factor);
    if (p.estimated) estimated = true;
  }
  if (totals.size === 0) return null;
  const text = FAMILY_ORDER.filter((f) => totals.has(f))
    .map((f) => formatFamily(f, totals.get(f) ?? 0))
    .join(" + ");
  return estimated ? `≈ ${text}` : text;
}

// ---------- Generación ----------

/** Una línea de ingrediente de una receta planificada (ya con los datos del catálogo). */
export interface NeedLine extends QuantityPart {
  ingredient_id: string;
  name: string;
  aisle: string;
  pantry: boolean;
}

export interface GeneratedItem {
  ingredient_id: string;
  name: string;
  aisle: string;
  pantry: boolean;
  quantity_text: string | null;
  status: ItemStatus;
}

/** Sin despensa → comprar. De despensa con cantidad → revisar en casa. Sin cantidad → en casa. */
export function initialStatus(pantry: boolean, quantityText: string | null): ItemStatus {
  if (!pantry) return "buy";
  return quantityText !== null ? "review" : "home";
}

export function capitalizeName(name: string): string {
  return name.charAt(0).toLocaleUpperCase("es-ES") + name.slice(1);
}

/** Ingredientes que nunca se compran aunque la receta dé cantidad (el agua del grifo). */
export const ALWAYS_HOME = new Set(["agua"]);

/** Agrupa las líneas por ingrediente y suma (sin escalar: las recetas ya son para 4). */
export function aggregateNeeds(lines: NeedLine[]): GeneratedItem[] {
  const groups = new Map<string, NeedLine[]>();
  for (const line of lines) {
    const group = groups.get(line.ingredient_id);
    if (group) group.push(line);
    else groups.set(line.ingredient_id, [line]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as NeedLine;
    const quantity_text = sumQuantities(group);
    return {
      ingredient_id: first.ingredient_id,
      name: capitalizeName(first.name),
      aisle: first.aisle,
      pantry: first.pantry,
      quantity_text,
      status: ALWAYS_HOME.has(first.ingredient_id) ? "home" : initialStatus(first.pantry, quantity_text),
    };
  });
}

/** Línea guardada en una lista (lo que necesitan las reglas). */
export interface StoredItem {
  id: number;
  ingredient_id: string | null;
  name: string;
  quantity_text: string | null;
  aisle: string;
  pantry: boolean;
  status: ItemStatus;
  bought: boolean;
  manual: boolean;
  carried: boolean;
}

/** Pendiente de comprar: se pasa a la lista nueva si se pide. */
export const isPendingBuy = (item: Pick<StoredItem, "status" | "bought">) => item.status === "buy" && !item.bought;

export interface CarriedItem {
  ingredient_id: string | null;
  name: string;
  quantity_text: string | null;
  aisle: string;
  pantry: boolean;
  manual: boolean;
}

/**
 * Lo que se pasa de la lista anterior: lo pendiente de comprar. Las líneas de recetas
 * no se duplican si su ingrediente ya está en la nueva; las añadidas a mano se copian
 * tal cual (la cantidad la puso Pablo y no se puede sumar con la de las recetas).
 */
export function carryOver(previous: StoredItem[], generated: GeneratedItem[]): CarriedItem[] {
  const inNew = new Set(generated.map((g) => g.ingredient_id));
  return previous
    .filter(isPendingBuy)
    .filter((item) => item.manual || item.ingredient_id === null || !inNew.has(item.ingredient_id))
    .map((item) => ({
      ingredient_id: item.ingredient_id,
      name: item.name,
      quantity_text: item.quantity_text,
      aisle: item.aisle,
      pantry: item.pantry,
      manual: item.manual,
    }));
}

// ---------- Cambios del menú ----------

export interface SnapshotMeal {
  date: string;
  slot: Slot;
  recipe_id: string;
}

export interface MealRef {
  date: string;
  slot: Slot;
}

export type MenuChange =
  | { kind: "added"; date: string; slot: Slot; recipe_id: string }
  | { kind: "removed"; date: string; slot: Slot; recipe_id: string }
  | { kind: "changed"; date: string; slot: Slot; recipe_id: string; previous_recipe_id: string };

const mealKey = (m: MealRef) => `${m.date}#${m.slot}`;
const SLOT_RANK: Record<Slot, number> = { lunch: 0, dinner: 1 };
const byMeal = (a: MealRef, b: MealRef) => (a.date === b.date ? SLOT_RANK[a.slot] - SLOT_RANK[b.slot] : a.date < b.date ? -1 : 1);

/** Comidas que cubre una lista: las planificadas con receta menos las desmarcadas. */
export function coveredMeals(planned: SnapshotMeal[], excluded: MealRef[]): SnapshotMeal[] {
  const skip = new Set(excluded.map(mealKey));
  return planned.filter((m) => !skip.has(mealKey(m))).sort(byMeal);
}

/** Diferencias entre las comidas con las que se hizo la lista y las de ahora, por fecha. */
export function menuChanges(snapshot: SnapshotMeal[], current: SnapshotMeal[]): MenuChange[] {
  const before = new Map(snapshot.map((m) => [mealKey(m), m]));
  const now = new Map(current.map((m) => [mealKey(m), m]));
  const changes: MenuChange[] = [];
  for (const [key, m] of now) {
    const old = before.get(key);
    if (!old) changes.push({ kind: "added", date: m.date, slot: m.slot, recipe_id: m.recipe_id });
    else if (old.recipe_id !== m.recipe_id)
      changes.push({ kind: "changed", date: m.date, slot: m.slot, recipe_id: m.recipe_id, previous_recipe_id: old.recipe_id });
  }
  for (const [key, m] of before) {
    if (!now.has(key)) changes.push({ kind: "removed", date: m.date, slot: m.slot, recipe_id: m.recipe_id });
  }
  return changes.sort(byMeal);
}

export interface ListUpdate {
  add: GeneratedItem[];
  /** Líneas existentes cuya cantidad cambia (se respeta el estado que eligió Pablo). */
  requantify: { id: number; quantity_text: string | null }[];
  remove: number[];
}

/**
 * Cómo se actualiza una lista con el menú nuevo:
 * - ingredientes nuevos: se añaden con su estado inicial;
 * - los que siguen y no están comprados: cantidad nueva, mismo estado;
 * - los que ya no hacen falta: se quitan, salvo comprados, añadidos a mano o pasados
 *   de la lista anterior;
 * - lo comprado y lo añadido a mano no se toca.
 */
export function planListUpdate(items: StoredItem[], needed: GeneratedItem[]): ListUpdate {
  const fromRecipes = new Map<string, StoredItem>();
  for (const item of items) {
    if (!item.manual && item.ingredient_id !== null) fromRecipes.set(item.ingredient_id, item);
  }
  const neededIds = new Set(needed.map((n) => n.ingredient_id));
  const update: ListUpdate = { add: [], requantify: [], remove: [] };
  for (const need of needed) {
    const item = fromRecipes.get(need.ingredient_id);
    if (!item) update.add.push(need);
    else if (!item.bought && item.quantity_text !== need.quantity_text) update.requantify.push({ id: item.id, quantity_text: need.quantity_text });
  }
  for (const item of fromRecipes.values()) {
    if (item.ingredient_id !== null && !neededIds.has(item.ingredient_id) && !item.bought && !item.carried) update.remove.push(item.id);
  }
  return update;
}

const SLOT_WORD: Record<Slot, string> = { lunch: "comida", dinner: "cena" };

/**
 * Resumen de los cambios para la tarjeta «El menú ha cambiado»: el primero en una frase
 * ("Sábado 10, cena: Pollo al limón en lugar de Piadinas rellenas y 2 cambios más.").
 */
export function describeChanges(changes: MenuChange[], titleOf: (recipeId: string) => string): { count: number; first: string } | null {
  const first = changes[0];
  if (!first) return null;
  const where = `${dayTitle(first.date)}, ${SLOT_WORD[first.slot]}`;
  const what =
    first.kind === "changed"
      ? `${titleOf(first.recipe_id)} en lugar de ${titleOf(first.previous_recipe_id)}`
      : first.kind === "added"
        ? `se ha añadido ${titleOf(first.recipe_id)}`
        : `ya no está ${titleOf(first.recipe_id)}`;
  const more = changes.length - 1;
  const tail = more === 0 ? "" : more === 1 ? " y 1 cambio más" : ` y ${more} cambios más`;
  return { count: changes.length, first: `${where}: ${what}${tail}.` };
}
