import { describe, expect, it, vi } from "vitest";
import { enterUrl, sendCapture } from "../src/client";
import { type FlowDeps, onIconClick } from "../src/flow";

/**
 * F12/M2 · clique no ícone: sem pareamento abre as opções; pareada, lê a aba, manda a captura e abre a janela do
 * narnia autenticada pelo token do dispositivo. Aba que não dá para ler abre a janela com o aviso; narnia fora do ar
 * ou dispositivo revogado marcam o ícone e abrem as opções.
 */
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const paired = { instance: "http://127.0.0.1:5173", token: "nxd_abc", deviceName: "Chrome" };
const snap = { url: "https://vagas.example/1", title: "Vaga", html: "<html></html>" };

function deps(over: Partial<FlowDeps> = {}): FlowDeps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    loadPairing: vi.fn(async () => paired),
    readTab: vi.fn(async () => snap),
    fetch: vi.fn(() => json(201, { id: "c1" })),
    openWindow: vi.fn(async () => {}),
    openOptions: vi.fn(async () => {}),
    setBadge: vi.fn(async () => {}),
    openPermission: vi.fn(async () => {}),
    ...over,
  } as FlowDeps & Record<string, ReturnType<typeof vi.fn>>;
}

describe("F12/M2 · clique no ícone", () => {
  it("sem pareamento: abre as opções e não lê a aba", async () => {
    const d = deps({ loadPairing: vi.fn(async () => ({})) });
    expect(await onIconClick({ id: 7 }, d)).toBe("options");
    expect(d.openOptions).toHaveBeenCalled();
    expect(d.readTab).not.toHaveBeenCalled();
  });

  it("pareada: lê a aba, manda a captura e abre a janela pela entrada do dispositivo", async () => {
    const d = deps();
    expect(await onIconClick({ id: 7 }, d)).toBe("window");
    expect(d.readTab).toHaveBeenCalledWith(7);
    const [url, init] = vi.mocked(d.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:5173/api/extension/captures");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer nxd_abc");
    expect(JSON.parse(String(init.body))).toEqual({ kind: "page", ...snap });
    expect(d.openWindow).toHaveBeenCalledWith(
      enterUrl(paired.instance, paired.token, "/candidatura?captura=c1"),
    );
    expect(d.setBadge).toHaveBeenCalledWith("", "narnia-jobs");
  });

  it("aba que não dá para ler (página do Chrome): janela com o aviso, sem mandar nada", async () => {
    const d = deps({ readTab: vi.fn(async () => Promise.reject(new Error("Cannot access"))) });
    expect(await onIconClick({ id: 7 }, d)).toBe("window");
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.openWindow).toHaveBeenCalledWith(
      enterUrl(paired.instance, paired.token, "/candidatura?erro=leitura"),
    );
  });

  it("narnia fora do ar ou dispositivo revogado: marca o ícone e abre as opções", async () => {
    const off = deps({ fetch: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) });
    expect(await onIconClick({ id: 7 }, off)).toBe("options");
    expect(off.setBadge).toHaveBeenCalledWith("!", expect.stringContaining("127.0.0.1:5173"));
    expect(off.openWindow).not.toHaveBeenCalled();
    const revoked = deps({ fetch: vi.fn(() => json(401, {})) });
    expect(await onIconClick({ id: 7 }, revoked)).toBe("options");
    expect(revoked.setBadge).toHaveBeenCalledWith("!", expect.stringMatching(/desconectado/));
  });

  it("página grande demais ou erro do narnia: janela com o aviso de envio", async () => {
    const d = deps({ fetch: vi.fn(() => json(400, { error: { code: "invalid_body" } })) });
    expect(await onIconClick({ id: 7 }, d)).toBe("window");
    expect(d.openWindow).toHaveBeenCalledWith(
      enterUrl(paired.instance, paired.token, "/candidatura?erro=envio"),
    );
  });
});

describe("F12/M3 · clique num formulário", () => {
  const field = (ref: string, label: string) => ({
    ref,
    control: "text" as const,
    label,
    name: null,
    placeholder: null,
    help: null,
    section: null,
    required: false,
    maxLength: null,
    options: [],
    autocomplete: null,
  });

  it("manda os campos do formulário junto com a página", async () => {
    const form = { fields: [field("f1", "Nome"), field("f2", "E-mail")], frames: [] };
    const d = deps({ readTab: vi.fn(async () => ({ ...snap, form })) });
    expect(await onIconClick({ id: 7 }, d)).toBe("window");
    const [, init] = vi.mocked(d.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).form).toEqual(form);
  });

  it("formulário num quadro de outro site sem permissão: pede a permissão antes de mandar", async () => {
    const form = { fields: [], frames: ["https://boards.greenhouse.io"] };
    const d = deps({ readTab: vi.fn(async () => ({ ...snap, form })) });
    expect(await onIconClick({ id: 7 }, d)).toBe("permission");
    expect(d.openPermission).toHaveBeenCalledWith(7, ["https://boards.greenhouse.io"]);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("página de vaga com vídeo de outro site: não pede permissão, segue como vaga", async () => {
    const form = { fields: [], frames: ["https://www.youtube.com"] };
    const d = deps({ readTab: vi.fn(async () => ({ ...snap, form })) });
    expect(await onIconClick({ id: 7 }, d)).toBe("window");
    expect(d.openPermission).not.toHaveBeenCalled();
  });

  it("com o formulário já lido na página, o quadro de outro site (anúncio, vídeo) não trava", async () => {
    const form = {
      fields: [field("f1", "Nome"), field("f2", "E-mail")],
      frames: ["https://ads.example"],
    };
    const d = deps({ readTab: vi.fn(async () => ({ ...snap, form })) });
    expect(await onIconClick({ id: 7 }, d)).toBe("window");
    expect(d.openPermission).not.toHaveBeenCalled();
  });
});

describe("F12/M2 · cliente", () => {
  it("entrada da janela: token do dispositivo e destino codificados", () => {
    expect(enterUrl("http://127.0.0.1:5173", "nxd_a", "/candidatura?captura=c1")).toBe(
      "http://127.0.0.1:5173/api/extension/enter?device=nxd_a&next=%2Fcandidatura%3Fcaptura%3Dc1",
    );
  });

  it("sendCapture devolve o id da captura", async () => {
    expect(
      await sendCapture(() => json(201, { id: "c9" }), paired.instance, "nxd_a", snap),
    ).toEqual({
      ok: true,
      id: "c9",
    });
  });
});
