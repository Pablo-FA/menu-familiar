import { Hono } from "hono";
import { z } from "zod";
import { AISLES } from "../../shared/aisles";
import type { ApiError, IngredientSuggestion, ShoppingCandidatesResponse, ShoppingListResponse, ShoppingUpdateResponse } from "../../shared/api";
import { isIsoDate } from "../../shared/dates";
import { toValidationErrors } from "../../shared/plan-format";
import { SLOTS } from "../../shared/recipe-format";
import { carryOver, coveredMeals, isPendingBuy, planListUpdate } from "../../shared/shopping";
import type { PatchFields, ShoppingOp } from "../../shared/shopping-sync";
import { slugify } from "../../shared/slug";
import type { AppEnv } from "../env";
import {
  activeList,
  applyOp,
  currentCoverage,
  insertItems,
  listResponse,
  needsFor,
  plannedMeals,
  pruneOps,
  storedItems,
} from "./store";

/** Lista de la compra: una sola lista activa (la más reciente). */
export const shopping = new Hono<AppEnv>();

const MAX_DAYS = 62;
const isoDate = z.string().refine(isIsoDate, "Debe ser una fecha real con formato AAAA-MM-DD");
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

const nowIso = () => new Date().toISOString();

function rangeError(from: string, to: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return "from y to deben ser fechas AAAA-MM-DD";
  if (to < from) return "«Hasta» no puede ser anterior a «Desde»";
  if (daysBetween(from, to) > MAX_DAYS) return `Como mucho ${MAX_DAYS} días`;
  return null;
}

// ---------- GET /api/shopping ----------

shopping.get("/shopping", async (c) => c.json<ShoppingListResponse | null>(await listResponse(c.env.DB)));

// ---------- GET /api/shopping/candidates?from&to ----------

shopping.get("/shopping/candidates", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  const error = rangeError(from, to);
  if (error) return c.json<ApiError>({ error }, 400);
  const db = c.env.DB;
  const [meals, list] = await Promise.all([plannedMeals(db, from, to), activeList(db)]);
  const pending = list ? (await storedItems(db, list.id)).filter(isPendingBuy).length : 0;
  return c.json<ShoppingCandidatesResponse>({ meals, pending });
});

// ---------- POST /api/shopping ----------

const mealRef = z.strictObject({ date: isoDate, slot: z.enum(SLOTS) });

const createSchema = z.strictObject({
  from: isoDate,
  to: isoDate,
  excluded: z.array(mealRef).max(2 * MAX_DAYS).default([]),
  carry: z.boolean().default(false),
});

/** Crea la lista nueva y borra la anterior (y sus líneas) en la misma transacción. */
shopping.post("/shopping", async (c) => {
  const parsed = createSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json<ApiError>({ error: "La lista no es válida", errors: toValidationErrors(parsed.error) }, 400);
  const { from, to, excluded, carry } = parsed.data;
  const error = rangeError(from, to);
  if (error) return c.json<ApiError>({ error }, 400);

  const db = c.env.DB;
  const planned = await plannedMeals(db, from, to);
  const covered = coveredMeals(
    planned.map(({ date, slot, recipe_id, updated_at }) => ({ date, slot, recipe_id, updated_at })),
    excluded,
  );
  if (covered.length === 0) return c.json<ApiError>({ error: "No hay comidas planificadas para esa lista" }, 400);

  const generated = await needsFor(db, covered);
  const previous = await activeList(db);
  const carried = carry && previous ? carryOver(await storedItems(db, previous.id), generated) : [];

  const now = nowIso();
  const items = [
    ...generated.map((g) => ({ ...g, manual: false, carried: false })),
    ...carried.map((i) => ({ ...i, status: "buy", carried: true })),
  ];
  await db.batch([
    db.prepare("DELETE FROM shopping_lists"), // las líneas se borran en cascada
    db
      .prepare("INSERT INTO shopping_lists (from_date, to_date, meals_snapshot, excluded, meals_count) VALUES (?, ?, ?, ?, ?)")
      .bind(from, to, JSON.stringify(covered), JSON.stringify(excluded), covered.length),
    insertItems(db, items, now),
  ]);
  return c.json<ShoppingListResponse | null>(await listResponse(db), 201);
});

// ---------- POST /api/shopping/update ----------

/** Actualiza la lista con el menú actual (mismo rango y mismas comidas desmarcadas). */
shopping.post("/shopping/update", async (c) => {
  const db = c.env.DB;
  const list = await activeList(db);
  if (!list) return c.json<ApiError>({ error: "No hay lista de la compra" }, 404);
  const { covered } = await currentCoverage(db, list);
  const [needed, items] = await Promise.all([needsFor(db, covered), storedItems(db, list.id)]);
  const plan = planListUpdate(items, needed);
  const now = nowIso();

  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE shopping_lists SET meals_snapshot = ?, meals_count = ? WHERE id = ?").bind(JSON.stringify(covered), covered.length, list.id),
  ];
  if (plan.add.length > 0) statements.push(insertItems(db, plan.add.map((a) => ({ ...a, manual: false, carried: false })), now));
  for (const r of plan.requantify) {
    statements.push(
      db
        .prepare(
          "UPDATE shopping_items SET quantity_text = ?, updated_at = ?, field_updated_at = json_set(field_updated_at, '$.quantity_text', ?) WHERE id = ?",
        )
        .bind(r.quantity_text, now, now, r.id),
    );
  }
  if (plan.remove.length > 0) {
    statements.push(db.prepare("DELETE FROM shopping_items WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(plan.remove)));
  }
  await db.batch(statements);

  const response = await listResponse(db);
  if (!response) return c.json<ApiError>({ error: "No hay lista de la compra" }, 404);
  return c.json<ShoppingUpdateResponse>({ list: response, added: plan.add.length, removed: plan.remove.length, changed: plan.requantify.length });
});

// ---------- Líneas ----------

const aisle = z.enum(AISLES);
const quantityText = z.string().trim().max(40).transform((s) => (s === "" ? null : s)).nullable();
const name = z.string().trim().min(1, "No puede estar vacío").max(80);
const at = z.iso.datetime({ offset: false });

const patchFields = z
  .strictObject({
    bought: z.boolean().optional(),
    status: z.enum(["review", "buy", "home"]).optional(),
    aisle: aisle.optional(),
    quantity_text: quantityText.optional(),
  })
  .refine((f) => Object.keys(f).length > 0, "No hay nada que cambiar");

const createFields = z.strictObject({
  name,
  quantity_text: quantityText.default(null),
  aisle,
  ingredient_id: z.string().max(80).nullable().default(null),
});

const opSchema = z.discriminatedUnion("op", [
  z.strictObject({ id: z.string().min(1).max(64), item_id: z.union([z.number().int().positive(), z.string().min(1).max(64)]), op: z.literal("patch"), fields: patchFields, at }),
  z.strictObject({ id: z.string().min(1).max(64), item_id: z.string().min(1).max(64), op: z.literal("create"), fields: createFields, at }),
  z.strictObject({ id: z.string().min(1).max(64), item_id: z.union([z.number().int().positive(), z.string().min(1).max(64)]), op: z.literal("delete"), fields: z.strictObject({}).default({}), at }),
]);

const opsSchema = z.array(opSchema).max(500);

/** Quita las claves undefined (zod las deja con .optional() y exactOptionalPropertyTypes no las admite). */
function compact(obj: object): PatchFields {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as PatchFields;
}

const itemId = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : null);

shopping.patch("/shopping/items/:id", async (c) => {
  const id = itemId(c.req.param("id"));
  if (id === null) return c.json<ApiError>({ error: "Línea no encontrada" }, 404);
  const parsed = patchFields.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json<ApiError>({ error: "El cambio no es válido", errors: toValidationErrors(parsed.error) }, 400);
  const now = nowIso();
  const result = await applyOp(c.env.DB, { id: crypto.randomUUID(), item_id: id, op: "patch", fields: compact(parsed.data), at: now }, now);
  if (result === "missing") return c.json<ApiError>({ error: "Línea no encontrada" }, 404);
  return c.json({ ok: true });
});

shopping.post("/shopping/items", async (c) => {
  const parsed = createFields.extend({ client_id: z.string().min(1).max(64).optional() }).safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json<ApiError>({ error: "La línea no es válida", errors: toValidationErrors(parsed.error) }, 400);
  const { client_id, ...fields } = parsed.data;
  const clientId = client_id ?? `s-${crypto.randomUUID()}`;
  const now = nowIso();
  const db = c.env.DB;
  if (!(await activeList(db))) return c.json<ApiError>({ error: "No hay lista de la compra" }, 404);
  await applyOp(db, { id: crypto.randomUUID(), item_id: clientId, op: "create", fields, at: now }, now);
  const row = await db.prepare("SELECT id FROM shopping_items WHERE client_id = ?").bind(clientId).first<{ id: number }>();
  return c.json({ id: row?.id ?? null, client_id: clientId }, 201);
});

shopping.delete("/shopping/items/:id", async (c) => {
  const id = itemId(c.req.param("id"));
  const db = c.env.DB;
  const row = id === null ? null : await db.prepare("SELECT manual FROM shopping_items WHERE id = ?").bind(id).first<{ manual: number }>();
  if (id === null || !row) return c.json<ApiError>({ error: "Línea no encontrada" }, 404);
  if (row.manual !== 1) return c.json<ApiError>({ error: "Solo se pueden quitar las cosas añadidas a mano. Usa «En casa»." }, 400);
  const now = nowIso();
  await applyOp(db, { id: crypto.randomUUID(), item_id: id, op: "delete", fields: {}, at: now }, now);
  return c.body(null, 204);
});

// ---------- POST /api/shopping/ops ----------

/** Cola del móvil: se aplican en orden; repetir una operación no hace nada. Devuelve la lista. */
shopping.post("/shopping/ops", async (c) => {
  const parsed = opsSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json<ApiError>({ error: "Las operaciones no son válidas", errors: toValidationErrors(parsed.error) }, 400);
  const db = c.env.DB;
  const now = nowIso();
  for (const op of parsed.data) {
    const clean = op.op === "patch" ? { ...op, fields: compact(op.fields) } : op;
    await applyOp(db, clean as ShoppingOp, now);
  }
  await pruneOps(db).run();
  return c.json<ShoppingListResponse | null>(await listResponse(db));
});

// ---------- GET /api/ingredients?q= ----------

/** Hasta 10 ingredientes del catálogo; sin distinguir tildes ni mayúsculas (se compara el slug). */
shopping.get("/ingredients", async (c) => {
  const q = slugify(c.req.query("q") ?? "");
  if (!q) return c.json<IngredientSuggestion[]>([]);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, aisle FROM ingredients
     WHERE ('-' || id) LIKE ? ESCAPE '\\'
     ORDER BY (id LIKE ? ESCAPE '\\') DESC, length(id), id
     LIMIT 10`,
  )
    .bind(`%-${q}%`, `${q}%`)
    .all<IngredientSuggestion>();
  return c.json(results);
});
