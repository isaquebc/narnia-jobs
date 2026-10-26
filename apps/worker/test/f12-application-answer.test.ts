import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepos, migrate, openDatabase, type Repos, seedFixture } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { FormField, WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { processTask, type TaskContext } from "../src/tasks";

/** F12/M4 · tarefa application.answer: com a vaga ligada, o Sonnet (mock) responde; conferido e guardado por versão. */
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

function harness(provider = new MockProvider(), opts: { reviewed?: boolean } = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const { profileId } = seedFixture(repos, "engineer");
  // F12-23: os testes das respostas partem do perfil com as motivações já revisadas
  if (opts.reviewed !== false) repos.profileMotivations.markReviewed(profileId);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-answer-"));
  const published: WsEvent[] = [];
  const enqueued: string[] = [];
  const deps: WorkerDeps = {
    repos,
    dataDir,
    provider,
    ocr: {
      render: async () => [],
      createRecognizer: async () => ({
        recognize: async () => ({ text: "", confidence: 0 }),
        terminate: async () => {},
      }),
    },
    enqueue: async () => {},
    enqueueTask: async (req) => {
      enqueued.push(req.type);
    },
    publish: async (e) => {
      published.push(e);
    },
    gh: () => {
      throw new Error("gh não usado");
    },
  };
  const stages: string[] = [];
  const ctx: TaskContext = {
    jobId: "task__application.answer__a1",
    progress: async (_pct, note) => {
      if (note) stages.push(note);
    },
  };
  return {
    repos,
    deps,
    ctx,
    stages,
    published,
    enqueued,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

const run = (h: ReturnType<typeof harness>, type: string, applicationId: string) =>
  processTask(
    { kind: "task", type, key: applicationId, payload: { applicationId } },
    h.ctx,
    h.deps,
  );

describe("F12/M4 worker · application.answer", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  function form(postingId: string | null) {
    return h.repos.applications.create({
      captureId: "c1",
      postingId,
      profileId: h.repos.profiles.active()?.id ?? null,
      url: "https://acme.example/aplicar",
      title: "Candidatura",
      fields: [
        field("f1", { label: "Nome completo" }),
        field("f2", { control: "textarea", label: "Por que você quer trabalhar aqui?" }),
        field("f3", {
          control: "select",
          label: "Quando pode começar?",
          options: [
            { value: "1", label: "Imediato" },
            { value: "2", label: "30 dias" },
          ],
        }),
        field("f4", { control: "checkbox", label: "Aceito os termos" }),
      ],
    });
  }

  it("perguntas prontas com vaga ligada: pede as respostas; elas saem conferidas, com origem", async () => {
    h = harness();
    const p = h.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    const f = form(p.id);
    await run(h, "application.locate", f.id);
    expect(h.enqueued).toEqual(["application.answer"]);
    expect(h.repos.applications.get(f.id)?.answersStatus).toBe("answering");
    await run(h, "application.answer", f.id);
    const done = h.repos.applications.get(f.id);
    expect(done?.answersStatus).toBe("ready");
    const answers = h.repos.applications.latestAnswers(f.id);
    const q = done?.questions ?? [];
    const by = (ref: string) =>
      answers.find((a) => a.questionId === q.find((x) => x.fieldRefs[0] === ref)?.id);
    // pergunta aberta: o roleplay escreve como a pessoa e diz o que supôs (F12-18)
    expect(by("f2")).toMatchObject({
      answer: expect.stringContaining("Acme Pagamentos"),
      source: "roleplay",
      assumptions: [expect.any(String)],
      version: 1,
    });
    expect(by("f2")?.origins).toEqual([{ kind: "experience", id: expect.any(String) }]);
    expect(by("f3")?.source).toBe("model");
    expect(by("f3")?.answer).toBe("Imediato");
    // campo óbvio e consentimento não vão para o modelo
    expect(by("f1")).toBeUndefined();
    expect(by("f4")).toBeUndefined();
    expect(h.repos.usageEvents.list().map((u) => u.category)).toEqual(
      expect.arrayContaining(["application.answer", "application.roleplay"]),
    );
    // gerar de novo cria a versão 2
    await run(h, "application.answer", f.id);
    expect(by("f2")).toBeDefined();
    expect(h.repos.applications.latestAnswers(f.id).every((a) => a.version === 2)).toBe(true);
  });

  it("F12-19: a resposta editada pela pessoa fica ao gerar de novo; o roleplay recebe a escrita dela", async () => {
    const provider = new MockProvider();
    const roleplay = vi.spyOn(provider, "applicationRoleplay");
    const answer = vi.spyOn(provider, "applicationAnswer");
    h = harness(provider);
    const p = h.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    const own =
      "Gosto de problemas difíceis de pagamentos e quero continuar nisso, perto do produto e do time.";
    h.repos.applications.addAnswers("outro-formulario", [
      { questionId: "q1", answer: own, origins: [], gap: null, assumptions: [], source: "edited" },
    ]);
    const f = form(p.id);
    await run(h, "application.locate", f.id);
    const q = h.repos.applications.get(f.id)?.questions ?? [];
    const select = q.find((x) => x.fieldRefs[0] === "f3")?.id as string;
    h.repos.applications.addAnswers(f.id, [
      {
        questionId: select,
        answer: "30 dias",
        origins: [],
        gap: null,
        assumptions: [],
        source: "edited",
      },
    ]);
    await run(h, "application.answer", f.id);
    const latest = h.repos.applications.latestAnswers(f.id);
    expect(latest.find((a) => a.questionId === select)).toMatchObject({
      answer: "30 dias",
      source: "edited",
    });
    expect(roleplay.mock.calls[0]?.[0]).toMatchObject({ voice: [own] });
    expect(JSON.stringify(answer.mock.calls[0]?.[0] ?? {})).not.toContain("Quando pode começar");
  });

  it("sem vaga ligada (F12-11): não pede nem gera respostas", async () => {
    h = harness();
    const f = form(null);
    await run(h, "application.locate", f.id);
    expect(h.enqueued).toEqual([]);
    expect(await run(h, "application.answer", f.id)).toMatchObject({ skipped: "no_posting" });
    expect(h.repos.applications.latestAnswers(f.id)).toEqual([]);
  });

  it("o roleplay falhou: as outras respostas ficam e o erro aparece com o motivo", async () => {
    h = harness(new MockProvider({ errors: { applicationRoleplay: "roleplay fora do ar" } }));
    const p = h.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    const f = form(p.id);
    await run(h, "application.locate", f.id);
    await expect(run(h, "application.answer", f.id)).rejects.toThrow(/roleplay fora do ar/);
    expect(h.repos.applications.get(f.id)).toMatchObject({ answersStatus: "error" });
    expect(h.repos.applications.latestAnswers(f.id).map((a) => a.answer)).toContain("Imediato");
  });

  it("modelo falhou: respostas em erro com o motivo", async () => {
    h = harness(new MockProvider({ errors: { applicationAnswer: "modelo fora do ar" } }));
    const p = h.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    const f = form(p.id);
    await run(h, "application.locate", f.id);
    await expect(run(h, "application.answer", f.id)).rejects.toThrow(/modelo fora do ar/);
    expect(h.repos.applications.get(f.id)).toMatchObject({
      answersStatus: "error",
      answersError: expect.stringMatching(/modelo fora do ar/),
    });
  });
});

/**
 * F12-23 · motivações do perfil antes das respostas: com pergunta aberta e o perfil sem motivações revisadas, o worker
 * não escreve e pede as sugestões; com elas, o roleplay recebe as aceitas e o tratamento do cadastro.
 */
describe("F12-23 worker · motivações do perfil", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());
  const openForm = () => {
    const p = h.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    return h.repos.applications.create({
      captureId: "c1",
      postingId: p.id,
      profileId: h.repos.profiles.active()?.id ?? null,
      url: "https://acme.example/aplicar",
      title: "Candidatura",
      fields: [field("f2", { control: "textarea", label: "Por que você quer trabalhar aqui?" })],
    });
  };
  const profileId = () => h.repos.profiles.active()?.id as string;

  it("perfil sem motivações revisadas: não escreve, marca a espera e pede as sugestões", async () => {
    h = harness(new MockProvider(), { reviewed: false });
    const f = openForm();
    await run(h, "application.locate", f.id);
    h.enqueued.length = 0;
    expect(await run(h, "application.answer", f.id)).toMatchObject({ waiting: "motivations" });
    expect(h.repos.applications.get(f.id)?.answersStatus).toBe("motivations");
    expect(h.repos.applications.latestAnswers(f.id)).toEqual([]);
    expect(h.enqueued).toEqual(["profile.motivations"]);
    // sugestões já na espera: não pede de novo
    h.repos.profileMotivations.add({
      profileId: profileId(),
      text: "Quero continuar em pagamentos.",
      status: "suggested",
      source: "model",
    });
    h.enqueued.length = 0;
    await run(h, "application.answer", f.id);
    expect(h.enqueued).toEqual([]);
  });

  it("sem pergunta aberta, não espera: as respostas de fato saem", async () => {
    h = harness(new MockProvider(), { reviewed: false });
    const p = h.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    const f = h.repos.applications.create({
      captureId: "c1",
      postingId: p.id,
      profileId: h.repos.profiles.active()?.id ?? null,
      url: "https://acme.example/aplicar",
      title: "Candidatura",
      fields: [
        field("f3", {
          control: "select",
          label: "Quando pode começar?",
          options: [{ value: "1", label: "Imediato" }],
        }),
      ],
    });
    await run(h, "application.locate", f.id);
    await run(h, "application.answer", f.id);
    expect(h.repos.applications.get(f.id)?.answersStatus).toBe("ready");
  });

  it("tarefa profile.motivations: guarda as sugestões (sem as recusadas) e avisa a janela", async () => {
    const provider = new MockProvider();
    const spy = vi.spyOn(provider, "profileMotivations");
    h = harness(provider, { reviewed: false });
    h.repos.users.upsert({ pronouns: "ela/dela" });
    const refused = h.repos.profileMotivations.add({
      profileId: profileId(),
      text: "Prefiro times pequenos, com autonomia.",
      status: "refused",
      source: "model",
    });
    await processTask(
      { kind: "task", type: "profile.motivations", key: "k", payload: { profileId: profileId() } },
      h.ctx,
      h.deps,
    );
    const input = spy.mock.calls[0]?.[0];
    expect(input).toMatchObject({ address: "feminino", refused: [refused.text], count: 4 });
    expect(input?.brief.posting).toBeNull();
    const list = h.repos.profileMotivations.list(profileId());
    const suggested = list.filter((m) => m.status === "suggested");
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.length).toBeLessThanOrEqual(4);
    expect(suggested.every((m) => m.source === "model")).toBe(true);
    expect(suggested.map((m) => m.text)).not.toContain(refused.text);
    expect(h.published).toContainEqual({
      type: "profile.motivations.updated",
      profileId: profileId(),
    });
    // pedido de uma no lugar de uma recusada
    spy.mockClear();
    await processTask(
      {
        kind: "task",
        type: "profile.motivations",
        key: "k2",
        payload: { profileId: profileId(), count: 1 },
      },
      h.ctx,
      h.deps,
    );
    expect(spy.mock.calls[0]?.[0].count).toBe(1);
    // as sugestões ainda pendentes também vão ao modelo (não repetir): uma nova chega no lugar
    expect(spy.mock.calls[0]?.[0].accepted).toEqual(
      expect.arrayContaining(suggested.map((m) => m.text)),
    );
    expect(h.repos.profileMotivations.list(profileId()).length).toBe(list.length + 1);
  });

  it("revisadas: o roleplay recebe as aceitas, as recusadas e o tratamento (sem cadastro, neutro)", async () => {
    const provider = new MockProvider();
    const roleplay = vi.spyOn(provider, "applicationRoleplay");
    h = harness(provider, { reviewed: false });
    h.repos.profileMotivations.add({
      profileId: profileId(),
      text: "Quero continuar trabalhando com pagamentos.",
      status: "accepted",
      source: "model",
    });
    h.repos.profileMotivations.add({
      profileId: profileId(),
      text: "Gosto de ser dona dos serviços.",
      status: "refused",
      source: "assumption",
    });
    const f = openForm();
    await run(h, "application.locate", f.id);
    await run(h, "application.answer", f.id);
    expect(roleplay.mock.calls[0]?.[0].person).toMatchObject({
      address: "neutro",
      motivations: ["Quero continuar trabalhando com pagamentos."],
      refusedMotivations: ["Gosto de ser dona dos serviços."],
    });
  });

  it("suposição recusada: refaz só a pergunta dela (questionIds); as outras ficam", async () => {
    const provider = new MockProvider();
    const answer = vi.spyOn(provider, "applicationAnswer");
    h = harness(provider);
    const p = h.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    const f = h.repos.applications.create({
      captureId: "c1",
      postingId: p.id,
      profileId: h.repos.profiles.active()?.id ?? null,
      url: "https://acme.example/aplicar",
      title: "Candidatura",
      fields: [
        field("f2", { control: "textarea", label: "Por que você quer trabalhar aqui?" }),
        field("f3", {
          control: "select",
          label: "Quando pode começar?",
          options: [{ value: "1", label: "Imediato" }],
        }),
      ],
    });
    await run(h, "application.locate", f.id);
    await run(h, "application.answer", f.id);
    const open = h.repos.applications.get(f.id)?.questions.find((q) => q.fieldRefs[0] === "f2");
    answer.mockClear();
    await processTask(
      {
        kind: "task",
        type: "application.answer",
        key: "k",
        payload: { applicationId: f.id, questionIds: [open?.id] },
      },
      h.ctx,
      h.deps,
    );
    expect(answer).not.toHaveBeenCalled();
    const latest = h.repos.applications.latestAnswers(f.id);
    expect(latest.find((a) => a.questionId === open?.id)?.version).toBe(2);
    expect(latest.find((a) => a.questionId !== open?.id)?.version).toBe(1);
    expect(h.repos.applications.get(f.id)?.answersStatus).toBe("ready");
  });
});
