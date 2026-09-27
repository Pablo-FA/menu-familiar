import { Moon, Sun } from "lucide-react";
import type { Slot } from "../../shared/recipe-format";
import styles from "./SunMoonCoin.module.css";

/**
 * Botón sol/luna: alterna entre comida y cena. Es una "moneda" que gira en el eje Y,
 * con el sol en una cara y la luna en la otra.
 */
export function SunMoonCoin({
  slot,
  onToggle,
  sunColor,
  moonColor,
  size = 26,
}: {
  slot: Slot;
  onToggle: () => void;
  sunColor: string;
  moonColor: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={styles.coin}
      onClick={onToggle}
      aria-label={slot === "lunch" ? "Ver la cena" : "Ver la comida"}
    >
      <span className={styles.inner} data-side={slot === "lunch" ? "sun" : "moon"} aria-hidden="true">
        <span className={styles.face}>
          <Sun size={size} strokeWidth={2} color={sunColor} fill={sunColor} />
        </span>
        <span className={`${styles.face} ${styles.back}`}>
          <Moon size={size - 2} strokeWidth={2} color={moonColor} fill={moonColor} />
        </span>
      </span>
    </button>
  );
}
