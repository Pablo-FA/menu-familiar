import { TIME_ZONE, addDays } from "./dates";
import { SLOTS, type Slot } from "./recipe-format";
import { weekDays } from "./week";

export const CONTEXT_FORMAT = "menu-familiar/contexto@1";
/** Días anteriores al lunes que se envían como historial reciente. */
export const RECENT_DAYS = 21;
/** Valoraciones (con estrellas o nota) que se envían, de la más reciente a la más antigua. */
export const MAX_RATINGS = 40;

export interface ContextPlanRow {
  date: string;
  slot: Slot;
  status: "planned" | "away" | "empty";
  recipe_id: string | null;
  note: string | null;
  stars?: number | null;
}

export interface ContextRecipe {
  id: string;
  title: string;
  minutes: number;
  protein: string;
  suits: string;
  course: string;
  archived: boolean;
  kcal_adult: number | null;
  tags: string[];
  freezer_note: string | null;
  times_cooked: number;
  last_cooked: string | null;
  avg_stars: number | null;
}

export interface ContextRating {
  date: string;
  slot: Slot | null;
  recipe_id: string;
  stars: number | null;
  note: string | null;
}

export interface ClaudeContext {
  format: typeof CONTEXT_FORMAT;
  generated_at: string;
  week: { from: string; to: string };
  empty_slots: { date: string; slot: Slot }[];
  planned: Record<string, unknown>[];
  recent_meals: Record<string, unknown>[];
  recipes: Record<string, unknown>[];
  ratings: Record<string, unknown>[];
}

/** Quita las claves null/undefined y los arrays vacíos (el texto copiado es más corto). */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)),
  );
}

/** "2026-10-04T19:30:00+02:00": hora local de Madrid con su desfase. */
export function madridIsoWithOffset(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const offset = String(parts.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export function buildClaudeContext(input: {
  now: Date;
  today: string;
  monday: string;
  /** Franjas de la semana y de los RECENT_DAYS días anteriores (stars del cook_log si lo hay). */
  plan: ContextPlanRow[];
  recipes: ContextRecipe[];
  /** cook_logs ordenados del más reciente al más antiguo. */
  ratings: ContextRating[];
}): ClaudeContext {
  const sunday = addDays(input.monday, 6);
  const recentFrom = addDays(input.monday, -RECENT_DAYS);
  const byKey = new Map(input.plan.map((r) => [`${r.date}#${r.slot}`, r]));

  const empty_slots = weekDays(input.monday).flatMap((date) =>
    SLOTS.filter((slot) => {
      const row = byKey.get(`${date}#${slot}`);
      return date >= input.today && (!row || row.status === "empty");
    }).map((slot) => ({ date, slot })),
  );

  const planned = input.plan
    .filter((r) => r.date >= input.monday && r.date <= sunday && r.status !== "empty")
    .map((r) => compact({ date: r.date, slot: r.slot, status: r.status === "away" ? "away" : undefined, recipe_id: r.recipe_id, note: r.note }));

  const recent_meals = input.plan
    .filter((r) => r.date >= recentFrom && r.date < input.monday && r.status === "planned" && r.recipe_id)
    .map((r) => compact({ date: r.date, slot: r.slot, recipe_id: r.recipe_id, stars: r.stars }));

  const recipes = input.recipes
    .filter((r) => r.course === "main" && !r.archived)
    .map((r) =>
      compact({
        id: r.id,
        title: r.title,
        minutes: r.minutes,
        protein: r.protein,
        suits: r.suits,
        kcal_adult: r.kcal_adult,
        tags: r.tags,
        freezer_note: r.freezer_note,
        times_cooked: r.times_cooked,
        last_cooked: r.last_cooked,
        avg_stars: r.avg_stars,
      }),
    );

  const ratings = input.ratings
    .filter((r) => r.stars !== null || (r.note ?? "") !== "")
    .slice(0, MAX_RATINGS)
    .map((r) => compact({ date: r.date, slot: r.slot, recipe_id: r.recipe_id, stars: r.stars, note: r.note }));

  return {
    format: CONTEXT_FORMAT,
    generated_at: madridIsoWithOffset(input.now),
    week: { from: input.monday, to: sunday },
    empty_slots,
    planned,
    recent_meals,
    recipes,
    ratings,
  };
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Texto que se copia al portapapeles: instrucción corta + el contexto en un bloque ```json. */
export function claudeContextText(context: ClaudeContext): string {
  const from = context.week.from;
  const to = context.week.to;
  const d = (s: string) => Number(s.slice(8, 10));
  const m = (s: string) => MONTHS[Number(s.slice(5, 7)) - 1] ?? "";
  const range = m(from) === m(to) ? `del ${d(from)} al ${d(to)} de ${m(to)}` : `del ${d(from)} de ${m(from)} al ${d(to)} de ${m(to)}`;
  return [
    `Planifica la semana ${range} para Menú familiar. Rellena los huecos y devuélveme el menú en formato menu-familiar/plan@1 dentro de un bloque \`\`\`json. Si propones una receta que no está en mi recetario, inclúyela completa (recipe@1) en "recipes". No cambies lo ya planificado salvo que te lo pida. Mis datos:`,
    "",
    "```json",
    JSON.stringify(context),
    "```",
  ].join("\n");
}
