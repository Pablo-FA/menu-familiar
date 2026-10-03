import { addDays } from "./dates";

/** Las semanas van de lunes a domingo. Las fechas son cadenas AAAA-MM-DD (sin hora ni zona). */

/** 1 = lunes … 7 = domingo. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * Semana que abre el Planificador: la de hoy, salvo el domingo, que abre la siguiente
 * (es la que se planifica ese día). `today` es la fecha de hoy en Madrid (madridNow).
 */
export function weekToOpen(today: string): string {
  return isoWeekday(today) === 7 ? addDays(mondayOf(today), 7) : mondayOf(today);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** El mes de una semana es el de su jueves (como en la ISO 8601). */
export function weekMonth(monday: string): { year: number; month: number } {
  const thursday = addDays(monday, 3);
  return { year: Number(thursday.slice(0, 4)), month: Number(thursday.slice(5, 7)) };
}

/** Lunes de cada fila de la cuadrícula del mes (5 o 6 filas, empezando en lunes). */
export function monthGrid(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`, -1);
  const rows: string[] = [];
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) rows.push(monday);
  return rows;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
export const WEEKDAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];
const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export function monthName(month: number): string {
  return MONTHS_LONG[month - 1] ?? "";
}

export function weekdayOf(date: string): string {
  return WEEKDAYS[isoWeekday(date) - 1] ?? "";
}

const day = (date: string) => Number(date.slice(8, 10));
const mon = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1] ?? "";

/** "oct" */
export const shortMonth = mon;

/** "5 – 11 oct", "28 sep – 4 oct". */
export function weekRangeLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  return mon(monday) === mon(sunday)
    ? `${day(monday)} – ${day(sunday)} ${mon(sunday)}`
    : `${day(monday)} ${mon(monday)} – ${day(sunday)} ${mon(sunday)}`;
}

/** Rango de fechas cualquiera con el mismo estilo ("5 – 11 oct"). */
export function dateRangeLabel(from: string, to: string): string {
  if (from === to) return `${day(from)} ${mon(from)}`;
  return mon(from) === mon(to) && from.slice(0, 4) === to.slice(0, 4)
    ? `${day(from)} – ${day(to)} ${mon(to)}`
    : `${day(from)} ${mon(from)} – ${day(to)} ${mon(to)}`;
}

/** "esta semana", "semana que viene", "semana pasada" o null. */
export function weekRelation(monday: string, today: string): string | null {
  const current = mondayOf(today);
  if (monday === current) return "esta semana";
  if (monday === addDays(current, 7)) return "semana que viene";
  if (monday === addDays(current, -7)) return "semana pasada";
  return null;
}

/** "faltan 6", "falta 1", "completa". */
export function missingLabel(missing: number): string {
  if (missing === 0) return "completa";
  return missing === 1 ? "falta 1" : `faltan ${missing}`;
}

/**
 * Textos del Planificador para una semana. Los huecos vacíos se cuentan desde hoy (los
 * de días pasados ya no se van a planificar); una semana terminada no lleva contador.
 * `emptyDates`: la fecha de cada franja vacía de la semana (repetida si hay dos).
 */
export function weekStatus(monday: string, today: string, emptyDates: string[]): { header: string; bar: string; missing: number | null } {
  const relation = weekRelation(monday, today);
  if (addDays(monday, 6) < today) {
    return {
      header: [weekRangeLabel(monday), relation].filter(Boolean).join(" · "),
      bar: relation === "semana pasada" ? "Semana pasada" : "Semana terminada",
      missing: null,
    };
  }
  const missing = emptyDates.filter((d) => d >= today).length;
  return {
    header: [weekRangeLabel(monday), relation, missingLabel(missing)].filter(Boolean).join(" · "),
    bar: missing === 0 ? "Semana completa" : missing === 1 ? "Falta 1 comida" : `Faltan ${missing} comidas`,
    missing,
  };
}

/** "Martes 6", "Martes 6 de octubre". */
export function dayTitle(date: string, withMonth = false): string {
  const name = weekdayOf(date);
  const base = `${name.charAt(0).toUpperCase()}${name.slice(1)} ${day(date)}`;
  return withMonth ? `${base} de ${monthName(Number(date.slice(5, 7))).toLowerCase()}` : base;
}

export function isWeekend(date: string): boolean {
  return isoWeekday(date) >= 6;
}
