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
