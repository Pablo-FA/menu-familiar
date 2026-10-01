import { LogOut, Plus, UtensilsCrossed } from "lucide-react";
import styles from "./Planner.module.css";

/** Miniatura de un hueco: portada, cubiertos (sin portada), + (vacío) o salida (fuera de casa). */
export function RecipeThumb({
  kind,
  photoUrl = null,
  size = 52,
  radius = 15,
}: {
  kind: "recipe" | "empty" | "away";
  photoUrl?: string | null;
  size?: number;
  radius?: number;
}) {
  const style = { width: size, height: size, borderRadius: radius };
  if (kind === "recipe" && photoUrl) return <img className={styles.thumb} style={style} src={photoUrl} alt="" loading="lazy" decoding="async" />;
  const icon = Math.round(size * 0.42);
  return (
    <span className={`${styles.thumb} ${styles[`thumb_${kind}`] ?? ""}`} style={style} aria-hidden="true">
      {kind === "recipe" && <UtensilsCrossed size={icon} strokeWidth={1.6} />}
      {kind === "empty" && <Plus size={icon} strokeWidth={1.8} />}
      {kind === "away" && <LogOut size={icon} strokeWidth={1.6} />}
    </span>
  );
}
