import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { planStages, STAGES } from "../../src/ingest/chain";
import { IngestError } from "../../src/ingest/errors";
import {
  cancelRun,
  confirmRun,
  decideRun,
  INGEST_TASKS,
  pendingRepos,
  repoTask,
  reviewCheckTask,
  synthesisTask,
} from "../../src/ingest/github-run";
import { newRunReport } from "../../src/ingest/report";
import {
  GH_HOST_TOKEN_FILE,
  readHostToken,
  resolveGhRuntime,
} from "../../src/ingest/sources/github/runtime";
import { loadRunSources, saveRunSource } from "../../src/ingest/sources-store";
import { HEAD_SHA, LOGIN } from "../../src/testing/fake-gh";

function repos(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

function githubRun(r: Repos, names = ["ana-exemplo/api-pagamentos", "ana-exemplo/painel-web"]) {
  const run = r.ingestionRuns.createGithub({
    provider: "mock",
    mode: "private",
    depth: "quick",
    model: "haiku",
    params: { repos: names, login: LOGIN },
    budget: {
      amount: 15_000,
      unit: "thousand",
      depth: "quick",
      perRepo: 6_000,
      reserve: { synthesis: 2_000, check: 1_000 },
    },
  });
  r.ingestionRuns.setReport(
    run.id,
    newRunReport({
      model: "haiku",
      budget: 15_000,
      startedAt: null,
      repos: names.map((fullName) => ({ fullName, estimatedTokens: 3_000 })),
    }),
  );
  return run;
}

describe("F03/M3 core · cadeia do F01 ganha reconciliação e revisão anti-alucinação", () => {
  it("toda cadeia termina em ingest.reconcile → ingest.review_check, na fila ingest, depois do digest", () => {
    for (const isPdf of [true, false]) {
      const plan = planStages({ isPdf, options: { ocr: true, modelRead: true } });
      expect(plan.slice(-3)).toEqual(["extract.digest", "ingest.reconcile", "ingest.review_check"]);
    }
    expect(STAGES["ingest.reconcile"].queue).toBe("ingest");
    expect(STAGES["ingest.review_check"].order).toBeGreaterThan(STAGES["ingest.reconcile"].order);
  });
});

describe("F03/M3 core · orquestração da execução do GitHub (github-run)", () => {
  it("ids de tarefa sem ':' e chaves por execução e repositório", () => {
    const t = repoTask("run-1", "ana-exemplo/api-pagamentos");
    expect(t).toMatchObject({ queue: "extract", type: INGEST_TASKS.githubRepo });
    expect(t.key).toBe("run-1__ana-exemplo__api-pagamentos");
    expect(t.payload).toEqual({ runId: "run-1", fullName: "ana-exemplo/api-pagamentos" });
    expect(synthesisTask("run-1")).toMatchObject({ queue: "ingest", key: "run-1" });
    expect(reviewCheckTask("run-1").type).toBe(INGEST_TASKS.reviewCheck);
  });

  it("confirmar só a partir de awaiting_confirmation: vira queued e devolve uma tarefa por repositório pendente", () => {
    const r = repos();
    const run = githubRun(r);
    expect(() => confirmRun(r, run.id)).toThrow(IngestError);
    r.ingestionRuns.setStatus(run.id, "awaiting_confirmation");
    const tasks = confirmRun(r, run.id);
    expect(tasks.map((t) => t.payload.fullName)).toEqual([
      "ana-exemplo/api-pagamentos",
      "ana-exemplo/painel-web",
    ]);
    expect(r.ingestionRuns.get(run.id)?.status).toBe("queued");
    expect(() => confirmRun(r, "nao-existe")).toThrow(/não encontrada/);
  });

  it("decisão no freio: continuar soma orçamento e reenfileira só os pendentes", () => {
    const r = repos();
    const run = githubRun(r);
    const report = r.ingestionRuns.get(run.id)?.report;
    if (!report) throw new Error("sem relatório");
    r.ingestionRuns.setReport(run.id, {
      ...report,
      repos: report.repos.map((x, i) =>
        i === 0 ? { ...x, status: "done", usedTokens: 9_000 } : x,
      ),
    });
    r.ingestionRuns.setStatus(run.id, "awaiting_decision");
    expect(pendingRepos(r.ingestionRuns.get(run.id) as never)).toEqual(["ana-exemplo/painel-web"]);
    const d = decideRun(r, run.id, { action: "continue", extraBudget: 10_000 });
    expect(d.status).toBe("running");
    expect(d.tasks.map((t) => t.payload.fullName)).toEqual(["ana-exemplo/painel-web"]);
    expect(r.ingestionRuns.get(run.id)?.budget?.amount).toBe(25_000);
  });

  it("encerrar marca pendentes como pulados por orçamento e pede a síntese; depois pausa", () => {
    const r = repos();
    const run = githubRun(r);
    r.ingestionRuns.setStatus(run.id, "awaiting_decision");
    const later = decideRun(r, run.id, { action: "later" });
    expect(later).toEqual({ status: "paused", tasks: [] });
    const fin = decideRun(r, run.id, { action: "finish" });
    expect(fin.tasks.map((t) => t.type)).toEqual([INGEST_TASKS.githubSynthesis]);
    const rep = r.ingestionRuns.get(run.id)?.report;
    expect(rep?.repos.every((x) => x.status === "skipped_budget")).toBe(true);
    expect(() => decideRun(r, run.id, { action: "later" })).toThrow(/não espera decisão/);
  });

  it("cancelar fecha a execução e não reabre execuções terminais", () => {
    const r = repos();
    const run = githubRun(r);
    cancelRun(r, run.id);
    expect(r.ingestionRuns.get(run.id)?.status).toBe("cancelled");
    expect(() => cancelRun(r, run.id)).toThrow(IngestError);
  });

  it("sem relatório, os pendentes são os repositórios dos parâmetros", () => {
    const r = repos();
    const run = r.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/b"] },
      budget: {
        amount: 1,
        unit: "thousand",
        depth: "quick",
        perRepo: 1,
        reserve: { synthesis: 0, check: 0 },
      },
    });
    expect(pendingRepos(run)).toEqual(["a/b"]);
  });

  it("setParams grava parâmetros extras sem perder os repositórios", () => {
    const r = repos();
    const run = githubRun(r);
    r.ingestionRuns.setParams(run.id, { ...run.params, metricsTable: "tabela" });
    expect(r.ingestionRuns.get(run.id)?.params).toMatchObject({
      metricsTable: "tabela",
      login: LOGIN,
    });
  });
});

describe("F03/M3 core · credencial do gh em runtime (F03-1)", () => {
  it("lê o token do host do volume e nunca o expõe no cliente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-gh-"));
    expect(readHostToken(dir)).toBeNull();
    writeFileSync(join(dir, GH_HOST_TOKEN_FILE), "gho_tokenSecreto123\n", { mode: 0o600 });
    expect(readHostToken(dir)).toBe("gho_tokenSecreto123");
    const r = repos();
    const host = resolveGhRuntime({ settings: r.settings, configDir: dir });
    expect(host.source).toBe("host");
    expect(JSON.stringify(host)).not.toContain("tokenSecreto");
    r.settings.set("github.auth", "app");
    expect(resolveGhRuntime({ settings: r.settings, configDir: dir }).source).toBe("app");
  });

  it("host sem token cai no login próprio; com o mock usa o gh falso com estado em arquivo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-gh-"));
    const r = repos();
    expect(resolveGhRuntime({ settings: r.settings, configDir: dir }).source).toBe("app");
    const stateFile = join(dir, ".gh-fake.json");
    writeFileSync(
      stateFile,
      JSON.stringify({ heads: { "ana-exemplo/api-pagamentos": "f".repeat(40) } }),
    );
    const fake = resolveGhRuntime({ settings: r.settings, configDir: dir, fake: { stateFile } });
    expect(fake.source).toBe("fake");
    const head = await fake.client.json<{ sha: string }>(
      "repos/ana-exemplo/api-pagamentos/commits/main",
    );
    expect(head.sha).toBe("f".repeat(40));
    expect(head.sha).not.toBe(HEAD_SHA);
  });
});

describe("F03/M3 core · fontes da revisão anti-alucinação por execução", () => {
  it("guarda o que foi enviado ao modelo e devolve por nome, com aliases cv/text para o consolidado", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "narnia-src-"));
    saveRunSource(
      dataDir,
      "run-1",
      "ana-exemplo/api-pagamentos",
      "## README.md\nAPI de pagamentos",
    );
    saveRunSource(dataDir, "run-1", "consolidated", "Acme Ltda — Engenheira");
    const s = loadRunSources(dataDir, "run-1");
    expect(s["ana-exemplo/api-pagamentos"]).toContain("API de pagamentos");
    expect(s.cv).toBe("Acme Ltda — Engenheira");
    expect(s.text).toBe("Acme Ltda — Engenheira");
    expect(loadRunSources(dataDir, "sem-run")).toEqual({});
    expect(() => saveRunSource(dataDir, "run-1", "../fora", "x")).not.toThrow();
    expect(Object.keys(loadRunSources(dataDir, "run-1"))).not.toContain("../fora");
  });
});
