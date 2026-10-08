import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  resolveInitialTheme,
  safeLocalStorage,
  systemPrefersDark,
  type Theme,
  toggleTheme,
} from "../lib/theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : resolveInitialTheme(safeLocalStorage(), systemPrefersDark()),
  );
  useEffect(() => {
    applyTheme(document.documentElement, theme, safeLocalStorage());
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => toggleTheme(t)), []);
  return { theme, toggle };
}
