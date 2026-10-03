import { Archive, ArchiveRestore, CalendarPlus, Camera, ChevronLeft, ClipboardPaste, Ellipsis, ExternalLink, Pencil, Play, Snowflake, Sparkles, Star, Utensils } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { CookHistoryEntry, RecipeDetail } from "../../shared/api";
import { PROTEIN_LABEL } from "../../shared/balance";
import { madridNow, shortDate } from "../../shared/dates";
import { formatStars, lastCookedLabel } from "../../shared/picker";
import { improveRequestText } from "../../shared/recipe-export";
import { dayTitle } from "../../shared/week";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { ensureThumb, PhotoError, preparePhoto, uploadCover } from "../cook/photo";
import { RecipeBody } from "../pages/Today";
import { copyAndOpenClaude } from "../planner/claude";
import { navigate } from "../router";
import { AddToMenuSheet } from "./AddToMenu";
import { COURSE_LABEL } from "./Gallery";
import { useRecipePaste } from "./NewRecipe";
import styles from "./RecipePage.module.css";
import { invalidateRecipes } from "./store";

const SUITS_UPPER = { lunch: "COMIDA", dinner: "CENA", both: "COMIDA Y CENA" } as const;
const SLOT_WORD = { lunch: "comida", dinner: "cena" } as const;
/** Valoraciones que se ven sin tocar «Ver todas». */
const VISIBLE_NOTES = 3;

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; recipe: RecipeDetail };

/** Ficha de una receta (/receta/:id). */
export function RecipePage({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<RecipeDetail>(`/recipes/${encodeURIComponent(id)}`)
      .then((recipe) => {
        if (cancelled) return;
        setLoad({ state: "ready", recipe });
        // Portadas anteriores a las miniaturas: se genera ahora, sin molestar.
        void ensureThumb(recipe);
      })
      .catch((err: unknown) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  if (load.state === "loading") return <p className={styles.status}>Cargando…</p>;
  if (load.state === "error") return <p className={styles.status}>No se pudo cargar la receta: {load.message}</p>;
  return <RecipeView recipe={load.recipe} onChanged={() => setReload((n) => n + 1)} />;
}

const back = () => (window.history.length > 1 ? window.history.back() : navigate("/recetas"));

/** "Sábado 3 oct · comida" */
function historyLabel(h: CookHistoryEntry): string {
  const month = shortDate(h.date).split(" ")[2] ?? "";
  return `${dayTitle(h.date)} ${month} · ${SLOT_WORD[h.slot]}`;
}

function RecipeView({ recipe, onChanged }: { recipe: RecipeDetail; onChanged: () => void }) {
  const toast = useToast();
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [allNotes, setAllNotes] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const blurTintRef = useRef<HTMLDivElement>(null);
  const blurStrongRef = useRef<HTMLDivElement>(null);
  const paste = useRecipePaste();
  useCoverScene({ coverRef, photoRef, titleRef, barRef, blurTintRef, blurStrongRef });

  const today = madridNow().date;
  const plannable = recipe.course === "main" && !recipe.archived;
  const notes = recipe.history.filter((h) => h.stars !== null || h.note);
  const shownNotes = allNotes ? notes : notes.slice(0, VISIBLE_NOTES);
  const last = recipe.last_cooked ? lastCookedLabel(recipe.last_cooked, today).replace(/^Hecha /, "") : null;
  const eyebrow = `${(COURSE_LABEL[recipe.course] ?? PROTEIN_LABEL[recipe.protein]).toUpperCase()} · ${SUITS_UPPER[recipe.suits]}`;

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await uploadCover(recipe.id, await preparePhoto(file));
      invalidateRecipes();
      onChanged();
      toast({ message: "Portada cambiada" });
    } catch (err) {
      toast({ message: err instanceof PhotoError ? err.message : "No se ha podido subir la foto" });
    } finally {
      setUploading(false);
    }
  }

  async function setArchived(archived: boolean, undoable = true) {
    try {
      await api.patch(`/recipes/${encodeURIComponent(recipe.id)}`, { archived });
    } catch {
      toast({ message: "No se ha podido guardar el cambio" });
      return;
    }
    invalidateRecipes();
    onChanged();
    toast({
      message: archived ? "Receta archivada" : "Receta recuperada",
      action: undoable ? { label: "Deshacer", onClick: () => void setArchived(!archived, false) } : undefined,
    });
  }

  function menu(action: "photo" | "edit" | "improve" | "paste" | "archive") {
    setMenuAnchor(null);
    if (action === "photo") fileRef.current?.click();
    if (action === "edit") navigate(`/receta/${encodeURIComponent(recipe.id)}/editar`);
    // Sin await antes: el portapapeles de Safari exige que la escritura empiece en el toque.
    if (action === "improve") copyAndOpenClaude(improveRequestText(recipe), toast, "Receta copiada");
    if (action === "paste") paste.start();
    if (action === "archive") void setArchived(!recipe.archived);
  }

  return (
    <div className={styles.page}>
      <input ref={fileRef} type="file" accept="image/*" className={styles.hiddenInput} onChange={(e) => void onFile(e.target.files?.[0])} />

      <section ref={coverRef} className={styles.cover} aria-label="Portada">
        <div ref={photoRef} className={styles.photo}>
          {recipe.photo_url ? (
            <img src={recipe.photo_url} alt="" decoding="async" />
          ) : (
            <div className={styles.placeholder}>
              <Utensils size={64} strokeWidth={1.2} aria-hidden="true" />
            </div>
          )}
        </div>
        <div className={styles.shadeTop} />
        <div className={styles.shadeBottom} />
        <div className={styles.coverButtons}>
          <button type="button" className={styles.photoButton} onClick={back} aria-label="Volver">
            <ChevronLeft size={24} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.photoButton}
            aria-label="Más opciones"
            aria-haspopup="menu"
            onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
          >
            <Ellipsis size={22} aria-hidden="true" />
          </button>
        </div>
        <div ref={titleRef} className={styles.titleBlock}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{recipe.title}</h1>
          <div className={styles.pills}>
            <span className="chip-photo">{recipe.minutes} min</span>
            {recipe.kcal_adult !== null && (
              <span className="chip-photo">
                {recipe.kcal_estimated ? "≈ " : ""}
                {recipe.kcal_adult} kcal
              </span>
            )}
            {recipe.avg_stars !== null && <span className="chip-photo">★ {formatStars(recipe.avg_stars)}</span>}
            {recipe.freezer_note && (
              <span className="chip-photo">
                <Snowflake size={14} aria-hidden="true" /> Para congelar
              </span>
            )}
            {recipe.archived && <span className="chip-photo">Archivada</span>}
            {uploading && <span className="chip-photo">Subiendo foto…</span>}
          </div>
        </div>
      </section>

      <article className={styles.sheet} aria-label={recipe.title}>
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.actions}>
          {plannable ? (
            <button type="button" className={`pill-button pill-button--primary ${styles.addButton}`} onClick={() => setAddOpen(true)}>
              <CalendarPlus size={20} aria-hidden="true" /> Añadir al menú
            </button>
          ) : (
            <p className={styles.notPlannable}>
              {recipe.archived ? "Archivada: recupérala para añadirla al menú." : "No es un plato principal: no se planifica como comida o cena."}
            </p>
          )}
          <button
            type="button"
            className={`${styles.playButton} glass`}
            onClick={() => navigate(`/cocinar/receta/${encodeURIComponent(recipe.id)}`)}
            aria-label="Cocinar ahora"
          >
            <Play size={22} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          </button>
        </div>

        <div className={`${styles.stats} glass`}>
          {recipe.times_cooked === 0 ? (
            <>
              <Stat value="Sin estrenar" label="cocinada" />
              <Stat value="Sin estrenar" label="última vez" />
              <Stat value="Sin estrenar" label="de media" />
            </>
          ) : (
            <>
              <Stat value={recipe.times_cooked === 1 ? "1 vez" : `${recipe.times_cooked} veces`} label="cocinada" />
              <Stat value={last ? last.charAt(0).toUpperCase() + last.slice(1) : "—"} label="última vez" />
              <Stat value={recipe.avg_stars !== null ? `★ ${formatStars(recipe.avg_stars)}` : "—"} label="de media" />
            </>
          )}
        </div>

        {notes.length > 0 && (
          <section aria-labelledby="notes-title">
            <h2 id="notes-title" className={styles.sectionTitle}>
              Lo que dijisteis
            </h2>
            <ul className={`${styles.notes} glass`}>
              {shownNotes.map((h) => (
                <li key={h.id} className={styles.noteRow}>
                  <div className={styles.noteHead}>
                    <span className={styles.noteDate}>{historyLabel(h)}</span>
                    <Stars value={h.stars} />
                  </div>
                  <p className={h.note ? styles.noteText : styles.noteEmpty}>{h.note ?? "Sin nota"}</p>
                </li>
              ))}
            </ul>
            {notes.length > VISIBLE_NOTES && (
              <button type="button" className={styles.linkButton} onClick={() => setAllNotes(!allNotes)} aria-expanded={allNotes}>
                {allNotes ? "Ver menos" : `Ver todas (${notes.length})`}
              </button>
            )}
          </section>
        )}

        {recipe.freezer_note && (
          <div className={`${styles.infoCard} glass`}>
            <Snowflake size={20} aria-hidden="true" />
            <div>
              <p className={styles.infoTitle}>Para congelar</p>
              <p className={styles.infoText}>{recipe.freezer_note}</p>
            </div>
          </div>
        )}

        <RecipeBody recipe={recipe} />

        {(recipe.adaptation_notes || recipe.source_url) && (
          <section className={`${styles.infoCard} ${styles.adaptation} glass`} aria-labelledby="adaptation-title">
            <div>
              <h2 id="adaptation-title" className={styles.infoTitle}>
                Adaptación
              </h2>
              {recipe.adaptation_notes && <p className={styles.infoText}>{recipe.adaptation_notes}</p>}
              {recipe.source_url && <SourceLink url={recipe.source_url} />}
            </div>
          </section>
        )}
      </article>

      <div ref={blurTintRef} className={styles.blurTint} aria-hidden="true" />
      <div ref={blurStrongRef} className={styles.blurStrong} aria-hidden="true" />
      <div ref={barRef} className={`${styles.bar} glass-bar`} inert>
        <button type="button" className={styles.barBack} onClick={back} aria-label="Volver">
          <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <div className={styles.barText}>
          <p className={styles.barMeta}>
            {recipe.minutes} min · {COURSE_LABEL[recipe.course] ?? PROTEIN_LABEL[recipe.protein]}
          </p>
          <p className={styles.barTitle}>{recipe.title}</p>
        </div>
        {plannable && (
          <button type="button" className={styles.barAction} onClick={() => setAddOpen(true)} aria-label="Añadir al menú">
            <CalendarPlus size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      {menuAnchor && <RecipeMenu anchor={menuAnchor} archived={recipe.archived} onAction={menu} onClose={() => setMenuAnchor(null)} />}
      {addOpen && <AddToMenuSheet recipe={recipe} onClose={() => setAddOpen(false)} />}
      {paste.element}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function Stars({ value }: { value: number | null }) {
  return (
    <span className={styles.stars} aria-label={value === null ? "Sin estrellas" : `${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={15} strokeWidth={0} fill="currentColor" className={value !== null && n <= value ? styles.starOn : styles.starOff} aria-hidden="true" />
      ))}
    </span>
  );
}

function SourceLink({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // se muestra tal cual
  }
  return (
    <a className={styles.source} href={url} target="_blank" rel="noopener noreferrer">
      {host} <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function RecipeMenu({
  anchor,
  archived,
  onAction,
  onClose,
}: {
  anchor: DOMRect;
  archived: boolean;
  onAction: (action: "photo" | "edit" | "improve" | "paste" | "archive") => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const right = Math.max(12, window.innerWidth - anchor.right);
  const item = (action: Parameters<typeof onAction>[0], label: string, Icon: typeof Camera, danger = false) => (
    <button type="button" role="menuitem" className={`${styles.menuItem} ${danger ? styles.danger : ""}`} onClick={() => onAction(action)}>
      <Icon size={20} aria-hidden="true" />
      <strong>{label}</strong>
    </button>
  );
  return (
    <>
      <div className={styles.menuOverlay} onClick={onClose} aria-hidden="true" />
      <div ref={menuRef} className={styles.menu} role="menu" aria-label="Más opciones" style={{ top: anchor.bottom + 8, right }}>
        {item("photo", "Cambiar foto de portada", Camera)}
        {item("edit", "Editar receta", Pencil)}
        {item("improve", "Mejorar con Claude", Sparkles)}
        {item("paste", "Pegar receta de Claude", ClipboardPaste)}
        {archived ? item("archive", "Recuperar", ArchiveRestore) : item("archive", "Archivar", Archive, true)}
      </div>
    </>
  );
}

// ---------- Escena ligada al scroll: parallax de la portada y barra fija ----------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

function useCoverScene(refs: {
  coverRef: RefObject<HTMLElement | null>;
  photoRef: RefObject<HTMLElement | null>;
  titleRef: RefObject<HTMLElement | null>;
  barRef: RefObject<HTMLElement | null>;
  blurTintRef: RefObject<HTMLElement | null>;
  blurStrongRef: RefObject<HTMLElement | null>;
}) {
  const { coverRef, photoRef, titleRef, barRef, blurTintRef, blurStrongRef } = refs;
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    function apply() {
      frame = 0;
      const height = coverRef.current?.offsetHeight ?? 500;
      const s = Math.max(0, window.scrollY);
      if (photoRef.current) photoRef.current.style.transform = reduce ? "" : `translate3d(0, ${Math.min(s, height) * 0.35}px, 0)`;
      if (titleRef.current) titleRef.current.style.opacity = String(clamp01((height - 120 - s) / 160));
      const p = smoothstep((s - (height - 150)) / 90);
      const bar = barRef.current;
      if (bar) {
        bar.style.opacity = String(p);
        bar.style.transform = reduce ? "" : `translate3d(0, ${-12 * (1 - p)}px, 0) scale(${0.92 + 0.08 * p})`;
        bar.style.pointerEvents = p >= 0.5 ? "auto" : "none";
        bar.inert = p < 0.5;
      }
      const blur = String(clamp01((s - (height - 220)) / 90));
      if (blurTintRef.current) blurTintRef.current.style.opacity = blur;
      if (blurStrongRef.current) blurStrongRef.current.style.opacity = blur;
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [coverRef, photoRef, titleRef, barRef, blurTintRef, blurStrongRef]);
}
