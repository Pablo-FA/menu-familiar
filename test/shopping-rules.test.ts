import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ACCEPTED_AISLES, AISLES, guessAisle, importAisle, LEGACY_AISLE_MAP } from "../src/shared/aisles";
import {
  aggregateNeeds,
  carryOver,
  coveredMeals,
  describeChanges,
  initialStatus,
  menuChanges,
  planListUpdate,
  sumQuantities,
  type GeneratedItem,
  type NeedLine,
  type StoredItem,
} from "../src/shared/shopping";
import { applyOps, retryDelay, winningFields, type ShoppingOp, type SyncItem } from "../src/shared/shopping-sync";

describe("secciones", () => {
  it("hay 19, en el orden de la tienda, y se aceptan también las 8 antiguas", () => {
    expect(AISLES).toHaveLength(19);
    expect(AISLES[0]).toBe("pan");
    expect(AISLES.at(-1)).toBe("otros");
    expect(ACCEPTED_AISLES).toHaveLength(19 + 5); // conservas, congelados y otros están en las dos
    for (const legacy of Object.keys(LEGACY_AISLE_MAP)) expect(ACCEPTED_AISLES).toContain(legacy);
  });

  it.each([
    ["huevo", null, "harinas-huevos"],
    ["mozzarella", null, "embutidos-quesos"],
    ["lenteja-pardina", null, "carne-legumbres"],
    ["garbanzo-cocido", null, "conservas"],
    ["leche-de-coco", null, "conservas"],
    ["leche", null, "leche"],
    ["salsa-de-soja", null, "pasta-salsas"],
    ["gyoza", null, "congelados"],
    ["salmon", null, "pescado"],
    ["arroz-basmati", null, "arroces"],
    ["pan-rallado", null, "harinas-huevos"],
    ["comino", null, "carne-legumbres"],
    ["jamon-cocido", null, "embutidos-quesos"],
    ["harina-de-maiz", null, "harinas-huevos"],
    ["cebolla", "verdura-fruta", "fruta-verdura"],
  ])("guessAisle(%s, %s) → %s", (slug, legacy, aisle) => {
    expect(guessAisle(slug, legacy)).toBe(aisle);
  });

  it("la palabra clave empieza un tramo del slug y se ignora la s final", () => {
    expect(guessAisle("platano", "verdura-fruta")).toBe("fruta-verdura"); // no es "lata"
    expect(guessAisle("garbanzos-cocidos")).toBe("conservas");
    expect(guessAisle("huevos-camperos")).toBe("harinas-huevos");
    expect(guessAisle("nuez-moscada")).toBe("carne-legumbres"); // especia antes que frutos secos
    expect(guessAisle("nueces")).toBe("otros");
    expect(guessAisle("panceta")).toBe("embutidos-quesos"); // antes que "pan"
    expect(guessAisle("pimiento-rojo", "verdura-fruta")).toBe("fruta-verdura"); // no es "pimienta"
    expect(guessAisle("caldo-de-pollo")).toBe("conservas");
    expect(guessAisle("panko", "cereales-pan")).toBe("harinas-huevos");
  });

  it("sin regla: equivalente de la sección antigua, o otros", () => {
    expect(guessAisle("aceite", "despensa")).toBe("otros");
    expect(guessAisle("zanahoria", "verdura-fruta")).toBe("fruta-verdura");
    expect(guessAisle("ternasco", "carne-pescado")).toBe("carne-legumbres");
    expect(guessAisle("algo-raro")).toBe("otros");
  });

  it("al importar: las secciones nuevas se respetan; las antiguas y «otros» se convierten", () => {
    expect(importAisle("cebolla", "limpieza")).toBe("limpieza");
    expect(importAisle("atun", "conservas")).toBe("conservas");
    expect(importAisle("arroz", "cereales-pan")).toBe("arroces");
    expect(importAisle("comino", "otros")).toBe("carne-legumbres");
    expect(importAisle("agua", "otros")).toBe("otros");
  });

  it("la migración 0005 re-secciona igual que guessAisle", async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0005"));
    const update = migration?.queries.find((q) => q.includes("UPDATE ingredients SET aisle"));
    expect(update).toBeDefined();
    const samples: [string, string][] = [
      ["huevo", "huevos-lacteos"], ["mozzarella", "huevos-lacteos"], ["lenteja-pardina", "despensa"],
      ["garbanzo-cocido", "conservas"], ["garbanzos-cocidos", "conservas"], ["leche-de-coco", "conservas"],
      ["leche", "huevos-lacteos"], ["salsa-de-soja", "despensa"], ["gyoza", "congelados"], ["salmon", "carne-pescado"],
      ["arroz-basmati", "cereales-pan"], ["pan-rallado", "cereales-pan"], ["comino", "despensa"],
      ["jamon-cocido", "carne-pescado"], ["harina-de-maiz", "despensa"], ["cebolla", "verdura-fruta"],
      ["platano", "verdura-fruta"], ["aceite", "despensa"], ["nuez-moscada", "despensa"], ["nueces", "despensa"],
      ["panceta", "carne-pescado"], ["pimiento-rojo", "verdura-fruta"], ["vino-blanco", "otros"],
      ["setas-shiitake", "verdura-fruta"], ["panko", "cereales-pan"], ["tortillas-de-trigo", "cereales-pan"],
      ["yogur-griego", "huevos-lacteos"], ["pechuga-de-pollo", "carne-pescado"], ["sal", "despensa"],
      ["guisantes-congelados", "congelados"], ["detergente", "limpieza"],
    ];
    await env.DB.prepare("DELETE FROM ingredients").run();
    await env.DB.batch(samples.map(([id, aisle]) => env.DB.prepare("INSERT INTO ingredients (id, name, aisle) VALUES (?, ?, ?)").bind(id, id, aisle)));
    await env.DB.prepare(update as string).run();
    const { results } = await env.DB.prepare("SELECT id, aisle FROM ingredients").all<{ id: string; aisle: string }>();
    const got = Object.fromEntries(results.map((r) => [r.id, r.aisle]));
    for (const [id, legacy] of samples) expect([id, got[id]]).toEqual([id, guessAisle(id, legacy)]);
  });
});

describe("cantidades", () => {
  const q = (quantity: number | null, unit: NeedLine["unit"], estimated = false) => ({ quantity, unit, estimated });

  it("g y kg se suman en gramos; desde 1000, en kg con un decimal y coma", () => {
    expect(sumQuantities([q(200, "g"), q(300, "g")])).toBe("500 g");
    expect(sumQuantities([q(600, "g"), q(0.9, "kg")])).toBe("1,5 kg");
    expect(sumQuantities([q(1, "kg")])).toBe("1 kg");
    expect(sumQuantities([q(999.6, "g")])).toBe("1 kg"); // nunca "1000 g"
    expect(sumQuantities([q(12.4, "g")])).toBe("12 g");
  });

  it("ml y l igual", () => {
    expect(sumQuantities([q(250, "ml"), q(0.5, "l")])).toBe("750 ml");
    expect(sumQuantities([q(800, "ml"), q(0.45, "l")])).toBe("1,3 l");
  });

  it("ud se redondea hacia arriba", () => {
    expect(sumQuantities([q(1.5, "ud"), q(1, "ud")])).toBe("3 ud");
    expect(sumQuantities([q(2, "ud")])).toBe("2 ud");
  });

  it("cda, cdta y pizca, cada una por su lado; familias distintas con +", () => {
    expect(sumQuantities([q(1, "cda"), q(0.5, "cda"), q(1, "cdta")])).toBe("1,5 cda + 1 cdta");
    expect(sumQuantities([q(200, "g"), q(2, "ud")])).toBe("2 ud + 200 g");
    expect(sumQuantities([q(1, "pizca"), q(1, "pizca")])).toBe("2 pizca");
  });

  it("las null no suman; si todas lo son, no hay cantidad", () => {
    expect(sumQuantities([q(null, null), q(100, "g")])).toBe("100 g");
    expect(sumQuantities([q(null, null), q(null, null)])).toBeNull();
  });

  it("≈ si alguna parte es estimada", () => {
    expect(sumQuantities([q(100, "g", true), q(100, "g")])).toBe("≈ 200 g");
    expect(sumQuantities([q(null, null, true), q(100, "g")])).toBe("100 g");
  });
});

const need = (ingredient_id: string, extra: Partial<NeedLine> = {}): NeedLine => ({
  ingredient_id,
  name: ingredient_id,
  aisle: "otros",
  pantry: false,
  quantity: 1,
  unit: "ud",
  estimated: false,
  ...extra,
});

describe("generación", () => {
  it("estado inicial según la despensa", () => {
    expect(initialStatus(false, "2 ud")).toBe("buy");
    expect(initialStatus(false, null)).toBe("buy");
    expect(initialStatus(true, "260 g")).toBe("review");
    expect(initialStatus(true, null)).toBe("home");
  });

  it("agrupa por ingrediente, pone mayúscula al nombre y el agua no se compra", () => {
    const items = aggregateNeeds([
      need("huevo", { name: "huevo" }),
      need("arroz", { name: "arroz", pantry: true, quantity: 260, unit: "g" }),
      need("huevo", { name: "huevo", quantity: 2 }),
      need("sal", { pantry: true, quantity: null, unit: null }),
      need("agua", { pantry: true, quantity: 600, unit: "ml" }),
    ]);
    expect(items).toEqual([
      { ingredient_id: "huevo", name: "Huevo", aisle: "otros", pantry: false, quantity_text: "3 ud", status: "buy" },
      { ingredient_id: "arroz", name: "Arroz", aisle: "otros", pantry: true, quantity_text: "260 g", status: "review" },
      { ingredient_id: "sal", name: "Sal", aisle: "otros", pantry: true, quantity_text: null, status: "home" },
      { ingredient_id: "agua", name: "Agua", aisle: "otros", pantry: true, quantity_text: "600 ml", status: "home" },
    ]);
  });
});

const stored = (id: number, extra: Partial<StoredItem> = {}): StoredItem => ({
  id,
  ingredient_id: `i${id}`,
  name: `Cosa ${id}`,
  quantity_text: "1 ud",
  aisle: "otros",
  pantry: false,
  status: "buy",
  bought: false,
  manual: false,
  carried: false,
  ...extra,
});

const generated = (ingredient_id: string, extra: Partial<GeneratedItem> = {}): GeneratedItem => ({
  ingredient_id,
  name: ingredient_id,
  aisle: "otros",
  pantry: false,
  quantity_text: "1 ud",
  status: "buy",
  ...extra,
});

describe("pasar lo que no compraste", () => {
  it("pasa lo pendiente de comprar, sin duplicar ingredientes; lo añadido a mano tal cual", () => {
    const previous = [
      stored(1), // pendiente → pasa
      stored(2, { bought: true }), // comprado → no
      stored(3, { status: "home" }), // en casa → no
      stored(4, { status: "review" }), // por revisar → no
      stored(5, { ingredient_id: "huevo" }), // ya está en la nueva → no
      stored(6, { manual: true, ingredient_id: null, name: "Lejía", aisle: "limpieza", quantity_text: null }),
      stored(7, { manual: true, ingredient_id: "huevo", quantity_text: "12 ud" }), // a mano: se copia
    ];
    const carried = carryOver(previous, [generated("huevo")]);
    expect(carried.map((c) => c.name)).toEqual(["Cosa 1", "Lejía", "Cosa 7"]);
    expect(carried[1]).toEqual({ ingredient_id: null, name: "Lejía", quantity_text: null, aisle: "limpieza", pantry: false, manual: true });
  });
});

describe("cambios del menú", () => {
  const meal = (date: string, slot: "lunch" | "dinner", recipe_id: string) => ({ date, slot, recipe_id });

  it("las comidas cubiertas son las planificadas menos las desmarcadas, por fecha", () => {
    const planned = [meal("2026-10-06", "dinner", "b"), meal("2026-10-06", "lunch", "a"), meal("2026-10-05", "dinner", "c")];
    expect(coveredMeals(planned, [{ date: "2026-10-06", slot: "lunch" }])).toEqual([meal("2026-10-05", "dinner", "c"), meal("2026-10-06", "dinner", "b")]);
  });

  it("detecta añadidas, quitadas y cambiadas, y cuenta la primera en una frase", () => {
    const snapshot = [meal("2026-10-10", "dinner", "piadinas"), meal("2026-10-08", "lunch", "lentejas"), meal("2026-10-11", "lunch", "paella")];
    const current = [meal("2026-10-10", "dinner", "pollo"), meal("2026-10-11", "lunch", "paella"), meal("2026-10-12", "lunch", "crema")];
    const changes = menuChanges(snapshot, current);
    expect(changes.map((c) => `${c.date} ${c.kind}`)).toEqual(["2026-10-08 removed", "2026-10-10 changed", "2026-10-12 added"]);
    const titles: Record<string, string> = { pollo: "Pollo al limón", piadinas: "Piadinas rellenas", lentejas: "Lentejas", crema: "Crema" };
    const title = (id: string) => titles[id] ?? id;
    expect(describeChanges(changes.slice(1), title)).toEqual({ count: 2, first: "Sábado 10, cena: Pollo al limón en lugar de Piadinas rellenas y 1 cambio más." });
    expect(describeChanges(changes, title)?.first).toBe("Jueves 8, comida: ya no está Lentejas y 2 cambios más.");
    expect(describeChanges(changes.slice(2), title)?.first).toBe("Lunes 12, comida: se ha añadido Crema.");
    expect(menuChanges(snapshot, snapshot)).toEqual([]);
    expect(describeChanges([], title)).toBeNull();
  });

  it("actualizar: añade lo nuevo, recalcula sin tocar el estado y quita lo que sobra salvo comprado, a mano o pasado", () => {
    const items = [
      stored(1, { ingredient_id: "huevo", quantity_text: "2 ud", status: "home" }), // sigue, cambia la cantidad
      stored(2, { ingredient_id: "arroz", quantity_text: "260 g" }), // sigue igual
      stored(3, { ingredient_id: "salmon" }), // ya no hace falta → fuera
      stored(4, { ingredient_id: "leche", bought: true }), // ya no hace falta pero comprado → se queda
      stored(5, { ingredient_id: "pan", bought: true, quantity_text: "1 ud" }), // sigue, comprado → no se toca
      stored(6, { ingredient_id: "salmon", manual: true }), // a mano → no se toca
      stored(7, { ingredient_id: "lejia", carried: true }), // pasado de la lista anterior → se queda
    ];
    const update = planListUpdate(items, [
      generated("huevo", { quantity_text: "4 ud" }),
      generated("arroz", { quantity_text: "260 g" }),
      generated("pan", { quantity_text: "2 ud" }),
      generated("tomate"),
    ]);
    expect(update.add.map((a) => a.ingredient_id)).toEqual(["tomate"]);
    expect(update.requantify).toEqual([{ id: 1, quantity_text: "4 ud" }]);
    expect(update.remove).toEqual([3]);
  });
});

describe("cola sin conexión", () => {
  const item = (id: number | null, client_id: string | null = null): SyncItem => ({
    id,
    client_id,
    ingredient_id: null,
    name: `L${id ?? client_id}`,
    quantity_text: null,
    aisle: "otros",
    pantry: false,
    status: "buy",
    bought: false,
    manual: false,
  });
  const make = (op: Extract<ShoppingOp, { op: "create" }>): SyncItem => ({ ...item(null, op.item_id), name: op.fields.name, manual: true });

  it("aplica en orden, crea sin duplicar y descarta operaciones sobre líneas que no existen", () => {
    const ops: ShoppingOp[] = [
      { id: "a", item_id: 1, op: "patch", fields: { bought: true }, at: "2026-10-03T10:00:00.000Z" },
      { id: "b", item_id: 1, op: "patch", fields: { bought: false }, at: "2026-10-03T10:00:01.000Z" },
      { id: "c", item_id: "c-1", op: "create", fields: { name: "Lejía", quantity_text: null, aisle: "limpieza", ingredient_id: null }, at: "2026-10-03T10:00:02.000Z" },
      { id: "d", item_id: "c-1", op: "patch", fields: { bought: true }, at: "2026-10-03T10:00:03.000Z" },
      { id: "e", item_id: 99, op: "patch", fields: { bought: true }, at: "2026-10-03T10:00:04.000Z" },
    ];
    const once = applyOps([item(1), item(2)], ops, make);
    expect(once.map((i) => [i.name, i.bought])).toEqual([["L1", false], ["L2", false], ["Lejía", true]]);
    expect(applyOps(once, ops, make)).toEqual(once); // repetir no cambia nada
  });

  it("gana por campo la escritura más reciente; con el mismo instante, lo guardado", () => {
    const stamps = { bought: "2026-10-03T10:00:05.000Z" };
    expect(winningFields({ bought: false, status: "home" }, "2026-10-03T10:00:01.000Z", stamps)).toEqual({ status: "home" });
    expect(winningFields({ bought: false }, "2026-10-03T10:00:06.000Z", stamps)).toEqual({ bought: false });
    expect(winningFields({ bought: true }, "2026-10-03T10:00:05.000Z", stamps)).toEqual({});
  });

  it("reintentos cada vez más espaciados", () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([2000, 4000, 8000, 16000, 120000]);
  });
});
