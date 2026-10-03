import { claudeContextText, type ClaudeContext } from "../../shared/claude-context";
import { api } from "../api";
import type { ToastOptions } from "../components/Toast";
import { CLAUDE_PROJECT_URL } from "../config";

/**
 * Copia un texto al portapapeles. El texto puede ser una promesa (p. ej. lo que devuelve
 * la API).
 *
 * Safari (también en la app instalada) solo deja escribir en el portapapeles durante el
 * toque del usuario: un writeText() después de un await falla con NotAllowedError. Por eso
 * se llama a clipboard.write() de inmediato, dentro del toque, con un ClipboardItem cuyo
 * contenido es una *promesa*. Donde ClipboardItem no existe, se espera al texto y se usa
 * writeText().
 *
 * Debe llamarse directamente desde el manejador del toque (sin await antes).
 */
export async function copyText(content: string | Promise<string>): Promise<boolean> {
  const text = Promise.resolve(content);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard && "write" in navigator.clipboard) {
    try {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    } catch {
      // Se intenta con writeText.
    }
  }
  try {
    await navigator.clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}

/** Copia el contexto de la semana para Claude (GET /api/claude-context). */
export function copyClaudeContext(monday: string): Promise<boolean> {
  return copyText(api.get<ClaudeContext>(`/claude-context?week=${monday}`).then(claudeContextText));
}

/**
 * Abre el proyecto de Claude en una pestaña nueva. Devuelve false si el navegador lo
 * bloquea (p. ej. por haber pasado demasiado tiempo desde el toque); entonces se ofrece
 * un botón "Abrir Claude" para abrirlo con otro toque.
 */
export function openClaude(): boolean {
  const win = window.open(CLAUDE_PROJECT_URL, "_blank");
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    // Sin acceso: no importa.
  }
  return true;
}

/** Lee el portapapeles (iOS muestra su burbuja "Pegar"). null si no se puede. */
export async function readClipboard(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/**
 * Copia y abre el proyecto de Claude, con el aviso correspondiente. Si Safari bloquea la
 * ventana, el aviso lleva «Abrir Claude» para abrirla con otro toque.
 * Llamar directamente desde el toque.
 */
export function copyAndOpenClaude(content: string | Promise<string>, toast: (t: ToastOptions) => void, what = "Copiado") {
  void copyText(content).then((ok) => {
    if (!ok) return toast({ message: "No se ha podido copiar" });
    if (openClaude()) toast({ message: `${what} · abriendo Claude` });
    else toast({ message: what, action: { label: "Abrir Claude", onClick: () => void openClaude() } });
  });
}
