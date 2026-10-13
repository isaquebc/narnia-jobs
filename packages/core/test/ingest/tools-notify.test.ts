import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { IngestError } from "../../src/ingest/errors";
import { syncRunNotifications } from "../../src/ingest/notify";
import { previousRunsForFile, previousRunsForSha } from "../../src/ingest/previous-runs";
import { createIngestTools } from "../../src/ingest/tools";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  repos.users.ensureId();
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-tools-"));
  mkdirSync(join(dataDir, "digests"), { recursive: true });
  writeFileSync(join(dataDir, "digests", "sha-cv.txt"), "0123456789".repeat(1000), "utf8");
  const file = repos.sourceFiles.insert({
    originalName: "cv.pdf",
    mime: "application/pdf",
    size: 10,
    sha256: "sha-cv",
    path: "uploads/sha-cv.pdf",
    kind: "cv",
  });
  repos.digests.upsert({
    fileId: file.id,
    summary: "Resumo do CV",
    keyPoints: ["ponto"],
    sections: [],
    meta: { language: "pt", pages: 1 },
    editedByUser: false,
    textPath: "digests/sha-cv.txt",
  });
  const run = () =>
    repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
  return { repos, dataDir, file, run };
}

describe("F03/M2 tools file.* e ingest.* (definição na F03, exposição na F04)", () => {
  it("file.list: arquivos e repositórios com uma linha cada e se há digest", () => {
    const { repos, dataDir, file } = setup();
    repos.repos.upsert({
      fullName: "ana/api",
      owner: "ana",
      url: "https://github.com/ana/api",
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      languages: {},
      topics: [],
      stars: 0,
      pushedAt: "2026-09-01T00:00:00Z",
      defaultBranch: "main",
      headSha: null,
      relevance: null,
    });
    const tools = createIngestTools(repos, { dataDir });
    const out = tools["file.list"]({});
    expect(out.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectKind: "file",
          id: file.id,
          name: "cv.pdf",
          hasDigest: true,
        }),
        expect.objectContaining({
          subjectKind: "repo",
          name: "ana/api",
          kind: "github",
          hasDigest: false,
        }),
      ]),
    );
  });

  it("file.get_digest devolve o digest do arquivo; exige fileId ou repoId", () => {
    const { repos, dataDir, file } = setup();
    const tools = createIngestTools(repos, { dataDir });
    expect(tools["file.get_digest"]({ fileId: file.id }).digest?.summary).toBe("Resumo do CV");
    expect(() => tools["file.get_digest"]({})).toThrow();
  });

  it("file.get_text devolve o intervalo; recusa mais de 8k chars; arquivo sem texto → erro tipado", () => {
    const { repos, dataDir, file } = setup();
    const tools = createIngestTools(repos, { dataDir });
    expect(tools["file.get_text"]({ fileId: file.id, from: 10, to: 15 })).toEqual({
      text: "01234",
      from: 10,
      to: 15,
      total: 10_000,
    });
    expect(() => tools["file.get_text"]({ fileId: file.id, from: 0, to: 8_001 })).toThrow(/8000/);
    expect(() =>
      tools["file.get_text"]({ fileId: "01a00000-0000-7000-8000-000000000000", from: 0, to: 10 }),
    ).toThrow(IngestError);
  });

  it("ingest.propose ignora identidade sem nenhum dado (não vira item vazio na revisão)", () => {
    const { repos, dataDir, run } = setup();
    const r = run();
    const tools = createIngestTools(repos, { dataDir });
    const res = tools["ingest.propose"]({
      runId: r.id,
      proposals: [
        {
          proposal: { kind: "identity", confidence: 0.3, data: {} },
          evidence: { ref: "text", quote: "meu último salário" },
        },
        {
          proposal: { kind: "skill", confidence: 0.8, data: { name: "Go", category: "language" } },
          evidence: { ref: "text", quote: "Go" },
        },
      ],
    });
    expect(res.added).toBe(1);
    expect(repos.proposals.listByRun(r.id).map((p) => p.proposal.kind)).toEqual(["skill"]);
  });

  it("ingest.propose valida por kind, grava com evidência e recusa run encerrado; ingest.status conta pendentes", () => {
    const { repos, dataDir, run } = setup();
    const r = run();
    const tools = createIngestTools(repos, { dataDir });
    const ok = tools["ingest.propose"]({
      runId: r.id,
      proposals: [
        {
          proposal: { kind: "skill", confidence: 0.8, data: { name: "Go", category: "language" } },
          evidence: { ref: "cv", quote: "Go" },
        },
      ],
    });
    expect(ok.added).toBe(1);
    expect(repos.proposals.listByRun(r.id)[0]?.evidence).toEqual({ ref: "cv", quote: "Go" });
    expect(() =>
      tools["ingest.propose"]({
        runId: r.id,
        proposals: [
          {
            proposal: { kind: "skill", confidence: 0.8, data: { name: "Go" } },
            evidence: { ref: "cv", quote: "Go" },
          },
        ],
      }),
    ).toThrow();
    expect(tools["ingest.status"]({ runId: r.id })).toMatchObject({
      runId: r.id,
      pendingProposals: 1,
      usedTokens: 0,
    });
    repos.ingestionRuns.setStatus(r.id, "done");
    expect(() =>
      tools["ingest.propose"]({
        runId: r.id,
        proposals: [
          {
            proposal: {
              kind: "skill",
              confidence: 0.8,
              data: { name: "Go", category: "language" },
            },
            evidence: { ref: "cv", quote: "Go" },
          },
        ],
      }),
    ).toThrow(IngestError);
  });
});

describe("F03/M2 já lido (previousRuns)", () => {
  it("mesmo sha → execuções anteriores, mais novas primeiro; sha desconhecido → nenhuma", () => {
    const { repos, file, run } = setup();
    const a = run();
    const b = run();
    expect(previousRunsForFile(repos, file.id).map((r) => r.runId)).toEqual([b.id, a.id]);
    expect(previousRunsForSha(repos, "sha-cv")).toHaveLength(2);
    expect(previousRunsForSha(repos, "outro")).toEqual([]);
    expect(previousRunsForFile(repos, file.id)[0]).toEqual({
      runId: b.id,
      status: b.status,
      createdAt: b.createdAt,
    });
  });
});

describe("F03/M2 notificações geradas pela ingestão (F03-10)", () => {
  const open = (repos: Repos) =>
    repos.notifications
      .list()
      .map((n) => n.kind)
      .sort();

  it("revisão pendente (+ conflitos); concluir resolve as pendências e avisa 'concluída'", () => {
    const { repos, run } = setup();
    const r = run();
    const [pid] = repos.proposals.insertMany(r.id, [
      { kind: "skill", confidence: 0.9, data: { name: "Go", category: "language" } },
    ]);
    repos.proposals.setMatch(pid as string, {
      match: "conflict",
      targetId: "01a00000-0000-7000-8000-000000000001",
      conflict: {
        targetId: "01a00000-0000-7000-8000-000000000001",
        fields: [
          { field: "level", current: 3, proposed: 5, currentSource: null, proposedSource: null },
        ],
      },
    });
    repos.ingestionRuns.setStatus(r.id, "review");
    const first = syncRunNotifications(repos, r.id);
    expect(
      first
        .filter((e) => e.created)
        .map((e) => e.notification.kind)
        .sort(),
    ).toEqual(["review.conflicts", "review.pending"]);
    expect(repos.notifications.list().find((n) => n.kind === "review.pending")?.actionUrl).toBe(
      `/ingestao/${r.id}`,
    );
    // idempotente: não duplica
    expect(syncRunNotifications(repos, r.id).every((e) => !e.created)).toBe(true);
    expect(repos.notifications.countUnresolved()).toBe(2);
    repos.ingestionRuns.setStatus(r.id, "done");
    syncRunNotifications(repos, r.id);
    expect(open(repos)).toEqual(["ingestion.done"]);
  });

  it("conflitos resolvidos na revisão somem antes de salvar", () => {
    const { repos, run } = setup();
    const r = run();
    const [pid] = repos.proposals.insertMany(r.id, [
      { kind: "skill", confidence: 0.9, data: { name: "Go", category: "language" } },
    ]);
    repos.proposals.setMatch(pid as string, {
      match: "conflict",
      targetId: "01a00000-0000-7000-8000-000000000001",
      conflict: {
        targetId: "01a00000-0000-7000-8000-000000000001",
        fields: [
          { field: "level", current: 3, proposed: 5, currentSource: null, proposedSource: null },
        ],
      },
    });
    repos.ingestionRuns.setStatus(r.id, "review");
    syncRunNotifications(repos, r.id);
    repos.proposals.setResolution(pid as string, { level: { choice: "keep" } });
    syncRunNotifications(repos, r.id);
    expect(open(repos)).toEqual(["review.pending"]);
  });

  it("aguardando decisão e pausado mantêm a pendência; voltar a rodar resolve; erro e cancelamento", () => {
    const { repos, run } = setup();
    const r = run();
    repos.ingestionRuns.setStatus(r.id, "awaiting_decision");
    syncRunNotifications(repos, r.id);
    expect(open(repos)).toEqual(["ingestion.awaiting_decision"]);
    repos.ingestionRuns.setStatus(r.id, "paused");
    syncRunNotifications(repos, r.id);
    expect(open(repos)).toEqual(["ingestion.awaiting_decision"]);
    repos.ingestionRuns.setStatus(r.id, "running");
    syncRunNotifications(repos, r.id);
    expect(open(repos)).toEqual([]);
    repos.ingestionRuns.setStatus(r.id, "error", { error: "provider fora" });
    syncRunNotifications(repos, r.id);
    expect(repos.notifications.list()[0]).toMatchObject({
      kind: "ingestion.error",
      severity: "error",
    });
    const r2 = run();
    repos.ingestionRuns.setStatus(r2.id, "review");
    syncRunNotifications(repos, r2.id);
    repos.ingestionRuns.setStatus(r2.id, "cancelled");
    syncRunNotifications(repos, r2.id);
    expect(open(repos)).toEqual(["ingestion.error"]);
  });

  it("run inexistente → erro tipado", () => {
    const { repos } = setup();
    expect(() => syncRunNotifications(repos, "01a00000-0000-7000-8000-000000000009")).toThrow(
      IngestError,
    );
  });
});
