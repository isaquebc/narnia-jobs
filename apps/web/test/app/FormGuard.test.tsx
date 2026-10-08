import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FormGuardProvider, useFormGuard } from "../../src/app/FormGuard";

function wrapper(confirm: (message: string) => boolean) {
  return ({ children }: { children: ReactNode }) => (
    <FormGuardProvider confirm={confirm}>{children}</FormGuardProvider>
  );
}

describe("FormGuard · formulário sujo bloqueia a troca de perfil (F02 §2.5)", () => {
  it("sem formulário sujo, canLeave é verdadeiro sem perguntar", () => {
    const confirm = vi.fn(() => false);
    const { result } = renderHook(() => useFormGuard(), { wrapper: wrapper(confirm) });
    expect(result.current.dirty).toBe(false);
    expect(result.current.canLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("com formulário sujo, pergunta; confirmar libera e limpa; recusar bloqueia", () => {
    const confirm = vi.fn(() => false);
    const { result } = renderHook(() => useFormGuard(), { wrapper: wrapper(confirm) });
    act(() => result.current.setDirty(true));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Há alterações não salvas. Descartar e continuar?");
    confirm.mockReturnValue(true);
    let ok = false;
    act(() => {
      ok = result.current.canLeave();
    });
    expect(ok).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("fora do provider, useFormGuard funciona como 'nunca sujo'", () => {
    const { result } = renderHook(() => useFormGuard());
    expect(result.current.dirty).toBe(false);
    expect(result.current.canLeave()).toBe(true);
  });
});
