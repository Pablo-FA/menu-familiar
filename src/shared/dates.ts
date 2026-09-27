/** Utilidades de fecha y hora en la zona de la familia (Europe/Madrid). */

export const TIME_ZONE = "Europe/Madrid";
/** A partir de esta hora (local) se muestra la cena en vez de la comida. */
export const DINNER_FROM_HOUR = 17;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Fecha (YYYY-MM-DD) y hora (0–23) en Madrid para un instante dado. */
export function madridNow(now: Date = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(partsFormatter.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** true si es una fecha real con formato YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function utcNoon(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

const weekdayLong = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" });
const weekdayShort = new Intl.DateTimeFormat("es-ES", { weekday: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" });

/** "sábado" */
export function weekdayName(date: string): string {
  return weekdayLong.format(utcNoon(date));
}

/** "4 de octubre" */
export function longDate(date: string): string {
  return `${utcNoon(date).getUTCDate()} de ${monthLong.format(utcNoon(date))}`;
}

/** "sáb 4 oct" */
export function shortDate(date: string): string {
  const d = utcNoon(date);
  const clean = (s: string) => s.replace(/\.$/, "");
  return `${clean(weekdayShort.format(d))} ${d.getUTCDate()} ${clean(monthShort.format(d))}`;
}
