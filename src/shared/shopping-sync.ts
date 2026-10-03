import type { ItemStatus } from "./shopping";

/**
 * Operaciones sobre las líneas de la lista. El móvil las aplica al momento, las guarda
 * en una cola persistente y las envía en orden a POST /api/shopping/ops. El servidor
 * resuelve por línea y por campo: gana la escritura con el instante (`at`) más reciente.
 */

export interface PatchFields {
  bought?: boolean;
  status?: ItemStatus;
  aisle?: string;
  quantity_text?: string | null;
}

export interface CreateFields {
  name: string;
  quantity_text: string | null;
  aisle: string;
  ingredient_id: string | null;
}

/** item_id: el id numérico, o el client_id de una línea creada en el móvil. */
export type ShoppingOp =
  | { id: string; item_id: number | string; op: "patch"; fields: PatchFields; at: string }
  | { id: string; item_id: string; op: "create"; fields: CreateFields; at: string }
  | { id: string; item_id: number | string; op: "delete"; fields: Record<string, never>; at: string };

export const PATCH_FIELDS = ["bought", "status", "aisle", "quantity_text"] as const;
export type PatchField = (typeof PATCH_FIELDS)[number];

/**
 * Campos de `fields` que ganan a lo guardado: los que no tienen marca o la tienen
 * anterior a `at`. Con el mismo instante gana lo guardado (repetir una operación no
 * cambia nada).
 */
export function winningFields(fields: PatchFields, at: string, fieldUpdatedAt: Partial<Record<PatchField, string>>): PatchFields {
  const out: PatchFields = {};
  for (const field of PATCH_FIELDS) {
    if (!(field in fields)) continue;
    const stored = fieldUpdatedAt[field];
    if (stored !== undefined && stored >= at) continue;
    (out as Record<string, unknown>)[field] = fields[field];
  }
  return out;
}

/** Línea tal y como la ve el móvil (id null hasta que el servidor la crea). */
export interface SyncItem {
  id: number | null;
  client_id: string | null;
  ingredient_id: string | null;
  name: string;
  quantity_text: string | null;
  aisle: string;
  pantry: boolean;
  status: ItemStatus;
  bought: boolean;
  manual: boolean;
}

export const opTargets = (item: Pick<SyncItem, "id" | "client_id">, target: number | string) =>
  (item.id !== null && item.id === target) || (item.client_id !== null && item.client_id === target);

/** Aplica operaciones en orden sobre una copia de las líneas (las de líneas que no existen se ignoran). */
export function applyOps<T extends SyncItem>(items: T[], ops: ShoppingOp[], makeItem: (op: Extract<ShoppingOp, { op: "create" }>) => T): T[] {
  let list = [...items];
  for (const op of ops) {
    if (op.op === "create") {
      if (!list.some((i) => opTargets(i, op.item_id))) list.push(makeItem(op));
    } else if (op.op === "delete") {
      list = list.filter((i) => !opTargets(i, op.item_id));
    } else {
      list = list.map((i) => (opTargets(i, op.item_id) ? { ...i, ...op.fields } : i));
    }
  }
  return list;
}

/** Espera antes del reintento n (0, 1, 2…): 2 s, 4 s, 8 s… hasta 2 min. */
export function retryDelay(attempt: number): number {
  return Math.min(120_000, 2000 * 2 ** attempt);
}
