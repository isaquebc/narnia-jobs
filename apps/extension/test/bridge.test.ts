import { describe, expect, it, vi } from "vitest";
import { type BridgeDeps, handleBridge } from "../src/bridge";

/**
 * Ponte entre a janela do narnia e a extensão (F12-14, F12-17): o script de conteúdo da página do narnia repassa os
 * pedidos; só a página do narnia pareado é atendida. Voltar à página analisada foca a aba (ou abre o link numa janela
 * nova, se ela sumiu ou mudou); preencher escreve na aba de origem.
 */
const paired = { instance: "http://127.0.0.1:5173", token: "nxd_a", deviceName: "Chrome" };

function deps(
  over: Partial<BridgeDeps> = {},
): BridgeDeps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    loadPairing: vi.fn(async () => paired),
    tabUrl: vi.fn(async () => "https://vagas.example/1"),
    focusTab: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    fillTab: vi.fn(async () => ({ filled: ["f1"], failed: [] })),
    ...over,
  } as BridgeDeps & Record<string, ReturnType<typeof vi.fn>>;
}

describe("F12 · ponte da janela", () => {
  it("só atende a página do narnia pareado", async () => {
    const d = deps();
    const r = await handleBridge(
      { type: "narnia.focus", tabId: 7, url: "https://vagas.example/1" },
      "http://127.0.0.1:9999/candidatura",
      d,
    );
    expect(r).toEqual({ ok: false, error: "origem não é o narnia pareado" });
    expect(d.focusTab).not.toHaveBeenCalled();
  });

  it("voltar à página: foca a aba de origem se ela ainda está na página analisada", async () => {
    const d = deps();
    const r = await handleBridge(
      { type: "narnia.focus", tabId: 7, url: "https://vagas.example/1#apply" },
      "http://127.0.0.1:5173/candidatura?captura=c1",
      d,
    );
    expect(r).toEqual({ ok: true, focused: true });
    expect(d.focusTab).toHaveBeenCalledWith(7);
  });

  it("voltar à página: aba fechada ou em outro endereço abre o link numa janela nova", async () => {
    const gone = deps({ tabUrl: vi.fn(async () => null) });
    expect(
      await handleBridge(
        { type: "narnia.focus", tabId: 7, url: "https://vagas.example/1" },
        "http://127.0.0.1:5173/candidatura",
        gone,
      ),
    ).toEqual({ ok: true, focused: false });
    expect(gone.openUrl).toHaveBeenCalledWith("https://vagas.example/1");
    const moved = deps({ tabUrl: vi.fn(async () => "https://outro.example/") });
    await handleBridge(
      { type: "narnia.focus", tabId: 7, url: "https://vagas.example/1" },
      "http://127.0.0.1:5173/x",
      moved,
    );
    expect(moved.openUrl).toHaveBeenCalled();
  });

  it("preencher: escreve na aba de origem se ela ainda está no formulário; senão avisa", async () => {
    const d = deps();
    const items = [{ ref: "f1", value: "Ana" }];
    expect(
      await handleBridge(
        { type: "narnia.fill", tabId: 7, url: "https://vagas.example/1", items },
        "http://127.0.0.1:5173/candidatura",
        d,
      ),
    ).toEqual({ ok: true, filled: ["f1"], failed: [] });
    expect(d.fillTab).toHaveBeenCalledWith(7, items);
    const moved = deps({ tabUrl: vi.fn(async () => "https://outro.example/") });
    const r = await handleBridge(
      { type: "narnia.fill", tabId: 7, url: "https://vagas.example/1", items },
      "http://127.0.0.1:5173/candidatura",
      moved,
    );
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/não está mais no formulário/),
    });
    expect(moved.fillTab).not.toHaveBeenCalled();
  });
});
