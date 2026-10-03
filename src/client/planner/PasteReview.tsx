import { BookPlus, Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { PlanPreviewResponse, PreviewMeal } from "../../shared/api";
import type { Slot } from "../../shared/recipe-format";
import { dateRangeLabel, isoWeekday } from "../../shared/week";
import { Sheet } from "../components/Sheet";
import styles from "./Planner.module.css";

const DAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const SLOT_UPPER: Record<Slot, string> = { lunch: "COMIDA", dinner: "CENA" };
const keyOf = (m: { date: string; slot: Slot }) => `${m.date}#${m.slot}`;

function proposedTitle(m: PreviewMeal): string {
  if (m.proposed.status === "away") return "Fuera de casa";
  if (m.proposed.status === "empty") return "Vacío";
  return m.proposed.title ?? m.proposed.recipe_id ?? "";
}

function currentTitle(m: PreviewMeal): string {
  if (m.current.status === "away") return "«Fuera de casa»";
  return m.current.title ?? m.current.recipe_id ?? "";
}

/** Hoja "Menú de Claude": qué cambiaría, con una casilla por comida. */
export function PasteReview({
  preview,
  onApply,
  onClose,
}: {
  preview: PlanPreviewResponse;
  /** Recibe las comidas marcadas. */
  onApply: (meals: PreviewMeal[]) => Promise<void>;
  onClose: () => void;
}) {
  const changes = useMemo(() => preview.meals.filter((m) => m.change !== "same"), [preview]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(changes.map(keyOf)));
  const [busy, setBusy] = useState(false);

  const dates = preview.meals.map((m) => m.date).sort();
  const range = dates.length ? dateRangeLabel(dates[0] ?? "", dates[dates.length - 1] ?? "") : "";
  const selected = changes.filter((m) => checked.has(keyOf(m)));
  const newTitles = [
    ...new Map(selected.filter((m) => m.proposed.is_new && m.proposed.recipe_id).map((m) => [m.proposed.recipe_id, proposedTitle(m)])).values(),
  ];
  const hasErrors = preview.errors.length > 0;

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    try {
      await onApply(selected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      label="Menú de Claude"
      onClose={onClose}
      top="calc(var(--safe-top) + 84px)"
      head={
        <div className={styles.sheetHead}>
          <div className={styles.sheetHeadText}>
            <h2 className={styles.sheetTitle}>Menú de Claude</h2>
            <p className={styles.sheetSub}>
              {range} · {changes.length === 1 ? "1 cambio" : `${changes.length} cambios`}
            </p>
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
      footer={
        <div className={styles.footerActions}>
          <button type="button" className="pill-button pill-button--secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={`pill-button pill-button--primary ${styles.grow}`}
            onClick={apply}
            disabled={busy || hasErrors || selected.length === 0}
          >
            {busy ? "Aplicando…" : `Aplicar ${selected.length}`}
          </button>
        </div>
      }
    >
      {hasErrors && (
        <ul className={styles.errors} role="alert">
          {preview.errors.map((e, i) => (
            <li key={i}>
              {e.field && <code>{e.field}</code>} {e.message}
            </li>
          ))}
        </ul>
      )}

      {newTitles.length > 0 && (
        <p className={styles.notice}>
          <BookPlus size={20} aria-hidden="true" />
          <span>
            {newTitles.length === 1 ? "Se añadirá 1 receta nueva" : `Se añadirán ${newTitles.length} recetas nuevas`} al recetario:{" "}
            {newTitles.length === 1 ? newTitles[0] : `${newTitles.slice(0, -1).join(", ")} y ${newTitles[newTitles.length - 1]}`}.
          </span>
        </p>
      )}

      {changes.length === 0 && !hasErrors ? (
        <p className={styles.empty}>Este menú ya está en tu planificador.</p>
      ) : (
        <ul className={styles.group}>
          {changes.map((m) => {
            const key = keyOf(m);
            const on = checked.has(key);
            return (
              <li key={key}>
                <button type="button" role="checkbox" aria-checked={on} className={styles.option} onClick={() => toggle(key)}>
                  <span className={styles.check} aria-hidden="true">
                    {on && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className={styles.reviewText}>
                    <span className={styles.eyebrow}>
                      {DAY_SHORT[isoWeekday(m.date) - 1]} {Number(m.date.slice(8, 10))} · {SLOT_UPPER[m.slot]}
                    </span>
                    <span className={styles.recipeTitle}>{proposedTitle(m)}</span>
                    {m.change === "replace" && <span className={styles.replaces}>Sustituye a {currentTitle(m)}</span>}
                  </span>
                  {m.proposed.is_new && <span className={styles.newChip}>Nueva</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

/** Si no se puede leer el portapapeles: pegar a mano. */
export function PasteManual({
  onReview,
  onClose,
  title = "Pegar menú",
  placeholder = "Pega aquí el menú",
}: {
  onReview: (text: string) => void;
  onClose: () => void;
  title?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  return (
    <Sheet
      label={title}
      onClose={onClose}
      top="calc(var(--safe-top) + 84px)"
      head={
        <div className={styles.sheetHead}>
          <div className={styles.sheetHeadText}>
            <h2 className={styles.sheetTitle}>{title}</h2>
            <p className={styles.sheetSub}>Lo que te haya devuelto Claude</p>
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
      footer={
        <div className={styles.footerActions}>
          <button type="button" className={`pill-button pill-button--primary ${styles.grow}`} disabled={!text.trim()} onClick={() => onReview(text)}>
            Revisar
          </button>
        </div>
      }
    >
      <label className="visually-hidden" htmlFor="paste-manual">
        {placeholder}
      </label>
      <textarea
        id="paste-manual"
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </Sheet>
  );
}
