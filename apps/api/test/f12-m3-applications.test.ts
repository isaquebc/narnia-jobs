import { assembleQuestions, heuristicQuestions, seedFixture } from "@narnia-jobs/core";
import type { FormField } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F12/M3 · formulário de candidatura pela extensão: a captura com campos de formulário cria o formulário e pede ao
 * worker que organize as perguntas (`application.locate`); a janela lê as perguntas, com o valor dos campos óbvios
 * tirado dos dados da pessoa (consentimento e autodeclaração sem valor).
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
  fields: [
    field("f1", { label: "Nome completo", required: true }),
    field("f2", { control: "email", label: "E-mail" }),
    field("f3", {
      control: "textarea",
      label: "Por que você quer trabalhar aqui?",
      maxLength: 800,
    }),
    field("f4", { control: "checkbox", label: "Li e aceito a política de privacidade" }),
    field("f5", {
      control: "select",
      label: "Raça/cor",
      options: [
        { value: "1", label: "Branca" },
        { value: "9", label: "Prefiro não informar" },
      ],
    }),
  ],
  frames: [],
};
const HTML =
  "<!doctype html><html><head><title>Candidatura</title></head><body><form></form></body></html>";

describe("F12/M3 · formulário de candidatura", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function device(app: TestApp) {
    const { code } = (await (
      await app.api("/api/extension/pairing", { method: "POST" })
    ).json()) as {
      code: string;
    };
    const r = await app.app.request("/api/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Chrome" }),
    });
    return ((await r.json()) as { token: string }).token;
  }

  async function capture(app: TestApp, body: Record<string, unknown>) {
    const token = await device(app);
    const r = await app.app.request("/api/extension/captures", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "page",
        url: "https://acme.example/vagas/9/aplicar",
        title: "Candidatura",
        html: HTML,
        ...body,
      }),
    });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    const got = (await (await app.api(`/api/extension/captures/${id}`)).json()) as {
      capture: { applicationId: string | null };
    };
    return { id, applicationId: got.capture.applicationId };
  }

  const view = async (app: TestApp, id: string) =>
    (await (await app.api(`/api/applications/${id}`)).json()) as {
      application: {
        status: string;
        postingId: string | null;
        posting: { title: string | null } | null;
        profileId: string | null;
        questions: Array<{
          question: string;
          kind: string;
          prefill: string | null;
          fieldRefs: string[];
        }>;
      };
    };

  it("captura com formulário cria o formulário, pede as perguntas ao worker e liga ao perfil ativo", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const { applicationId } = await capture(t, { form: FORM });
    expect(applicationId).toEqual(expect.any(String));
    expect(t.queue.tasks.map((x) => [x.queue, x.type, x.payload?.applicationId])).toEqual([
      ["extract", "application.locate", applicationId],
    ]);
    const { application } = await view(t, applicationId as string);
    expect(application).toMatchObject({
      status: "locating",
      profileId: ids.profileId,
      questions: [],
    });
  });

  it("página sem formulário (ou só um campo, como uma busca) não cria formulário", async () => {
    t = makeTestApp();
    expect((await capture(t, {})).applicationId).toBeNull();
    expect(
      (await capture(t, { form: { fields: [field("f1", { label: "Buscar" })], frames: [] } }))
        .applicationId,
    ).toBeNull();
    expect(t.queue.tasks).toHaveLength(0);
  });

  it("menu (F12-15): analisar a vaga não cria formulário; ajudar no formulário cria mesmo com um campo só", async () => {
    t = makeTestApp();
    expect((await capture(t, { form: FORM, mode: "posting" })).applicationId).toBeNull();
    const one = { fields: [field("f1", { control: "textarea", label: "Conte" })], frames: [] };
    expect((await capture(t, { form: one, mode: "form" })).applicationId).toEqual(
      expect.any(String),
    );
    const none = await capture(t, { form: { fields: [], frames: [] }, mode: "form" });
    expect(none.applicationId).toBeNull();
    const got = (await (await t.api(`/api/extension/captures/${none.id}`)).json()) as {
      capture: { mode: string };
    };
    expect(got.capture.mode).toBe("form");
  });

  it("perguntas prontas: campos óbvios com o valor dos dados; consentimento e autodeclaração sem valor", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const { applicationId } = await capture(t, { form: FORM });
    const fields = FORM.fields;
    t.repos.applications.setQuestions(
      applicationId as string,
      assembleQuestions(fields, heuristicQuestions(fields), null),
    );
    const { application } = await view(t, applicationId as string);
    expect(application.status).toBe("ready");
    expect(application.questions.map((q) => [q.kind, q.prefill])).toEqual([
      ["short_text", "Ana Maria Exemplo"],
      ["short_text", "ana.exemplo@example.com"],
      ["long_text", null],
      ["consent", null],
      ["self_declaration", null],
    ]);
  });

  it("vaga já salva com o mesmo link fica ligada ao formulário", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({
      title: "Backend Sr",
      company: "Acme",
      postingUrl: "https://acme.example/vagas/9/aplicar?utm_source=linkedin",
    });
    const { applicationId } = await capture(t, { form: FORM });
    const { application } = await view(t, applicationId as string);
    expect(application).toMatchObject({ postingId: p.id, posting: { title: "Backend Sr" } });
  });

  it("ligar o formulário a uma vaga salva à mão (ou desligar); vaga inexistente dá 404", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({ title: "Senior Software Engineer", company: "Vitalis" });
    const { applicationId } = await capture(t, { form: FORM });
    const link = (postingId: string | null) =>
      t?.api(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postingId }),
      });
    expect((await link(p.id))?.status).toBe(200);
    expect((await view(t, applicationId as string)).application).toMatchObject({
      postingId: p.id,
      posting: { title: "Senior Software Engineer" },
    });
    expect((await link("nao"))?.status).toBe(404);
    expect((await link(null))?.status).toBe(200);
    expect((await view(t, applicationId as string)).application.postingId).toBeNull();
  });

  it("a página do formulário acha a vaga salva pela página da vaga (Ashby /application)", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({
      title: "Senior Software Engineer - Vitalis Labs",
      company: "Vitalis",
      postingUrl: "https://jobs.ashbyhq.com/vitalis/0f1e2d3c-4b5a-4968-8778-a1b2c3d4e5f6",
    });
    const token = await device(t);
    const r = await t.app.request("/api/extension/captures", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "page",
        url: "https://jobs.ashbyhq.com/vitalis/0f1e2d3c-4b5a-4968-8778-a1b2c3d4e5f6/application?utm_source=exemplo",
        title: "Senior Software Engineer - Vitalis Labs @ Vitalis",
        html: HTML,
        form: FORM,
        mode: "form",
      }),
    });
    const { id } = (await r.json()) as { id: string };
    const got = (await (await t.api(`/api/extension/captures/${id}`)).json()) as {
      capture: { applicationId: string };
    };
    expect((await view(t, got.capture.applicationId)).application.postingId).toBe(p.id);
  });

  it("F12/M4: respostas na leitura; gerar de novo exige vaga (F12-11); ligar a vaga pede as respostas", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const { applicationId } = await capture(t, { form: FORM });
    const id = applicationId as string;
    const fields = FORM.fields;
    const qs = assembleQuestions(fields, heuristicQuestions(fields), null);
    t.repos.applications.setQuestions(id, qs);
    const gen = () => t?.api(`/api/applications/${id}/answers`, { method: "POST" });
    expect((await gen())?.status).toBe(422);
    const p = t.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    await t.api(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postingId: p.id }),
    });
    expect(t.queue.tasks.filter((x) => x.type === "application.answer")).toHaveLength(1);
    expect((await view(t, id)).application).toMatchObject({ answersStatus: "answering" });
    const motivo = qs.find((q) => q.kind === "long_text") as (typeof qs)[number];
    t.repos.applications.addAnswers(id, [
      {
        questionId: motivo.id,
        answer: "Quero trabalhar com pagamentos.",
        origins: [{ kind: "experience", id: ids.experienceIds[0] as string }],
        gap: null,
        assumptions: [],
        source: "model",
      },
    ]);
    t.repos.applications.setAnswersStatus(id, "ready");
    const got = (await view(t, id)).application as unknown as {
      answersStatus: string;
      questions: Array<{ id: string; answer: { answer: string; version: number } | null }>;
    };
    expect(got.answersStatus).toBe("ready");
    expect(got.questions.find((q) => q.id === motivo.id)?.answer).toMatchObject({
      answer: "Quero trabalhar com pagamentos.",
      version: 1,
    });
    expect((await gen())?.status).toBe(202);
    expect(t.queue.tasks.filter((x) => x.type === "application.answer")).toHaveLength(2);
  });

  it("F12-19: a pessoa edita a resposta antes de preencher; vira versão editada (consentimento e autodeclaração não)", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const { applicationId } = await capture(t, { form: FORM });
    const id = applicationId as string;
    const qs = assembleQuestions(FORM.fields, heuristicQuestions(FORM.fields), null);
    t.repos.applications.setQuestions(id, qs);
    const edit = (questionId: string, answer: string) =>
      t?.api(`/api/applications/${id}/answers/${questionId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer }),
      });
    const motivo = qs.find((q) => q.kind === "long_text") as (typeof qs)[number];
    t.repos.applications.addAnswers(id, [
      {
        questionId: motivo.id,
        answer: "Rascunho do roleplay.",
        origins: [],
        gap: null,
        assumptions: ["Que você gosta de pagamentos."],
        source: "roleplay",
      },
    ]);
    const r = await edit(motivo.id, "  Meu texto, do meu jeito.  ");
    expect(r?.status).toBe(200);
    const got = (await r?.json()) as {
      application: { questions: Array<{ id: string; answer: Record<string, unknown> | null }> };
    };
    expect(got.application.questions.find((q) => q.id === motivo.id)?.answer).toMatchObject({
      answer: "Meu texto, do meu jeito.",
      source: "edited",
      version: 2,
      assumptions: [],
    });
    // campo óbvio também: o texto editado vale sobre o dos dados
    const nome = qs.find((q) => q.profileField === "full_name") as (typeof qs)[number];
    expect((await edit(nome.id, "Ana M. Exemplo"))?.status).toBe(200);
    const consent = qs.find((q) => q.kind === "consent") as (typeof qs)[number];
    expect((await edit(consent.id, "Sim"))?.status).toBe(422);
    const self = qs.find((q) => q.kind === "self_declaration") as (typeof qs)[number];
    expect((await edit(self.id, "Parda"))?.status).toBe(422);
    expect((await edit("q99", "x"))?.status).toBe(404);
    expect((await edit(motivo.id, "   "))?.status).toBe(400);
  });

  it("ler de novo pede as perguntas outra vez; formulário inexistente dá 404", async () => {
    t = makeTestApp();
    const { applicationId } = await capture(t, { form: FORM });
    t.repos.applications.setError(applicationId as string, "falhou");
    const r = await t.api(`/api/applications/${applicationId}/locate`, { method: "POST" });
    expect(r.status).toBe(202);
    expect((await view(t, applicationId as string)).application.status).toBe("locating");
    expect(t.queue.tasks.filter((x) => x.type === "application.locate")).toHaveLength(2);
    expect((await t.api("/api/applications/nao")).status).toBe(404);
  });
});
