import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { madridNow } from "../shared/dates";
import type { Slot } from "../shared/recipe-format";
import { THEME_COLOR, resolveTheme, type Theme } from "../shared/theme";

interface ThemeControl {
  theme: Theme;
  /** Hoy indica qué comida enseña (o null al salir), porque decide el tema. */
  setTodaySlot: (slot: Slot | null) => void;
}

const ThemeContext = createContext<ThemeControl | null>(null);

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}

function useMadridHour(): number {
  const [hour, setHour] = useState(() => madridNow().hour);
  useEffect(() => {
    const id = window.setInterval(() => setHour(madridNow().hour), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return hour;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemDark = useSystemDark();
  const hour = useMadridHour();
  const [todaySlot, setTodaySlot] = useState<Slot | null>(null);
  const theme = resolveTheme({ systemDark, todaySlot, hour });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTodaySlot }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeControl {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme fuera de ThemeProvider");
  return ctx;
}
