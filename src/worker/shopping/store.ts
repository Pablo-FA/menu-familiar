import { isAisle } from "../../shared/aisles";
import type { ShoppingItem, ShoppingListResponse } from "../../shared/api";
import type { Slot, Unit } from "../../shared/recipe-format";
import {
  aggregateNeeds,
  coveredMeals,
  describeChanges,
  menuChanges,
  type GeneratedItem,
  type MealRef,
  type NeedLine,
  type SnapshotMeal,
  type StoredItem,
} from "../../shared/shopping";
import { winningFields, type PatchField, type ShoppingOp } from "../../shared/shopping-sync";

export interface ListRow {
  id: number;
  from_date: string;
  to_date: string;
  meals_count: number;
  meals_snapshot: string;
  excluded: string;
}

interface ItemRow {
  id: number;
  client_id: string | null;
  ingredient_id: string | null;
  name: string;
  quantity_text: string | null;
  aisle: string;
  pantry: number;
  status: ShoppingItem["status"];
  bought: number;
  manual: number;
  carried: number;
  field_updated_at: string;
  updated_at: string | null;
}

export const ACTIVE_LIST = "SELECT id FROM shopping_lists ORDER BY id DESC LIMIT 1";

export async function activeList(db: D1Database): Promise<ListRow | null> {
  return db
    .prepare("SELECT id, from_date, to_date, meals_count, meals_snapshot, excluded FROM shopping_lists ORDER BY id DESC LIMIT 1")
    .first<ListRow>();
}

const ITEM_COLUMNS = "id, client_id, ingredient_id, name, quantity_text, aisle, pantry, status, bought, manual, carried, field_updated_at, updated_at";

async function itemRows(db: D1Database, listId: number): Promise<ItemRow[]> {
  const { results } = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM shopping_items WHERE list_id = ? ORDER BY id`).bind(listId).all<ItemRow>();
  return results;
}

const toItem = (r: ItemRow): ShoppingItem => ({
  id: r.id,
  client_id: r.client_id,
  ingredient_id: r.ingredient_id,
  name: r.name,
  quantity_text: r.quantity_text,
  aisle: isAisle(r.aisle) ? r.aisle : "otros",
  pantry: r.pantry === 1,
  status: r.status,
  bought: r.bought === 1,
  manual: r.manual === 1,
  carried: r.carried === 1,
});

export const toStored = (r: ShoppingItem | ItemRow): StoredItem => {
  const item = "field_updated_at" in r ? toItem(r) : r;
  return { ...item, id: item.id ?? 0 };
};

export async function storedItems(db: D1Database, listId: number): Promise<StoredItem[]> {
  return (await itemRows(db, listId)).map(toStored);
}

/** Comidas planificadas con receta en un rango, con su título. */
export async function plannedMeals(db: D1Database, from: string, to: string): Promise<(SnapshotMeal & { title: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT pm.date, pm.slot, pm.recipe_id, r.title, r.updated_at
       FROM plan_meals pm JOIN recipes r ON r.id = pm.recipe_id
       WHERE pm.status = 'planned' AND pm.date BETWEEN ? AND ?
       ORDER BY pm.date, CASE pm.slot WHEN 'lunch' THEN 0 ELSE 1 END`,
    )
    .bind(from, to)
    .all<{ date: string; slot: Slot; recipe_id: string; title: string; updated_at: string }>();
  return results;
}

/** Ingredientes que hacen falta para unas comidas (una receta repetida cuenta dos veces). */
export async function needsFor(db: D1Database, meals: SnapshotMeal[]): Promise<GeneratedItem[]> {
  const ids = [...new Set(meals.map((m) => m.recipe_id))];
  if (ids.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT ri.recipe_id, ri.quantity, ri.unit, ri.estimated, ri.ingredient_id, i.name, i.aisle, i.pantry
       FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id IN (SELECT value FROM json_each(?))
       ORDER BY ri.recipe_id, ri.position`,
    )
    .bind(JSON.stringify(ids))
    .all<{ recipe_id: string; quantity: number | null; unit: Unit | null; estimated: number; ingredient_id: string; name: string; aisle: string; pantry: number }>();
  const byRecipe = new Map<string, NeedLine[]>();
  for (const r of results) {
    const line: NeedLine = {
      ingredient_id: r.ingredient_id,
      name: r.name,
      aisle: isAisle(r.aisle) ? r.aisle : "otros",
      pantry: r.pantry === 1,
      quantity: r.quantity,
      unit: r.unit,
      estimated: r.estimated === 1,
    };
    const lines = byRecipe.get(r.recipe_id);
    if (lines) lines.push(line);
    else byRecipe.set(r.recipe_id, [line]);
  }
  return aggregateNeeds(meals.flatMap((m) => byRecipe.get(m.recipe_id) ?? []));
}

const parseJson = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/** Comidas que cubriría ahora la lista (plan actual en su rango, menos las desmarcadas). */
export async function currentCoverage(db: D1Database, list: ListRow) {
  const planned = await plannedMeals(db, list.from_date, list.to_date);
  const excluded = parseJson<MealRef[]>(list.excluded, []);
  const covered = coveredMeals(
    planned.map(({ date, slot, recipe_id, updated_at }) => ({ date, slot, recipe_id, updated_at })),
    excluded,
  );
  return { planned, covered };
}

/** Lista activa completa (GET /api/shopping), o null. */
export async function listResponse(db: D1Database): Promise<ShoppingListResponse | null> {
  const list = await activeList(db);
  if (!list) return null;
  const [rows, { planned, covered }] = await Promise.all([itemRows(db, list.id), currentCoverage(db, list)]);
  const snapshot = parseJson<SnapshotMeal[]>(list.meals_snapshot, []);
  const changes = menuChanges(snapshot, covered);
  let summary: ShoppingListResponse["changes"] = null;
  if (changes.length > 0) {
    const titles = new Map(planned.map((m) => [m.recipe_id, m.title]));
    const missing = changes.map((c) => (c.kind === "changed" ? c.previous_recipe_id : c.recipe_id)).filter((id) => !titles.has(id));
    if (missing.length > 0) {
      const { results } = await db
        .prepare("SELECT id, title FROM recipes WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(missing))
        .all<{ id: string; title: string }>();
      for (const r of results) titles.set(r.id, r.title);
    }
    summary = describeChanges(changes, (id) => titles.get(id) ?? id);
  }
  return {
    id: list.id,
    from_date: list.from_date,
    to_date: list.to_date,
    meals_count: list.meals_count,
    items: rows.map(toItem),
    changes: summary,
  };
}

/** Inserta líneas en la lista activa en una sola sentencia (para meterla en un batch). */
export function insertItems(
  db: D1Database,
  items: { ingredient_id: string | null; name: string; quantity_text: string | null; aisle: string; pantry: boolean; status: string; manual: boolean; carried: boolean }[],
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO shopping_items (list_id, ingredient_id, name, quantity_text, aisle, pantry, status, manual, carried, updated_at)
       SELECT (${ACTIVE_LIST}), json_extract(j.value, '$.ingredient_id'), json_extract(j.value, '$.name'),
              json_extract(j.value, '$.quantity_text'), json_extract(j.value, '$.aisle'), json_extract(j.value, '$.pantry'),
              json_extract(j.value, '$.status'), json_extract(j.value, '$.manual'), json_extract(j.value, '$.carried'), ?
       FROM json_each(?) j`,
    )
    .bind(
      now,
      JSON.stringify(
        items.map((i) => ({ ...i, pantry: i.pantry ? 1 : 0, manual: i.manual ? 1 : 0, carried: i.carried ? 1 : 0 })),
      ),
    );
}

// ---------- Operaciones (cola sin conexión y escrituras sueltas) ----------

export type OpResult = "applied" | "duplicate" | "missing" | "rejected";

async function findItem(db: D1Database, target: number | string): Promise<ItemRow | null> {
  return typeof target === "number"
    ? db.prepare(`SELECT ${ITEM_COLUMNS} FROM shopping_items WHERE id = ?`).bind(target).first<ItemRow>()
    : db.prepare(`SELECT ${ITEM_COLUMNS} FROM shopping_items WHERE client_id = ?`).bind(target).first<ItemRow>();
}

/**
 * Aplica una operación. Idempotente por op.id. Las que apuntan a líneas que ya no
 * existen (lista sustituida, línea quitada) se descartan sin error. `at` se limita a
 * `now`: un reloj del móvil adelantado no puede ganar a escrituras posteriores.
 */
export async function applyOp(db: D1Database, op: ShoppingOp, now: string): Promise<OpResult> {
  if (await db.prepare("SELECT 1 FROM shopping_ops WHERE id = ?").bind(op.id).first()) return "duplicate";
  const at = op.at < now ? op.at : now;
  const markApplied = db.prepare("INSERT INTO shopping_ops (id) VALUES (?) ON CONFLICT (id) DO NOTHING").bind(op.id);

  if (op.op === "create") {
    if (!isAisle(op.fields.aisle)) return "rejected";
    if (await findItem(db, op.item_id)) {
      await markApplied.run();
      return "duplicate";
    }
    const list = await db.prepare(ACTIVE_LIST).first<{ id: number }>();
    if (!list) {
      await markApplied.run();
      return "missing";
    }
    let ingredientId = op.fields.ingredient_id;
    if (ingredientId && !(await db.prepare("SELECT 1 FROM ingredients WHERE id = ?").bind(ingredientId).first())) ingredientId = null;
    await db.batch([
      db
        .prepare(
          `INSERT INTO shopping_items (list_id, client_id, ingredient_id, name, quantity_text, aisle, pantry, status, manual, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'buy', 1, ?)`,
        )
        .bind(list.id, op.item_id, ingredientId, op.fields.name, op.fields.quantity_text, op.fields.aisle, at),
      markApplied,
    ]);
    return "applied";
  }

  const item = await findItem(db, op.item_id);
  if (!item) {
    await markApplied.run();
    return "missing";
  }

  if (op.op === "delete") {
    if (item.manual !== 1) return "rejected";
    await db.batch([db.prepare("DELETE FROM shopping_items WHERE id = ?").bind(item.id), markApplied]);
    return "applied";
  }

  const stamps = parseJson<Partial<Record<PatchField, string>>>(item.field_updated_at, {});
  const fields = winningFields(op.fields, at, stamps);
  if (fields.aisle !== undefined && !isAisle(fields.aisle)) delete fields.aisle;
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [field, value] of Object.entries(fields) as [PatchField, unknown][]) {
    sets.push(`${field} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as string | null));
    stamps[field] = at;
  }
  const statements = [markApplied];
  if (sets.length > 0) {
    const updatedAt = item.updated_at && item.updated_at > at ? item.updated_at : at;
    statements.unshift(
      db
        .prepare(`UPDATE shopping_items SET ${sets.join(", ")}, field_updated_at = ?, updated_at = ? WHERE id = ?`)
        .bind(...values, JSON.stringify(stamps), updatedAt, item.id),
    );
    // La sección elegida se recuerda en el catálogo para las próximas listas.
    if (fields.aisle !== undefined && item.ingredient_id) {
      statements.push(db.prepare("UPDATE ingredients SET aisle = ? WHERE id = ?").bind(fields.aisle, item.ingredient_id));
    }
  }
  await db.batch(statements);
  return "applied";
}

/** Olvida los ids de operaciones antiguas (una cola no espera tanto). */
export function pruneOps(db: D1Database): D1PreparedStatement {
  return db.prepare("DELETE FROM shopping_ops WHERE applied_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')");
}
