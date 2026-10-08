import { describe, expect, it } from "vitest";
import { applyTheme, resolveInitialTheme, toggleTheme } from "../../src/lib/theme";

function storage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("lib/theme · claro/escuro", () => {
  it("usa o valor salvo; senão respeita prefers-color-scheme", () => {
    expect(resolveInitialTheme(storage({ "narnia.theme": "dark" }), false)).toBe("dark");
    expect(resolveInitialTheme(storage(), true)).toBe("dark");
    expect(resolveInitialTheme(storage(), false)).toBe("light");
    expect(resolveInitialTheme(storage({ "narnia.theme": "lixo" }), true)).toBe("dark");
  });
  it("aplica a classe `dark` no elemento raiz e persiste ao alternar", () => {
    const root = document.documentElement;
    const st = storage();
    applyTheme(root, "dark", st);
    expect(root.classList.contains("dark")).toBe(true);
    expect(st.getItem("narnia.theme")).toBe("dark");
    expect(toggleTheme("dark")).toBe("light");
    applyTheme(root, "light", st);
    expect(root.classList.contains("dark")).toBe(false);
    expect(st.getItem("narnia.theme")).toBe("light");
  });
});
