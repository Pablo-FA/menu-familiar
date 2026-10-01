import { Camera, ChevronLeft, RotateCcw, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CookLog, PhotoResponse, RecipeDetail } from "../../shared/api";
import type { Slot } from "../../shared/recipe-format";
import { api } from "../api";
import styles from "./Cook.module.css";
import { PhotoError, preparePhoto } from "./photo";

/**
 * Pantalla tras "Terminar": foto de portada (si no la tiene), valoración opcional y nota.
 * "Guardar" y "Valorar después" registran que se ha cocinado y suben la foto si la hay.
 * Si la subida falla, el registro ya queda guardado y se puede reintentar sin perder la foto.
 */
export function FinishScreen({
  recipe,
  date,
  slot,
  existingLog,
  onBack,
  onDone,
}: {
  recipe: RecipeDetail;
  date: string;
  slot: Slot;
  existingLog: CookLog | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lo ya guardado, para que reintentar no duplique el registro ni la subida.
  const [logSaved, setLogSaved] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    setError(null);
    try {
      const blob = await preparePhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setPhotoSaved(false);
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : "No se ha podido preparar la foto");
    } finally {
      setPreparing(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  async function save(withRating: boolean) {
    setBusy(true);
    setError(null);
    const rating = withRating ? stars : null;
    const text = withRating ? note.trim() || null : null;

    if (!logSaved) {
      try {
        if (existingLog) {
          // Ya estaba registrada (p. ej. se repite el plato): solo se añade lo que se haya dado.
          const patch: { stars?: number; note?: string } = {};
          if (rating !== null) patch.stars = rating;
          if (text !== null) patch.note = text;
          if (Object.keys(patch).length > 0) await api.patch(`/cook-logs/${existingLog.id}`, patch);
        } else {
          await api.post("/cook-logs", {
            recipe_id: recipe.id,
            plan_meal_date: date,
            plan_meal_slot: slot,
            cooked_at: new Date().toISOString(),
            stars: rating,
            note: text,
          });
        }
        setLogSaved(true);
      } catch {
        setError("No se ha podido guardar. Inténtalo de nuevo.");
        setBusy(false);
        return;
      }
    }

    if (photo && !photoSaved) {
      try {
        const res = await fetch(`/api/recipes/${encodeURIComponent(recipe.id)}/photo`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "image/jpeg" },
          body: photo.blob,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        (await res.json()) as PhotoResponse;
        setPhotoSaved(true);
      } catch {
        setError("Se ha guardado que lo habéis cocinado, pero la foto no se ha podido subir.");
        setBusy(false);
        return;
      }
    }

    onDone();
  }

  const uploadFailed = logSaved && photo !== null && !photoSaved && error !== null;

  return (
    <div className={styles.finish}>
      <div>
        <button type="button" className={styles.glassButton} onClick={onBack} aria-label="Volver al último paso">
          <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <h1 className={styles.finishTitle}>¡A la mesa!</h1>
        <p className={styles.finishRecipe}>{recipe.title}</p>
      </div>

      <input
        ref={cameraRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <input
        ref={galleryRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {photo ? (
        <div className={styles.previewWrap}>
          <img className={styles.preview} src={photo.url} alt="Vista previa de la foto del plato" />
          <button
            type="button"
            className={`pill-button pill-button--secondary ${styles.retake}`}
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
          >
            <RotateCcw size={18} aria-hidden="true" /> Repetir
          </button>
        </div>
      ) : recipe.cover_photo_key ? (
        <button
          type="button"
          className="pill-button pill-button--secondary"
          onClick={() => galleryRef.current?.click()}
          disabled={preparing}
        >
          <Camera size={18} aria-hidden="true" /> {preparing ? "Preparando…" : "Cambiar foto de portada"}
        </button>
      ) : (
        <>
          <button type="button" className={`${styles.photoCard} glass`} onClick={() => cameraRef.current?.click()} disabled={preparing}>
            <span className={styles.cameraCircle} aria-hidden="true">
              <Camera size={34} strokeWidth={1.8} />
            </span>
            <strong>{preparing ? "Preparando la foto…" : "Haz la foto del plato"}</strong>
            <span>Será la portada de la receta</span>
          </button>
          <button type="button" className={styles.linkButton} onClick={() => galleryRef.current?.click()} disabled={preparing}>
            Elegir de la galería
          </button>
        </>
      )}

      <p className={styles.question} id="finish-rating">
        ¿Qué tal ha salido?
      </p>
      <div className={styles.stars} role="radiogroup" aria-labelledby="finish-rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={n === 1 ? "1 estrella" : `${n} estrellas`}
            data-filled={stars !== null && n <= stars}
            className={styles.star}
            onClick={() => setStars(stars === n ? null : n)}
          >
            <Star size={30} strokeWidth={1.8} fill={stars !== null && n <= stars ? "currentColor" : "none"} aria-hidden="true" />
          </button>
        ))}
      </div>

      {noteOpen ? (
        <>
          <label className="visually-hidden" htmlFor="finish-note">
            Nota
          </label>
          <textarea
            id="finish-note"
            className={styles.note}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="¿Qué cambiarías? ¿Les gustó a las niñas?"
            maxLength={500}
            autoFocus
          />
        </>
      ) : (
        <button type="button" className={styles.linkButton} onClick={() => setNoteOpen(true)}>
          Añadir nota
        </button>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.finishActions}>
        {uploadFailed ? (
          <>
            <button type="button" className="pill-button pill-button--secondary" onClick={onDone} disabled={busy}>
              Seguir sin foto
            </button>
            <button type="button" className="pill-button pill-button--primary" onClick={() => void save(true)} disabled={busy}>
              {busy ? "Subiendo…" : "Reintentar"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="pill-button pill-button--secondary"
              onClick={() => void save(false)}
              disabled={busy || preparing}
            >
              Valorar después
            </button>
            <button
              type="button"
              className="pill-button pill-button--primary"
              onClick={() => void save(true)}
              disabled={busy || preparing}
            >
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
