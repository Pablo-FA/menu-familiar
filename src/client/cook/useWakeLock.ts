import { useEffect } from "react";

/**
 * Mantiene la pantalla encendida mientras la pantalla está montada (Screen Wake Lock).
 * iOS lo suelta al pasar a segundo plano, así que se vuelve a pedir al volver.
 * En apps instaladas en la pantalla de inicio funciona desde iOS 18.4; si no está
 * disponible o falla, no pasa nada.
 */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let active = true;

    async function request() {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (active) lock = sentinel;
        else void sentinel.release();
      } catch {
        // No permitido o no soportado: se sigue sin pantalla siempre encendida.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}
