import { Check, X } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import type { RecipeIngredient } from "../../shared/api";
import { capitalize, formatQuantity } from "../format";
import styles from "./Cook.module.css";
import { Dialog } from "./Dialog";

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
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const done = ingredients.filter((i) => checked.includes(i.position)).length;

  // Deslizar hacia abajo desde la cabecera cierra la hoja.
  function onPointerDown(e: PointerEvent) {
    drag.current = { y: e.clientY, dy: 0 };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  }
  function onPointerUp() {
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    setDragging(false);
    if (dy > 90) onClose();
    else if (sheetRef.current) sheetRef.current.style.transform = "";
  }

  return (
    <Dialog label="Ingredientes" onClose={onClose}>
      <div ref={sheetRef} className={styles.sheet} style={dragging ? { transition: "none" } : { transition: "transform 200ms" }}>
        <div
          className={styles.sheetHead}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className={styles.handle} aria-hidden="true" />
          <div className={styles.sheetTitleRow}>
            <div>
              <h2 className={styles.sheetTitle}>Ingredientes</h2>
              <p className={styles.sheetSub} aria-live="polite">
                {done} de {ingredients.length} preparados
              </p>
            </div>
            <button
              type="button"
              className={styles.glassButton}
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Cerrar ingredientes"
            >
              <X size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>
        <ul className={styles.checklist}>
          {ingredients.map((ing) => {
            const on = checked.includes(ing.position);
            const qty = formatQuantity(ing);
            return (
              <li key={ing.position}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={styles.checkRow}
                  onClick={() => onToggle(ing.position)}
                >
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
      </div>
    </Dialog>
  );
}
