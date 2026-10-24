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

function harness(provider = new MockProvider()) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  seedFixture(repos, "engineer");
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
