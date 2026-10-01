/**
 * Temporizadores del modo cocina. Se guardan como hora de fin absoluta (ms desde epoch),
 * nunca como contador: así sobreviven a que iOS recargue la app al volver de otra.
 */
export interface CookTimer {
  /** Un temporizador por paso: "step-3". */
  id: string;
  step: number;
  label: string;
  durationMs: number;
  endsAt: number;
  /** true cuando ya se ha avisado (sonido y aviso) de que terminó. */
  notified: boolean;
}

export function startTimer(step: number, seconds: number, label: string | null, now: number): CookTimer {
  return {
    id: `step-${step}`,
    step,
    label: label ?? `Paso ${step}`,
    durationMs: seconds * 1000,
    endsAt: now + seconds * 1000,
    notified: false,
  };
}

export function remainingMs(timer: CookTimer, now: number): number {
  return Math.max(0, timer.endsAt - now);
}

export function isDone(timer: CookTimer, now: number): boolean {
  return now >= timer.endsAt;
}

/** Progreso de 0 (recién iniciado) a 1 (terminado). */
export function timerProgress(timer: CookTimer, now: number): number {
  if (timer.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remainingMs(timer, now) / timer.durationMs));
}

/** "09:58", "1:02:05". Redondea hacia arriba: a 0,4 s del final sigue mostrando 00:01. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Temporizadores que han terminado y de los que aún no se ha avisado. */
export function newlyFinished(timers: CookTimer[], now: number): CookTimer[] {
  return timers.filter((t) => !t.notified && isDone(t, now));
}
