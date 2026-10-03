import { Camera, Clock, Play } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { DayMeal, DayResponse, RecipeDetail } from "../../shared/api";
import { longDate, madridNow, shortDate, weekdayName } from "../../shared/dates";
import { otherSlot, pickSlotToShow } from "../../shared/meals";
import type { Slot } from "../../shared/recipe-format";
import { api } from "../api";
import { useNavRef } from "../components/BottomNav";
import { SunMoonCoin } from "../components/SunMoonCoin";
import { capitalize, formatQuantity, minutesLabel } from "../format";
import { Link, navigate } from "../router";
import { useTheme } from "../theme";
import styles from "./Today.module.css";

const SLOT_LABEL: Record<Slot, string> = { lunch: "Comida", dinner: "Cena" };

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; day: DayResponse };

export function Today() {
  const [today] = useState(() => madridNow());
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [slot, setSlot] = useState<Slot | null>(null);
  const { setTodaySlot } = useTheme();

  useEffect(() => {
    let cancelled = false;
    api
      .get<DayResponse>(`/day/${today.date}`)
      .then((day) => {
        if (cancelled) return;
        setLoad({ state: "ready", day });
        setSlot(pickSlotToShow(today.hour, { lunch: Boolean(day.lunch.recipe), dinner: Boolean(day.dinner.recipe) }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  // La comida mostrada decide el tema (salvo con el sistema en modo oscuro).
  useEffect(() => {
    setTodaySlot(slot);
    return () => setTodaySlot(null);
  }, [slot, setTodaySlot]);

  if (load.state === "loading") return <p className={styles.status}>Cargando…</p>;
  if (load.state === "error") return <p className={styles.status}>No se pudo cargar el día: {load.message}</p>;
  if (!slot) return <EmptyDay date={today.date} />;

  return <MealView date={today.date} slot={slot} meal={load.day[slot]} onToggle={() => setSlot(otherSlot(slot))} />;
}

function EmptyDay({ date }: { date: string }) {
  return (
    <main className={`${styles.page} ${styles.empty}`}>
      <p className={styles.weekday}>{weekdayName(date)}</p>
      <h1 className={`${styles.date} ${styles.emptyDate}`}>{longDate(date)}</h1>
      <div className={`${styles.emptyCard} glass`}>
        <p>Nada planificado para hoy</p>
        <Link href="/planificador" className="pill-button pill-button--primary">
          Planificar
        </Link>
      </div>
    </main>
  );
}

/** Portada + hoja de la comida de hoy: fecha, sol/luna y play. */
function MealView({ date, slot, meal, onToggle }: { date: string; slot: Slot; meal: DayMeal; onToggle: () => void }) {
  const recipe = meal.recipe;
  const coverRef = useRef<HTMLElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const blurTintRef = useRef<HTMLDivElement>(null);
  const blurStrongRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const navRef = useNavRef();

  useScrollScene(
    { coverRef, photoRef, dateRef, titleRef, barRef, blurTintRef, blurStrongRef, navRef },
    // Sin receta (fuera de casa o vacío) no hay hoja: la portada se queda sola, con el menú visible.
    Boolean(recipe),
  );

  const cook = () => navigate(`/cocinar/${date}/${slot}`);
  const openRecipe = () => {
    const top = (sheetRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return (
    <div className={styles.page}>
      <section ref={coverRef} className={styles.cover} aria-label="Portada">
        <div ref={photoRef} className={styles.photo}>
          {recipe?.photo_url ? (
            <img src={recipe.photo_url} alt="" decoding="async" />
          ) : (
            <div className={styles.placeholder}>
              {recipe && (
                <>
                  <Camera size={72} strokeWidth={1.1} color="rgba(255,255,255,.28)" aria-hidden="true" />
                  <span>La foto la harás al terminar</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className={styles.shadeTop} />
        <div className={styles.shadeBottom} />

        <header ref={dateRef} className={styles.dateHeader}>
          <SunMoonCoin slot={slot} onToggle={onToggle} sunColor="var(--sun-cover)" moonColor="#fff" />
          <div>
            <p className={styles.weekday}>{weekdayName(date)}</p>
            <h1 className={styles.date}>{longDate(date)}</h1>
          </div>
        </header>

        <div ref={titleRef} className={styles.titleBlock}>
          <p className={styles.slotLabel}>{SLOT_LABEL[slot]}</p>
          {recipe ? (
            <>
              <h2 className={styles.title}>
                <button type="button" className={styles.titleButton} onClick={openRecipe}>
                  {recipe.title}
                </button>
              </h2>
              <div className={styles.metaRow}>
                <RecipePills recipe={recipe} cooked={meal.cook_log !== null} />
                <button type="button" className={styles.coverPlay} onClick={cook} aria-label="Cocinar">
                  <Play size={28} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className={styles.title}>{meal.status === "away" ? "Fuera de casa" : "Sin planificar"}</h2>
              {meal.note && <p className={styles.note}>{meal.note}</p>}
            </>
          )}
        </div>
      </section>

      {recipe && (
        <>
          <RecipeSheet ref={sheetRef} recipe={recipe} />
          <div ref={blurTintRef} className={styles.blurTint} aria-hidden="true" />
          <div ref={blurStrongRef} className={styles.blurStrong} aria-hidden="true" />
          <div ref={barRef} className={`${styles.bar} glass-bar`} inert>
            <SunMoonCoin slot={slot} onToggle={onToggle} sunColor="var(--sun)" moonColor="var(--fg)" size={24} />
            <div className={styles.barText}>
              <p className={styles.barMeta}>
                {SLOT_LABEL[slot]} · {shortDate(date)}
              </p>
              <p className={styles.barTitle}>{recipe.title}</p>
            </div>
            <button type="button" className={styles.barPlay} onClick={cook} aria-label="Cocinar">
              <Play size={20} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RecipePills({ recipe, cooked }: { recipe: RecipeDetail; cooked: boolean }) {
  return (
    <div className={styles.pills}>
      <span className="chip-photo">{recipe.minutes} min</span>
      {recipe.kcal_adult !== null && (
        <span className="chip-photo">
          {recipe.kcal_estimated ? "≈ " : ""}
          {recipe.kcal_adult} kcal
        </span>
      )}
      {recipe.last_stars !== null && (
        <span className="chip-photo" aria-label={`Última valoración: ${recipe.last_stars} de 5`}>
          ★ {recipe.last_stars}
        </span>
      )}
      {cooked && <span className="chip-photo">Cocinado</span>}
      {recipe.times_cooked === 0 && <span className="chip-photo">Nueva</span>}
    </div>
  );
}

function RecipeSheet({ recipe, ref }: { recipe: RecipeDetail; ref: RefObject<HTMLElement | null> }) {
  return (
    <article ref={ref} className={styles.sheet} aria-label={recipe.title}>
      <div className={styles.handle} aria-hidden="true" />
      <RecipeBody recipe={recipe} />
    </article>
  );
}

/** Ingredientes y pasos de una receta (Hoy y la ficha). */
export function RecipeBody({ recipe }: { recipe: Pick<RecipeDetail, "ingredients" | "steps"> }) {
  return (
    <>
      <section aria-labelledby="ingredients-title">
        <div className={styles.sectionHead}>
          <h2 id="ingredients-title" className={styles.sectionTitle}>
            Ingredientes
          </h2>
          <span className={styles.servings}>4 raciones</span>
        </div>
        <ul className={`${styles.ingredients} glass`}>
          {recipe.ingredients.map((ing) => (
            <li key={ing.position} className={styles.ingredient}>
              <span>{ing.quantity === null ? ing.display_text : capitalize(ing.ingredient.name)}</span>
              <span className={styles.qty}>{formatQuantity(ing)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="steps-title">
        <div className={styles.sectionHead}>
          <h2 id="steps-title" className={styles.sectionTitle}>
            Pasos
          </h2>
        </div>
        <ol className={styles.steps}>
          {recipe.steps.map((step) => (
            <li key={step.position} className={`${styles.step} glass`}>
              <span className={styles.stepNumber} aria-hidden="true">
                {step.position}
              </span>
              <div>
                <p className={styles.stepText}>
                  <span className="visually-hidden">Paso {step.position}: </span>
                  {step.text}
                </p>
                {step.timer_seconds !== null && (
                  <span className={`chip ${styles.timer}`}>
                    <Clock size={16} strokeWidth={2} aria-hidden="true" />
                    {minutesLabel(step.timer_seconds)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

// ---------- Escena ligada al desplazamiento ----------

interface SceneRefs {
  coverRef: RefObject<HTMLElement | null>;
  photoRef: RefObject<HTMLElement | null>;
  dateRef: RefObject<HTMLElement | null>;
  titleRef: RefObject<HTMLElement | null>;
  barRef: RefObject<HTMLElement | null>;
  blurTintRef: RefObject<HTMLElement | null>;
  blurStrongRef: RefObject<HTMLElement | null>;
  navRef: RefObject<HTMLElement | null> | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Transiciones ligadas al scroll. No re-renderiza React: en cada frame (rAF) escribe
 * opacity/transform directamente en unos pocos elementos. Los umbrales del diseño son
 * para un alto de 844 px y se escalan con el alto real de la portada.
 * Con prefers-reduced-motion: sin parallax ni escalados, solo fundidos.
 */
function useScrollScene(refs: SceneRefs, withSheet: boolean) {
  const { coverRef, photoRef, dateRef, titleRef, barRef, blurTintRef, blurStrongRef, navRef } = refs;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    function apply() {
      frame = 0;
      const height = coverRef.current?.offsetHeight || window.innerHeight;
      const k = height / 844;
      const s = Math.max(0, window.scrollY);

      const photo = photoRef.current;
      if (photo) photo.style.transform = reduce ? "" : `translate3d(0, ${Math.min(s, height) * 0.4}px, 0)`;

      if (dateRef.current) dateRef.current.style.opacity = String(clamp01(1 - s / (160 * k)));

      const title = titleRef.current;
      if (title) {
        const visible = clamp01((560 * k - s) / (200 * k));
        const gone = 1 - visible;
        title.style.opacity = String(visible);
        title.style.transform = reduce ? "" : `translate3d(0, ${-14 * gone}px, 0) scale(${1 - 0.04 * gone})`;
      }

      const bar = barRef.current;
      if (bar) {
        const p = smoothstep((s - 470 * k) / (110 * k));
        bar.style.opacity = String(p);
        bar.style.transform = reduce ? "" : `translate3d(0, ${-12 * (1 - p)}px, 0) scale(${0.92 + 0.08 * p})`;
        const interactive = p >= 0.5;
        bar.style.pointerEvents = interactive ? "auto" : "none";
        bar.inert = !interactive;
      }

      const blur = String(clamp01((s - 10 * k) / (90 * k)));
      if (blurTintRef.current) blurTintRef.current.style.opacity = blur;
      if (blurStrongRef.current) blurStrongRef.current.style.opacity = blur;

      const nav = navRef?.current;
      if (nav) {
        // Sin hoja (fuera de casa / vacío) el menú se ve siempre.
        const n = withSheet ? smoothstep((s - 260 * k) / (160 * k)) : 1;
        nav.style.opacity = String(n);
        nav.style.transform = reduce ? "" : `translate3d(0, ${24 * (1 - n)}px, 0) scale(${0.94 + 0.06 * n})`;
        const interactive = n >= 0.5;
        nav.style.pointerEvents = interactive ? "" : "none";
        nav.inert = !interactive;
      }
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
      // El menú vive fuera de Hoy (en App): se lee al limpiar para devolverlo a su estado normal.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const nav = navRef?.current;
      if (nav) {
        nav.style.opacity = "";
        nav.style.transform = "";
        nav.style.pointerEvents = "";
        nav.inert = false;
      }
    };
  }, [coverRef, photoRef, dateRef, titleRef, barRef, blurTintRef, blurStrongRef, navRef, withSheet]);
}
