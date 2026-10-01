import { ArrowUpDown, BookOpen, LogOut, RefreshCw, Star, Trash2, X } from "lucide-react";
import type { PlanSlotInfo, RecipeSummary } from "../../shared/api";
import { PROTEIN_LABEL } from "../../shared/balance";
import { formatStars } from "../../shared/picker";
import type { Slot } from "../../shared/recipe-format";
import { dayTitle } from "../../shared/week";
import { Sheet } from "../components/Sheet";
import styles from "./Planner.module.css";
import { RecipeThumb } from "./RecipeThumb";

export type SlotAction = "view" | "change" | "move" | "away" | "remove" | "rate";

const SLOT_UPPER: Record<Slot, string> = { lunch: "COMIDA", dinner: "CENA" };

/** Acciones sobre un hueco con receta (futuro o pasado). */
export function SlotActions({
  date,
  slot,
  info,
  summary,
  past,
  onAction,
  onClose,
}: {
  date: string;
  slot: Slot;
  info: PlanSlotInfo;
  summary: RecipeSummary | undefined;
  past: boolean;
  onAction: (action: SlotAction) => void;
  onClose: () => void;
}) {
  const recipe = info.recipe;
  if (!recipe) return null;
  const meta = [`${recipe.minutes} min`, PROTEIN_LABEL[recipe.protein]];
  meta.push(summary?.avg_stars != null ? `★ ${formatStars(summary.avg_stars)} de media` : summary && summary.times_cooked > 0 ? "Sin valorar" : "Sin estrenar");
  const rated = info.cook_log?.stars != null;

  const row = (action: SlotAction, label: string, Icon: typeof BookOpen, danger = false) => (
    <li>
      <button type="button" className={`${styles.option} ${styles.actionRow} ${danger ? styles.danger : ""}`} onClick={() => onAction(action)}>
        <Icon size={21} strokeWidth={1.9} aria-hidden="true" />
        {label}
      </button>
    </li>
  );

  return (
    <Sheet
      label={`${recipe.title}: acciones`}
      onClose={onClose}
      head={
        <div className={styles.actionsHead}>
          <RecipeThumb kind="recipe" photoUrl={recipe.photo_url} size={64} radius={18} />
          <div className={styles.sheetHeadText}>
            <p className={styles.eyebrow}>
              {dayTitle(date).toUpperCase()} · {SLOT_UPPER[slot]}
            </p>
            <h2 className={styles.actionsTitle}>{recipe.title}</h2>
            <p className={styles.actionsMeta}>{meta.join(" · ")}</p>
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
    >
      {past ? (
        <ul className={styles.group}>
          {row("view", "Ver receta", BookOpen)}
          {row("rate", rated ? "Cambiar valoración" : "Valorar", Star)}
        </ul>
      ) : (
        <>
          <ul className={styles.group}>
            {row("view", "Ver receta", BookOpen)}
            {row("change", "Cambiar receta", RefreshCw)}
            {row("move", "Mover o intercambiar", ArrowUpDown)}
            {row("away", "Fuera de casa", LogOut)}
          </ul>
          <ul className={styles.group}>{row("remove", "Quitar del menú", Trash2, true)}</ul>
        </>
      )}
    </Sheet>
  );
}
