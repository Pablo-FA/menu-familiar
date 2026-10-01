import { Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RatingPrompt } from "../../shared/api";
import { madridNow, weekdayName } from "../../shared/dates";
import { pastMealLabel } from "../../shared/meals";
import { api } from "../api";
import styles from "./RatingSheet.module.css";

/**
 * Hoja flotante de valoración (estrellas + nota) con <dialog> nativo: foco atrapado,
 * Escape y capa superior. Se cierra sin guardar con la X, el botón secundario, tocando
 * fuera o con Escape (onDismiss).
 */
export function RatingDialog({
  eyebrow,
  title,
  photoUrl,
  initialStars = null,
  initialNote = "",
  dismissLabel = "Ahora no",
  onSave,
  onDismiss,
}: {
  eyebrow: string;
  title: string;
  photoUrl: string | null;
  initialStars?: number | null;
  initialNote?: string;
  dismissLabel?: string;
  onSave: (stars: number | null, note: string | null) => Promise<void>;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stars, setStars] = useState<number | null>(initialStars);
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function close() {
    if (closedRef.current) return false;
    closedRef.current = true;
    dialogRef.current?.close();
    return true;
  }

  function skip() {
    if (close()) onDismiss();
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(stars, note.trim() || null);
      close();
    } catch {
      setError("No se ha podido guardar. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

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
          {photoUrl ? (
            <img className={styles.thumb} src={photoUrl} alt="" />
          ) : (
            <div className={styles.thumb} aria-hidden="true" />
          )}
          <div className={styles.heading}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id="rating-title" className={styles.title}>
              {title}
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
            {dismissLabel}
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

/**
 * Aviso "¿qué tal estuvo?" de la comida anterior. Cualquier forma de cerrarlo sin guardar
 * (X, "Ahora no", tocar fuera, Escape) pospone el aviso.
 */
export function RatingSheet({ prompt, onDone }: { prompt: RatingPrompt; onDone: () => void }) {
  return (
    <RatingDialog
      eyebrow={pastMealLabel(prompt.date, prompt.slot, madridNow().date, weekdayName)}
      title={prompt.recipe.title}
      photoUrl={prompt.recipe.photo_url}
      onDismiss={() => {
        // Si falla, no pasa nada grave: volverá a preguntar en la siguiente apertura.
        void api.post("/rating-prompt/skip", { date: prompt.date, slot: prompt.slot }).catch(() => undefined);
        onDone();
      }}
      onSave={async (stars, note) => {
        if (prompt.cook_log_id !== null) {
          // Ya se registró como cocinada ("Valorar después"): se completa ese registro.
          const patch: { stars?: number; note?: string } = {};
          if (stars !== null) patch.stars = stars;
          if (note) patch.note = note;
          await api.patch(`/cook-logs/${prompt.cook_log_id}`, patch);
        } else {
          await api.post("/cook-logs", {
            recipe_id: prompt.recipe.id,
            plan_meal_date: prompt.date,
            plan_meal_slot: prompt.slot,
            stars,
            note,
          });
        }
        onDone();
      }}
    />
  );
}
