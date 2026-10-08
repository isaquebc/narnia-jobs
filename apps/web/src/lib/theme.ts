export type Theme = "light" | "dark";
const KEY = "narnia.theme";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Tema claro/escuro (decisão F01-10): valor salvo em localStorage; senão, `prefers-color-scheme`. */
export function resolveInitialTheme(storage: StorageLike | null, prefersDark: boolean): Theme {
  try {
    const saved = storage?.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage indisponível (modo privado): segue a preferência do sistema
  }
  return prefersDark ? "dark" : "light";
}

export function applyTheme(root: HTMLElement, theme: Theme, storage: StorageLike | null) {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    storage?.setItem(KEY, theme);
  } catch {
    // ignorar falha de persistência
  }
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
