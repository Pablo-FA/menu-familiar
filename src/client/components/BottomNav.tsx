import { BookOpen, CalendarDays, House, ShoppingBasket } from "lucide-react";
import { createContext, forwardRef, useContext, type RefObject } from "react";
import { Link, type Route } from "../router";
import styles from "./BottomNav.module.css";

const ITEMS = [
  { route: "today", href: "/", label: "Hoy", Icon: House },
  { route: "planner", href: "/planificador", label: "Planificador", Icon: CalendarDays },
  { route: "recipes", href: "/recetas", label: "Recetas", Icon: BookOpen },
  { route: "shopping", href: "/compra", label: "Compra", Icon: ShoppingBasket },
] as const;

/**
 * Hoy controla la visibilidad del menú al desplazarse escribiendo estilos directamente
 * en el elemento (sin re-renderizar React), así que lo expone con un ref compartido.
 */
export const NavRefContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useNavRef() {
  return useContext(NavRefContext);
}

export const BottomNav = forwardRef<HTMLElement, { active: Route["name"] }>(function BottomNav({ active }, ref) {
  return (
    <nav ref={ref} className={`${styles.nav} glass-bar`} aria-label="Secciones">
      {ITEMS.map(({ route, href, label, Icon }) => (
        <Link key={route} href={href} className={styles.item} aria-current={active === route ? "page" : undefined}>
          <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
});
