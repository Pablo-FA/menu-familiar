import { Check, Ellipsis, House, LayoutList, Trash2 } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { ShoppingItem } from "../../shared/api";
import styles from "./Shopping.module.css";
import { itemKey } from "./sync";

/** Cuánto se desplaza la fila abierta (dos acciones de 92 px y sus márgenes). */
const OPEN_X = -196;
/** Distancia mínima para abrir. */
const OPEN_THRESHOLD = 40;
/** Gestos que empiezan tan cerca del borde izquierdo son el «atrás» de iOS. */
const EDGE = 24;

/**
 * Línea de la lista. Tocar en cualquier parte la marca o desmarca (role="checkbox").
 * Deslizar a la izquierda muestra «Sección» y «En casa» (o «Quitar» si se añadió a mano).
 * Sin gesto: el botón «Acciones», invisible hasta recibir el foco, abre las mismas
 * acciones en una hoja.
 */
export function ItemRow({
  item,
  open,
  anotherOpen,
  onOpenChange,
  closeOthers,
  onToggle,
  onAisle,
  onHome,
  onRemove,
  onActions,
}: {
  item: ShoppingItem;
  open: boolean;
  anotherOpen: boolean;
  onOpenChange: (open: boolean) => void;
  closeOthers: () => void;
  onToggle: () => void;
  onAisle: () => void;
  onHome: () => void;
  onRemove: () => void;
  onActions: () => void;
}) {
  const fgRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; mode: "pending" | "swipe" | "scroll"; dx: number } | null>(null);
  // Tras deslizar, iOS a veces manda un click y a veces no: se ignora solo el inmediato.
  const suppressUntil = useRef(0);

  /** Coloca la fila en x (≤ 0) y deja ver las acciones en el hueco. */
  function place(x: number, animate: boolean) {
    const transition = animate ? "" : "none";
    if (fgRef.current) {
      fgRef.current.style.transition = transition;
      fgRef.current.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
    }
    if (actionsRef.current) {
      actionsRef.current.style.transition = transition;
      actionsRef.current.style.width = `${-x}px`;
    }
  }

  // La posición sigue a `open` (y vuelve a su sitio con transición).
  useEffect(() => {
    place(open ? OPEN_X : 0, true);
  }, [open]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.clientX < EDGE) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: "pending", dx: 0 };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.mode === "pending") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.mode = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
      if (g.mode === "swipe") e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (g.mode !== "swipe") return;
    g.dx = dx;
    const base = open ? OPEN_X : 0;
    const x = Math.min(0, Math.max(OPEN_X - 24, base + dx));
    place(x, false);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== e.pointerId || g.mode !== "swipe") return;
    suppressUntil.current = Date.now() + 350;
    const next = open ? g.dx < OPEN_THRESHOLD : g.dx < -OPEN_THRESHOLD;
    if (next !== open) onOpenChange(next);
    else place(open ? OPEN_X : 0, true);
  }

  function onClick() {
    if (Date.now() < suppressUntil.current) return;
    // Con otra fila abierta (o esta), el toque solo cierra.
    if (anotherOpen) return closeOthers();
    if (open) return onOpenChange(false);
    onToggle();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onToggle();
    }
  }

  const label = `${item.name}${item.quantity_text ? `, ${item.quantity_text}` : ""}`;

  return (
    <li className={styles.itemLi} data-row-key={itemKey(item)}>
      <div ref={actionsRef} className={styles.swipeActions} aria-hidden={!open}>
        <button type="button" className={`${styles.swipeAction} ${styles.swipeAisle}`} tabIndex={open ? 0 : -1} onClick={onAisle}>
          <LayoutList size={20} aria-hidden="true" />
          Sección
        </button>
        {item.manual ? (
          <button type="button" className={`${styles.swipeAction} ${styles.swipeHome}`} tabIndex={open ? 0 : -1} onClick={onRemove}>
            <Trash2 size={20} aria-hidden="true" />
            Quitar
          </button>
        ) : (
          <button type="button" className={`${styles.swipeAction} ${styles.swipeHome}`} tabIndex={open ? 0 : -1} onClick={onHome}>
            <House size={20} aria-hidden="true" />
            En casa
          </button>
        )}
      </div>
      <div
        ref={fgRef}
        className={styles.item}
        role="checkbox"
        aria-checked={item.bought}
        aria-label={label}
        tabIndex={0}
        data-bought={item.bought}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className={styles.circle} aria-hidden="true">
          {item.bought && <Check size={17} strokeWidth={3} />}
        </span>
        <span className={styles.itemName}>{item.name}</span>
        {item.quantity_text && <span className={styles.itemQty}>{item.quantity_text}</span>}
      </div>
      <button type="button" className={styles.actionsButton} onClick={onActions} aria-label={`Acciones para ${item.name}`}>
        <Ellipsis size={18} aria-hidden="true" />
      </button>
    </li>
  );
}
