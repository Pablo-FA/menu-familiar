import { useEffect, useRef } from "react";
import type { CookTimer } from "../../shared/timers";
import styles from "./Cook.module.css";
import { Dialog } from "../components/Dialog";

/** Confirmación para cancelar un temporizador. El foco empieza en "Seguir" (lo no destructivo). */
export function ConfirmCancel({ timer, onCancelTimer, onKeep }: { timer: CookTimer; onCancelTimer: () => void; onKeep: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <Dialog label="Cancelar temporizador" onClose={onKeep}>
      <div className={styles.confirm}>
        <h2>{timer.label}</h2>
        <p>¿Cancelar este temporizador?</p>
        <div className={styles.confirmActions}>
          <button type="button" className={`pill-button pill-button--secondary ${styles.danger}`} onClick={onCancelTimer}>
            Cancelar temporizador
          </button>
          <button ref={keepRef} type="button" className="pill-button pill-button--primary" onClick={onKeep}>
            Seguir
          </button>
        </div>
      </div>
    </Dialog>
  );
}
