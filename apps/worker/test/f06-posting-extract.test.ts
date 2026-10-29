import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPostingFromIntake,
  createRepos,
  migrate,
  openDatabase,
  type Repos,
  seedFixture,
} from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { PreAnalysis, WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { processTask, type TaskContext } from "../src/tasks";

/** F06/M4 · tarefa posting.extract: extração, merge e duplicata pelo mock; uso registrado; vaga pronta. */
const JD = `Desenvolvedor(a) Backend Sênior
Empresa: Globex Consultoria · Cliente: Initech Bank
São Paulo - SP · Híbrido · CLT
Requisitos:
- Java, Kafka e PostgreSQL`;

function harness(provider = new MockProvider()) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  seedFixture(repos, "engineer");
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-posting-"));
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
    jobId: "task__posting.extract__p1",
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

const run = (h: ReturnType<typeof harness>, postingId: string) =>
  processTask(
    { kind: "task", type: "posting.extract", key: postingId, payload: { postingId } },
    h.ctx,
    h.deps,
  );

describe("F06/M4 worker · posting.extract", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("extrai, junta e deixa a vaga pronta com a origem dos campos; registra o uso de cada chamada", async () => {
    h = harness();
    const p = createPostingFromIntake(h.repos, { text: JD });
    const r = await run(h, p.id);
    expect(h.stages).toEqual(["extracting", "merging", "dedupe"]);
    const done = h.repos.postings.get(p.id);
    expect(done).toMatchObject({
      status: "ready",
      company: "Globex Consultoria",
      client: "Initech Bank",
    });
    expect(done?.fieldSources.company).toMatch(/model|both/);
    expect(
      ((done?.preAnalysis ?? { keywords: [] }) as PreAnalysis).keywords.some(
        (k) => k.source !== "heuristic",
      ),
    ).toBe(true);
    expect(r).toMatchObject({ postingId: p.id, duplicate: null });
    expect(
      h.repos.usageEvents
        .list()
        .map((u) => u.category)
        .sort(),
    ).toEqual(["posting.extract", "posting.merge"]);
    expect(h.published).toContainEqual({ type: "posting.updated", postingId: p.id });
  });

  it("etapas do processo pelo modelo (F07/M2, 2026-10-29): vão para a vaga sem passar pelo merge", async () => {
    const mock = new MockProvider();
    const mergeInputs: unknown[] = [];
    const provider = Object.assign(Object.create(mock) as MockProvider, {
      postingExtract: async (input: Parameters<MockProvider["postingExtract"]>[0]) => {
        const r = await mock.postingExtract(input);
        return {
          ...r,
          output: {
            ...r.output,
            fields: { ...r.output.fields, hiringSteps: ["Conversa com o RH", "Case técnico"] },
          },
        };
      },
      postingMerge: async (input: Parameters<MockProvider["postingMerge"]>[0]) => {
        mergeInputs.push(input);
        return mock.postingMerge(input);
      },
    });
    h = harness(provider);
    const p = createPostingFromIntake(h.repos, { text: JD });
    await run(h, p.id);
    const done = h.repos.postings.get(p.id);
    expect(done?.hiringSteps).toEqual(["Conversa com o RH", "Case técnico"]);
    expect(done?.fieldSources.hiringSteps).toBe("model");
    // o merge (prompt sem etapas) recebe a extração sem elas
    expect(JSON.stringify(mergeInputs)).not.toContain("hiringSteps");
  });

  it("vaga salva com o mesmo hash: compara e grava a duplicata pendente de decisão", async () => {
    h = harness();
    const first = createPostingFromIntake(h.repos, { text: JD });
    await run(h, first.id);
    const second = createPostingFromIntake(h.repos, { text: JD });
    const r = await run(h, second.id);
    expect(r).toMatchObject({ duplicate: { candidateId: first.id, confidence: 95 } });
    expect(h.repos.postings.get(second.id)?.duplicate).toMatchObject({
      sameJob: true,
      decision: null,
    });
  });

  it("modelo fora do ar: a vaga fica em error com o que a heurística gravou", async () => {
    h = harness(new MockProvider({ errors: { postingExtract: "modelo fora do ar" } }));
    const p = createPostingFromIntake(h.repos, { text: JD });
    await expect(run(h, p.id)).rejects.toThrow(/fora do ar/);
    expect(h.repos.postings.get(p.id)).toMatchObject({
      status: "error",
      title: "Desenvolvedor(a) Backend Sênior",
    });
  });

  it("vaga sem texto: nada a extrair, fica pronta", async () => {
    h = harness();
    const p = createPostingFromIntake(h.repos, { fields: { company: "Nubank", title: "Dev" } });
    expect(await run(h, p.id)).toMatchObject({ skipped: "no_text" });
    expect(h.repos.postings.get(p.id)?.status).toBe("ready");
  });
});
