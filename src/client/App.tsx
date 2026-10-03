import { Compass } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { RatingPrompt } from "../shared/api";
import { api } from "./api";
import { BottomNav, NavRefContext } from "./components/BottomNav";
import { ComingSoon } from "./components/ComingSoon";
import { RatingSheet } from "./components/RatingSheet";
import { ToastProvider } from "./components/Toast";
import { Cook, CookRecipe } from "./cook/Cook";
import { Planner } from "./planner/Planner";
import { Gallery } from "./recipes/Gallery";
import { RecipePage } from "./recipes/RecipePage";
import { Shopping } from "./shopping/Shopping";
import { Today } from "./pages/Today";
import { Tools } from "./pages/Tools";
import { Link, matchRoute, usePathname, type Route } from "./router";
import { ThemeProvider } from "./theme";

/** Pantallas sin menú inferior. */
const FULL_SCREEN = new Set<Route["name"]>(["cook", "cook-recipe", "recipe-edit"]);
/** Pestaña que se marca en el menú para las pantallas que no son pestañas. */
const NAV_TAB: Partial<Record<Route["name"], Route["name"]>> = { recipe: "recipes", "recipe-edit": "recipes" };

// El editor se carga solo cuando se abre (no hace falta para el uso diario).
const RecipeEditor = lazy(() => import("./recipes/editor/Editor").then((m) => ({ default: m.Editor })));

export function App() {
  const route = matchRoute(usePathname());
  const navRef = useRef<HTMLElement>(null);

  return (
    <ThemeProvider>
      <ToastProvider>
      <NavRefContext.Provider value={navRef}>
        <Suspense fallback={<p className="screen-status">Cargando…</p>}>
          <Screen route={route} />
        </Suspense>
        {!FULL_SCREEN.has(route.name) && <BottomNav ref={navRef} active={NAV_TAB[route.name] ?? route.name} />}
        <RatingPromptOnOpen route={route} />
      </NavRefContext.Provider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "today":
      return <Today />;
    case "planner":
      return <Planner />;
    case "recipes":
      return <Gallery />;
    case "shopping":
      return <Shopping />;
    case "import":
      return <Tools />;
    case "cook":
      return <Cook date={route.date} slot={route.slot} />;
    case "recipe":
      return <RecipePage key={route.id} id={route.id} />;
    case "recipe-edit":
      return <RecipeEditor key={route.id} id={route.id} />;
    case "cook-recipe":
      return <CookRecipe key={route.id} id={route.id} />;
    case "not-found":
      return (
        <ComingSoon title="No encontrado" Icon={Compass}>
          <Link href="/">Volver a Hoy</Link>
        </ComingSoon>
      );
  }
}

/**
 * Aviso de valoración: se consulta una sola vez por apertura de la app (al montar),
 * y nunca si la app se abre en el modo cocina. La regla de cuándo toca está en el
 * servidor (src/shared/rating-prompt.ts).
 */
function RatingPromptOnOpen({ route }: { route: Route }) {
  const [openedIn] = useState(route.name);
  const [prompt, setPrompt] = useState<RatingPrompt | null>(null);

  useEffect(() => {
    if (openedIn === "cook" || openedIn === "cook-recipe") return;
    api
      .get<RatingPrompt | null>("/rating-prompt")
      .then(setPrompt)
      .catch(() => undefined); // si falla, simplemente no se pregunta
  }, [openedIn]);

  if (!prompt || FULL_SCREEN.has(route.name)) return null;
  return <RatingSheet prompt={prompt} onDone={() => setPrompt(null)} />;
}
