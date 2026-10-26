import type { ApplicationQuestion } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createApplicationTools } from "../../src/applications/tools";
import { createRepos, migrate, openDatabase } from "../../src/db";

/** F12/M5 · tools do formulário: o recrutador lê as perguntas e grava a resposta combinada na conversa. */
const q = (id: string, over: Partial<ApplicationQuestion> = {}): ApplicationQuestion => ({
  id,
  question: `Pergunta ${id}`,
  kind: "long_text",
  options: [],
  required: false,
  maxChars: null,
  fieldRefs: [id],
  section: null,
  profileField: null,
  topic: null,
  source: "model",
  ...over,
});

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const f = repos.applications.create({
    captureId: "c1",
    postingId: null,
    profileId: null,
    url: "https://jobs.example/vitalis/apply",
    title: "Vitalis · Candidatura",
    fields: [],
  });
  repos.applications.setQuestions(f.id, [
    q("motivo", { question: "Why are you interested in Vitalis?", maxChars: 120 }),
    q("remoto", {
      kind: "choice",
      question: "Work model",
      options: [
        { value: "r", label: "Remote" },
        { value: "h", label: "Hybrid" },
      ],
    }),
    q("lgpd", { kind: "consent", question: "I agree to the privacy policy" }),
  ]);
  repos.applications.addAnswers(f.id, [
    {
      questionId: "motivo",
      answer: "Porque pagamentos.",
      origins: [],
      gap: null,
      assumptions: [],
      source: "roleplay",
    },
  ]);
  const changed: string[] = [];
  const tools = createApplicationTools(repos, { ports: { changed: (id) => changed.push(id) } });
  return { repos, f, tools, changed };
}

describe("F12/M5 · application.get", () => {
  it("perguntas com tipo, opções, limite, a resposta atual e se dá para gravar", async () => {
    const { f, tools } = setup();
    const r = await tools["application.get"]({ applicationId: f.id });
    expect(r).toMatchObject({ applicationId: f.id, url: "https://jobs.example/vitalis/apply" });
    expect(r.questions).toEqual([
      expect.objectContaining({
        questionId: "motivo",
        maxChars: 120,
        answer: "Porque pagamentos.",
        source: "roleplay",
        editable: true,
      }),
      expect.objectContaining({
        questionId: "remoto",
        options: ["Remote", "Hybrid"],
        answer: null,
        editable: true,
      }),
      expect.objectContaining({ questionId: "lgpd", editable: false }),
    ]);
  });

  it("formulário que não existe é erro", async () => {
    const { tools } = setup();
    await expect(tools["application.get"]({ applicationId: "nao-existe" })).rejects.toThrow(
      /não encontrado/,
    );
  });
});

describe("F12/M5 · application.answer_save", () => {
  it("grava a versão nova com origem chat e avisa a janela", async () => {
    const { repos, f, tools, changed } = setup();
    const r = await tools["application.answer_save"]({
      applicationId: f.id,
      questionId: "motivo",
      answer: "Quero levar pagamentos para a saúde.",
    });
    expect(r).toEqual({ questionId: "motivo", version: 2 });
    expect(repos.applications.latestAnswers(f.id)).toEqual([
      expect.objectContaining({
        questionId: "motivo",
        answer: "Quero levar pagamentos para a saúde.",
        source: "chat",
      }),
    ]);
    expect(changed).toEqual([f.id]);
  });

  it("escolha só com o texto de uma opção (sem diferença de caixa); grava o rótulo da página", async () => {
    const { repos, f, tools } = setup();
    await expect(
      tools["application.answer_save"]({
        applicationId: f.id,
        questionId: "remoto",
        answer: "Onsite",
      }),
    ).rejects.toThrow(/Remote; Hybrid/);
    await tools["application.answer_save"]({
      applicationId: f.id,
      questionId: "remoto",
      answer: "remote",
    });
    expect(
      repos.applications.latestAnswers(f.id).find((a) => a.questionId === "remoto")?.answer,
    ).toBe("Remote");
  });

  it("recusa texto acima do limite, consentimento e pergunta que não existe", async () => {
    const { f, tools } = setup();
    await expect(
      tools["application.answer_save"]({
        applicationId: f.id,
        questionId: "motivo",
        answer: "x".repeat(121),
      }),
    ).rejects.toThrow(/121 caracteres.*120/);
    await expect(
      tools["application.answer_save"]({ applicationId: f.id, questionId: "lgpd", answer: "Sim" }),
    ).rejects.toThrow(/fica com a pessoa/);
    await expect(
      tools["application.answer_save"]({ applicationId: f.id, questionId: "nada", answer: "x" }),
    ).rejects.toThrow(/Pergunta não encontrada/);
  });
});

describe("F12/M5 · conversa do formulário no banco", () => {
  it("guarda a conversa do formulário; 0023 entra sobre o banco anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0022_application_roleplay" });
    expect(migrate(db).applied).toEqual(expect.arrayContaining(["0023_application_chat"]));
    const repos = createRepos(db);
    const f = repos.applications.create({
      captureId: "c1",
      postingId: null,
      profileId: null,
      url: "https://x.example",
      title: null,
      fields: [],
    });
    expect(f.chatSessionId).toBeNull();
    repos.applications.setChatSession(f.id, "s1");
    expect(repos.applications.get(f.id)?.chatSessionId).toBe("s1");
  });
});

describe("F12/M5 · formulário sem vaga (F12-11), modo B e autodeclaração (F12-12)", () => {
  it("application.list: os formulários mais recentes, para achar o id no terminal", async () => {
    const { f, tools } = setup();
    const r = await tools["application.list"]({});
    expect(r.items).toEqual([
      expect.objectContaining({
        applicationId: f.id,
        url: "https://jobs.example/vitalis/apply",
        postingId: null,
        status: "ready",
      }),
    ]);
  });

  it("application.link_posting: liga a vaga ao formulário e à conversa, e pede as respostas sugeridas", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const f = repos.applications.create({
      captureId: "c1",
      postingId: null,
      profileId: null,
      url: "https://x.example/apply",
      title: null,
      fields: [],
    });
    repos.applications.setQuestions(f.id, [q("motivo")]);
    const s = repos.chatSessions.create({
      profileId: null,
      category: "job",
      title: "Formulário · x.example",
      provider: "mock",
      model: "sonnet",
    });
    const p = repos.postings.create({ company: "Vitalis", title: "Senior Software Engineer" });
    const requested: string[] = [];
    const tools = createApplicationTools(repos, {
      sessionId: s.id,
      ports: { requestAnswers: async (id) => void requested.push(id) },
    });
    const r = await tools["application.link_posting"]({ applicationId: f.id, postingId: p.id });
    expect(r).toEqual({ applicationId: f.id, postingId: p.id, answersRequested: true });
    expect(repos.applications.get(f.id)?.postingId).toBe(p.id);
    expect(repos.chatSessions.get(s.id)?.postingId).toBe(p.id);
    expect(requested).toEqual([f.id]);
    await expect(
      tools["application.link_posting"]({ applicationId: f.id, postingId: "nao-existe" }),
    ).rejects.toThrow(/Vaga não encontrada/);
  });

  it("self_declaration: guarda o que a pessoa declarou (ou prefiro não informar) e application.get mostra a opção casada", async () => {
    const { repos, f, tools } = setup();
    repos.applications.setQuestions(f.id, [
      q("raca", {
        kind: "self_declaration",
        topic: "race",
        question: "Raça/cor",
        options: [
          { value: "b", label: "Branco(a)" },
          { value: "p", label: "Pardo(a)" },
          { value: "x", label: "Prefiro não informar" },
        ],
      }),
      q("pcd", { kind: "self_declaration", topic: "disability", question: "Você é PcD?" }),
    ]);
    expect((await tools["self_declaration.list"]({})).items).toEqual([]);
    await tools["self_declaration.save"]({ topic: "race", value: "Parda" });
    await tools["self_declaration.save"]({ topic: "disability", preferNotToSay: true });
    expect((await tools["self_declaration.list"]({})).items).toEqual([
      { topic: "disability", value: null, preferNotToSay: true },
      { topic: "race", value: "Parda", preferNotToSay: false },
    ]);
    const view = await tools["application.get"]({ applicationId: f.id });
    expect(view.questions).toEqual([
      expect.objectContaining({ questionId: "raca", answer: "Pardo(a)", declared: true }),
      expect.objectContaining({ questionId: "pcd", answer: null, declared: true }),
    ]);
    await expect(tools["self_declaration.save"]({ topic: "race" })).rejects.toThrow(/valor/);
  });
});
