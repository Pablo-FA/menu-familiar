import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("No se encuentra #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker: abrir la app sin conexión (solo en producción; ver src/sw/sw.js).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        // Al volver a la app se comprueba si hay versión nueva (iOS no recarga la página).
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  });
}
