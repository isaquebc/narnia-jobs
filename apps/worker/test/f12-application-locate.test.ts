import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepos, migrate, openDatabase, type Repos, seedFixture } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { FormField, WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { processTask, type TaskContext } from "../src/tasks";

/** F12/M3 · tarefa application.locate: heurística, Haiku (mock) para o resto, perguntas conferidas; uso registrado. */
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
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-application-"));
  const published: WsEvent[] = [];
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
    enqueueTask: async () => {},
    publish: async (e) => {
      published.push(e);
    },
    gh: () => {
      throw new Error("gh não usado");
    },
  };
  const stages: string[] = [];
  const ctx: TaskContext = {
    jobId: "task__application.locate__a1",
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
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

const run = (h: ReturnType<typeof harness>, applicationId: string) =>
  processTask(
    { kind: "task", type: "application.locate", key: applicationId, payload: { applicationId } },
    h.ctx,
    h.deps,
  );

function form(h: ReturnType<typeof harness>, fields: FormField[]) {
  return h.repos.applications.create({
    captureId: "c1",
    postingId: null,
    profileId: null,
    url: "https://acme.example/aplicar",
    title: "Candidatura",
    fields,
  });
}

describe("F12/M3 worker · application.locate", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("heurística primeiro, o modelo com o resto; perguntas na ordem; uso registrado; avisa a janela", async () => {
    h = harness();
    const f = form(h, [
      field("f1", { label: "Nome completo" }),
      field("f2", { control: "textarea", label: "Por que você?" }),
      field("f3", { label: "Buscar CEP" }),
      field("f4", { control: "checkbox", label: "Aceito os termos" }),
    ]);
    await run(h, f.id);
    expect(h.stages).toEqual(["heuristic", "locating"]);
    const done = h.repos.applications.get(f.id);
    expect(done?.status).toBe("ready");
    expect(done?.questions.map((q) => [q.fieldRefs.join("+"), q.kind, q.source])).toEqual([
      ["f1", "short_text", "heuristic"],
      ["f2", "long_text", "model"],
      ["f4", "consent", "heuristic"],
    ]);
    expect(h.repos.usageEvents.list().map((u) => u.category)).toEqual(["application.locate"]);
    expect(h.published).toEqual([{ type: "application.updated", applicationId: f.id }]);
  });

  it("tudo resolvido pela heurística: não chama o modelo", async () => {
    h = harness();
    const f = form(h, [field("f1", { label: "Nome completo" }), field("f2", { control: "email" })]);
    await run(h, f.id);
    expect(h.stages).toEqual(["heuristic"]);
    expect(h.repos.usageEvents.list()).toHaveLength(0);
  });

  it("modelo falhou: as perguntas saem pelos rótulos, com o motivo como aviso (a janela não trava)", async () => {
    h = harness(new MockProvider({ errors: { applicationLocate: "modelo fora do ar" } }));
    const f = form(h, [
      field("f1", { control: "textarea", label: "Conte" }),
      field("f2", { label: "Cargo" }),
    ]);
    await run(h, f.id);
    const done = h.repos.applications.get(f.id);
    expect(done).toMatchObject({
      status: "ready",
      error: expect.stringMatching(/modelo fora do ar/),
    });
    expect(done?.questions.map((q) => [q.question, q.kind])).toEqual([
      ["Conte", "long_text"],
      ["Cargo", "short_text"],
    ]);
    expect(h.published).toHaveLength(1);
  });
});
