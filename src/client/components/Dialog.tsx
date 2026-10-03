import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import styles from "./Dialog.module.css";

// Diálogos abiertos, del más antiguo al más reciente. Lo que tenga que verse y tocarse
// por encima (el aviso con «Deshacer») se pinta dentro del último: fuera de un <dialog>
// modal todo es inerte.
let openDialogs: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** El diálogo modal abierto más reciente, o null. */
export function useTopDialog(): HTMLDialogElement | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => openDialogs[openDialogs.length - 1] ?? null,
  );
}

/**
 * <dialog> modal nativo: foco atrapado, Escape y capa superior. onClose se llama al
 * pulsar Escape o tocar fuera del contenido (el contenido ocupa solo una parte).
 */
export function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    if (dialog) {
      openDialogs = [...openDialogs, dialog];
      notify();
    }
    return () => {
      dialog?.close();
      openDialogs = openDialogs.filter((d) => d !== dialog);
      notify();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
