import { describe, expect, it } from "vitest";
import { addDays, isIsoDate, longDate, madridNow, shortDate, weekdayName } from "../src/shared/dates";
import { currentSlot, pastMealLabel, pickSlotToShow } from "../src/shared/meals";
import { pickRatingPrompt, type PastMeal } from "../src/shared/rating-prompt";
import { resolveTheme } from "../src/shared/theme";
import { formatQuantity } from "../src/client/format";

// 4 de octubre de 2026 (sábado). Madrid está en UTC+2 (horario de verano).
const at = (localTime: string) => new Date(`2026-10-04T${localTime}:00+02:00`);

describe("fechas en Madrid", () => {
  it("usa la fecha y la hora de Madrid, no las de UTC", () => {
    expect(madridNow(new Date("2026-10-04T23:30:00Z"))).toEqual({ date: "2026-10-05", hour: 1 });
    expect(madridNow(new Date("2026-12-31T22:59:00Z"))).toEqual({ date: "2026-12-31", hour: 23 });
  });

  it("valida y suma fechas", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-10-4")).toBe(false);
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("formatea en español", () => {
    expect(weekdayName("2026-10-04")).toBe("domingo");
    expect(longDate("2026-10-04")).toBe("4 de octubre");
    expect(shortDate("2026-10-03")).toBe("sáb 3 oct");
  });
});

describe("qué comida muestra Hoy", () => {
  const both = { lunch: true, dinner: true };

  it("antes de las 17:00 la comida y desde las 17:00 la cena", () => {
    expect(currentSlot(16)).toBe("lunch");
    expect(currentSlot(17)).toBe("dinner");
    expect(pickSlotToShow(9, both)).toBe("lunch");
    expect(pickSlotToShow(16, both)).toBe("lunch");
    expect(pickSlotToShow(17, both)).toBe("dinner");
    expect(pickSlotToShow(23, both)).toBe("dinner");
  });

  it("si la franja actual no tiene receta y la otra sí, muestra la otra", () => {
    expect(pickSlotToShow(10, { lunch: false, dinner: true })).toBe("dinner");
    expect(pickSlotToShow(20, { lunch: true, dinner: false })).toBe("lunch");
  });

  it("si ninguna tiene receta, no hay nada que mostrar", () => {
    expect(pickSlotToShow(10, { lunch: false, dinner: false })).toBeNull();
  });
});

describe("aviso de valoración", () => {
  const meal = (date: string, slot: "lunch" | "dinner", extra: Partial<PastMeal> = {}): PastMeal => ({
    date,
    slot,
    recipe_id: `${date}-${slot}`,
    rating_skipped_at: null,
    has_cook_log: false,
    ...extra,
  });

  it("por la mañana pregunta por la cena de ayer", () => {
    const pick = pickRatingPrompt([meal("2026-10-03", "lunch"), meal("2026-10-03", "dinner")], null, at("10:00"));
    expect(pick?.recipe_id).toBe("2026-10-03-dinner");
  });

  it("no pregunta por la comida de hoy hasta las 17:00, y desde entonces sí", () => {
    const meals = [meal("2026-10-03", "dinner", { has_cook_log: true }), meal("2026-10-04", "lunch")];
    expect(pickRatingPrompt(meals, null, at("16:59"))).toBeNull();
    expect(pickRatingPrompt(meals, null, at("17:00"))?.recipe_id).toBe("2026-10-04-lunch");
  });

  it("nunca pregunta por la cena de hoy ni por comidas futuras", () => {
    expect(pickRatingPrompt([meal("2026-10-04", "dinner"), meal("2026-10-05", "lunch")], null, at("23:00"))).toBeNull();
  });

  it("solo mira la más reciente: si ya está valorada no retrocede a otras", () => {
    const meals = [meal("2026-10-03", "lunch"), meal("2026-10-03", "dinner", { has_cook_log: true })];
    expect(pickRatingPrompt(meals, null, at("10:00"))).toBeNull();
  });

  it("si faltan comidas planificadas, la más reciente puede ser de días antes", () => {
    expect(pickRatingPrompt([meal("2026-10-02", "lunch")], null, at("10:00"))?.recipe_id).toBe("2026-10-02-lunch");
  });

  it("deja de preguntar pasados 2 días", () => {
    expect(pickRatingPrompt([meal("2026-10-01", "dinner")], null, at("10:00"))).toBeNull();
  });

  it("como mucho una vez al día: si hoy ya se pospuso o valoró, no pregunta", () => {
    const meals = [meal("2026-10-03", "dinner")];
    expect(pickRatingPrompt(meals, "2026-10-04T07:00:00.000Z", at("21:00"))).toBeNull(); // 09:00 de hoy
    expect(pickRatingPrompt(meals, "2026-10-03T21:30:00.000Z", at("08:00"))?.recipe_id).toBe("2026-10-03-dinner"); // 23:30 de ayer
  });

  it("etiqueta la comida en lenguaje natural", () => {
    expect(pastMealLabel("2026-10-03", "dinner", "2026-10-04", weekdayName)).toBe("Anoche cenasteis");
    expect(pastMealLabel("2026-10-03", "lunch", "2026-10-04", weekdayName)).toBe("Ayer comisteis");
    expect(pastMealLabel("2026-10-04", "lunch", "2026-10-04", weekdayName)).toBe("Hoy comisteis");
    expect(pastMealLabel("2026-10-02", "dinner", "2026-10-04", weekdayName)).toBe("El viernes cenasteis");
  });
});

describe("tema", () => {
  it("con el sistema en oscuro siempre es night", () => {
    expect(resolveTheme({ systemDark: true, todaySlot: "lunch", hour: 10 })).toBe("night");
    expect(resolveTheme({ systemDark: true, todaySlot: null, hour: 10 })).toBe("night");
  });

  it("en Hoy depende de la comida mostrada", () => {
    expect(resolveTheme({ systemDark: false, todaySlot: "lunch", hour: 21 })).toBe("day");
    expect(resolveTheme({ systemDark: false, todaySlot: "dinner", hour: 9 })).toBe("night");
  });

  it("en el resto depende de la hora", () => {
    expect(resolveTheme({ systemDark: false, todaySlot: null, hour: 16 })).toBe("day");
    expect(resolveTheme({ systemDark: false, todaySlot: null, hour: 17 })).toBe("night");
  });
});

describe("formato de cantidades", () => {
  it("combina cantidad y unidad, sin unidad para 'ud' y con ≈ si es estimada", () => {
    expect(formatQuantity({ quantity: 600, unit: "g", estimated: false })).toBe("600 g");
    expect(formatQuantity({ quantity: 2, unit: "ud", estimated: false })).toBe("2");
    expect(formatQuantity({ quantity: 1, unit: "cda", estimated: true })).toBe("≈ 1 cda");
    expect(formatQuantity({ quantity: 0.5, unit: "l", estimated: false })).toBe("0,5 l");
    expect(formatQuantity({ quantity: null, unit: null, estimated: true })).toBe("");
  });
});
