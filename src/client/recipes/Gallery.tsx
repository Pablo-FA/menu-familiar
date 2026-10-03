import { BookOpen, Plus, Search, Snowflake, Sparkles, Utensils } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RecipeSummary } from "../../shared/api";
import { PROTEIN_LABEL } from "../../shared/balance";
import {
  emptyTitle,
  filterGallery,
  GALLERY_SORTS,
  gallerySubtitle,
  hasFilters,
  ideasRequestText,
  NO_FILTERS,
  SORT_LABEL,
  sortGallery,
  type GalleryFilters,
  type GallerySort,
} from "../../shared/gallery";
import { formatStars, QUICK_MINUTES } from "../../shared/picker";
import type { Protein } from "../../shared/recipe-format";
import { useToast } from "../components/Toast";
import { useScrollScene } from "../components/useScrollScene";
import { copyAndOpenClaude } from "../planner/claude";
import { Link } from "../router";
import { NewRecipeSheet } from "./NewRecipe";
import styles from "./Recipes.module.css";
import { useRecipes } from "./store";

const PROTEINS: Protein[] = ["verdura", "legumbre", "pescado", "huevo", "ave", "carne"];
export const COURSE_LABEL: Record<string, string> = { side: "Pan", breakfast: "Desayuno", drink: "Bebida" };
const STATE_KEY = "mf.gallery";

interface SavedState {
  filters: GalleryFilters;
  sort: GallerySort;
  scrollY: number;
}

function readState(): SavedState {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (raw) return { filters: NO_FILTERS, sort: "best", scrollY: 0, ...(JSON.parse(raw) as Partial<SavedState>) };
  } catch {
    // sin almacenamiento
  }
  return { filters: NO_FILTERS, sort: "best", scrollY: 0 };
}

function saveState(state: SavedState) {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // sin almacenamiento
  }
}

/** "30 min · Pescado" (o "Pan" en vez de la proteína). */
export function recipeMeta(r: Pick<RecipeSummary, "minutes" | "protein" | "course">): string {
  return `${r.minutes} min · ${COURSE_LABEL[r.course] ?? PROTEIN_LABEL[r.protein]}`;
}

type Chip = { key: string; label: string; active: boolean; toggle: () => void };

/** Galería del recetario (/recetas). */
export function Gallery() {
  const [initial] = useState(readState);
  const [filters, setFilters] = useState<GalleryFilters>(initial.filters);
  const [sort, setSort] = useState<GallerySort>(initial.sort);
  const [newOpen, setNewOpen] = useState(false);
  const { recipes, error } = useRecipes();
  const toast = useToast();

  const list = useMemo(() => (recipes ? sortGallery(filterGallery(recipes, filters), sort) : []), [recipes, filters, sort]);
  const filtered = hasFilters(filters);
  const set = (patch: Partial<GalleryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  // Filtros, orden y posición se conservan al ir a una ficha y volver.
  const latest = useRef({ filters, sort });
  useEffect(() => {
    latest.current = { filters, sort };
    saveState({ filters, sort, scrollY: window.scrollY });
  }, [filters, sort]);
  // Se guarda al desplazarse (al navegar, el router ya ha subido al principio).
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        saveState({ ...latest.current, scrollY: window.scrollY });
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !recipes) return;
    restored.current = true;
    if (initial.scrollY > 0) window.scrollTo(0, initial.scrollY);
  }, [recipes, initial.scrollY]);

  const chips: Chip[] = [
    { key: "lunch", label: "Comida", active: filters.slot === "lunch", toggle: () => set({ slot: filters.slot === "lunch" ? null : "lunch" }) },
    { key: "dinner", label: "Cena", active: filters.slot === "dinner", toggle: () => set({ slot: filters.slot === "dinner" ? null : "dinner" }) },
    { key: "quick", label: `≤ ${QUICK_MINUTES} min`, active: filters.quick, toggle: () => set({ quick: !filters.quick }) },
    ...PROTEINS.map((p) => ({
      key: p,
      label: PROTEIN_LABEL[p],
      active: filters.protein === p,
      toggle: () => set({ protein: filters.protein === p ? null : p }),
    })),
    { key: "unstarted", label: "Sin estrenar", active: filters.unstarted, toggle: () => set({ unstarted: !filters.unstarted }) },
    { key: "freezer", label: "Para congelar", active: filters.freezer, toggle: () => set({ freezer: !filters.freezer }) },
    { key: "sides", label: "Panes y guarniciones", active: filters.sides, toggle: () => set({ sides: !filters.sides }) },
    { key: "archived", label: "Archivadas", active: filters.archived, toggle: () => set({ archived: !filters.archived }) },
  ];
  // Los activos van delante, para que siempre se vean.
  const orderedChips = [...chips.filter((c) => c.active), ...chips.filter((c) => !c.active)];

  const headerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const blurTintRef = useRef<HTMLDivElement>(null);
  const blurStrongRef = useRef<HTMLDivElement>(null);
  useScrollScene({ headerRef, barRef, blurTintRef, blurStrongRef });

  const countLabel = filtered ? `${list.length} ${list.length === 1 ? "receta" : "recetas"}` : `${list.length} RECETAS`;
  const mainsCount = recipes ? recipes.filter((r) => r.course === "main" && !r.archived).length : 0;

  function askIdeas(protein: Protein) {
    const titles = (recipes ?? []).filter((r) => !r.archived && r.course === "main").map((r) => r.title);
    copyAndOpenClaude(ideasRequestText(protein, filters.slot, titles), toast, "Petición copiada");
  }

  return (
    <main className={styles.page}>
      <div ref={blurTintRef} className={styles.blurTint} aria-hidden="true" />
      <div ref={blurStrongRef} className={styles.blurStrong} aria-hidden="true" />

      <div ref={barRef} className={`${styles.bar} glass-bar`} inert>
        <div className={styles.barText}>
          <p className={styles.barTitle}>Recetas</p>
          <p className={styles.barStatus}>{mainsCount} recetas</p>
        </div>
        <button type="button" className={styles.barPlus} onClick={() => setNewOpen(true)} aria-label="Nueva receta">
          <Plus size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <div ref={headerRef}>
        <div className={styles.header}>
          <h1 className={styles.title}>Recetas</h1>
          <button type="button" className={`${styles.circleButton} glass`} onClick={() => setNewOpen(true)} aria-label="Nueva receta">
            <Plus size={21} strokeWidth={2.1} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.subline}>{recipes ? gallerySubtitle(recipes) : " "}</p>
      </div>

      <label className={`${styles.search} glass`}>
        <Search size={18} aria-hidden="true" />
        <span className="visually-hidden">Buscar receta o ingrediente</span>
        <input
          type="search"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="Buscar receta o ingrediente"
          autoCorrect="off"
          enterKeyHint="search"
        />
      </label>

      <div className={styles.chips} role="group" aria-label="Filtros">
        {orderedChips.map((c) => (
          <button key={c.key} type="button" className={styles.chip} aria-pressed={c.active} onClick={c.toggle}>
            {c.label}
          </button>
        ))}
      </div>

      <div className={styles.listHead}>
        <span className={styles.listCount} aria-live="polite">
          {recipes ? countLabel : ""}
        </span>
        <button
          type="button"
          className={styles.sortButton}
          onClick={() => setSort(GALLERY_SORTS[(GALLERY_SORTS.indexOf(sort) + 1) % GALLERY_SORTS.length] ?? "best")}
          aria-label={`Orden: ${SORT_LABEL[sort]}. Cambiar`}
        >
          {SORT_LABEL[sort]}
        </button>
      </div>

      {!recipes && <p className={styles.muted}>{error ? "No se ha podido cargar el recetario." : "Cargando…"}</p>}

      {recipes && list.length === 0 && (
        <section className={`${styles.emptyCard} glass`}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <BookOpen size={26} />
          </span>
          <h2 className={styles.emptyTitle}>{emptyTitle(filters)}</h2>
          {(filters.protein === "pescado" || filters.protein === "legumbre") && !filters.archived && (
            <>
              <p className={styles.emptyText}>
                Tu recetario anda corto de {PROTEIN_LABEL[filters.protein].toLowerCase()}. Claude puede proponerte algunas que encajen con la familia.
              </p>
              <button
                type="button"
                className={`pill-button pill-button--primary ${styles.wide}`}
                onClick={() => filters.protein && askIdeas(filters.protein)}
              >
                <Sparkles size={18} aria-hidden="true" /> Pedir ideas a Claude
              </button>
            </>
          )}
          <button type="button" className={`pill-button pill-button--secondary ${styles.wide}`} onClick={() => setFilters(NO_FILTERS)}>
            Quitar filtros
          </button>
        </section>
      )}

      <ul className={styles.grid}>
        {list.map((r) => (
          <li key={r.id}>
            <RecipeCard recipe={r} />
          </li>
        ))}
      </ul>

      {newOpen && <NewRecipeSheet onClose={() => setNewOpen(false)} />}
    </main>
  );
}

function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const photo = recipe.thumb_url;
  const badge = photo ? "chip-photo" : styles.phChip;
  return (
    <Link href={`/receta/${encodeURIComponent(recipe.id)}`} className={`${styles.card} glass`} data-archived={recipe.archived}>
      <div className={styles.cardPhoto}>
        {photo ? (
          <img src={photo} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className={styles.placeholder}>
            <Utensils size={30} strokeWidth={1.5} aria-hidden="true" />
            <span>Sin foto</span>
          </div>
        )}
        <div className={styles.badgesLeft}>
          {recipe.avg_stars !== null && <span className={badge}>★ {formatStars(recipe.avg_stars)}</span>}
          {recipe.times_cooked === 0 && <span className={badge}>Nueva</span>}
        </div>
        {recipe.has_freezer && (
          <span className={`${badge} ${styles.badgeRight}`} aria-label="Para congelar">
            <Snowflake size={14} aria-hidden="true" />
          </span>
        )}
      </div>
      <p className={styles.cardTitle}>{recipe.title}</p>
      <p className={styles.cardMeta}>{recipeMeta(recipe)}</p>
    </Link>
  );
}
