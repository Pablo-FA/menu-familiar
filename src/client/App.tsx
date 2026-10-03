import { BookOpen, Compass } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RatingPrompt } from "../shared/api";
import { api } from "./api";
import { BottomNav, NavRefContext } from "./components/BottomNav";
import { ComingSoon } from "./components/ComingSoon";
import { RatingSheet } from "./components/RatingSheet";
import { ToastProvider } from "./components/Toast";
import { Cook } from "./cook/Cook";
import { RecipeView } from "./pages/RecipeView";
import { Planner } from "./planner/Planner";
import { Shopping } from "./shopping/Shopping";
import { Today } from "./pages/Today";
import { Tools } from "./pages/Tools";
import { Link, matchRoute, usePathname, type Route } from "./router";
import { ThemeProvider } from "./theme";

export function App() {
  const route = matchRoute(usePathname());
  const navRef = useRef<HTMLElement>(null);

  return (
    <ThemeProvider>
      <ToastProvider>
      <NavRefContext.Provider value={navRef}>
        <Screen route={route} />
        {route.name !== "cook" && <BottomNav ref={navRef} active={route.name} />}
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
      return <ComingSoon title="Recetas" Icon={BookOpen} />;
    case "shopping":
      return <Shopping />;
    case "import":
      return <Tools />;
    case "cook":
      return <Cook date={route.date} slot={route.slot} />;
    case "recipe":
      return <RecipeView id={route.id} />;
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
    if (openedIn === "cook") return;
    api
      .get<RatingPrompt | null>("/rating-prompt")
      .then(setPrompt)
      .catch(() => undefined); // si falla, simplemente no se pregunta
  }, [openedIn]);

  if (!prompt || route.name === "cook") return null;
  return <RatingSheet prompt={prompt} onDone={() => setPrompt(null)} />;
}
