import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlanMealWrite, PlanRangeResponse, PlanSlotInfo, RecipeSummary } from "../../shared/api";
import { addDays, DINNER_FROM_HOUR, madridNow, shortDate } from "../../shared/dates";
import { QUICK_MINUTES } from "../../shared/picker";
import { SLOTS, type Slot } from "../../shared/recipe-format";
import { weekdayOf } from "../../shared/week";
import { api } from "../api";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import styles from "./Recipes.module.css";

const DAYS = 14;
const SLOT_UPPER: Record<Slot, string> = { lunch: "COMIDA", dinner: "CENA" };
const EMPTY: PlanSlotInfo = { status: "empty", note: null, recipe: null, cook_log: null };
const keyOf = (date: string, slot: Slot) => `${date}#${slot}`;

/** "Hoy", "Lun 5". */
function dayLabel(date: string, today: string): string {
  if (date === today) return "Hoy";
  const [weekday = "", day = ""] = shortDate(date).split(" ");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}`;
}

/** Hoja «Añadir al menú»: los próximos 14 días; tocar un hueco pone ahí la receta (con Deshacer). */
export function AddToMenuSheet({
  recipe,
  onClose,
}: {
  recipe: Pick<RecipeSummary, "id" | "title" | "minutes" | "photo_url" | "protein" | "suits">;
  onClose: () => void;
}) {
  const [now] = useState(() => madridNow());
  const today = now.date;
  const to = addDays(today, DAYS - 1);
  const [slots, setSlots] = useState<Map<string, PlanSlotInfo> | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    api
      .get<PlanRangeResponse>(`/plan?from=${today}&to=${to}`)
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, PlanSlotInfo>();
        for (const d of res.days) for (const s of SLOTS) map.set(keyOf(d.date, s), d[s]);
        setSlots(map);
      })
      .catch(() => !cancelled && toast({ message: "No se ha podido cargar el menú" }));
    return () => {
      cancelled = true;
    };
  }, [today, to, toast]);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const info = (date: string, slot: Slot) => slots?.get(keyOf(date, slot)) ?? EMPTY;
  const isPast = (date: string, slot: Slot) => date === today && slot === "lunch" && now.hour >= DINNER_FROM_HOUR;

  async function write(changes: PlanMealWrite[], local: Map<string, PlanSlotInfo>) {
    await api.post("/plan/batch", { meals: changes });
    setSlots(local);
  }

  async function assign(date: string, slot: Slot) {
    if (!slots) return;
    const current = info(date, slot);
    if (current.recipe?.id === recipe.id) return;
    const previous: PlanMealWrite = { date, slot, status: current.status, recipe_id: current.recipe?.id ?? null, note: current.note };
    const next = new Map(slots).set(keyOf(date, slot), {
      status: "planned",
      note: current.note,
      recipe: { id: recipe.id, title: recipe.title, minutes: recipe.minutes, protein: recipe.protein, suits: recipe.suits, photo_url: recipe.photo_url },
      cook_log: null,
    });
    try {
      await write([{ date, slot, status: "planned", recipe_id: recipe.id, note: current.note }], next);
    } catch {
      toast({ message: "No se ha podido añadir al menú" });
      return;
    }
    const before = slots;
    toast({
      message: current.recipe ? `Sustituye a ${current.recipe.title}` : `Añadida al ${weekdayOf(date)} ${Number(date.slice(8, 10))}`,
      action: {
        label: "Deshacer",
        onClick: () =>
          void write([previous], before)
            .then(() => toast({ message: "Deshecho" }))
            .catch(() => toast({ message: "No se ha podido deshacer" })),
      },
    });
  }

  return (
    <Sheet
      label="Añadir al menú"
      onClose={onClose}
      top="calc(var(--safe-top) + 70px)"
      head={
        <div className={styles.sheetHead}>
          <div className={styles.sheetHeadText}>
            <h2 className={styles.sheetTitle}>Añadir al menú</h2>
            <p className={styles.sheetSub}>
              {recipe.title} · {recipe.minutes} min
            </p>
            {recipe.minutes > QUICK_MINUTES && <p className={styles.amberLine}>Pasa de {QUICK_MINUTES} min: mejor en fin de semana.</p>}
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
    >
      {!slots ? (
        <p className={styles.muted}>Cargando…</p>
      ) : (
        <ul className={styles.planDays}>
          {days.map((date) => (
            <li key={date} className={styles.planDay}>
              <span className={styles.planDayLabel}>{dayLabel(date, today)}</span>
              {SLOTS.map((slot) => {
                const i = info(date, slot);
                const mine = i.recipe?.id === recipe.id;
                const kind = mine ? "mine" : i.recipe ? "recipe" : i.status === "away" ? "away" : "free";
                const content = mine ? `✓ ${recipe.title}` : i.recipe ? i.recipe.title : i.status === "away" ? "Fuera de casa" : "Libre";
                return (
                  <button
                    key={slot}
                    type="button"
                    className={styles.planSlot}
                    data-kind={kind}
                    disabled={isPast(date, slot)}
                    aria-pressed={mine}
                    aria-label={`${dayLabel(date, today)}, ${slot === "lunch" ? "comida" : "cena"}: ${content}`}
                    onClick={() => void assign(date, slot)}
                  >
                    <span className={styles.planSlotLabel}>{SLOT_UPPER[slot]}</span>
                    <span className={styles.planSlotText}>
                      {mine && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                      {mine ? recipe.title : content}
                    </span>
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
