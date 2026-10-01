import { useEffect, useState } from "react";
import type { RecipeDetail } from "../../shared/api";
import { madridNow } from "../../shared/dates";
import { api } from "../api";
import { MealView } from "./Today";
import styles from "./Today.module.css";

/** Vista mínima de una receta (/receta/:id): la portada y la hoja de Hoy, sin sol/luna ni play. */
export function RecipeView({ id }: { id: string }) {
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<RecipeDetail>(`/recipes/${encodeURIComponent(id)}`)
      .then((r) => !cancelled && setRecipe(r))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = () => (window.history.length > 1 ? window.history.back() : window.location.assign("/planificador"));

  if (error) return <p className={styles.status}>No se pudo cargar la receta: {error}</p>;
  if (!recipe) return <p className={styles.status}>Cargando…</p>;
  return (
    <MealView
      date={madridNow().date}
      slot="lunch"
      meal={{ status: "planned", note: null, recipe, cook_log: null }}
      onBack={back}
    />
  );
}
