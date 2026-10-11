import {
  addStop,
  candidatePathsForDepth,
  canStartRepo,
  collectGithubMetrics,
  collectRepo,
  DEEPEN_CHARS_FACTOR,
  estimateRun,
  type FetchedFile,
  fetchCompare,
  fetchFiles,
  finishReport,
  GhError,
  type IngestionRunRecord,
  ingestModelsForDepth,
  markRepo,
  mergeCoverage,
  metricsTable,
  newRunReport,
  packContext,
  persistMetrics,
  planCandidates,
  readmeForDepth,
  reanalysisKind,
  reconcileTask,
  resolveIngestSettings,
  reviewCheckTask,
  saveRunSource,
  selectSecondRound,
  shouldBrake,
  splitBudget,
  summarizeCompare,
  synthesisTask,
  TYPICAL_CONTEXT_CHARS,
  unavailableMetrics,
} from "@narnia-jobs/core";
import type {
  FactProposal,
  IngestionDepth,
  RepoAnalysisKind,
  RunReport,
} from "@narnia-jobs/shared";
import { nowUtc } from "@narnia-jobs/shared";
import type { WorkerDeps } from "../pipeline";
import type { TaskHandler } from "../tasks";
import { reconcileRun, reviewCheckRun } from "./review";
import { setRunStatus } from "./status";
import { recordCall } from "./usage";

/**
 * Execução do GitHub em tarefas (F03 §2.1): prepare (0 tokens) → repo × N (uma chamada por repositório; profunda
 * escolhe arquivos antes) → síntese (só relatórios) → reconciliação → conferência → revisão. Cada tarefa relê o run
 * e não faz nada se ele foi cancelado, pausado ou está esperando decisão; o freio é checado antes de cada repositório.
 */

const MAX_CHARS_PER_FILE = 4_000;
const MAX_PICK = 8;
const ACTIVE = new Set(["queued", "running"]);

const runId = (payload: Record<string, unknown>) => String(payload.runId ?? "");

function load(deps: WorkerDeps, id: string): IngestionRunRecord {
  const run = deps.repos.ingestionRuns.get(id);
  if (!run) throw new Error(`Execução não encontrada: ${id}`);
  return run;
}

/** Atualização do relatório sem `await` entre ler e gravar (duas tarefas de repositório podem rodar juntas). */
function updateReport(
  deps: WorkerDeps,
  id: string,
  fn: (r: RunReport) => RunReport,
): RunReport | null {
  const run = deps.repos.ingestionRuns.get(id);
  if (!run?.report) return null;
  const next = fn(run.report);
  deps.repos.ingestionRuns.setReport(id, next);
  return next;
}

function githubErrorMessage(e: unknown): string {
  if (e instanceof GhError) {
    if (e.code === "not_authenticated")
      return "GitHub não conectado: conecte em Configurações › Integrações";
    if (e.code === "rate_limited")
      return "Limite de requisições do GitHub atingido; tente mais tarde ou conecte sua conta";
    if (e.code === "unavailable")
      return e.status && e.status >= 500 ? e.message : "GitHub CLI indisponível no container";
    return `GitHub: ${e.message}`;
  }
  return (e as Error).message || String(e);
}

/* ---------- prepare ---------- */

export const githubPrepare: TaskHandler = async (data, ctx, deps) => {
  const id = runId(data.payload);
  const run = load(deps, id);
  if (run.status !== "estimating" && run.status !== "queued") return { skipped: run.status };
  const depth = run.depth as IngestionDepth;
  const names = run.params.repos ?? [];
  try {
    const gh = deps.gh();
    const viewer = await gh.tryJson<{ login: string }>("user").catch((e) => {
      if (e instanceof GhError && e.code === "not_authenticated") return null;
      throw e;
    });
    if (run.mode === "private" && !viewer) {
      throw new GhError("not_authenticated", "A análise privada exige o GitHub conectado");
    }
    const login = viewer?.login ?? (typeof run.params.login === "string" ? run.params.login : null);
    if (!login)
      throw new GhError("not_authenticated", "Informe o usuário do GitHub para a análise pública");
    await ctx.progress(10);

    const sizes: Array<{ fullName: string; contextChars: number; treeChars: number }> = [];
    const failed: Array<{ fullName: string; reason: string }> = [];
    const empty: string[] = [];
    for (const [i, fullName] of names.entries()) {
      try {
        const c = await collectRepo(gh, fullName, {
          login,
          cloneTree: deps.ghCloneTree?.() ?? null,
        });
        deps.repos.repos.upsert(c.repo);
        const wanted = new Set(candidatePathsForDepth(c.tree.entries, depth));
        const filesChars = c.tree.entries
          .filter((e) => wanted.has(e.path))
          .reduce((n, e) => n + Math.min(e.size, MAX_CHARS_PER_FILE), 0);
        sizes.push({
          fullName,
          contextChars: Math.min(
            TYPICAL_CONTEXT_CHARS[depth] * 2,
            800 + (readmeForDepth(c.readme, depth)?.length ?? 0) + filesChars,
          ),
          treeChars: c.tree.entries.reduce((n, e) => n + e.path.length + 1, 0),
        });
      } catch (e) {
        if (e instanceof GhError && e.code === "empty") empty.push(fullName);
        else failed.push({ fullName, reason: githubErrorMessage(e) });
      }
      await ctx.progress(10 + Math.round((60 * (i + 1)) / Math.max(1, names.length)));
    }
    const ok = sizes.map((s) => s.fullName);
    // métricas são complemento: se o GitHub falhar mesmo após as novas tentativas, a execução segue sem elas
    let metricsNote: string | null = null;
    const metrics = await collectGithubMetrics(gh, { login, repos: ok }).catch((e: unknown) => {
      if (e instanceof GhError && (e.code === "not_authenticated" || e.code === "rate_limited"))
        throw e;
      metricsNote = `Métricas indisponíveis nesta execução: ${githubErrorMessage(e)}`;
      return unavailableMetrics(login);
    });
    persistMetrics(deps.repos, metrics);
    const table = metricsTable(metrics);
    const plan = await deps.provider.getPlanUsage().catch(() => null);

    const settings = resolveIngestSettings(deps.repos.settings);
    const models = ingestModelsForDepth(deps.repos.settings, depth, run.model ?? undefined);
    const est = estimateRun({
      depth,
      models,
      checkEnabled: settings.reviewCheckModelEnabled,
      metricsChars: table.length,
      repos: sizes,
    });
    const amount = run.budget?.amount ?? settings.budgetDefaults[depth];
    const budget = splitBudget({
      amount,
      unit: run.budget?.unit ?? settings.budgetUnit,
      depth,
      repoCount: Math.max(1, ok.length),
      reserve: { synthesis: est.synthesisTokens, check: est.checkTokens },
    });
    const byName = new Map(est.perRepo.map((r) => [r.fullName, r.tokens]));
    let report = newRunReport({
      model: run.model ?? models.repo,
      budget: amount,
      startedAt: null,
      repos: names.map((fullName) => ({ fullName, estimatedTokens: byName.get(fullName) ?? 0 })),
    });
    if (metricsNote) report = { ...report, notes: [...(report.notes ?? []), metricsNote] };
    for (const fullName of empty) {
      report = markRepo(report, fullName, {
        status: "skipped_empty",
        usedTokens: 0,
        stoppedReason: "repositório vazio (sem commits)",
      });
    }
    for (const f of failed) {
      report = markRepo(report, f.fullName, {
        status: "error",
        usedTokens: 0,
        stoppedReason: f.reason,
      });
    }
    deps.repos.ingestionRuns.setParams(id, {
      ...run.params,
      login,
      metricsTable: table,
      planBefore: { utilization: plan?.windows.fiveHour?.utilization ?? null },
      estimateTokens: est.totalTokens,
    });
    deps.repos.ingestionRuns.setBudget(id, budget);
    deps.repos.ingestionRuns.setReport(id, report);
    // GitHub sempre confirma (F03-13): a UI mostra estimativa × orçamento e o diagnóstico do plano
    await setRunStatus(deps, id, ok.length > 0 ? "awaiting_confirmation" : "error", {
      error: ok.length > 0 ? null : (failed[0]?.reason ?? "Nenhum repositório pôde ser coletado"),
    });
    return { repos: ok.length, failed: failed.length, estimate: est.totalTokens };
  } catch (e) {
    await setRunStatus(deps, id, "error", { error: githubErrorMessage(e) });
    return { error: githubErrorMessage(e) };
  }
};

/* ---------- repo ---------- */

function toProposals(out: {
  projects: Array<
    { confidence: number; evidence: { ref: string; quote: string } } & Record<string, unknown>
  >;
  skills: Array<
    { confidence: number; evidence: { ref: string; quote: string } } & Record<string, unknown>
  >;
}) {
  const proposals: FactProposal[] = [];
  const evidence: Array<{ ref: string; quote: string }> = [];
  for (const { confidence, evidence: e, ...data } of out.projects) {
    proposals.push({ kind: "project", confidence, data } as FactProposal);
    evidence.push(e);
  }
  for (const { confidence, evidence: e, ...data } of out.skills) {
    proposals.push({ kind: "skill", confidence, data } as FactProposal);
    evidence.push(e);
  }
  return { proposals, evidence };
}

async function brake(deps: WorkerDeps, id: string, used: number): Promise<void> {
  updateReport(deps, id, (r) =>
    addStop(r, { at: nowUtc(), reason: "orçamento esgotado (125%)", usedTokens: used }),
  );
  await setRunStatus(deps, id, "awaiting_decision");
}

/** Depois de cada repositório: sem pendentes nem em andamento, a síntese roda (idempotente pela chave). */
async function maybeSynthesize(deps: WorkerDeps, id: string): Promise<void> {
  const run = deps.repos.ingestionRuns.get(id);
  if (!run?.report || !ACTIVE.has(run.status)) return;
  const open = run.report.repos.some((r) => r.status === "pending" || r.status === "running");
  if (!open) await deps.enqueueTask(synthesisTask(id));
}

export const githubRepo: TaskHandler = async (data, ctx, deps) => {
  const id = runId(data.payload);
  const fullName = String(data.payload.fullName ?? "");
  const run = load(deps, id);
  if (!ACTIVE.has(run.status)) return { skipped: run.status };
  const entry = run.report?.repos.find((r) => r.fullName === fullName);
  if (entry?.status !== "pending") return { skipped: entry?.status ?? "fora da execução" };
  if (run.status === "queued") await setRunStatus(deps, id, "running");

  const budget = run.budget;
  // relê depois do await acima: outra tarefa em paralelo pode ter começado (correções F03, item 12)
  const fresh = load(deps, id);
  const used = deps.repos.ingestionRuns.usedTokens(id);
  const repoRows = fresh.report?.repos ?? [];
  const reserved = repoRows
    .filter((r) => r.status === "running")
    .reduce((n, r) => n + r.estimatedTokens, 0);
  const own = repoRows.find((r) => r.fullName === fullName)?.estimatedTokens ?? 0;
  if (budget && (shouldBrake(budget, used) || !canStartRepo(budget, used, reserved, own))) {
    if (deps.repos.ingestionRuns.get(id)?.status !== "awaiting_decision")
      await brake(deps, id, used);
    return { braked: true, used };
  }
  updateReport(deps, id, (r) => markRepo(r, fullName, { status: "running", usedTokens: 0 }));

  const depth = run.depth as IngestionDepth;
  const models = ingestModelsForDepth(deps.repos.settings, depth, run.model ?? undefined);
  let analysisId: string | null = null;
  let spent = 0;
  try {
    const gh = deps.gh();
    const login = String(run.params.login ?? "");
    const c = await collectRepo(gh, fullName, { login });
    const repo = deps.repos.repos.upsert(c.repo);
    const previous = deps.repos.repoAnalyses.latestDone(repo.id);
    const rk = reanalysisKind({ previous, headSha: repo.headSha });
    const requested =
      run.params.kind === "deepen" || run.params.kind === "cover" ? run.params.kind : null;
    const kind: RepoAnalysisKind =
      rk === "full" ? "full" : rk === "incremental" ? "incremental" : (requested ?? "deepen");
    const maxChars = MAX_CHARS_PER_FILE * (kind === "deepen" ? DEEPEN_CHARS_FACTOR : 1);
    const ref = repo.headSha ?? repo.defaultBranch ?? "main";
    await ctx.progress(20);

    let paths: string[];
    let diffText: string | null = null;
    if (kind === "incremental" && previous?.headSha && repo.headSha) {
      const diff = await fetchCompare(gh, fullName, previous.headSha, repo.headSha);
      diffText = summarizeCompare(diff, { maxPatchChars: 3_000 });
      const changed = new Set(diff.files.map((f) => f.path));
      paths = planCandidates(c.tree.entries.filter((e) => changed.has(e.path))).map((x) => x.path);
    } else if ((kind === "deepen" || kind === "cover") && previous) {
      paths = selectSecondRound({
        kind,
        candidates: planCandidates(c.tree.entries),
        coverage: previous.coverage,
        max: MAX_PICK,
      }).map((x) => x.path);
    } else {
      paths = candidatePathsForDepth(c.tree.entries, depth);
      if (depth === "deep" && paths.length > 0) {
        const pick = await deps.provider.pickFiles({
          repo: fullName,
          tree: c.tree.entries.map((e) => e.path).slice(0, 2_000),
          candidates: paths,
          maxFiles: MAX_PICK,
          model: models.pick,
        });
        spent += recordCall(
          deps,
          { runId: id, name: `pick:${fullName}`, category: "ingest.github.pick", jobId: ctx.jobId },
          pick,
        );
        const inTree = new Set(c.tree.entries.map((e) => e.path));
        paths = pick.output.files.map((f) => f.path).filter((p) => inTree.has(p));
        // checagem depois de cada chamada: estourou, para antes da próxima chamada deste repositório (item 12)
        const usedNow = deps.repos.ingestionRuns.usedTokens(id);
        if (budget && shouldBrake(budget, usedNow)) {
          updateReport(deps, id, (r) =>
            markRepo(r, fullName, { status: "pending", usedTokens: spent }),
          );
          if (deps.repos.ingestionRuns.get(id)?.status !== "awaiting_decision")
            await brake(deps, id, usedNow);
          return { braked: true, used: usedNow };
        }
      }
    }
    const files: FetchedFile[] = await fetchFiles(gh, fullName, ref, paths, { maxChars });
    await ctx.progress(40);

    const packed = packContext({
      repo: {
        fullName,
        description: repo.description,
        languages: repo.languages,
        topics: repo.topics,
        stars: repo.stars,
        pushedAt: repo.pushedAt,
        isFork: repo.isFork,
      },
      readme: readmeForDepth(c.readme, depth),
      commitMessages: c.userCommits.messages,
      metricsTable: typeof run.params.metricsTable === "string" ? run.params.metricsTable : null,
      files,
      sliceTokens: budget?.perRepo ?? 0,
      maxCharsPerFile: maxChars,
      previousReport: kind === "full" ? null : (previous?.report ?? null),
      diffText,
    });
    saveRunSource(deps.dataDir, id, fullName, packed.text);
    const analysis = deps.repos.repoAnalyses.create({
      repoId: repo.id,
      runId: id,
      depth,
      kind,
      headSha: repo.headSha,
      baseSha: kind === "incremental" ? (previous?.headSha ?? null) : null,
      parentId: previous?.id ?? null,
    });
    analysisId = analysis.id;

    const result = await deps.provider.analyzeRepo({
      repo: fullName,
      context: packed.text,
      model: models.repo,
    });
    spent += recordCall(
      deps,
      { runId: id, name: `repo:${fullName}`, category: "ingest.github.repo", jobId: ctx.jobId },
      result,
    );
    await ctx.progress(80);
    const out = result.output;
    const coverage =
      previous && kind !== "full" ? mergeCoverage(previous.coverage, out.coverage) : out.coverage;
    deps.repos.repoAnalyses.complete(analysis.id, {
      status: "done",
      report: out.report,
      coverage,
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    });
    const keyPoints = [
      ...out.report.highlights,
      ...out.report.stack.map((s) => `Stack: ${s}`),
    ].filter((k) => k.trim().length > 0);
    deps.repos.repoDigests.upsert({
      repoId: repo.id,
      summary: out.report.summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : [out.report.summary],
      sections: [],
      meta: {},
      editedByUser: false,
    });
    const { proposals, evidence } = toProposals(out);
    deps.repos.proposals.insertMany(id, proposals, evidence);
    updateReport(deps, id, (r) => markRepo(r, fullName, { status: "done", usedTokens: spent }));
  } catch (e) {
    const isEmpty = e instanceof GhError && e.code === "empty";
    const reason = isEmpty ? "repositório vazio (sem commits)" : githubErrorMessage(e);
    if (analysisId) deps.repos.repoAnalyses.complete(analysisId, { status: "error" });
    updateReport(deps, id, (r) =>
      markRepo(r, fullName, {
        status: isEmpty ? "skipped_empty" : "error",
        usedTokens: spent,
        stoppedReason: reason,
      }),
    );
  }
  await maybeSynthesize(deps, id);
  return { fullName, usedTokens: spent };
};

/* ---------- síntese ---------- */

export const githubSynthesis: TaskHandler = async (data, ctx, deps) => {
  const id = runId(data.payload);
  const run = load(deps, id);
  if (!ACTIVE.has(run.status)) return { skipped: run.status };
  if (run.report?.finishedAt) return { skipped: "já sintetizada" };
  const depth = run.depth as IngestionDepth;
  const models = ingestModelsForDepth(deps.repos.settings, depth, run.model ?? undefined);
  const reports = deps.repos.repoAnalyses
    .listByRun(id)
    .filter((a) => a.status === "done" && a.report)
    .map((a) => ({
      fullName: deps.repos.repos.get(a.repoId)?.fullName ?? a.repoId,
      report: a.report as NonNullable<typeof a.report>,
    }));
  const table = typeof run.params.metricsTable === "string" ? run.params.metricsTable : "";
  let synthesis: string | null = null;
  let synthesisNote: string | null = null;
  let extra = 0;
  // a síntese é complemento: se o modelo falhar, a revisão segue com as propostas dos repositórios (2026-10-11)
  if (reports.length > 0)
    try {
      saveRunSource(
        deps.dataDir,
        id,
        "synthesis",
        `${reports.map((r) => `## ${r.fullName}\n${JSON.stringify(r.report, null, 1)}`).join("\n\n")}\n\n${table}`,
      );
      const result = await deps.provider.synthesizeRun({
        reports,
        metricsTable: table,
        model: models.synthesis,
      });
      extra = recordCall(
        deps,
        { runId: id, name: "synthesis", category: "ingest.github.synthesis", jobId: ctx.jobId },
        result,
      );
      const proposals: FactProposal[] = [];
      const evidence: Array<{ ref: string; quote: string }> = [];
      for (const { confidence, evidence: e, ...rest } of result.output.skills) {
        proposals.push({ kind: "skill", confidence, data: rest } as FactProposal);
        evidence.push(e);
      }
      if (proposals.length > 0) deps.repos.proposals.insertMany(id, proposals, evidence);
      synthesis = result.output.report.summary;
    } catch (e) {
      synthesisNote = `Síntese indisponível nesta execução: ${(e as Error).message}`;
    }
  updateReport(deps, id, (r) => {
    const done = finishReport(r, { finishedAt: nowUtc(), synthesis, extraUsedTokens: extra });
    return synthesisNote ? { ...done, notes: [...(done.notes ?? []), synthesisNote] } : done;
  });

  // a conversão % → tokens é aprendida por chamada (plan-sampling.ts), não mais por execução
  await deps.enqueueTask(reconcileTask(id));
  return { reports: reports.length };
};

/* ---------- reconciliação e conferência (tarefas do GitHub; CV/texto usam as etapas) ---------- */

export const ingestReconcile: TaskHandler = async (data, _ctx, deps) => {
  const id = runId(data.payload);
  const run = load(deps, id);
  if (!ACTIVE.has(run.status)) return { skipped: run.status };
  const counts = reconcileRun(deps, id);
  await deps.enqueueTask(reviewCheckTask(id));
  return counts;
};

export const ingestReviewCheck: TaskHandler = async (data, ctx, deps) => {
  const id = runId(data.payload);
  const run = load(deps, id);
  if (!ACTIVE.has(run.status)) return { skipped: run.status };
  const counts = await reviewCheckRun(deps, id, ctx.jobId);
  await setRunStatus(deps, id, "review");
  return counts;
};
