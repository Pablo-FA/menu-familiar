import { useEffect, type RefObject } from "react";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Escena ligada al scroll del Planificador y la Compra (mismo mecanismo que Hoy): la
 * cabecera se desvanece, aparece la barra fija y se activan las dos capas de desenfoque
 * superiores. Escribe estilos directamente (sin re-render de React). `pinned` deja el
 * desenfoque siempre activo (modo mover).
 */
export function useScrollScene(
  refs: {
    headerRef: RefObject<HTMLElement | null>;
    barRef: RefObject<HTMLElement | null>;
    blurTintRef: RefObject<HTMLElement | null>;
    blurStrongRef: RefObject<HTMLElement | null>;
  },
  pinned = false,
) {
  const { headerRef, barRef, blurTintRef, blurStrongRef } = refs;
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    function apply() {
      frame = 0;
      const s = Math.max(0, window.scrollY);
      if (headerRef.current) headerRef.current.style.opacity = String(clamp01(1 - s / 70));
      const bar = barRef.current;
      if (bar) {
        const p = smoothstep((s - 50) / 60);
        bar.style.opacity = String(p);
        bar.style.transform = reduce ? "" : `translate3d(0, ${-12 * (1 - p)}px, 0) scale(${0.92 + 0.08 * p})`;
        const interactive = p >= 0.5;
        bar.style.pointerEvents = interactive ? "auto" : "none";
        bar.inert = !interactive;
      }
      // En modo mover, el desenfoque superior queda siempre activo.
      const blur = pinned ? "1" : String(clamp01((s - 10) / 60));
      if (blurTintRef.current) blurTintRef.current.style.opacity = blur;
      if (blurStrongRef.current) blurStrongRef.current.style.opacity = blur;
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [headerRef, barRef, blurTintRef, blurStrongRef, pinned]);
}
