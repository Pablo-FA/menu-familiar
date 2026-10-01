import { Check, X } from "lucide-react";
import type { RecipeIngredient } from "../../shared/api";
import { Sheet } from "../components/Sheet";
import { capitalize, formatQuantity } from "../format";
import styles from "./Cook.module.css";

/** Hoja inferior con los ingredientes para ir marcándolos como preparados. */
export function IngredientsSheet({
  ingredients,
  checked,
  onToggle,
  onClose,
}: {
  ingredients: RecipeIngredient[];
  checked: number[];
  onToggle: (position: number) => void;
  onClose: () => void;
}) {
  const done = ingredients.filter((i) => checked.includes(i.position)).length;
  return (
    <Sheet
      label="Ingredientes"
      onClose={onClose}
      top="30svh"
      head={
        <div className={styles.sheetTitleRow}>
          <div>
            <h2 className={styles.sheetTitle}>Ingredientes</h2>
            <p className={styles.sheetSub} aria-live="polite">
              {done} de {ingredients.length} preparados
            </p>
          </div>
          <button type="button" className={styles.glassButton} onClick={onClose} aria-label="Cerrar ingredientes">
            <X size={20} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <ul className={styles.checklist}>
        {ingredients.map((ing) => {
          const on = checked.includes(ing.position);
          const qty = formatQuantity(ing);
          return (
            <li key={ing.position}>
              <button type="button" role="checkbox" aria-checked={on} className={styles.checkRow} onClick={() => onToggle(ing.position)}>
                <span className={styles.checkCircle} aria-hidden="true">
                  {on && <Check size={16} strokeWidth={3} />}
                </span>
                <span className={styles.checkName}>{ing.quantity === null ? ing.display_text : capitalize(ing.ingredient.name)}</span>
                {qty && <span className={styles.checkQty}>{qty}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
