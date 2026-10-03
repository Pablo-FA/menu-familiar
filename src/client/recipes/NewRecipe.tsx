import { ClipboardPaste, Link2, Utensils, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AISLE_LABEL, isAisle } from "../../shared/aisles";
import type { ImportResponse, RecipePreviewResponse } from "../../shared/api";
import { PROTEIN_LABEL } from "../../shared/balance";
import { extractRecipe } from "../../shared/plan-extract";
import { adaptRequestText } from "../../shared/recipe-export";
import { api, ApiRequestError } from "../api";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { copyAndOpenClaude, readClipboard } from "../planner/claude";
import { PasteManual } from "../planner/PasteReview";
import { navigate } from "../router";
import { COURSE_LABEL } from "./Gallery";
import styles from "./Recipes.module.css";
import { invalidateRecipes } from "./store";

const SUITS_LABEL = { lunch: "Comida", dinner: "Cena", both: "Comida y cena" } as const;

/**
 * «Pegar receta de Claude»: lee el portapapeles dentro del toque (si no se puede, un
 * cuadro de texto), extrae la primera recipe@1, pide la vista previa al servidor y abre
 * la hoja «Receta de Claude».
 */
export function useRecipePaste(onDone?: () => void): { start: () => void; element: ReactNode } {
  const [stage, setStage] = useState<
    { kind: "manual" } | { kind: "preview"; recipe: unknown; preview: RecipePreviewResponse } | null
  >(null);
  const toast = useToast();

  async function review(text: string) {
    const recipe = extractRecipe(text);
    if (!recipe) {
      toast({ message: "No he encontrado una receta de Claude en lo que has pegado." });
      return;
    }
    try {
      const preview = await api.post<RecipePreviewResponse>("/recipes/preview", recipe);
      setStage({ kind: "preview", recipe, preview });
    } catch {
      toast({ message: "No se ha podido revisar la receta" });
    }
  }

  function start() {
    // readText dentro del toque: iOS muestra su burbuja «Pegar».
    void readClipboard().then((text) => {
      if (text === null || !text.trim()) setStage({ kind: "manual" });
      else void review(text);
    });
  }

  const close = () => setStage(null);
  const element =
    stage?.kind === "manual" ? (
      <PasteManual
        title="Pegar receta"
        placeholder="Pega aquí la receta que te ha devuelto Claude"
        onClose={close}
        onReview={(text) => {
          setStage(null);
          void review(text);
        }}
      />
    ) : stage?.kind === "preview" ? (
      <ClaudeRecipeSheet
        recipe={stage.recipe}
        preview={stage.preview}
        onClose={close}
        onImported={(id, replaced) => {
          setStage(null);
          onDone?.();
          invalidateRecipes();
          navigate(`/receta/${encodeURIComponent(id)}`);
          toast({ message: replaced ? "Receta reemplazada" : "Receta añadida al recetario" });
        }}
      />
    ) : null;

  return { start, element };
}

/** Hoja «Nueva receta» (botón + de la galería). */
export function NewRecipeSheet({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const toast = useToast();
  const paste = useRecipePaste(onClose);
  const validUrl = /^https?:\/\/\S+\.\S+/.test(url.trim());

  return (
    <>
      {!paste.element && (
        <Sheet
          label="Nueva receta"
          onClose={onClose}
          head={
            <div className={styles.sheetHead}>
              <div className={styles.sheetHeadText}>
                <h2 className={styles.sheetTitle}>Nueva receta</h2>
              </div>
              <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
                <X size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          }
        >
          <form
            className={styles.groupCard}
            onSubmit={(e) => {
              e.preventDefault();
              if (validUrl) copyAndOpenClaude(adaptRequestText(url), toast, "Petición copiada");
            }}
          >
            <p className={styles.groupTitle}>
              <Link2 size={18} aria-hidden="true" /> Adaptar una receta de internet
            </p>
            <p className={styles.groupText}>Pega el enlace y Claude la adapta a la familia.</p>
            <label className="visually-hidden" htmlFor="recipe-url">
              Enlace de la receta
            </label>
            <input
              id="recipe-url"
              className={styles.urlInput}
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="go"
            />
            <button type="submit" className={`pill-button pill-button--primary ${styles.wide}`} disabled={!validUrl}>
              Abrir en Claude
            </button>
          </form>
          <button type="button" className={`${styles.groupCard} ${styles.groupButton}`} onClick={paste.start}>
            <p className={styles.groupTitle}>
              <ClipboardPaste size={18} aria-hidden="true" /> Pegar receta de Claude
            </p>
            <p className={styles.groupText}>Cuando Claude te la devuelva, cópiala y tócala aquí.</p>
          </button>
        </Sheet>
      )}
      {paste.element}
    </>
  );
}

/** Hoja «Receta de Claude»: vista previa antes de añadir o reemplazar. */
function ClaudeRecipeSheet({
  recipe,
  preview,
  onClose,
  onImported,
}: {
  recipe: unknown;
  preview: RecipePreviewResponse;
  onClose: () => void;
  onImported: (id: string, replaced: boolean) => void;
}) {
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = preview.summary;
  const blocked = preview.errors.length > 0 || !s || (preview.exists && !replace) || saving;

  async function importIt() {
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<ImportResponse>(`/recipes/import${preview.exists ? "?replace=true" : ""}`, recipe);
      onImported(res.id, res.replaced);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "No se ha podido guardar la receta. ¿Hay conexión?");
      setSaving(false);
    }
  }

  return (
    <Sheet
      label="Receta de Claude"
      onClose={onClose}
      top="calc(var(--safe-top) + 84px)"
      head={
        <div className={styles.sheetHead}>
          <div className={styles.sheetHeadText}>
            <h2 className={styles.sheetTitle}>Receta de Claude</h2>
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
      footer={
        <>
          {error && (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.footerActions}>
            <button type="button" className="pill-button pill-button--secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className={`pill-button pill-button--primary ${styles.grow}`} disabled={blocked} onClick={() => void importIt()}>
              {preview.exists ? "Reemplazar receta" : "Añadir al recetario"}
            </button>
          </div>
        </>
      }
    >
      {preview.exists && (
        <div className={`${styles.groupCard} ${styles.switchRow}`}>
          <span className={styles.grow}>
            <span className={styles.amberTitle} id="replace-label">
              Ya tienes esta receta
            </span>
            <span className={styles.groupText}>Reemplazarla conserva la foto y las valoraciones.</span>
          </span>
          <span className={styles.switchLabel} aria-hidden="true">
            Reemplazar
          </span>
          <button type="button" role="switch" aria-checked={replace} aria-labelledby="replace-label" className={styles.switch} onClick={() => setReplace(!replace)}>
            <span className={styles.knob} />
          </button>
        </div>
      )}

      {s && (
        <>
          <div className={`${styles.groupCard} ${styles.previewHead}`}>
            <span className={styles.previewThumb}>
              {s.photo_url ? <img src={s.photo_url} alt="" /> : <Utensils size={24} strokeWidth={1.5} aria-hidden="true" />}
            </span>
            <span className={styles.grow}>
              <span className={styles.previewTitle}>{s.title}</span>
              <span className={styles.groupText}>
                {s.minutes} min · {COURSE_LABEL[s.course] ?? PROTEIN_LABEL[s.protein]} · {SUITS_LABEL[s.suits]}
              </span>
            </span>
          </div>
          <ul className={styles.group}>
            <li className={styles.row}>
              <span>Ingredientes</span>
              <span className={styles.rowValue}>{preview.ingredients_count}</span>
            </li>
            <li className={styles.row}>
              <span>Pasos</span>
              <span className={styles.rowValue}>
                {preview.steps_count}
                {preview.timers_count > 0 ? ` · ${preview.timers_count} con temporizador` : ""}
              </span>
            </li>
            {s.kcal_adult !== null && (
              <li className={styles.row}>
                <span>Calorías por adulto</span>
                <span className={styles.rowValue}>
                  {s.kcal_estimated ? "≈ " : ""}
                  {s.kcal_adult} kcal
                </span>
              </li>
            )}
          </ul>
          {preview.new_ingredients.length > 0 && (
            <>
              <p className={styles.groupLabel}>
                {preview.new_ingredients.length === 1 ? "1 INGREDIENTE NUEVO" : `${preview.new_ingredients.length} INGREDIENTES NUEVOS`} EN TU CATÁLOGO
              </p>
              <ul className={styles.group}>
                {preview.new_ingredients.map((ing) => (
                  <li key={ing.name} className={styles.row}>
                    <span>{ing.name}</span>
                    <span className={styles.rowValue}>{isAisle(ing.aisle) ? AISLE_LABEL[ing.aisle] : ing.aisle}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.adaptation_notes && (
            <>
              <p className={styles.groupLabel}>ADAPTACIÓN</p>
              <p className={`${styles.groupCard} ${styles.notes}`}>{s.adaptation_notes}</p>
            </>
          )}
        </>
      )}

      {preview.errors.length > 0 && (
        <div className={styles.errors} role="alert">
          <p className={styles.errorsTitle}>La receta tiene errores:</p>
          <ul>
            {preview.errors.map((e, i) => (
              <li key={i}>
                {e.field && <code>{e.field}</code>} {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
