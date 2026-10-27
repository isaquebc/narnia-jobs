import { describe, expect, it, vi } from "vitest";
import { enterUrl, sendCapture } from "../src/client";
import { type FlowDeps, onIconClick, readFormInto } from "../src/flow";

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
    recallCapture: vi.fn(async () => null),
    rememberCapture: vi.fn(async () => {}),
    tabExists: vi.fn(async () => true),
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
    expect(JSON.parse(String(init.body))).toEqual({ kind: "page", mode: "auto", ...snap });
    expect(d.openWindow).toHaveBeenCalledWith(
      enterUrl(paired.instance, paired.token, "/candidatura?captura=c1&aba=7"),
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

describe("F12-15 · menu: o que fazer nesta página", () => {
  const field = (ref: string) => ({
    ref,
    control: "text" as const,
    label: ref,
    name: null,
    placeholder: null,
    help: null,
    section: null,
    required: false,
    maxLength: null,
    options: [],
    autocomplete: null,
  });
  const form = { fields: [field("f1"), field("f2")], frames: [] };

  it("analisar a vaga: manda a página sem o formulário, mesmo havendo um", async () => {
    const d = deps({ readTab: vi.fn(async () => ({ ...snap, form })) });
    expect(await onIconClick({ id: 7 }, d, "posting")).toBe("window");
    const [, init] = vi.mocked(d.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.mode).toBe("posting");
    expect(body.form).toBeUndefined();
  });

  it("ajudar no formulário: manda os campos com o modo; a janela sabe de qual aba veio", async () => {
    const d = deps({ readTab: vi.fn(async () => ({ ...snap, form })) });
    expect(await onIconClick({ id: 7 }, d, "form")).toBe("window");
    const [, init] = vi.mocked(d.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ mode: "form", form });
    expect(d.openWindow).toHaveBeenCalledWith(
      enterUrl(paired.instance, paired.token, "/candidatura?captura=c1&aba=7"),
    );
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

/**
 * Pedido do dono (2026-10-27) · o formulário entra na aba da vaga: analisar a vaga, ir ao formulário na mesma aba do
 * Chrome e pedir "Ajudar no formulário" (ou o botão da janela "Procurar o formulário nesta aba") liga o formulário à
 * captura da vaga, sem abrir outra aba na janela.
 */
describe("formulário na aba da vaga", () => {
  const field = (ref: string) => ({
    ref,
    control: "text" as const,
    label: ref,
    name: null,
    placeholder: null,
    help: null,
    section: null,
    required: false,
    maxLength: null,
    options: [],
    autocomplete: null,
  });
  const form = { fields: [field("f1"), field("f2")], frames: [] };
  const formPage = { ...snap, url: "https://vagas.example/1/aplicar", form };

  it("o clique no ícone lembra de qual aba do Chrome veio cada captura", async () => {
    const d = deps();
    await onIconClick({ id: 7 }, d, "posting");
    expect(d.rememberCapture).toHaveBeenCalledWith(7, "c1");
  });

  it("ajudar no formulário na aba de uma vaga já aberta: entra na captura dela e reabre a mesma aba da janela", async () => {
    const d = deps({
      readTab: vi.fn(async () => formPage),
      recallCapture: vi.fn(async () => "c-vaga"),
      fetch: vi.fn(() => json(201, { applicationId: "a1" })),
    });
    expect(await onIconClick({ id: 7 }, d, "form")).toBe("window");
    const [url, init] = vi.mocked(d.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:5173/api/extension/captures/c-vaga/form");
    expect(JSON.parse(String(init.body))).toEqual({
      url: formPage.url,
      title: formPage.title,
      html: formPage.html,
      form,
      force: false,
    });
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.openWindow).toHaveBeenCalledWith(
      enterUrl(paired.instance, paired.token, "/candidatura?captura=c-vaga&aba=7"),
    );
  });

  it("recusado (outra vaga, a aba já tem formulário): segue como antes, numa captura nova", async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => json(409, { error: { code: "different_posting" } }))
      .mockImplementationOnce(() => json(201, { id: "c2" }));
    const d = deps({
      readTab: vi.fn(async () => formPage),
      recallCapture: vi.fn(async () => "c-vaga"),
      fetch,
    });
    expect(await onIconClick({ id: 7 }, d, "form")).toBe("window");
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:5173/api/extension/captures",
    );
    expect(d.openWindow).toHaveBeenCalledWith(
      enterUrl(paired.instance, paired.token, "/candidatura?captura=c2&aba=7"),
    );
    expect(d.rememberCapture).toHaveBeenCalledWith(7, "c2");
  });

  it("analisar a vaga nunca entra numa captura anterior", async () => {
    const d = deps({
      readTab: vi.fn(async () => formPage),
      recallCapture: vi.fn(async () => "c-vaga"),
    });
    await onIconClick({ id: 7 }, d, "posting");
    expect(vi.mocked(d.fetch).mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:5173/api/extension/captures",
    );
  });

  it("botão da janela: lê a mesma aba e manda o formulário para a captura (a pessoa disse que é desta vaga)", async () => {
    const d = deps({
      readTab: vi.fn(async () => formPage),
      fetch: vi.fn(() => json(201, { applicationId: "a1" })),
    });
    expect(await readFormInto(7, "c-vaga", d)).toEqual({ ok: true, applicationId: "a1" });
    const [, init] = vi.mocked(d.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).force).toBe(true);
  });

  it("formulário em várias etapas (F12/M6): repassa à janela a etapa em que a página entrou", async () => {
    const d = deps({
      readTab: vi.fn(async () => formPage),
      fetch: vi.fn(() => json(201, { applicationId: "a1", step: 2, added: true })),
    });
    expect(await readFormInto(7, "c-vaga", d)).toEqual({
      ok: true,
      applicationId: "a1",
      step: 2,
      added: true,
    });
  });

  it("botão: página sem acesso (outro site) pede o clique no ícone, e o clique entra nesta captura", async () => {
    const d = deps({ readTab: vi.fn(async () => Promise.reject(new Error("Cannot access"))) });
    const r = await readFormInto(7, "c-vaga", d);
    expect(r).toMatchObject({ ok: false, code: "no_access" });
    expect(d.rememberCapture).toHaveBeenCalledWith(7, "c-vaga");
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("botão: aba fechada, formulário num quadro de outro site, página sem formulário e recusa do narnia", async () => {
    const closed = deps({
      readTab: vi.fn(async () => Promise.reject(new Error("No tab"))),
      tabExists: vi.fn(async () => false),
    });
    expect(await readFormInto(7, "c-vaga", closed)).toMatchObject({
      ok: false,
      code: "tab_closed",
    });
    const framed = deps({
      readTab: vi.fn(async () => ({
        ...snap,
        form: { fields: [], frames: ["https://boards.greenhouse.io"] },
      })),
    });
    expect(await readFormInto(7, "c-vaga", framed)).toEqual({ ok: true, permission: true });
    expect(framed.openPermission).toHaveBeenCalledWith(
      7,
      ["https://boards.greenhouse.io"],
      "c-vaga",
    );
    const none = deps({ readTab: vi.fn(async () => snap) });
    expect(await readFormInto(7, "c-vaga", none)).toMatchObject({ ok: false, code: "no_form" });
    expect(none.fetch).not.toHaveBeenCalled();
    const refused = deps({
      readTab: vi.fn(async () => formPage),
      fetch: vi.fn(() =>
        json(409, { error: { code: "has_form", message: "Esta aba já tem um formulário." } }),
      ),
    });
    expect(await readFormInto(7, "c-vaga", refused)).toEqual({
      ok: false,
      code: "has_form",
      error: "Esta aba já tem um formulário.",
    });
  });
});
