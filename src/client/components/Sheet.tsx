import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Dialog } from "./Dialog";
import styles from "./Sheet.module.css";

/**
 * Hoja inferior de vidrio: tirador, cerrar deslizando hacia abajo desde la cabecera,
 * tocando fuera o con Escape. `top` fija dónde empieza (p. ej. "calc(var(--safe-top) + 58px)");
 * sin `top`, la altura se ajusta al contenido.
 */
export function Sheet({
  label,
  onClose,
  head,
  children,
  footer,
  top,
  className,
}: {
  label: string;
  onClose: () => void;
  head: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  top?: string;
  className?: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useKeyboardInset(sheetRef);

  function onPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button, input, textarea, a")) return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  }
  function onPointerUp() {
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    const sheet = sheetRef.current;
    if (dy > 90) {
      onClose();
      return;
    }
    if (sheet) {
      sheet.style.transition = "transform 200ms";
      sheet.style.transform = "";
    }
  }

  const style: CSSProperties = top ? { top } : {};
  return (
    <Dialog label={label} onClose={onClose}>
      <div ref={sheetRef} className={`${styles.sheet} ${className ?? ""}`} style={style}>
        <div
          className={styles.head}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className={styles.handle} aria-hidden="true" />
          {head}
        </div>
        {children !== undefined && <div className={styles.body}>{children}</div>}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </Dialog>
  );
}

/**
 * Con el teclado abierto, iOS no encoge la ventana: la hoja (fija abajo) quedaría debajo
 * del teclado. Se sube la hoja lo que ocupa el teclado (visualViewport) y, al enfocar un
 * campo, se desplaza hasta él dentro de la hoja.
 */
function useKeyboardInset(sheetRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const sheet = sheetRef.current;
    if (!vv || !sheet) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      sheet.style.bottom = inset > 0 ? `${inset}px` : "";
      sheet.style.maxHeight = inset > 0 ? `${vv.height - 12}px` : "";
    };
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target.matches("input, textarea")) return;
      // Tras abrirse el teclado (y ajustarse la hoja), el campo a la vista.
      window.setTimeout(() => target.scrollIntoView({ block: "nearest" }), 300);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    sheet.addEventListener("focusin", onFocus);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      sheet.removeEventListener("focusin", onFocus);
    };
  }, [sheetRef]);
}
