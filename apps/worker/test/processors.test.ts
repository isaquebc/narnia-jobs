import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRepos,
  migrate,
  openDatabase,
  planStages,
  type Repos,
  type StageName,
} from "@narnia-jobs/core";
import { MockProvider, type Provider } from "@narnia-jobs/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onStageFailed, processStage, type StageContext, type WorkerDeps } from "../src/pipeline";

const FIXTURES = new URL("../../../packages/core/test/fixtures/", import.meta.url).pathname;

interface Harness {
  repos: Repos;
  dataDir: string;
  deps: WorkerDeps;
  enqueued: StageName[];
  calls: Record<string, number>;
}

function countingProvider(inner: Provider, calls: Record<string, number>): Provider {
  const wrap =
    <K extends "readDocument" | "extractFacts" | "buildDigest">(k: K) =>
    (input: Parameters<Provider[K]>[0]) => {
      calls[k] = (calls[k] ?? 0) + 1;
      return (inner[k] as (i: Parameters<Provider[K]>[0]) => ReturnType<Provider[K]>)(input);
    };
  return {
    id: inner.id,
    detect: () => inner.detect(),
    openChat: (o) => inner.openChat(o),
    readDocument: wrap("readDocument") as Provider["readDocument"],
    extractFacts: wrap("extractFacts") as Provider["extractFacts"],
    buildDigest: wrap("buildDigest") as Provider["buildDigest"],
    analyzeProfiles: (i) => inner.analyzeProfiles(i),
    pickFiles: (i) => inner.pickFiles(i),
    analyzeRepo: (i) => inner.analyzeRepo(i),
    synthesizeRun: (i) => inner.synthesizeRun(i),
    checkProposals: (i) => inner.checkProposals(i),
    chatTitle: (i) => inner.chatTitle(i),
    postingExtract: (i) => inner.postingExtract(i),
    postingMerge: (i) => inner.postingMerge(i),
    postingDuplicate: (i) => inner.postingDuplicate(i),
    cvGenerate: (i) => inner.cvGenerate(i),
    coverLetterGenerate: (i) => inner.coverLetterGenerate(i),
    cvReview: (i) => inner.cvReview(i),
    complete: (i, onText) => inner.complete(i, onText),
    getPlanUsage: () => inner.getPlanUsage(),
    planWindowSnapshot: () => inner.planWindowSnapshot(),
  };
}

function harness(provider: Provider = new MockProvider()): Harness {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-"));
  mkdirSync(join(dataDir, "uploads"), { recursive: true });
  const enqueued: StageName[] = [];
  const calls: Record<string, number> = {};
  const deps: WorkerDeps = {
    repos,
    dataDir,
    provider: countingProvider(provider, calls),
    ocr: {
      render: async (_pdf, outDir) => {
        const p = join(outDir, "page-1.png");
        writeFileSync(p, "png");
        return [p];
      },
      createRecognizer: async () => ({
        recognize: async () => ({
          text: "ANA MARIA EXEMPLO\nAcme Ltda — Engenheira de Software Sênior\nUnicamp",
          confidence: 0.91,
        }),
        terminate: async () => {},
      }),
    },
    enqueue: async (_runId, stage) => {
      enqueued.push(stage);
    },
    enqueueTask: async () => {},
    publish: async () => {},
    gh: () => {
      throw new Error("gh não usado neste teste");
    },
  };
  return { repos, dataDir, deps, enqueued, calls };
}

function addFile(h: Harness, fixture: string, kind: "cv" | "text" = "cv") {
  const buf = readFileSync(join(FIXTURES, fixture));
  const sha = createHash("sha256").update(buf).digest("hex");
  const ext = fixture.split(".").pop();
  const rel = join("uploads", `${sha}.${ext}`);
  copyFileSync(join(FIXTURES, fixture), join(h.dataDir, rel));
  return h.repos.sourceFiles.insert({
    originalName: fixture,
    mime: ext === "pdf" ? "application/pdf" : "text/plain",
    size: buf.byteLength,
    sha256: sha,
    path: rel,
    kind,
  });
}

function newRun(h: Harness, fileId: string, options = { ocr: true, modelRead: true }) {
  const run = h.repos.ingestionRuns.create({
    fileId,
    provider: "mock",
    models: { document: "haiku", facts: "haiku", digest: "sonnet" },
    options,
  });
  h.repos.ingestionRuns.setStatus(run.id, "queued");
  return run;
}

const ctx = (runId: string, stage: StageName): StageContext => ({
  runId,
  jobId: `${runId}__${stage}`,
  progress: async () => {},
});

async function runAll(h: Harness, runId: string, plan: StageName[]) {
  for (const stage of plan) await processStage({ runId, stage }, ctx(runId, stage), h.deps);
}

describe("M4/worker processadores da cadeia (F01 §2.5)", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => {
    rmSync(h.dataDir, { recursive: true, force: true });
  });

  it("PDF com tudo ligado: 3 leituras, consolidação com segmentos, propostas, digest, run em review, 3 usage_event, próxima etapa enfileirada a cada passo", async () => {
    const file = addFile(h, "cv_text.pdf");
    const run = newRun(h, file.id);
    const plan = planStages({ isPdf: true, options: run.options });
    await runAll(h, run.id, plan);

    const readings = h.repos.readings.listByRun(run.id);
    expect(readings.map((r) => r.kind).sort()).toEqual(["model_read", "ocr", "text_layer"]);
    for (const r of readings) expect(existsSync(join(h.dataDir, r.textPath))).toBe(true);
    expect(h.repos.readings.segmentsByRun(run.id).length).toBeGreaterThan(0);
    expect(h.repos.proposals.listByRun(run.id).length).toBeGreaterThan(5);
    expect(h.repos.digests.get(file.id)?.summary).toContain("Ana Maria Exemplo");
    expect(h.repos.ingestionRuns.get(run.id)?.status).toBe("review");
    expect(h.repos.ingestionRuns.get(run.id)?.usage).toMatchObject({
      document: expect.any(Object),
      facts: expect.any(Object),
      digest: expect.any(Object),
    });
    expect(
      h.repos.usageEvents
        .list()
        .map((e) => e.category)
        .sort(),
    ).toEqual(["ingest.digest", "ingest.facts", "ingest.read_doc", "ingest.review_check"]);
    // cada etapa enfileirou a próxima; a última não enfileira nada
    expect(h.enqueued).toEqual(plan.slice(1));
    expect(h.repos.ingestionRuns.get(run.id)?.startedAt).toBeTruthy();
  });

  it("options {ocr:false, modelRead:false}: só leitura de texto, sem chamadas ao modelo para o documento", async () => {
    const file = addFile(h, "cv_text.pdf");
    const run = newRun(h, file.id, { ocr: false, modelRead: false });
    const plan = planStages({ isPdf: true, options: run.options });
    expect(plan).toEqual([
      "ingest.read_text",
      "ingest.consolidate",
      "extract.facts",
      "extract.digest",
      "ingest.reconcile",
      "ingest.review_check",
    ]);
    await runAll(h, run.id, plan);
    expect(h.repos.readings.listByRun(run.id).map((r) => r.kind)).toEqual(["text_layer"]);
    expect(h.calls.readDocument ?? 0).toBe(0);
    expect(h.repos.ingestionRuns.get(run.id)?.status).toBe("review");
  });

  it("texto livre: 4 etapas, leitura text_layer com quality 1, locale detectado pt-BR", async () => {
    const file = addFile(h, "texto_livre.txt", "text");
    const run = newRun(h, file.id);
    const plan = planStages({ isPdf: false, options: run.options });
    await runAll(h, run.id, plan);
    const reading = h.repos.readings.listByRun(run.id)[0];
    if (!reading) throw new Error("leitura ausente");
    expect(reading.kind).toBe("text_layer");
    expect(reading.quality).toBe(1);
    expect((reading.pages as { language: string }).language).toBe("pt");
    expect(h.repos.ingestionRuns.get(run.id)?.status).toBe("review");
  });

  it("conquista de experiência do perfil: o extrator recebe as experiências; id desconhecido vira 'sem experiência'", async () => {
    const seen: Array<Parameters<Provider["extractFacts"]>[0]> = [];
    const mock = new MockProvider();
    const h2 = harness(
      Object.assign(Object.create(mock), {
        extractFacts: async (i: Parameters<Provider["extractFacts"]>[0]) => {
          seen.push(i);
          const r = await mock.extractFacts(i);
          r.output.profileAchievements?.push({
            confidence: 0.5,
            experienceId: "fantasma",
            text: "Ganhou um prêmio",
          });
          return r;
        },
      }) as Provider,
    );
    const acme = h2.repos.facts.experiences.insert({
      company: "Acme Pagamentos",
      title: "Tech Lead",
      startDate: "2022-01",
      isCurrent: true,
      tech: [],
      confidence: 1,
      verified: true,
    });
    const text =
      "Conquista: liderei 7 pessoas na Acme Pagamentos\nConquista: criei o guia de onboarding\n";
    const rel = join("uploads", "conquistas.txt");
    writeFileSync(join(h2.dataDir, rel), text);
    const file = h2.repos.sourceFiles.insert({
      originalName: null,
      mime: "text/plain",
      size: text.length,
      sha256: "c".repeat(64),
      path: rel,
      kind: "text",
    });
    const run = newRun(h2, file.id);
    await runAll(h2, run.id, planStages({ isPdf: false, options: run.options }));
    expect(seen[0]?.experiences).toEqual([
      {
        id: acme.id,
        company: "Acme Pagamentos",
        title: "Tech Lead",
        startDate: "2022-01",
        isCurrent: true,
      },
    ]);
    const achievements = h2.repos.proposals
      .listByRun(run.id)
      .filter((p) => p.kind === "achievement")
      .map((p) => p.proposal.data);
    expect(achievements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "liderei 7 pessoas na Acme Pagamentos",
          experienceId: acme.id,
        }),
        expect.not.objectContaining({ experienceId: expect.anything() }),
      ]),
    );
    const ghost = achievements.find((a) => (a as { text: string }).text === "Ganhou um prêmio");
    expect(ghost).toEqual({ text: "Ganhou um prêmio" });
  });

  it("idempotência: reprocessar extract.read_doc e extract.facts não duplica leitura/propostas nem chama o modelo de novo", async () => {
    const file = addFile(h, "cv_text.pdf");
    const run = newRun(h, file.id);
    const plan = planStages({ isPdf: true, options: run.options });
    await runAll(h, run.id, plan);
    const before = h.repos.proposals.listByRun(run.id).length;
    await processStage(
      { runId: run.id, stage: "extract.read_doc" },
      ctx(run.id, "extract.read_doc"),
      h.deps,
    );
    await processStage(
      { runId: run.id, stage: "extract.facts" },
      ctx(run.id, "extract.facts"),
      h.deps,
    );
    expect(h.repos.proposals.listByRun(run.id).length).toBe(before);
    expect(h.repos.readings.listByRun(run.id).filter((r) => r.kind === "model_read")).toHaveLength(
      1,
    );
    expect(h.calls.readDocument).toBe(1);
    expect(h.calls.extractFacts).toBe(1);
  });

  it("falha em extract.digest mantém propostas e deixa o run em review com erro registrado; falha em extract.facts marca error", async () => {
    const h2 = harness(new MockProvider({ errors: { buildDigest: "digest indisponível" } }));
    try {
      const file = addFile(h2, "cv_text.pdf");
      const run = newRun(h2, file.id, { ocr: false, modelRead: false });
      await runAll(h2, run.id, ["ingest.read_text", "ingest.consolidate", "extract.facts"]);
      await expect(
        processStage(
          { runId: run.id, stage: "extract.digest" },
          ctx(run.id, "extract.digest"),
          h2.deps,
        ),
      ).rejects.toThrow(/digest indisponível/);
      await onStageFailed(
        { runId: run.id, stage: "extract.digest" },
        new Error("digest indisponível"),
        h2.deps,
      );
      const after = h2.repos.ingestionRuns.get(run.id);
      expect(after?.status).toBe("review");
      expect(after?.error).toMatch(/digest/i);
      expect(h2.repos.proposals.listByRun(run.id).length).toBeGreaterThan(0);

      const run2 = newRun(h2, file.id, { ocr: false, modelRead: false });
      await onStageFailed(
        { runId: run2.id, stage: "extract.facts" },
        new Error("modelo fora do ar"),
        h2.deps,
      );
      expect(h2.repos.ingestionRuns.get(run2.id)?.status).toBe("error");
      expect(h2.repos.ingestionRuns.get(run2.id)?.error).toContain("modelo fora do ar");
    } finally {
      rmSync(h2.dataDir, { recursive: true, force: true });
    }
  });

  it("readDocument recebe o caminho absoluto dentro de uploads (o modelo só enxerga essa pasta)", async () => {
    let seen = "";
    const spy: Provider = {
      ...new MockProvider(),
      id: "mock",
      detect: () => new MockProvider().detect(),
      openChat: (o) => new MockProvider().openChat(o),
      readDocument: async (i) => {
        seen = i.filePath;
        return new MockProvider().readDocument(i);
      },
      extractFacts: (i) => new MockProvider().extractFacts(i),
      buildDigest: (i) => new MockProvider().buildDigest(i),
      analyzeProfiles: (i) => new MockProvider().analyzeProfiles(i),
      pickFiles: (i) => new MockProvider().pickFiles(i),
      analyzeRepo: (i) => new MockProvider().analyzeRepo(i),
      synthesizeRun: (i) => new MockProvider().synthesizeRun(i),
      checkProposals: (i) => new MockProvider().checkProposals(i),
      chatTitle: (i) => new MockProvider().chatTitle(i),
      postingExtract: (i) => new MockProvider().postingExtract(i),
      postingMerge: (i) => new MockProvider().postingMerge(i),
      postingDuplicate: (i) => new MockProvider().postingDuplicate(i),
      cvGenerate: (i) => new MockProvider().cvGenerate(i),
      coverLetterGenerate: (i) => new MockProvider().coverLetterGenerate(i),
      cvReview: (i) => new MockProvider().cvReview(i),
      complete: (i) => new MockProvider().complete(i),
      getPlanUsage: () => new MockProvider().getPlanUsage(),
      planWindowSnapshot: () => null,
    };
    const h3 = harness(spy);
    try {
      const file = addFile(h3, "cv_text.pdf");
      const run = newRun(h3, file.id, { ocr: false, modelRead: true });
      await runAll(h3, run.id, ["ingest.read_text", "extract.read_doc"]);
      expect(seen).toBe(join(h3.dataDir, file.path));
      expect(seen.startsWith(join(h3.dataDir, "uploads"))).toBe(true);
    } finally {
      rmSync(h3.dataDir, { recursive: true, force: true });
    }
  });
});
