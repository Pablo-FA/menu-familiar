import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiError, IngredientSuggestion, ShoppingCandidatesResponse, ShoppingItem, ShoppingListResponse, ShoppingUpdateResponse } from "../src/shared/api";
import app from "../src/worker/index";

const devEnv = { ...env, DEV_DISABLE_ACCESS: "true" };
const BASE = "http://localhost/api";

function send(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request(`${BASE}${path}`, init, devEnv);
}

const ing = (name: string, quantity: number | null, unit: string | null, extra: Record<string, unknown> = {}) => ({
  text: name,
  name,
  quantity,
  unit,
  aisle: "otros",
  ...extra,
});

const recipe = (id: string, ingredients: unknown[]) => ({
  format: "menu-familiar/recipe@1",
  id,
  title: `Receta ${id}`,
  minutes: 30,
  protein: "verdura",
  suits: "both",
  ingredients,
  steps: [{ text: "Cocinar." }],
});

const RECIPES = [
  recipe("tortilla", [ing("huevo", 6, "ud"), ing("patata", 600, "g", { aisle: "verdura-fruta" }), ing("aceite", null, null, { pantry: true })]),
  recipe("arroz-tomate", [ing("arroz", 300, "g", { pantry: true }), ing("huevo", 4, "ud"), ing("tomate frito", 0.5, "kg", { estimated: true })]),
  recipe("salmon-horno", [ing("salmón", 600, "g"), ing("patata", 0.5, "kg", { aisle: "verdura-fruta" })]),
];

async function plan(meals: { date: string; slot: string; recipe_id?: string; status?: string }[]) {
  const res = await send("POST", "/plan/import", { format: "menu-familiar/plan@1", meals, recipes: [] });
  expect(res.status).toBe(200);
}

const byName = (list: ShoppingListResponse | null, name: string) => list?.items.find((i) => i.name === name);

beforeEach(async () => {
  for (const r of RECIPES) await send("POST", "/recipes/import?replace=true", r);
  await plan([
    { date: "2027-05-03", slot: "lunch", recipe_id: "tortilla" },
    { date: "2027-05-03", slot: "dinner", recipe_id: "arroz-tomate" },
    { date: "2027-05-04", slot: "lunch", status: "away" },
    { date: "2027-05-05", slot: "dinner", recipe_id: "salmon-horno" },
  ]);
});

describe("crear lista", () => {
  it("sin lista, GET devuelve null", async () => {
    expect(await (await send("GET", "/shopping")).json()).toBeNull();
  });

  it("candidatas: solo las planificadas con receta, con título", async () => {
    const res = await (await send("GET", "/shopping/candidates?from=2027-05-03&to=2027-05-09")).json<ShoppingCandidatesResponse>();
    expect(res.meals.map((m) => `${m.date} ${m.slot} ${m.title}`)).toEqual([
      "2027-05-03 lunch Receta tortilla",
      "2027-05-03 dinner Receta arroz-tomate",
      "2027-05-05 dinner Receta salmon-horno",
    ]);
    expect(res.pending).toBe(0);
  });

  it("suma por ingrediente, pone sección del catálogo y estado según la despensa", async () => {
    const res = await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-09", excluded: [] });
    expect(res.status).toBe(201);
    const list = await res.json<ShoppingListResponse>();
    expect(list).toMatchObject({ from_date: "2027-05-03", to_date: "2027-05-09", meals_count: 3, changes: null });
    expect(byName(list, "Huevo")).toMatchObject({ quantity_text: "10 ud", aisle: "harinas-huevos", status: "buy", bought: false });
    expect(byName(list, "Patata")).toMatchObject({ quantity_text: "1,1 kg", aisle: "fruta-verdura", status: "buy" });
    expect(byName(list, "Tomate frito")).toMatchObject({ quantity_text: "≈ 500 g", aisle: "pasta-salsas" });
    expect(byName(list, "Arroz")).toMatchObject({ quantity_text: "300 g", aisle: "arroces", status: "review" });
    expect(byName(list, "Aceite")).toMatchObject({ quantity_text: null, status: "home" });
    expect(byName(list, "Salmón")).toMatchObject({ aisle: "pescado" });
  });

  it("las comidas desmarcadas no cuentan", async () => {
    const list = await (
      await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-09", excluded: [{ date: "2027-05-05", slot: "dinner" }] })
    ).json<ShoppingListResponse>();
    expect(list.meals_count).toBe(2);
    expect(byName(list, "Salmón")).toBeUndefined();
    expect(byName(list, "Patata")?.quantity_text).toBe("600 g");
  });

  it("sin comidas, error en español", async () => {
    const res = await send("POST", "/shopping", { from: "2027-06-01", to: "2027-06-07" });
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).error).toBe("No hay comidas planificadas para esa lista");
  });

  it("una lista nueva sustituye a la anterior y puede pasar lo que no se compró", async () => {
    const first = await (await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-03" })).json<ShoppingListResponse>();
    const huevo = byName(first, "Huevo") as ShoppingItem;
    const tomate = byName(first, "Tomate frito") as ShoppingItem;
    await send("PATCH", `/shopping/items/${huevo.id}`, { bought: true });
    await send("POST", "/shopping/items", { name: "Lejía", aisle: "limpieza" });

    const candidates = await (await send("GET", "/shopping/candidates?from=2027-05-05&to=2027-05-05")).json<ShoppingCandidatesResponse>();
    expect(candidates.pending).toBe(3); // patata, tomate frito y lejía

    const second = await (await send("POST", "/shopping", { from: "2027-05-05", to: "2027-05-05", carry: true })).json<ShoppingListResponse>();
    expect(second.id).not.toBe(first.id);
    const names = second.items.map((i) => i.name).sort();
    expect(names).toEqual(["Lejía", "Patata", "Salmón", "Tomate frito"]); // patata no se duplica
    expect(byName(second, "Patata")?.quantity_text).toBe("500 g");
    expect(byName(second, "Tomate frito")).toMatchObject({ carried: true, quantity_text: tomate.quantity_text });
    expect(byName(second, "Lejía")).toMatchObject({ manual: true, aisle: "limpieza" });
    const lists = await env.DB.prepare("SELECT COUNT(*) AS n FROM shopping_lists").first<{ n: number }>();
    expect(lists?.n).toBe(1);
    const orphans = await env.DB.prepare("SELECT COUNT(*) AS n FROM shopping_items WHERE list_id <> ?").bind(second.id).first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });
});

describe("menú cambiado y actualizar", () => {
  it("detecta el cambio y actualiza según las reglas", async () => {
    const list = await (await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-09" })).json<ShoppingListResponse>();
    const patata = byName(list, "Patata") as ShoppingItem;
    const salmon = byName(list, "Salmón") as ShoppingItem;
    await send("PATCH", `/shopping/items/${patata.id}`, { status: "home" });
    await send("PATCH", `/shopping/items/${salmon.id}`, { bought: true });

    // El miércoles se cambia el salmón por tortilla y se quita el arroz del lunes.
    await plan([
      { date: "2027-05-05", slot: "dinner", recipe_id: "tortilla" },
      { date: "2027-05-03", slot: "dinner", status: "empty" },
    ]);
    const changed = await (await send("GET", "/shopping")).json<ShoppingListResponse>();
    expect(changed.changes).toEqual({ count: 2, first: "Lunes 3, cena: ya no está Receta arroz-tomate y 1 cambio más." });

    const res = await (await send("POST", "/shopping/update")).json<ShoppingUpdateResponse>();
    expect(res.list.changes).toBeNull();
    expect(res.list.meals_count).toBe(2);
    expect(byName(res.list, "Huevo")?.quantity_text).toBe("12 ud");
    expect(byName(res.list, "Patata")).toMatchObject({ quantity_text: "1,2 kg", status: "home" }); // cantidad nueva, mismo estado
    expect(byName(res.list, "Salmón")).toMatchObject({ bought: true }); // comprado: se queda
    expect(byName(res.list, "Arroz")).toBeUndefined();
    expect(byName(res.list, "Tomate frito")).toBeUndefined();
    expect([res.added, res.removed, res.changed]).toEqual([0, 2, 2]);

    const again = await (await send("POST", "/shopping/update")).json<ShoppingUpdateResponse>();
    expect([again.added, again.removed, again.changed]).toEqual([0, 0, 0]);
  });
});

describe("líneas", () => {
  it("cambiar la sección la recuerda en el catálogo para las próximas listas", async () => {
    const list = await (await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-03" })).json<ShoppingListResponse>();
    const tomate = byName(list, "Tomate frito") as ShoppingItem;
    expect((await send("PATCH", `/shopping/items/${tomate.id}`, { aisle: "conservas" })).status).toBe(200);
    expect((await send("PATCH", `/shopping/items/${tomate.id}`, { aisle: "nada" })).status).toBe(400);
    const next = await (await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-03" })).json<ShoppingListResponse>();
    expect(byName(next, "Tomate frito")?.aisle).toBe("conservas");
  });

  it("solo se borran las añadidas a mano", async () => {
    const list = await (await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-03" })).json<ShoppingListResponse>();
    const huevo = byName(list, "Huevo") as ShoppingItem;
    const res = await send("DELETE", `/shopping/items/${huevo.id}`);
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).error).toContain("Usa «En casa»");
    const created = await (await send("POST", "/shopping/items", { name: "Papel de cocina", quantity_text: " 2 ", aisle: "limpieza" })).json<{ id: number }>();
    const after = await (await send("GET", "/shopping")).json<ShoppingListResponse>();
    expect(byName(after, "Papel de cocina")).toMatchObject({ quantity_text: "2", manual: true, status: "buy", pantry: false });
    expect((await send("DELETE", `/shopping/items/${created.id}`)).status).toBe(204);
    expect((await send("DELETE", `/shopping/items/${created.id}`)).status).toBe(404);
  });

  it("buscar ingredientes sin distinguir tildes", async () => {
    const res = await (await send("GET", "/ingredients?q=SALMON")).json<IngredientSuggestion[]>();
    expect(res).toEqual([{ id: "salmon", name: "salmón", aisle: "pescado" }]);
    expect(await (await send("GET", "/ingredients?q=")).json()).toEqual([]);
    const tomate = await (await send("GET", "/ingredients?q=frito")).json<IngredientSuggestion[]>();
    expect(tomate.map((t) => t.id)).toEqual(["tomate-frito"]);
  });
});

describe("POST /api/shopping/ops", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 10, 0, s)).toISOString();

  it("aplica en orden, es idempotente por id y descarta operaciones sobre líneas borradas", async () => {
    const list = await (await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-03" })).json<ShoppingListResponse>();
    const huevo = byName(list, "Huevo") as ShoppingItem;
    const ops = [
      { id: "op-1", item_id: huevo.id, op: "patch", fields: { bought: true }, at: at(1) },
      { id: "op-2", item_id: "c-lejia", op: "create", fields: { name: "Lejía", quantity_text: null, aisle: "limpieza", ingredient_id: null }, at: at(2) },
      { id: "op-3", item_id: "c-lejia", op: "patch", fields: { bought: true }, at: at(3) },
      { id: "op-4", item_id: 999999, op: "patch", fields: { bought: true }, at: at(4) },
      { id: "op-5", item_id: "c-nada", op: "delete", fields: {}, at: at(5) },
    ];
    const res = await send("POST", "/shopping/ops", ops);
    expect(res.status).toBe(200);
    const after = await res.json<ShoppingListResponse>();
    expect(byName(after, "Huevo")?.bought).toBe(true);
    expect(byName(after, "Lejía")).toMatchObject({ bought: true, manual: true, client_id: "c-lejia" });

    // Repetir el envío (p. ej. se cortó la respuesta) no duplica ni deshace nada.
    await send("PATCH", `/shopping/items/${huevo.id}`, { bought: false });
    const repeated = await (await send("POST", "/shopping/ops", ops)).json<ShoppingListResponse>();
    expect(repeated.items.filter((i) => i.name === "Lejía")).toHaveLength(1);
    expect(byName(repeated, "Huevo")?.bought).toBe(false);
  });

  it("gana la escritura más reciente por campo, aunque llegue después", async () => {
    const list = await (await send("POST", "/shopping", { from: "2027-05-03", to: "2027-05-03" })).json<ShoppingListResponse>();
    const huevo = byName(list, "Huevo") as ShoppingItem;
    await send("POST", "/shopping/ops", [{ id: "n-1", item_id: huevo.id, op: "patch", fields: { bought: true, status: "buy" }, at: at(20) }]);
    // Llega tarde una operación más antigua: no pisa bought, pero sí aisle (nadie lo había tocado).
    const late = await (
      await send("POST", "/shopping/ops", [{ id: "n-2", item_id: huevo.id, op: "patch", fields: { bought: false, aisle: "leche" }, at: at(10) }])
    ).json<ShoppingListResponse>();
    expect(byName(late, "Huevo")).toMatchObject({ bought: true, aisle: "leche" });
  });

  it("valida las operaciones", async () => {
    const res = await send("POST", "/shopping/ops", [{ id: "x", item_id: 1, op: "patch", fields: {}, at: "ayer" }]);
    expect(res.status).toBe(400);
    expect((await res.json<ApiError>()).errors?.map((e) => e.field)).toEqual(expect.arrayContaining(["[0].at"]));
  });
});
