import { describe, expect, it } from "vitest";
import { weekBalance } from "../src/shared/balance";
import { buildClaudeContext, claudeContextText, madridIsoWithOffset, type ContextRecipe } from "../src/shared/claude-context";
import { madridNow } from "../src/shared/dates";
import { filterAndSort, lastCookedLabel, type PickerFilters, type PickerRecipe } from "../src/shared/picker";
import { extractPlan } from "../src/shared/plan-extract";
import {
  dateRangeLabel,
  dayTitle,
  missingLabel,
  monthGrid,
  mondayOf,
  weekMonth,
  weekRangeLabel,
  weekRelation,
  weekToOpen,
} from "../src/shared/week";

describe("semanas", () => {
  it("empiezan en lunes", () => {
    expect(mondayOf("2026-10-05")).toBe("2026-10-05"); // lunes
    expect(mondayOf("2026-10-08")).toBe("2026-10-05"); // jueves
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // domingo
    expect(mondayOf("2027-01-01")).toBe("2026-12-28"); // cruza el año
  });

  it("el domingo abre la semana siguiente; el resto de días, la actual", () => {
    expect(weekToOpen("2026-10-10")).toBe("2026-10-05"); // sábado
    expect(weekToOpen("2026-10-11")).toBe("2026-10-12"); // domingo
    expect(weekToOpen("2026-10-12")).toBe("2026-10-12"); // lunes
  });

  it("usa la fecha de Madrid, también en los cambios de hora", () => {
    // Domingo 25 oct 2026, 23:30 en Madrid (ya en horario de invierno, UTC+1) = 22:30 UTC.
    const lateSunday = madridNow(new Date("2026-10-25T22:30:00Z"));
    expect(lateSunday).toEqual({ date: "2026-10-25", hour: 23 });
    expect(weekToOpen(lateSunday.date)).toBe("2026-10-26");
    // 00:30 del lunes en Madrid es todavía domingo en UTC.
    expect(madridNow(new Date("2026-10-25T23:30:00Z")).date).toBe("2026-10-26");
    // Domingo 29 mar 2026 (cambio a horario de verano): 23:30 en Madrid = 21:30 UTC.
    expect(madridNow(new Date("2026-03-29T21:30:00Z"))).toEqual({ date: "2026-03-29", hour: 23 });
    expect(madridIsoWithOffset(new Date("2026-10-04T17:30:00Z"))).toBe("2026-10-04T19:30:00+02:00");
    expect(madridIsoWithOffset(new Date("2026-11-04T18:30:00Z"))).toBe("2026-11-04T19:30:00+01:00");
  });

  it("el mes de la semana es el de su jueves y la cuadrícula empieza en lunes", () => {
    expect(weekMonth("2026-09-28")).toEqual({ year: 2026, month: 10 });
    expect(monthGrid(2026, 10)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(monthGrid(2026, 3)).toHaveLength(6); // marzo de 2026 ocupa 6 filas
  });

  it("textos de cabecera", () => {
    expect(weekRangeLabel("2026-10-05")).toBe("5 – 11 oct");
    expect(weekRangeLabel("2026-09-28")).toBe("28 sep – 4 oct");
    expect(dateRangeLabel("2026-10-06", "2026-10-09")).toBe("6 – 9 oct");
    expect(weekRelation("2026-10-05", "2026-10-04")).toBe("semana que viene");
    expect(weekRelation("2026-09-28", "2026-10-04")).toBe("esta semana");
    expect(weekRelation("2026-09-21", "2026-10-04")).toBe("semana pasada");
    expect(weekRelation("2026-10-12", "2026-10-04")).toBeNull();
    expect([missingLabel(6), missingLabel(1), missingLabel(0)]).toEqual(["faltan 6", "falta 1", "completa"]);
    expect(dayTitle("2026-10-06")).toBe("Martes 6");
    expect(dayTitle("2026-10-07", true)).toBe("Miércoles 7 de octubre");
  });
});

describe("equilibrio de la semana", () => {
  it("cuenta franjas planificadas por proteína y marca las que no llegan al mínimo", () => {
    const slots = [
      { status: "planned", protein: "legumbre" as const },
      { status: "planned", protein: "legumbre" as const },
      { status: "planned", protein: "pescado" as const },
      { status: "planned", protein: "pescado" as const },
      { status: "planned", protein: "pescado" as const },
      { status: "planned", protein: "verdura" as const },
      { status: "away", protein: null },
      { status: "empty", protein: null },
    ];
    const items = Object.fromEntries(weekBalance(slots).map((i) => [i.protein, i]));
    expect(weekBalance(slots).map((i) => i.protein)).toEqual(["verdura", "legumbre", "huevo", "pescado", "ave", "carne"]);
    expect(items.legumbre).toMatchObject({ count: 2, minimum: 4, tone: "below" });
    expect(items.pescado).toMatchObject({ count: 3, minimum: 3, tone: "ok" });
    expect(items.verdura).toMatchObject({ count: 1, minimum: null, tone: "ok" });
    expect(items.carne).toMatchObject({ count: 0, minimum: null, tone: "zero" });
  });
});

describe("selector de recetas", () => {
  const r = (id: string, extra: Partial<PickerRecipe> = {}): PickerRecipe => ({
    id,
    title: id,
    minutes: 30,
    protein: "verdura",
    suits: "both",
    course: "main",
    archived: false,
    last_cooked: null,
    avg_stars: null,
    ...extra,
  });
  const recipes = [
    r("Crema de calabaza", { last_cooked: "2026-09-20", avg_stars: 4.5, minutes: 30 }),
    r("Lentejas", { protein: "legumbre", suits: "lunch", minutes: 50, last_cooked: "2026-09-01", avg_stars: 4 }),
    r("Salmón al horno", { protein: "pescado", suits: "dinner", minutes: 25, avg_stars: 5, last_cooked: "2026-09-25" }),
    r("Ñoquis", { minutes: 20 }),
    r("Pan harcha", { course: "side" }),
    r("Archivada", { archived: true }),
  ];
  const base: PickerFilters = { slot: "dinner", query: "", quick: false, protein: null, includeOther: false, sort: "oldest" };
  const ids = (f: Partial<PickerFilters>) => filterAndSort(recipes, { ...base, ...f }).map((x) => x.id);

  it("solo platos principales no archivados de esa franja (o 'both')", () => {
    expect(ids({})).toEqual(["Ñoquis", "Crema de calabaza", "Salmón al horno"]);
    expect(ids({ includeOther: true })).toContain("Lentejas");
  });

  it("orden 'hace más tiempo': primero las nunca hechas, luego la más antigua", () => {
    expect(ids({ includeOther: true })).toEqual(["Ñoquis", "Lentejas", "Crema de calabaza", "Salmón al horno"]);
  });

  it("orden por valoración y por rapidez", () => {
    expect(ids({ sort: "best" })).toEqual(["Salmón al horno", "Crema de calabaza", "Ñoquis"]);
    expect(ids({ sort: "fastest" })).toEqual(["Ñoquis", "Salmón al horno", "Crema de calabaza"]);
  });

  it("buscador sin tildes ni mayúsculas, ≤ 45 min y proteína", () => {
    expect(ids({ query: "SALMON" })).toEqual(["Salmón al horno"]);
    expect(ids({ query: "noq" })).toEqual(["Ñoquis"]);
    expect(ids({ includeOther: true, quick: true })).not.toContain("Lentejas");
    expect(ids({ protein: "pescado" })).toEqual(["Salmón al horno"]);
  });

  it("texto de la última vez", () => {
    expect(lastCookedLabel(null, "2026-10-04")).toBe("Sin estrenar");
    expect(lastCookedLabel("2026-10-04", "2026-10-04")).toBe("Hecha hoy");
    expect(lastCookedLabel("2026-10-03", "2026-10-04")).toBe("Hecha ayer");
    expect(lastCookedLabel("2026-09-28", "2026-10-04")).toBe("Hecha hace 6 días");
    expect(lastCookedLabel("2026-09-20", "2026-10-04")).toBe("Hecha hace 2 semanas");
  });
});

describe("extraer el plan de un texto pegado", () => {
  const plan = { format: "menu-familiar/plan@1", meals: [{ date: "2026-10-06", slot: "dinner", recipe_id: "x" }] };

  it("JSON puro", () => {
    expect(extractPlan(JSON.stringify(plan))).toEqual(plan);
  });

  it("bloque ```json con texto alrededor", () => {
    const text = `¡Aquí tienes!\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n\n¿Quieres cambios?`;
    expect(extractPlan(text)).toEqual(plan);
  });

  it("JSON en medio del texto, sin bloque, aunque haya otras llaves antes", () => {
    const text = `Notas {sin json} y un objeto {"a": 1}. El menú: ${JSON.stringify(plan)} — fin. Texto con "comillas {".`;
    expect(extractPlan(text)).toEqual(plan);
  });

  it("ignora JSON de otro formato y devuelve null si no hay plan", () => {
    expect(extractPlan('```json\n{"format":"menu-familiar/recipe@1"}\n```')).toBeNull();
    expect(extractPlan("hola")).toBeNull();
  });
});

describe("contexto@1 para Claude", () => {
  const recipe = (id: string, extra: Partial<ContextRecipe> = {}): ContextRecipe => ({
    id,
    title: id,
    minutes: 30,
    protein: "verdura",
    suits: "both",
    course: "main",
    archived: false,
    kcal_adult: null,
    tags: [],
    freezer_note: null,
    times_cooked: 0,
    last_cooked: null,
    avg_stars: null,
    ...extra,
  });

  const ctx = buildClaudeContext({
    now: new Date("2026-10-04T17:30:00Z"),
    today: "2026-10-04",
    monday: "2026-10-05",
    plan: [
      { date: "2026-10-05", slot: "lunch", status: "away", recipe_id: null, note: null },
      { date: "2026-10-05", slot: "dinner", status: "planned", recipe_id: "crema", note: null },
      { date: "2026-10-06", slot: "lunch", status: "empty", recipe_id: null, note: null },
      { date: "2026-09-28", slot: "dinner", status: "planned", recipe_id: "crema", note: null, stars: 4 },
      { date: "2026-09-14", slot: "lunch", status: "planned", recipe_id: "crema", note: null, stars: null }, // 21 días antes
      { date: "2026-09-13", slot: "lunch", status: "planned", recipe_id: "viejo", note: null }, // 22 días: fuera
    ],
    recipes: [
      recipe("crema", { kcal_adult: 450, tags: ["otoño"], times_cooked: 2, last_cooked: "2026-09-28", avg_stars: 4.5 }),
      recipe("pan", { course: "side" }),
      recipe("vieja", { archived: true }),
    ],
    ratings: [
      ...Array.from({ length: 45 }, (_, i) => ({
        date: `2026-08-${String(30 - (i % 28)).padStart(2, "0")}`,
        slot: "dinner" as const,
        recipe_id: `r${i}`,
        stars: 3,
        note: null,
      })),
    ],
  });

  it("semana, huecos y lo ya planificado", () => {
    expect(ctx.format).toBe("menu-familiar/contexto@1");
    expect(ctx.generated_at).toBe("2026-10-04T19:30:00+02:00");
    expect(ctx.week).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(ctx.empty_slots).toHaveLength(12);
    expect(ctx.empty_slots[0]).toEqual({ date: "2026-10-06", slot: "lunch" });
    expect(ctx.planned).toEqual([
      { date: "2026-10-05", slot: "lunch", status: "away" },
      { date: "2026-10-05", slot: "dinner", recipe_id: "crema" },
    ]);
  });

  it("historial de 21 días, solo platos principales y como mucho 40 valoraciones", () => {
    expect(ctx.recent_meals).toEqual([
      { date: "2026-09-28", slot: "dinner", recipe_id: "crema", stars: 4 },
      { date: "2026-09-14", slot: "lunch", recipe_id: "crema" },
    ]);
    expect(ctx.recipes).toEqual([
      { id: "crema", title: "crema", minutes: 30, protein: "verdura", suits: "both", kcal_adult: 450, tags: ["otoño"], times_cooked: 2, last_cooked: "2026-09-28", avg_stars: 4.5 },
    ]);
    expect(ctx.ratings).toHaveLength(40);
    expect(ctx.ratings[0]).toEqual({ date: "2026-08-30", slot: "dinner", recipe_id: "r0", stars: 3 });
  });

  it("el texto copiado lleva la instrucción y el JSON compacto", () => {
    const text = claudeContextText(ctx);
    expect(text.startsWith("Planifica la semana del 5 al 11 de octubre para Menú familiar.")).toBe(true);
    expect(text).toContain("```json\n{\"format\":\"menu-familiar/contexto@1\"");
  });
});
