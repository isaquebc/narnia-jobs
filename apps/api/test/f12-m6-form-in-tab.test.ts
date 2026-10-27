import { seedFixture } from "@narnia-jobs/core";
import type { ExtensionCapture, FormField } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * Pedido do dono (2026-10-27) · o formulário entra na aba da vaga: depois da análise, a janela lê a mesma aba do Chrome
 * de novo procurando o formulário (ou a extensão manda o formulário de "Ajudar no formulário" na mesma aba), e ele fica
 * ligado à captura e à vaga já salvas, sem abrir outra aba na janela. E o andamento de cada aba da janela (processando
 * ou não) para o seletor de abas.
 */
const field = (ref: string, over: Partial<FormField> = {}): FormField => ({
  ref,
  control: "text",
  label: null,
  name: null,
  placeholder: null,
  help: null,
  section: null,
  required: false,
  maxLength: null,
  options: [],
  autocomplete: null,
  ...over,
});
const FORM = {
  fields: [field("f1", { label: "Nome completo" }), field("f2", { label: "E-mail" })],
  frames: [],
};
const HTML = "<!doctype html><html><head><title>Candidatura</title></head><body></body></html>";

describe("formulário na aba da vaga", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function device(app: TestApp) {
    const { code } = (await (
      await app.api("/api/extension/pairing", { method: "POST" })
    ).json()) as { code: string };
    const r = await app.app.request("/api/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Chrome" }),
    });
    return ((await r.json()) as { token: string }).token;
  }

  /** Uma captura de vaga já salva (Salvar vaga), como a janela deixa depois da análise. */
  function savedCapture(app: TestApp, company = "Acme") {
    const posting = app.repos.postings.create({ title: "Backend Sr", company });
    const capture = app.repos.extension.createCapture({
      kind: "page",
      url: "https://acme.example/vagas/9",
      title: "Backend Sr",
      payload: { ok: true, text: "Backend Sr", title: "Backend Sr", company, siteName: null },
      deviceId: null,
    });
    app.repos.extension.linkCapturePosting(capture.id, posting.id);
    return { posting, capture };
  }

  const attach = async (
    app: TestApp,
    token: string,
    captureId: string,
    body: Record<string, unknown> = {},
  ) =>
    app.app.request(`/api/extension/captures/${captureId}/form`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://acme.example/vagas/9/aplicar",
        title: "Candidatura",
        html: HTML,
        form: FORM,
        ...body,
      }),
    });

  const read = async (app: TestApp, id: string) =>
    (
      (await (await app.api(`/api/extension/captures/${id}`)).json()) as {
        capture: ExtensionCapture;
      }
    ).capture;

  it("liga o formulário à captura e à vaga já salvas (a mesma aba da janela) e pede as perguntas", async () => {
    t = makeTestApp();
    const { posting, capture } = savedCapture(t);
    const r = await attach(t, await device(t), capture.id, { force: true });
    expect(r.status).toBe(201);
    const { applicationId } = (await r.json()) as { applicationId: string };
    expect(t.repos.applications.get(applicationId)).toMatchObject({
      captureId: capture.id,
      postingId: posting.id,
      url: "https://acme.example/vagas/9/aplicar",
    });
    expect(t.queue.tasks.filter((x) => x.type === "application.locate")).toHaveLength(1);
    // a janela passa a mostrar o formulário nesta aba, com o endereço dele (voltar à página e preencher)
    expect(await read(t, capture.id)).toMatchObject({
      applicationId,
      applicationUrl: "https://acme.example/vagas/9/aplicar",
      postingId: posting.id,
    });
    expect(t.events).toContainEqual({ type: "application.updated", applicationId });
    // de novo: a aba já tem formulário
    const again = await attach(t, await device(t), capture.id, { force: true });
    expect(again.status).toBe(409);
  });

  it("pelo ícone (sem force): só liga se a página não parece ser de outra vaga já salva", async () => {
    t = makeTestApp();
    const token = await device(t);
    const { capture } = savedCapture(t);
    // a pessoa abriu, nesta mesma aba, o formulário de outra vaga que ela também salvou
    t.repos.postings.create({
      title: "Designer de Produto",
      company: "Globex",
      postingUrl: "https://globex.example/jobs/1",
    });
    const other = await attach(t, token, capture.id, {
      url: "https://globex.example/jobs/1",
      title: "Designer de Produto · Globex",
    });
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe(
      "different_posting",
    );
    // a página do formulário sem nada de outra vaga entra na aba
    const same = await attach(t, token, capture.id);
    expect(same.status).toBe(201);
  });

  it("recusa captura sem vaga salva, página sem campos e captura inexistente", async () => {
    t = makeTestApp();
    const token = await device(t);
    const loose = t.repos.extension.createCapture({
      kind: "page",
      url: "https://acme.example/vagas/9",
      title: null,
      payload: { ok: true, text: "x", title: null, company: null, siteName: null },
      deviceId: null,
    });
    expect((await attach(t, token, loose.id, { force: true })).status).toBe(422);
    const { capture } = savedCapture(t);
    const empty = await attach(t, token, capture.id, {
      force: true,
      form: { fields: [], frames: [] },
    });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as { error: { code: string } }).error.code).toBe("no_form");
    expect((await attach(t, token, "nao-existe", { force: true })).status).toBe(404);
  });
});

describe("andamento das abas da janela", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  const activity = async (app: TestApp, ids: string[]) =>
    (
      (await (await app.api(`/api/extension/captures/activity?ids=${ids.join(",")}`)).json()) as {
        items: Array<{ id: string; busy: boolean }>;
      }
    ).items;

  const capture = (app: TestApp) =>
    app.repos.extension.createCapture({
      kind: "page",
      url: "https://acme.example/vagas/9",
      title: null,
      payload: { ok: true, text: "x", title: "Backend Sr", company: "Acme", siteName: null },
      deviceId: null,
    });

  it("vaga lendo, análise pedida sem resultado ou documento gerando: processando; pronta: parada", async () => {
    t = makeTestApp();
    const loose = capture(t);
    const reading = capture(t);
    const p1 = t.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    t.repos.postings.setStatus(p1.id, "extracting");
    t.repos.extension.linkCapturePosting(reading.id, p1.id);
    const docs = capture(t);
    const p2 = t.repos.postings.create({ title: "Frontend", company: "Acme" });
    t.repos.extension.linkCapturePosting(docs.id, p2.id);
    const { profileId } = seedFixture(t.repos, "engineer");
    const doc = t.repos.documents.create({
      kind: "cv",
      profileId,
      postingId: p2.id,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    t.repos.documents.addVersion(doc.id, {
      source: "agent",
      instructions: null,
      factsVersion: t.repos.settings.getFactsVersion(),
      postingUpdatedAt: null,
      profileHash: "x",
    });
    const starting = capture(t);
    const p3 = t.repos.postings.create({ title: "Dados", company: "Acme" });
    t.repos.extension.linkCapturePosting(starting.id, p3.id);
    t.repos.extension.requestCaptureAnalysis(starting.id);
    expect(await activity(t, [loose.id, reading.id, docs.id, starting.id, "nao-existe"])).toEqual([
      { id: loose.id, busy: false },
      { id: reading.id, busy: true },
      { id: docs.id, busy: true },
      { id: starting.id, busy: true },
    ]);
    // a análise abriu com erro (teto de conversas): para de processar
    t.repos.extension.setCaptureAnalysis(starting.id, { error: "session_limit" });
    expect((await activity(t, [starting.id]))[0]?.busy).toBe(false);
  });

  it("formulário organizando as perguntas ou escrevendo as respostas: processando", async () => {
    t = makeTestApp();
    const c = capture(t);
    const f = t.repos.applications.create({
      captureId: c.id,
      postingId: null,
      profileId: null,
      url: "https://acme.example/aplicar",
      title: null,
      fields: [],
    });
    expect((await activity(t, [c.id]))[0]?.busy).toBe(true); // "locating" ao nascer
    t.repos.applications.setQuestions(f.id, []);
    expect((await activity(t, [c.id]))[0]?.busy).toBe(false);
    t.repos.applications.setAnswersStatus(f.id, "answering");
    expect((await activity(t, [c.id]))[0]?.busy).toBe(true);
  });
});
