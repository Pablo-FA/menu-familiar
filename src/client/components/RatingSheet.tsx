import { Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RatingPrompt } from "../../shared/api";
import { madridNow, weekdayName } from "../../shared/dates";
import { pastMealLabel } from "../../shared/meals";
import { api } from "../api";
import styles from "./RatingSheet.module.css";

/**
 * Hoja flotante "¿qué tal estuvo?" sobre la comida anterior. Usa <dialog> nativo:
 * trae el foco atrapado, Escape y la capa superior. Cualquier forma de cerrarla sin
 * guardar (X, "Ahora no", tocar fuera, Escape) pospone el aviso.
 */
export function RatingSheet({ prompt, onDone }: { prompt: RatingPrompt; onDone: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stars, setStars] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function close() {
    if (closedRef.current) return;
    closedRef.current = true;
    dialogRef.current?.close();
    onDone();
  }

  function skip() {
    // Si falla, no pasa nada grave: volverá a preguntar en la siguiente apertura.
    void api.post("/rating-prompt/skip", { date: prompt.date, slot: prompt.slot }).catch(() => undefined);
    close();
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (prompt.cook_log_id !== null) {
        // Ya se registró como cocinada ("Valorar después"): se completa ese registro.
        const patch: { stars?: number; note?: string } = {};
        if (stars !== null) patch.stars = stars;
        if (note.trim()) patch.note = note.trim();
        await api.patch(`/cook-logs/${prompt.cook_log_id}`, patch);
      } else {
        await api.post("/cook-logs", {
          recipe_id: prompt.recipe.id,
          plan_meal_date: prompt.date,
          plan_meal_slot: prompt.slot,
          stars,
          note: note.trim() || null,
        });
      }
      close();
    } catch {
      setError("No se ha podido guardar. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

  const label = pastMealLabel(prompt.date, prompt.slot, madridNow().date, weekdayName);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="rating-title"
      onCancel={(e) => {
        e.preventDefault(); // Escape
        skip();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) skip(); // toque fuera de la hoja
      }}
    >
      <div className={styles.sheet}>
        <div className={styles.header}>
          {prompt.recipe.photo_url ? (
            <img className={styles.thumb} src={prompt.recipe.photo_url} alt="" />
          ) : (
            <div className={styles.thumb} aria-hidden="true" />
          )}
          <div className={styles.heading}>
            <p className={styles.eyebrow}>{label}</p>
            <h2 id="rating-title" className={styles.title}>
              {prompt.recipe.title}
            </h2>
          </div>
          <button type="button" className={styles.close} onClick={skip} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.stars} role="radiogroup" aria-label="Valoración">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={n === 1 ? "1 estrella" : `${n} estrellas`}
              data-filled={stars !== null && n <= stars}
              className={styles.star}
              onClick={() => setStars(n)}
            >
              <Star size={30} strokeWidth={1.8} fill={stars !== null && n <= stars ? "currentColor" : "none"} aria-hidden="true" />
            </button>
          ))}
        </div>

        <label className="visually-hidden" htmlFor="rating-note">
          Nota
        </label>
        <textarea
          id="rating-note"
          className={styles.note}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="¿Qué cambiarías? ¿Les gustó a las niñas?"
          maxLength={500}
        />

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className="pill-button pill-button--secondary" onClick={skip} disabled={busy}>
            Ahora no
          </button>
          <button
            type="button"
            className="pill-button pill-button--primary"
            onClick={save}
            disabled={busy || (stars === null && note.trim() === "")}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
