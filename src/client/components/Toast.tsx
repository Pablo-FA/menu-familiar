import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Toast.module.css";

export interface ToastOptions {
  message: string;
  /** Acción opcional ("Deshacer", "Abrir Claude"). */
  action?: { label: string; onClick: () => void } | undefined;
}

const ToastContext = createContext<(t: ToastOptions) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

const DURATION_MS = 3400;

/** Aviso en pastilla sobre el menú inferior. Uno a la vez: el nuevo sustituye al anterior. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<number | null>(null);
  const counter = useRef(0);

  const show = useCallback((t: ToastOptions) => {
    counter.current += 1;
    setToast({ ...t, id: counter.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), DURATION_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`${styles.toast} glass-bar`}>
            <span className={styles.text}>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
