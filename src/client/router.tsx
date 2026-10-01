import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import type { Slot } from "../shared/recipe-format";

/**
 * Router mínimo con la History API: la app tiene pocas rutas y así no hace falta
 * una dependencia. El Worker sirve index.html para cualquier ruta que no sea /api.
 */

const NAVIGATE_EVENT = "app:navigate";

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (to === window.location.pathname + window.location.search) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return path;
}

export type Route =
  | { name: "today" }
  | { name: "planner" }
  | { name: "recipes" }
  | { name: "shopping" }
  | { name: "import" }
  | { name: "cook"; date: string; slot: Slot }
  | { name: "recipe"; id: string }
  | { name: "not-found" };

export function matchRoute(path: string): Route {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return { name: "today" };
  if (clean === "/planificador") return { name: "planner" };
  if (clean === "/recetas") return { name: "recipes" };
  if (clean === "/compra") return { name: "shopping" };
  if (clean === "/importar") return { name: "import" };
  const cook = /^\/cocinar\/(\d{4}-\d{2}-\d{2})\/(lunch|dinner)$/.exec(clean);
  if (cook?.[1] && cook[2]) return { name: "cook", date: cook[1], slot: cook[2] as Slot };
  const recipe = /^\/receta\/([^/]+)$/.exec(clean);
  if (recipe?.[1]) return { name: "recipe", id: decodeURIComponent(recipe[1]) };
  return { name: "not-found" };
}

/** Enlace interno: navega sin recargar (y deja funcionar Cmd/Ctrl+clic). */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  }
  return <a href={href} onClick={handle} {...rest} />;
}
