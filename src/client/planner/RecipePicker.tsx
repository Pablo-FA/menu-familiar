import { Check, LogOut, Search, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { PlanSlotInfo, RecipeSummary } from "../../shared/api";
import { PROTEIN_LABEL } from "../../shared/balance";
import { filterAndSort, formatStars, joinDays, lastCookedLabel, QUICK_MINUTES, type PickerSort } from "../../shared/picker";
import type { Protein, Slot } from "../../shared/recipe-format";
import { dayTitle, isWeekend, weekdayOf } from "../../shared/week";
import { Sheet } from "../components/Sheet";
import styles from "./Planner.module.css";
import { RecipeThumb } from "./RecipeThumb";

const SORT_LABEL: Record<PickerSort, string> = { oldest: "Hace más tiempo", best: "Mejor valoradas", fastest: "Más rápidas" };
const NEXT_SORT: Record<PickerSort, PickerSort> = { oldest: "best", best: "fastest", fastest: "oldest" };
const PROTEINS: Protein[] = ["verdura", "legumbre", "pescado", "huevo", "ave", "carne"];
const SLOT_NAME: Record<Slot, string> = { lunch: "Comida", dinner: "Cena" };
const SLOT_OF: Record<Slot, string> = { lunch: "comida", dinner: "cena" };

export type PickerChoice = { kind: "recipe"; recipe: RecipeSummary } | { kind: "away" } | { kind: "empty" };

/** Hoja para elegir qué se come en un hueco. */
export function RecipePicker({
  date,
  slot,
  current,
  recipes,
  week,
  today,
  onPick,
  onClose,
}: {
  date: string;
  slot: Slot;
  current: PlanSlotInfo;
  recipes: RecipeSummary[];
  /** Las 14 franjas de la semana (clave "fecha#franja") para avisar de repetidas. */
  week: Map<string, PlanSlotInfo>;
  today: string;
  onPick: (choice: PickerChoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState(!isWeekend(date));
  const [protein, setProtein] = useState<Protein | null>(null);
  const [includeOther, setIncludeOther] = useState(false);
  const [sort, setSort] = useState<PickerSort>("oldest");

  const list = useMemo(
    () => filterAndSort(recipes, { slot, query, quick, protein, includeOther, sort }),
    [recipes, slot, query, quick, protein, includeOther, sort],
  );

  // En qué otros días de la semana ya está cada receta.
  const inWeek = useMemo(() => {
    const days = new Map<string, string[]>();
    for (const [key, info] of week) {
      const [d, s] = key.split("#");
      if (!info.recipe || (d === date && s === slot) || !d) continue;
      const list = days.get(info.recipe.id) ?? [];
      const name = weekdayOf(d);
      if (!list.includes(name)) list.push(name);
      days.set(info.recipe.id, list);
    }
    return days;
  }, [week, date, slot]);

  const other: Slot = slot === "lunch" ? "dinner" : "lunch";
  const count = list.length;
  const countLabel = `${count} ${count === 1 ? "receta" : "recetas"}${includeOther ? "" : ` de ${SLOT_OF[slot]}`}`;

  return (
    <Sheet
      label={`Elegir ${SLOT_OF[slot]}`}
      onClose={onClose}
      top="calc(var(--safe-top) + 58px)"
      head={
        <>
          <div className={styles.sheetHead}>
            <div className={styles.sheetHeadText}>
              <h2 className={styles.sheetTitle}>{SLOT_NAME[slot]}</h2>
              <p className={styles.sheetSub}>
                {dayTitle(date, true)} · {isWeekend(date) ? "fin de semana" : "entre semana"}
              </p>
            </div>
            <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
              <X size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <label className={styles.search}>
            <Search size={18} aria-hidden="true" />
            <span className="visually-hidden">Buscar receta</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar"
              autoCorrect="off"
              enterKeyHint="search"
            />
          </label>
          <div className={styles.chips} role="group" aria-label="Filtros">
            <button type="button" className={styles.filterChip} aria-pressed={quick} onClick={() => setQuick(!quick)}>
              ≤ {QUICK_MINUTES} min
            </button>
            {PROTEINS.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.filterChip}
                aria-pressed={protein === p}
                onClick={() => setProtein(protein === p ? null : p)}
              >
                {PROTEIN_LABEL[p]}
              </button>
            ))}
          </div>
        </>
      }
    >
      <ul className={styles.group}>
        <li>
          <button type="button" className={styles.option} onClick={() => onPick({ kind: "away" })} aria-current={current.status === "away"}>
            <LogOut size={20} aria-hidden="true" />
            <span className={styles.reviewText}>Fuera de casa</span>
            {current.status === "away" && <Check size={20} aria-label="Actual" />}
          </button>
        </li>
        {current.status !== "empty" && (
          <li>
            <button type="button" className={styles.option} onClick={() => onPick({ kind: "empty" })}>
              <XCircle size={20} aria-hidden="true" />
              Dejar vacío
            </button>
          </li>
        )}
      </ul>

      <div className={styles.listHead}>
        <span className={styles.listCount}>{countLabel}</span>
        <button type="button" className={styles.sortButton} onClick={() => setSort(NEXT_SORT[sort])} aria-label={`Orden: ${SORT_LABEL[sort]}. Cambiar`}>
          {SORT_LABEL[sort]}
        </button>
      </div>

      {count === 0 ? (
        <p className={styles.empty}>Ninguna receta encaja con estos filtros.</p>
      ) : (
        <ul className={styles.group}>
          {list.map((recipe) => {
            const isCurrent = current.recipe?.id === recipe.id;
            const days = inWeek.get(recipe.id);
            const meta = [`${recipe.minutes} min`, PROTEIN_LABEL[recipe.protein]];
            if (recipe.avg_stars !== null) meta.push(`★ ${formatStars(recipe.avg_stars)}`);
            return (
              <li key={recipe.id}>
                <button
                  type="button"
                  className={`${styles.option} ${styles.recipeRow}`}
                  data-selected={isCurrent}
                  onClick={() => onPick({ kind: "recipe", recipe })}
                >
                  <RecipeThumb kind="recipe" photoUrl={recipe.photo_url} size={50} radius={14} />
                  <span className={styles.recipeText}>
                    <span className={styles.recipeTitle}>{recipe.title}</span>
                    <span className={styles.recipeMeta}>{meta.join(" · ")}</span>
                    <span className={styles.recipeMeta}>{lastCookedLabel(recipe.last_cooked, today)}</span>
                    {days && <span className={styles.inWeek}>Ya en el menú: {joinDays(days)}</span>}
                  </span>
                  {isCurrent && <Check size={20} aria-label="Actual" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className={styles.linkButton} onClick={() => setIncludeOther(!includeOther)}>
        {includeOther ? `Solo recetas de ${SLOT_OF[slot]}` : `Ver también recetas de ${SLOT_OF[other]}`}
      </button>
    </Sheet>
  );
}
