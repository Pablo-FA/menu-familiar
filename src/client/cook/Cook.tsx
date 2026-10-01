import { BellRing, ChevronLeft, ChevronRight, Clock, ListChecks, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { DayMeal, DayResponse, RecipeDetail } from "../../shared/api";
import { emptyProgress, parseProgress, progressKey, type CookProgress } from "../../shared/cook-progress";
import type { Slot } from "../../shared/recipe-format";
import { stepIngredients } from "../../shared/step-ingredients";
import { newlyFinished, startTimer, type CookTimer } from "../../shared/timers";
import { api } from "../api";
import { capitalize, formatQuantity, minutesLabel } from "../format";
import { navigate } from "../router";
import { useTheme } from "../theme";
import { playAlarm, unlockAudio } from "./alarm";
import { ConfirmCancel } from "./ConfirmCancel";
import styles from "./Cook.module.css";
import { FinishScreen } from "./FinishScreen";
import { IngredientsSheet } from "./IngredientsSheet";
import { averageColor } from "./photo";
import { TimerPills } from "./TimerPills";
import { useWakeLock } from "./useWakeLock";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; meal: DayMeal };

/** Modo cocina: /cocinar/:fecha/:franja */
export function Cook({ date, slot }: { date: string; slot: Slot }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const { setTodaySlot } = useTheme();
  useWakeLock();

  // Mismo tema que Hoy para esa franja.
  useEffect(() => {
    setTodaySlot(slot);
    return () => setTodaySlot(null);
  }, [slot, setTodaySlot]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<DayResponse>(`/day/${date}`)
      .then((day) => !cancelled && setLoad({ state: "ready", meal: day[slot] }))
      .catch((err: unknown) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [date, slot]);

  if (load.state === "loading") return <p className={styles.status}>Cargando…</p>;
  if (load.state === "error") return <p className={styles.status}>No se pudo cargar la receta: {load.message}</p>;
  const recipe = load.meal.recipe;
  if (!recipe) {
    return (
      <div className={styles.status}>
        <p>No hay receta planificada para esta comida.</p>
        <button type="button" className="pill-button pill-button--primary" onClick={() => navigate("/")}>
          Volver a Hoy
        </button>
      </div>
    );
  }
  return <CookSession date={date} slot={slot} recipe={recipe} meal={load.meal} />;
}

function loadProgress(key: string, steps: number): CookProgress {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Sin localStorage (modo privado): se empieza de cero.
  }
  const saved = parseProgress(raw, Date.now()) ?? emptyProgress(Date.now());
  return { ...saved, step: Math.min(saved.step, steps - 1) };
}

function CookSession({ date, slot, recipe, meal }: { date: string; slot: Slot; recipe: RecipeDetail; meal: DayMeal }) {
  const key = progressKey(date, slot);
  const steps = recipe.steps;
  const [progress, setProgress] = useState<CookProgress>(() => loadProgress(key, steps.length));
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState<CookTimer | null>(null);
  const [toasts, setToasts] = useState<CookTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const pageRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef(progress.timers);
  useEffect(() => {
    timersRef.current = progress.timers;
  }, [progress.timers]);
  const hasTimers = progress.timers.length > 0;

  // Reloj de 250 ms mientras haya temporizadores. En cada tic se detectan los que acaban
  // de terminar: sonido, aviso arriba y se marcan como avisados (también al volver a la app).
  useEffect(() => {
    if (!hasTimers) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const finished = newlyFinished(timersRef.current, t);
      if (finished.length === 0) return;
      timersRef.current = timersRef.current.map((x) => (finished.some((f) => f.id === x.id) ? { ...x, notified: true } : x));
      playAlarm();
      setToasts((list) => [...list, ...finished]);
      setProgress((p) => ({
        ...p,
        timers: p.timers.map((x) => (finished.some((f) => f.id === x.id) ? { ...x, notified: true } : x)),
      }));
    };
    const id = window.setInterval(tick, 250);
    const timeout = window.setTimeout(tick, 0);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [hasTimers]);

  // Persistencia: cada cambio se guarda con su hora (caduca a las 12 h).
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ ...progress, savedAt: Date.now() }));
    } catch {
      // Sin almacenamiento: el progreso dura lo que la pantalla.
    }
  }, [key, progress]);

  // Halo con el tono de la portada.
  useEffect(() => {
    if (!recipe.photo_url) return;
    let cancelled = false;
    void averageColor(recipe.photo_url).then((rgb) => {
      if (!cancelled && rgb && pageRef.current) pageRef.current.style.setProperty("--halo", `rgba(${rgb.join(",")}, 0.45)`);
    });
    return () => {
      cancelled = true;
    };
  }, [recipe.photo_url]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0) return;
      if (index >= steps.length) {
        setProgress((p) => ({ ...p, finished: true }));
        return;
      }
      setDirection(index > progress.step ? "forward" : "back");
      setProgress((p) => ({ ...p, step: index, finished: false }));
    },
    [progress.step, steps.length],
  );

  // Gestos horizontales sobre el cuerpo. Los que empiezan a < 24 px del borde izquierdo
  // se ignoran: en iOS son el gesto de volver.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse" || e.clientX < 24) return;
    swipe.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTo(progress.step + (dx < 0 ? 1 : -1));
  }

  const exit = () => navigate("/"); // conserva el progreso guardado
  const finishAndLeave = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      // nada
    }
    navigate("/");
  };

  if (progress.finished) {
    return (
      <div ref={pageRef} className={styles.page}>
        <div className={styles.halo} aria-hidden="true" />
        <FinishScreen
          recipe={recipe}
          date={date}
          slot={slot}
          existingLog={meal.cook_log}
          onBack={() => goTo(steps.length - 1)}
          onDone={finishAndLeave}
        />
      </div>
    );
  }

  const step = steps[progress.step];
  if (!step) return null;
  const amounts = stepIngredients(step, recipe.ingredients);
  const stepTimer = progress.timers.find((t) => t.step === step.position);
  const isLast = progress.step === steps.length - 1;

  function startStepTimer() {
    if (!step?.timer_seconds) return;
    unlockAudio(); // en el toque: iOS solo deja sonar audio desbloqueado por un gesto
    const timer = startTimer(step.position, step.timer_seconds, step.timer_label, Date.now());
    setProgress((p) => ({ ...p, timers: [...p.timers.filter((t) => t.id !== timer.id), timer] }));
  }

  function removeTimer(id: string) {
    setProgress((p) => ({ ...p, timers: p.timers.filter((t) => t.id !== id) }));
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={styles.halo} aria-hidden="true" />

      <header className={styles.header}>
        <button type="button" className={styles.glassButton} onClick={exit} aria-label="Salir del modo cocina">
          <X size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <div className={styles.headerText}>
          <p className={styles.headerTitle}>{recipe.title}</p>
          <p className={styles.headerStep} aria-live="polite">
            Paso {progress.step + 1} de {steps.length}
          </p>
        </div>
        <button type="button" className={styles.glassButton} onClick={() => setSheetOpen(true)} aria-label="Ver ingredientes">
          <ListChecks size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Progreso de la receta"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={progress.step + 1}
      >
        {steps.map((s, i) => (
          <span key={s.position} className={`${styles.segment} ${i <= progress.step ? styles.segmentOn : ""}`} />
        ))}
      </div>

      <TimerPills
        timers={progress.timers}
        now={now}
        onSelect={(t) => (now >= t.endsAt ? removeTimer(t.id) : setConfirming(t))}
      />

      <main className={styles.body} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)}>
        <div key={progress.step} className={styles.step} data-dir={direction}>
          <p className={styles.stepText}>{step.text}</p>
          {amounts.length > 0 && (
            <ul className={styles.amounts} aria-label="Cantidades de este paso">
              {amounts.map((ing) => {
                const qty = formatQuantity(ing);
                return (
                  <li key={ing.position} className={styles.amount}>
                    {qty && <strong>{qty}</strong>}
                    <span>{ing.ingredient.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {step.timer_seconds !== null && !stepTimer && (
            <button type="button" className={styles.startTimer} onClick={startStepTimer}>
              <span className={styles.startTimerIcon} aria-hidden="true">
                <Clock size={20} strokeWidth={2.2} />
              </span>
              Iniciar {minutesLabel(step.timer_seconds)}
            </button>
          )}
        </div>
      </main>

      <footer className={styles.footer}>
        <button
          type="button"
          className={`${styles.glassButton} ${styles.prev}`}
          onClick={() => goTo(progress.step - 1)}
          disabled={progress.step === 0}
          aria-label="Paso anterior"
        >
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button type="button" className={styles.next} onClick={() => goTo(progress.step + 1)}>
          {isLast ? "Terminar" : "Siguiente"}
          <ChevronRight size={22} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </footer>

      {toasts[0] && (
        <button type="button" className={`${styles.toast} glass-bar`} role="alert" onClick={() => setToasts((t) => t.slice(1))}>
          <BellRing size={22} strokeWidth={2.2} aria-hidden="true" />
          {capitalize(toasts[0].label)}: ¡listo!
        </button>
      )}

      {sheetOpen && (
        <IngredientsSheet
          ingredients={recipe.ingredients}
          checked={progress.checked}
          onToggle={(position) =>
            setProgress((p) => ({
              ...p,
              checked: p.checked.includes(position) ? p.checked.filter((n) => n !== position) : [...p.checked, position],
            }))
          }
          onClose={() => setSheetOpen(false)}
        />
      )}

      {confirming && (
        <ConfirmCancel
          timer={confirming}
          onCancelTimer={() => {
            removeTimer(confirming.id);
            setConfirming(null);
          }}
          onKeep={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
