import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import katsukare from "../docs/ejemplos/katsukare.json";
import type { ApiError, ImportResponse, RecipeDetail, RecipePreviewResponse, RecipeSummary, ShoppingListResponse } from "../src/shared/api";
import { buildClaudeContext } from "../src/shared/claude-context";
import {
  emptyTitle,
  filterGallery,
  gallerySubtitle,
  matchesQuery,
  NO_FILTERS,
  sortGallery,
  type GalleryRecipe,
} from "../src/shared/gallery";
import { extractPlan, extractRecipe } from "../src/shared/plan-extract";
import { exportRecipe, improveRequestText } from "../src/shared/recipe-export";
import { afterFailure, CONNECTED, isSessionExpired, SessionExpiredError } from "../src/shared/session";
import app from "../src/worker/index";

const devEnv = { ...env, DEV_DISABLE_ACCESS: "true" };
const BASE = "http://localhost/api";

function send(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request(`${BASE}${path}`, init, devEnv);
}

const recipe = (id: string, changes: Record<string, unknown> = {}) => ({ ...structuredClone(katsukare), id, ...changes });

// ---------- Galería (reglas puras) ----------

const g = (id: string, extra: Partial<GalleryRecipe> = {}): GalleryRecipe => ({
  id,
  title: id,
  minutes: 30,
  protein: "verdura",
  suits: "both",
  course: "main",
  archived: false,
  times_cooked: 0,
  last_cooked_at: null,
  avg_stars: null,
  has_freezer: false,
  created_at: "2026-01-01T00:00:00.000Z",
  ingredient_names: [],
  ...extra,
});

describe("galería", () => {
  const all = [
    g("Crema de calabaza", { ingredient_names: ["calabaza", "puerro"], times_cooked: 2, avg_stars: 4.5, last_cooked_at: "2026-09-01T12:00:00Z" }),
    g("Salmón al horno", { protein: "pescado", suits: "dinner", ingredient_names: ["salmón", "patata"], minutes: 50, has_freezer: true }),
    g("Lentejas", { protein: "legumbre", suits: "lunch", times_cooked: 5, avg_stars: 4.5, last_cooked_at: "2026-08-01T12:00:00Z", created_at: "2026-03-01T00:00:00Z" }),
    g("Pan de pita", { course: "side" }),
    g("Pollo viejo", { protein: "ave", archived: true }),
  ];

  it("busca por título e ingrediente sin tildes ni mayúsculas", () => {
    const titles = (q: string) => filterGallery(all, { ...NO_FILTERS, query: q }).map((r) => r.title);
    expect(titles("CALABAZA")).toEqual(["Crema de calabaza"]);
    expect(titles("salmon")).toEqual(["Salmón al horno"]);
    expect(titles("patata")).toEqual(["Salmón al horno"]); // ingrediente
    expect(titles("puerro crema")).toEqual(["Crema de calabaza"]); // varias palabras
    expect(titles("pollo")).toEqual([]); // archivada
    expect(matchesQuery({ title: "Ñoquis", ingredient_names: [] }, "noquis")).toBe(true);
  });

  it("filtros: franja (both cuenta en las dos), rápidas, proteína, sin estrenar, congelar, panes y archivadas", () => {
    const ids = (f: Partial<typeof NO_FILTERS>) => filterGallery(all, { ...NO_FILTERS, ...f }).map((r) => r.id);
    expect(ids({})).toEqual(["Crema de calabaza", "Salmón al horno", "Lentejas"]);
    expect(ids({ slot: "lunch" })).toEqual(["Crema de calabaza", "Lentejas"]);
    expect(ids({ slot: "dinner" })).toEqual(["Crema de calabaza", "Salmón al horno"]);
    expect(ids({ quick: true })).toEqual(["Crema de calabaza", "Lentejas"]);
    expect(ids({ protein: "pescado" })).toEqual(["Salmón al horno"]);
    expect(ids({ unstarted: true })).toEqual(["Salmón al horno"]);
    expect(ids({ freezer: true })).toEqual(["Salmón al horno"]);
    expect(ids({ sides: true })).toEqual(["Pan de pita"]);
    expect(ids({ archived: true })).toEqual(["Pollo viejo"]);
    expect(gallerySubtitle(all)).toBe("3 recetas · 1 sin estrenar");
    expect(emptyTitle({ ...NO_FILTERS, protein: "pescado", slot: "lunch" })).toBe("Ninguna receta de pescado para comida");
  });

  it("los cuatro órdenes", () => {
    const mains = filterGallery(all, NO_FILTERS);
    // Empate a 4,5: gana la más cocinada; sin valorar al final.
    expect(sortGallery(mains, "best").map((r) => r.id)).toEqual(["Lentejas", "Crema de calabaza", "Salmón al horno"]);
    expect(sortGallery(mains, "recent").map((r) => r.id)).toEqual(["Lentejas", "Crema de calabaza", "Salmón al horno"]);
    // Nunca cocinadas primero; luego la de hace más tiempo.
    expect(sortGallery(mains, "oldest").map((r) => r.id)).toEqual(["Salmón al horno", "Lentejas", "Crema de calabaza"]);
    expect(sortGallery(mains, "az").map((r) => r.id)).toEqual(["Crema de calabaza", "Lentejas", "Salmón al horno"]);
  });
});

describe("extraer recipe@1 de lo pegado", () => {
  const json = JSON.stringify(recipe("pegada"));
  it("acepta JSON puro, bloque ```json y texto alrededor", () => {
    expect((extractRecipe(json) as { id: string }).id).toBe("pegada");
    expect((extractRecipe(`Aquí la tienes:\n\`\`\`json\n${json}\n\`\`\`\n¡Que aproveche!`) as { id: string }).id).toBe("pegada");
    expect((extractRecipe(`Te la dejo: ${json} y ya está`) as { id: string }).id).toBe("pegada");
    expect(extractRecipe("nada por aquí")).toBeNull();
    // Un plan no es una receta (y al revés).
    expect(extractRecipe(JSON.stringify({ format: "menu-familiar/plan@1", meals: [] }))).toBeNull();
    expect(extractPlan(json)).toBeNull();
  });
});

describe("sesión caducada", () => {
  it("una redirección de Access es sesión caducada, no sin conexión", () => {
    expect(isSessionExpired({ type: "opaqueredirect", status: 0 })).toBe(true);
    expect(isSessionExpired({ type: "basic", status: 401 })).toBe(true);
    expect(isSessionExpired({ type: "basic", status: 200, redirected: true, url: "https://shrill-field-6efd.cloudflareaccess.com/cdn-cgi/access/login" })).toBe(true);
    expect(isSessionExpired({ type: "basic", status: 200 })).toBe(false);
    const isHttp = (e: unknown) => e instanceof RangeError;
    expect(afterFailure(CONNECTED, new SessionExpiredError(), isHttp)).toEqual({ networkFailed: false, sessionExpired: true });
    expect(afterFailure(CONNECTED, new TypeError("Failed to fetch"), isHttp)).toEqual({ networkFailed: true, sessionExpired: false });
    expect(afterFailure(CONNECTED, new RangeError("HTTP 500"), isHttp)).toEqual(CONNECTED);
  });
});

// ---------- API ----------

beforeEach(async () => {
  await send("POST", "/recipes/import?replace=true", recipe("base"));
});

describe("POST /api/recipes/preview", () => {
  it("receta nueva: resumen, recuentos e ingredientes nuevos con su sección; no escribe nada", async () => {
    await env.DB.prepare("DELETE FROM ingredients WHERE id NOT IN (SELECT ingredient_id FROM recipe_ingredients)").run();
    const nueva = recipe("nueva-preview", {
      ingredients: [...katsukare.ingredients, { text: "1 lata de atún", name: "atún en lata", quantity: 1, unit: "ud", aisle: "despensa" }],
    });
    const res = await (await send("POST", "/recipes/preview", nueva)).json<RecipePreviewResponse>();
    expect(res.exists).toBe(false);
    expect(res.errors).toEqual([]);
    expect(res.summary).toMatchObject({ id: "nueva-preview", minutes: 40, protein: "ave", suits: "lunch", kcal_adult: 800, photo_url: null });
    expect([res.ingredients_count, res.steps_count, res.timers_count]).toEqual([13, 8, 2]);
    expect(res.new_ingredients).toEqual([{ name: "atún en lata", aisle: "conservas" }]);
    expect(await env.DB.prepare("SELECT 1 FROM recipes WHERE id = 'nueva-preview'").first()).toBeNull();
  });

  it("receta existente y errores", async () => {
    const existing = await (await send("POST", "/recipes/preview", recipe("base"))).json<RecipePreviewResponse>();
    expect(existing.exists).toBe(true);
    expect(existing.new_ingredients).toEqual([]);
    const bad = await (await send("POST", "/recipes/preview", recipe("mal", { minutes: -3 }))).json<RecipePreviewResponse>();
    expect(bad.summary).toBeNull();
    expect(bad.errors.map((e) => e.field)).toContain("minutes");
  });
});

describe("PUT /api/recipes/:id", () => {
  it("sustituye datos, ingredientes y pasos; conserva foto, archived y cook_logs; crea ingredientes nuevos", async () => {
    await env.DB.prepare("UPDATE recipes SET cover_photo_key = 'recipes/base/1.jpg', archived = 1, updated_at = '2020-01-01T00:00:00.000Z' WHERE id = 'base'").run();
    await send("POST", "/cook-logs", { recipe_id: "base", stars: 4, note: "Menos sal" });
    const edited = recipe("base", {
      title: "Base editada",
      minutes: 25,
      ingredients: [
        { text: "200 g de chorizo", name: "chorizo", quantity: 200, unit: "g", aisle: "otros" },
        { text: "2 huevos", name: "huevo", quantity: 2, unit: "ud", aisle: "huevos-lacteos" },
      ],
      steps: [{ text: "Freír el chorizo.", uses: ["chorizo"], timer_seconds: 300, timer_label: "Chorizo" }],
    });
    const res = await send("PUT", "/recipes/base", edited);
    expect(res.status).toBe(200);
    expect((await res.json<ImportResponse>()).created_ingredients).toEqual(["chorizo"]);
    const detail = await (await send("GET", "/recipes/base")).json<RecipeDetail>();
    expect(detail).toMatchObject({ title: "Base editada", minutes: 25, cover_photo_key: "recipes/base/1.jpg", archived: true, times_cooked: 1 });
    expect(detail.updated_at > "2020-01-01T00:00:00.000Z").toBe(true);
    expect(detail.ingredients.map((i) => i.ingredient.id)).toEqual(["chorizo", "huevo"]);
    expect(detail.steps).toEqual([{ position: 1, text: "Freír el chorizo.", timer_seconds: 300, timer_label: "Chorizo", uses: ["chorizo"] }]);
    expect(detail.history[0]).toMatchObject({ stars: 4, note: "Menos sal", planned: false });
    const chorizo = await env.DB.prepare("SELECT aisle, pantry FROM ingredients WHERE id = 'chorizo'").first();
    expect(chorizo).toEqual({ aisle: "embutidos-quesos", pantry: 0 });
  });

  it("es atómico y valida: id distinto, receta inexistente o inválida no escriben nada", async () => {
    const before = await (await send("GET", "/recipes/base")).json<RecipeDetail>();
    expect((await send("PUT", "/recipes/base", recipe("otra"))).status).toBe(400);
    expect((await send("PUT", "/recipes/no-existe", recipe("no-existe"))).status).toBe(404);
    const bad = await send("PUT", "/recipes/base", recipe("base", { steps: [] }));
    expect(bad.status).toBe(400);
    expect((await bad.json<ApiError>()).errors?.[0]?.field).toBe("steps");
    expect(await (await send("GET", "/recipes/base")).json()).toEqual(before);
  });
});

describe("exportar e importar", () => {
  it("ida y vuelta: export → import con replace da la misma receta", async () => {
    await send("POST", "/recipes/import?replace=true", recipe("ida-vuelta", {
      steps: [...katsukare.steps.slice(0, 2), { text: "Añade el agua.", uses: ["Agua"], timer_seconds: 60, timer_label: "Agua" }],
    }));
    const exported = await (await send("GET", "/recipes/ida-vuelta/export")).json<Record<string, unknown>>();
    expect(exported.format).toBe("menu-familiar/recipe@1");
    const before = await (await send("GET", "/recipes/ida-vuelta")).json<RecipeDetail>();
    expect((await send("POST", "/recipes/import?replace=true", exported)).status).toBe(200);
    const after = await (await send("GET", "/recipes/ida-vuelta")).json<RecipeDetail>();
    expect({ ...after, updated_at: "" }).toEqual({ ...before, updated_at: "" });
    expect(await (await send("GET", "/recipes/ida-vuelta/export")).json()).toEqual(exported);
    expect(exportRecipe(after)).toEqual(exported);
    expect(improveRequestText(after)).toContain('"id": "ida-vuelta"');
  });
});

describe("archivar", () => {
  it("PATCH archived y las archivadas no salen en el selector ni en el contexto para Claude", async () => {
    await send("POST", "/recipes/import?replace=true", recipe("archivable"));
    await send("POST", "/plan/batch", { meals: [{ date: "2027-02-01", slot: "lunch", status: "planned", recipe_id: "archivable" }] });
    const res = await send("PATCH", "/recipes/archivable", { archived: true });
    expect(res.status).toBe(200);
    expect((await send("PATCH", "/recipes/archivable", { archived: "si" })).status).toBe(400);
    expect((await send("PATCH", "/recipes/no-existe", { archived: true })).status).toBe(404);

    const list = await (await send("GET", "/recipes")).json<RecipeSummary[]>();
    expect(list.map((r) => r.id)).not.toContain("archivable");
    const withArchived = await (await send("GET", "/recipes?include_archived=true")).json<RecipeSummary[]>();
    expect(withArchived.find((r) => r.id === "archivable")).toMatchObject({ archived: true, has_freezer: true });
    expect(withArchived.find((r) => r.id === "archivable")?.ingredient_names).toContain("arroz");

    const context = await (await send("GET", "/claude-context?week=2027-02-01")).json<ReturnType<typeof buildClaudeContext>>();
    expect(JSON.stringify(context.recipes)).not.toContain("archivable");
    // La comida ya planificada no se toca.
    const plan = await (await send("GET", "/plan?from=2027-02-01&to=2027-02-01")).json<{ days: { lunch: { recipe: { id: string } | null } }[] }>();
    expect(plan.days[0]?.lunch.recipe?.id).toBe("archivable");
  });
});

describe("cocinar ahora", () => {
  it("el cook_log sin plan queda con plan_meal a null y sale en el historial", async () => {
    const res = await send("POST", "/cook-logs", { recipe_id: "base", cooked_at: "2026-10-03T19:30:00Z", stars: 5, note: null });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT plan_meal_date, plan_meal_slot FROM cook_logs WHERE recipe_id = 'base' ORDER BY id DESC LIMIT 1").first();
    expect(row).toEqual({ plan_meal_date: null, plan_meal_slot: null });
    const detail = await (await send("GET", "/recipes/base")).json<RecipeDetail>();
    // 21:30 en Madrid → cena.
    expect(detail.history[0]).toMatchObject({ date: "2026-10-03", slot: "dinner", planned: false, stars: 5, note: null });
  });
});

describe("Compra: receta editada", () => {
  it("editar una receta de la lista activa aparece como cambio y Actualizar lo resuelve", async () => {
    await send("POST", "/plan/batch", {
      meals: [
        { date: "2027-04-05", slot: "lunch", status: "planned", recipe_id: "base" },
        { date: "2027-04-06", slot: "dinner", status: "planned", recipe_id: "base" },
      ],
    });
    await send("POST", "/shopping", { from: "2027-04-05", to: "2027-04-06" });
    expect((await (await send("GET", "/shopping")).json<ShoppingListResponse>()).changes).toBeNull();

    // La foto no cuenta como cambio de receta.
    await env.DB.prepare("UPDATE recipes SET cover_photo_key = 'x.jpg' WHERE id = 'base'").run();
    expect((await (await send("GET", "/shopping")).json<ShoppingListResponse>()).changes).toBeNull();

    await send("PUT", "/recipes/base", recipe("base", { title: "Lentejas caseras" }));
    const list = await (await send("GET", "/shopping")).json<ShoppingListResponse>();
    expect(list.changes).toEqual({ count: 1, first: "Lentejas caseras: la receta ha cambiado." });
    await send("POST", "/shopping/update");
    expect((await (await send("GET", "/shopping")).json<ShoppingListResponse>()).changes).toBeNull();
  });
});
