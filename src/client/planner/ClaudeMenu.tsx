import { ClipboardPaste, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import styles from "./Planner.module.css";

/** Menú emergente del botón ✦: anclado bajo el botón y alineado a su derecha. */
export function ClaudeMenu({
  anchor,
  onPlan,
  onPaste,
  onClose,
}: {
  anchor: DOMRect;
  onPlan: () => void;
  onPaste: () => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const right = Math.max(12, window.innerWidth - anchor.right);
  return (
    <>
      <div className={styles.menuOverlay} onClick={onClose} aria-hidden="true" />
      <div className={styles.menu} role="menu" aria-label="Claude" style={{ top: anchor.bottom + 8, right }}>
        <button ref={firstRef} type="button" role="menuitem" className={styles.menuItem} onClick={onPlan}>
          <Sparkles size={20} aria-hidden="true" />
          <span>
            <strong>Planificar con Claude</strong>
            <span>Copia un resumen y abre el proyecto</span>
          </span>
        </button>
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onPaste}>
          <ClipboardPaste size={20} aria-hidden="true" />
          <span>
            <strong>Pegar menú</strong>
            <span>Lo que te haya devuelto Claude</span>
          </span>
        </button>
      </div>
    </>
  );
}
