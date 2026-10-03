import { Archive, ArchiveRestore, Minus, Plus, Utensils } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportResponse, RecipeDetail } from "../../../shared/api";
import { PROTEIN_LABEL } from "../../../shared/balance";
import { draftFromRecipe, draftToRecipe, type RecipeDraft } from "../../../shared/recipe-draft";
import { parseRecipeImport, PROTEINS, type Course, type Suits } from "../../../shared/recipe-format";
import { api, ApiRequestError } from "../../api";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { PhotoError, preparePhoto, uploadCover } from "../../cook/photo";
import { navigate } from "../../router";
import { invalidateRecipes } from "../store";
import { AutoTextarea, FieldError, Segmented } from "./controls";
import styles from "./Editor.module.css";
import { IngredientsTab } from "./Ingredients";
import { StepsTab } from "./Steps";

type Tab = "data" | "ingredients" | "steps";
const TABS: { id: Tab; label: string }[] = [
  { id: "data", label: "Datos" },
  { id: "ingredients", label: "Ingredientes" },
  { id: "steps", label: "Pasos" },
];

export type Errors = Map<string, string>;

/** Errores de recipe@1 por ruta de campo ("ingredients[3].unit"); el primero de cada campo. */
function validate(draft: RecipeDraft): Errors {
  const parsed = parseRecipeImport(draftToRecipe(draft));
  const errors: Errors = new Map();
  if (!parsed.ok) for (const e of parsed.errors) if (!errors.has(e.field)) errors.set(e.field, e.message);
  return errors;
}

const tabOf = (field: string): Tab => (field.startsWith("ingredients") ? "ingredients" : field.startsWith("steps") ? "steps" : "data");

/** Editor de receta (/receta/:id/editar). */
export function Editor({ id }: { id: string }) {
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<RecipeDetail>(`/recipes/${encodeURIComponent(id)}`)
      .then((r) => !cancelled && setRecipe(r))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (error) return <p className="screen-status">No se pudo cargar la receta: {error}</p>;
  if (!recipe) return <p className="screen-status">Cargando…</p>;
  return <EditorForm recipe={recipe} />;
}

function EditorForm({ recipe: loaded }: { recipe: RecipeDetail }) {
  const [recipe, setRecipe] = useState(loaded);
  const [draft, setDraft] = useState<RecipeDraft>(() => draftFromRecipe(loaded));
  const [initial] = useState(() => JSON.stringify(draftToRecipe(draftFromRecipe(loaded))));
  const [tab, setTab] = useState<Tab>("data");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useToast();

  const dirty = useMemo(() => JSON.stringify(draftToRecipe(draft)) !== initial, [draft, initial]);
  const errors = useMemo(() => validate(draft), [draft]);
  const errorCount = (t: Tab) => [...errors.keys()].filter((f) => tabOf(f) === t).length;
  const update = (patch: Partial<RecipeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const ficha = `/receta/${encodeURIComponent(recipe.id)}`;
  const leave = () => (window.history.length > 1 ? window.history.back() : navigate(ficha, { replace: true }));

  // Cerrar la pestaña o recargar con cambios sin guardar pide confirmación al navegador.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.put<ImportResponse>(`/recipes/${encodeURIComponent(recipe.id)}`, draftToRecipe(draft));
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "No se ha podido guardar. ¿Hay conexión?");
      setSaving(false);
      return;
    }
    invalidateRecipes();
    toast({ message: "Receta guardada" });
    leave();
  }

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <button type="button" className={styles.textButton} onClick={() => (dirty ? setConfirming(true) : leave())}>
            Cancelar
          </button>
          <h1 className={styles.topTitle}>Editar receta</h1>
          <button
            type="button"
            className={`${styles.textButton} ${styles.strong}`}
            disabled={!dirty || errors.size > 0 || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Partes de la receta">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={styles.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {errorCount(t.id) > 0 && (
                <span className={styles.tabBadge} aria-label={`${errorCount(t.id)} errores`}>
                  {errorCount(t.id)}
                </span>
              )}
            </button>
          ))}
        </div>
        {saveError && (
          <p className={styles.saveError} role="alert">
            {saveError}
          </p>
        )}
      </header>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className={styles.panel}>
        {tab === "data" && <DataTab recipe={recipe} draft={draft} errors={errors} update={update} onRecipe={setRecipe} />}
        {tab === "ingredients" && <IngredientsTab draft={draft} errors={errors} setDraft={setDraft} />}
        {tab === "steps" && <StepsTab draft={draft} errors={errors} setDraft={setDraft} />}
      </div>

      {confirming && <DiscardDialog onDiscard={leave} onKeep={() => setConfirming(false)} />}
    </main>
  );
}

function DiscardDialog({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <Dialog label="Descartar los cambios" onClose={onKeep}>
      <div className={styles.confirm}>
        <h2>¿Descartar los cambios?</h2>
        <p>Lo que has cambiado en esta receta no se guardará.</p>
        <div className={styles.confirmActions}>
          <button type="button" className={`pill-button pill-button--secondary ${styles.danger}`} onClick={onDiscard}>
            Descartar
          </button>
          <button ref={keepRef} type="button" className="pill-button pill-button--primary" onClick={onKeep}>
            Seguir editando
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const SUITS: { id: Suits; label: string }[] = [
  { id: "lunch", label: "Comida" },
  { id: "dinner", label: "Cena" },
  { id: "both", label: "Ambas" },
];
const COURSES: { id: Course; label: string }[] = [
  { id: "main", label: "Plato" },
  { id: "side", label: "Pan" },
  { id: "breakfast", label: "Desayuno" },
  { id: "drink", label: "Bebida" },
];
const MINUTES_STEP = 5;

function DataTab({
  recipe,
  draft,
  errors,
  update,
  onRecipe,
}: {
  recipe: RecipeDetail;
  draft: RecipeDraft;
  errors: Errors;
  update: (patch: Partial<RecipeDraft>) => void;
  onRecipe: (r: RecipeDetail) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadCover(recipe.id, await preparePhoto(file));
      onRecipe({ ...recipe, cover_photo_key: res.cover_photo_key, photo_url: res.photo_url, thumb_url: res.photo_url });
      invalidateRecipes();
      toast({ message: "Portada cambiada" });
    } catch (err) {
      toast({ message: err instanceof PhotoError ? err.message : "No se ha podido subir la foto" });
    } finally {
      setUploading(false);
    }
  }

  async function setArchived(archived: boolean) {
    try {
      await api.patch(`/recipes/${encodeURIComponent(recipe.id)}`, { archived });
    } catch {
      toast({ message: "No se ha podido guardar el cambio" });
      return;
    }
    onRecipe({ ...recipe, archived });
    invalidateRecipes();
    toast({
      message: archived ? "Receta archivada" : "Receta recuperada",
      action: { label: "Deshacer", onClick: () => void setArchived(!archived) },
    });
  }

  return (
    <>
      <div className={`${styles.group} ${styles.photoRow}`}>
        <span className={styles.thumb}>
          {recipe.photo_url ? <img src={recipe.thumb_url ?? recipe.photo_url} alt="" /> : <Utensils size={24} strokeWidth={1.5} aria-hidden="true" />}
        </span>
        <span className={styles.grow}>Foto de portada</span>
        <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
        <button type="button" className={styles.smallButton} onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "Subiendo…" : "Cambiar"}
        </button>
      </div>

      <div className={styles.group}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Título</span>
          <input className={styles.bigInput} value={draft.title} onChange={(e) => update({ title: e.target.value })} maxLength={120} />
          <FieldError message={errors.get("title")} />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel} id="minutes-label">
            Minutos
          </span>
          <div className={styles.stepper} role="group" aria-labelledby="minutes-label">
            <button
              type="button"
              aria-label="Menos minutos"
              disabled={draft.minutes <= MINUTES_STEP}
              onClick={() => update({ minutes: Math.max(MINUTES_STEP, draft.minutes - MINUTES_STEP) })}
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <span className={styles.stepperValue} aria-live="polite">
              {draft.minutes} min
            </span>
            <button type="button" aria-label="Más minutos" onClick={() => update({ minutes: draft.minutes + MINUTES_STEP })}>
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
          <FieldError message={errors.get("minutes")} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="kcal">
            Calorías por adulto
          </label>
          <div className={styles.inline}>
            <input
              id="kcal"
              className={styles.numberInput}
              inputMode="numeric"
              value={draft.kcal}
              onChange={(e) => update({ kcal: e.target.value.replace(/[^\d]/g, "") })}
              placeholder="Opcional"
            />
            <button
              type="button"
              className={styles.chip}
              aria-pressed={draft.kcal_estimated}
              onClick={() => update({ kcal_estimated: !draft.kcal_estimated })}
              disabled={draft.kcal === ""}
            >
              ≈ estimadas
            </button>
          </div>
          <FieldError message={errors.get("kcal_adult")} />
        </div>
      </div>

      <p className={styles.label}>SIRVE PARA</p>
      <Segmented label="Sirve para" options={SUITS} value={draft.suits} onChange={(suits) => update({ suits })} />

      <p className={styles.label}>PROTEÍNA PRINCIPAL</p>
      <div className={styles.chips} role="radiogroup" aria-label="Proteína principal">
        {PROTEINS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={draft.protein === p} className={styles.chip} onClick={() => update({ protein: p })}>
            {PROTEIN_LABEL[p]}
          </button>
        ))}
      </div>

      <p className={styles.label}>TIPO</p>
      <Segmented label="Tipo" options={COURSES} value={draft.course} onChange={(course) => update({ course })} />

      <div className={styles.group}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Para congelar</span>
          <AutoTextarea value={draft.freezer_note} onChange={(v) => update({ freezer_note: v })} placeholder="Si se congela bien, cómo y cuánto" />
          <FieldError message={errors.get("freezer_note")} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Adaptación</span>
          <AutoTextarea value={draft.adaptation_notes} onChange={(v) => update({ adaptation_notes: v })} placeholder="Qué se ha cambiado respecto a la original" />
          <FieldError message={errors.get("adaptation_notes")} />
        </label>
      </div>

      <button type="button" className={`${styles.group} ${styles.groupButton} ${recipe.archived ? "" : styles.danger}`} onClick={() => void setArchived(!recipe.archived)}>
        {recipe.archived ? <ArchiveRestore size={20} aria-hidden="true" /> : <Archive size={20} aria-hidden="true" />}
        {recipe.archived ? "Recuperar receta" : "Archivar receta"}
      </button>
    </>
  );
}
