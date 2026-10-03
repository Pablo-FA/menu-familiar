import { ArrowDown, ArrowUp, Mic, Minus, Plus, Timer, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { emptyStep, timerStep, type DraftStep, type RecipeDraft } from "../../../shared/recipe-draft";
import { AutoTextarea, FieldError } from "./controls";
import type { Errors } from "./Editor";
import styles from "./Editor.module.css";

const DEFAULT_TIMER_MIN = 5;

export function StepsTab({
  draft,
  errors,
  setDraft,
}: {
  draft: RecipeDraft;
  errors: Errors;
  setDraft: Dispatch<SetStateAction<RecipeDraft>>;
}) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const steps = draft.steps;
  const setSteps = (fn: (s: DraftStep[]) => DraftStep[]) => setDraft((d) => ({ ...d, steps: fn(d.steps) }));
  const patch = (key: string, p: Partial<DraftStep>) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const move = (from: number, to: number) =>
    setSteps((s) => {
      if (to < 0 || to >= s.length) return s;
      const next = [...s];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });

  function add() {
    const step = emptyStep();
    setSteps((s) => [...s, step]);
    setFocusKey(step.key);
  }

  return (
    <>
      <p className={styles.dictate}>
        <Mic size={16} aria-hidden="true" /> Para dictar, toca el campo y después el micrófono del teclado.
      </p>
      <FieldError message={errors.get("steps")} />
      <ol className={styles.stepList}>
        {steps.map((step, index) => (
          <StepCard
            key={step.key}
            step={step}
            index={index}
            count={steps.length}
            errors={errors}
            autoFocus={focusKey === step.key}
            patch={(p) => patch(step.key, p)}
            onMove={(delta) => move(index, index + delta)}
            onRemove={() => setSteps((s) => s.filter((x) => x.key !== step.key))}
          />
        ))}
      </ol>
      <button type="button" className={styles.addButton} onClick={add}>
        <Plus size={18} aria-hidden="true" /> Añadir paso
      </button>
    </>
  );
}

function StepCard({
  step,
  index,
  count,
  errors,
  autoFocus,
  patch,
  onMove,
  onRemove,
}: {
  step: DraftStep;
  index: number;
  count: number;
  errors: Errors;
  autoFocus: boolean;
  patch: (p: Partial<DraftStep>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);
  const n = index + 1;
  const minutes = step.timer_seconds === null ? null : Math.max(1, Math.round(step.timer_seconds / 60));
  const err = (field: string) => errors.get(`steps[${index}].${field}`);

  return (
    <li className={`${styles.group} ${styles.stepCard}`}>
      <div className={styles.stepHead}>
        <span className={styles.stepNumber} aria-hidden="true">
          {n}
        </span>
        <span className={`${styles.grow} ${styles.label}`}>PASO {n}</span>
        <button type="button" className={styles.tool34} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Subir el paso ${n}`}>
          <ArrowUp size={17} aria-hidden="true" />
        </button>
        <button type="button" className={styles.tool34} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Bajar el paso ${n}`}>
          <ArrowDown size={17} aria-hidden="true" />
        </button>
        <button type="button" className={`${styles.tool34} ${styles.danger}`} onClick={onRemove} aria-label={`Quitar el paso ${n}`}>
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </div>
      <AutoTextarea ref={textRef} value={step.text} onChange={(text) => patch({ text })} label={`Texto del paso ${n}`} placeholder="Qué hay que hacer" />
      <FieldError message={err("text")} />

      {minutes === null ? (
        <button type="button" className={styles.chip} onClick={() => patch({ timer_seconds: DEFAULT_TIMER_MIN * 60 })}>
          <Timer size={15} aria-hidden="true" /> Añadir temporizador
        </button>
      ) : (
        <div className={styles.timerRow}>
          <div className={styles.stepper} role="group" aria-label={`Temporizador del paso ${n}`}>
            <Timer size={17} aria-hidden="true" className={styles.timerIcon} />
            <button
              type="button"
              aria-label={minutes <= 1 ? "Quitar temporizador" : "Menos minutos"}
              onClick={() => (minutes <= 1 ? patch({ timer_seconds: null }) : patch({ timer_seconds: timerStep(minutes, -1) * 60 }))}
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <span className={styles.stepperValue} aria-live="polite">
              {minutes} min
            </span>
            <button type="button" aria-label="Más minutos" onClick={() => patch({ timer_seconds: timerStep(minutes, 1) * 60 })}>
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
          <input
            className={styles.input}
            value={step.timer_label}
            onChange={(e) => patch({ timer_label: e.target.value })}
            placeholder="Nombre del temporizador"
            aria-label={`Nombre del temporizador del paso ${n}`}
            maxLength={30}
          />
          <FieldError message={err("timer_label")} />
          <button type="button" className={styles.linkButton} onClick={() => patch({ timer_seconds: null, timer_label: "" })}>
            Quitar temporizador
          </button>
        </div>
      )}
    </li>
  );
}
