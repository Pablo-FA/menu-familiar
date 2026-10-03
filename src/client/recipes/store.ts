import { useEffect, useState } from "react";
import type { RecipeSummary } from "../../shared/api";
import { api } from "../api";

/**
 * Listado de recetas (incluidas las archivadas) compartido por la galería y la ficha.
 * Se guarda en memoria para que volver de una ficha pinte la galería al instante; se
 * refresca en cada montaje y tras cualquier cambio (invalidateRecipes).
 */
let cache: RecipeSummary[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function invalidateRecipes() {
  version += 1;
  for (const l of listeners) l();
}

export function useRecipes(): { recipes: RecipeSummary[] | null; error: boolean } {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(cache);
  const [error, setError] = useState(false);
  const [v, setV] = useState(version);

  useEffect(() => {
    const l = () => setV(version);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<RecipeSummary[]>("/recipes?include_archived=true")
      .then((list) => {
        cache = list;
        if (!cancelled) {
          setRecipes(list);
          setError(false);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [v]);

  return { recipes, error };
}

/** Cambia cada vez que se llama a invalidateRecipes (para recargar una ficha abierta). */
export function useRecipesVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    const l = () => setV(version);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}
