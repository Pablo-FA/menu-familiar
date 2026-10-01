import type { CSSProperties } from "react";
import { formatCountdown, isDone, remainingMs, timerProgress, type CookTimer } from "../../shared/timers";
import styles from "./Cook.module.css";

/** Pastillas de los temporizadores en marcha, visibles en cualquier paso. */
export function TimerPills({ timers, now, onSelect }: { timers: CookTimer[]; now: number; onSelect: (t: CookTimer) => void }) {
  if (timers.length === 0) return null;
  return (
    <div className={styles.timers} role="list" aria-label="Temporizadores">
      {timers.map((t) => {
        const done = isDone(t, now);
        const left = formatCountdown(remainingMs(t, now));
        return (
          <button
            key={t.id}
            type="button"
            role="listitem"
            className={`${styles.timer} ${done ? styles.timerDone : ""}`}
            onClick={() => onSelect(t)}
            aria-label={done ? `${t.label}: listo. Tocar para quitar` : `${t.label}: quedan ${left}. Tocar para cancelar`}
          >
            <span className={styles.ring} style={{ "--p": timerProgress(t, now) } as CSSProperties} aria-hidden="true" />
            {t.label}
            <span className={styles.countdown} aria-hidden="true">
              {done ? "¡Listo!" : left}
            </span>
          </button>
        );
      })}
    </div>
  );
}
