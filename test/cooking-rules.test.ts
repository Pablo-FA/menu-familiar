import { describe, expect, it } from "vitest";
import type { RecipeIngredient } from "../src/shared/api";
import { PROGRESS_TTL_MS, parseProgress } from "../src/shared/cook-progress";
import { nameVariants, stepIngredients } from "../src/shared/step-ingredients";
import { formatCountdown, isDone, newlyFinished, remainingMs, startTimer, timerProgress } from "../src/shared/timers";

function ing(position: number, id: string, name: string): RecipeIngredient {
  return {
    position,
    display_text: name,
    quantity: 1,
    unit: "ud",
    estimated: false,
    ingredient: { id, name, aisle: "otros", pantry: false },
  };
}

const ingredients = [
  ing(1, "patata", "patata"),
  ing(2, "ajo", "ajo"),
  ing(3, "limon", "limón"),
  ing(4, "pechuga-de-pollo", "pechuga de pollo"),
  ing(5, "sal", "sal"),
  ing(6, "aceite-de-oliva", "aceite de oliva"),
];

const names = (text: string, uses: string[] | null = null) => stepIngredients({ text, uses }, ingredients).map((i) => i.ingredient.id);

describe("ingredientes de un paso", () => {
  it("encuentra nombres sin importar tildes ni mayúsculas", () => {
    expect(names("Exprime el LIMON y añade la sal.")).toEqual(["limon", "sal"]);
  });

  it("acepta el plural simple (+s, +es) y en nombres compuestos el de la primera palabra", () => {
    expect(names("Pela las patatas y los ajos.")).toEqual(["patata", "ajo"]);
    expect(names("Ralla dos limones.")).toEqual(["limon"]);
    expect(names("Fríe las pechugas de pollo con aceite de oliva.")).toEqual(["pechuga-de-pollo", "aceite-de-oliva"]);
  });

  it("solo palabras completas: sin falsos positivos dentro de otras palabras", () => {
    expect(names("Es un trabajo sencillo: deja la salsa reposar en la salsera.")).toEqual([]);
    expect(names("Sirve en platos hondos.")).toEqual([]);
  });

  it("si el paso trae uses, manda uses (en el orden de la receta)", () => {
    expect(names("Remueve todo.", ["sal", "patata"])).toEqual(["patata", "sal"]);
    expect(names("Exprime el limón.", [])).toEqual([]);
  });

  it("genera las variantes esperadas", () => {
    expect(nameVariants("Limón")).toEqual(["limon", "limones", "limons"]);
    expect(nameVariants("cebolla")).toEqual(["cebolla", "cebollas"]);
  });
});

describe("temporizadores con hora de fin", () => {
  const t0 = 1_000_000;
  const timer = startTimer(5, 600, null, t0);

  it("calcula el restante a partir de la hora de fin, no de un contador", () => {
    expect(timer).toMatchObject({ id: "step-5", label: "Paso 5", endsAt: t0 + 600_000, notified: false });
    expect(remainingMs(timer, t0 + 59_000)).toBe(541_000);
    // Tras una recarga (otra instancia, mismo endsAt) el resultado es el mismo.
    expect(remainingMs(JSON.parse(JSON.stringify(timer)), t0 + 59_000)).toBe(541_000);
  });

  it("progreso, fin y formato", () => {
    expect(timerProgress(timer, t0)).toBe(0);
    expect(timerProgress(timer, t0 + 300_000)).toBe(0.5);
    expect(isDone(timer, t0 + 599_999)).toBe(false);
    expect(isDone(timer, t0 + 600_000)).toBe(true);
    expect(remainingMs(timer, t0 + 700_000)).toBe(0);
    expect(timerProgress(timer, t0 + 700_000)).toBe(1);
    expect(formatCountdown(600_000)).toBe("10:00");
    expect(formatCountdown(400)).toBe("00:01");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
  });

  it("usa timer_label como nombre si existe", () => {
    expect(startTimer(2, 60, "Horno", t0).label).toBe("Horno");
  });

  it("detecta los que acaban de terminar y aún no se avisaron", () => {
    const a = startTimer(1, 60, "A", t0);
    const b = { ...startTimer(2, 30, "B", t0), notified: true };
    const c = startTimer(3, 600, "C", t0);
    expect(newlyFinished([a, b, c], t0 + 61_000).map((t) => t.id)).toEqual(["step-1"]);
  });
});

describe("progreso guardado", () => {
  const now = 50_000_000;

  it("se retoma si tiene menos de 12 h", () => {
    const raw = JSON.stringify({ step: 3, checked: [1, 4], timers: [], finished: false, savedAt: now - 60_000 });
    expect(parseProgress(raw, now)).toMatchObject({ step: 3, checked: [1, 4] });
  });

  it("se descarta pasadas 12 h, si no hay nada o si está corrupto", () => {
    const old = JSON.stringify({ step: 3, checked: [], timers: [], savedAt: now - PROGRESS_TTL_MS - 1 });
    expect(parseProgress(old, now)).toBeNull();
    expect(parseProgress(null, now)).toBeNull();
    expect(parseProgress("{no json", now)).toBeNull();
  });
});
