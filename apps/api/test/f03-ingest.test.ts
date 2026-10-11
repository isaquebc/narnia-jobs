import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyReconciliation,
  GH_HOST_TOKEN_FILE,
  INGEST_TASKS,
  newRunReport,
  syncRunNotifications,
} from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, uploadFixture, VALID_PROFILE } from "./helpers";

const REPOS = [
  "ana-exemplo/api-pagamentos",
  "ana-exemplo/painel-web",
  "ana-exemplo/notas-privadas",
];
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const put = (body: unknown): RequestInit => ({ ...json(body), method: "PUT" });
// biome-ignore lint/suspicious/noExplicitAny: corpo de resposta lido de forma solta nos testes
type Body = any;
const jsonOf = async (r: Response | Promise<Response>): Promise<Body> => (await r).json();

async function createGithubRun(t: TestApp, extra: Record<string, unknown> = {}) {
  const res = await t.api(
    "/api/ingestions",
    json({
      source: "github",
      mode: "private",
      repos: REPOS,
      depth: "quick",
      model: "haiku",
      ...extra,
    }),
  );
  return { res, body: (await res.json()) as { id: string; source: string; status: string } };
}

/** O que o `prepare` do worker deixa pronto: relatório com os repositórios pendentes. */
function prepared(t: TestApp, runId: string) {
  t.repos.ingestionRuns.setReport(
    runId,
    newRunReport({
      model: "haiku",
      budget: 15_000,
      startedAt: null,
      repos: REPOS.map((fullName) => ({ fullName, estimatedTokens: 3_000 })),
    }),
  );
  t.repos.ingestionRuns.setStatus(runId, "awaiting_confirmation");
}

describe("F03/M3 api · conexão do GitHub (F03-1)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("estado da credencial sem nunca expor o token; troca de origem; fluxo de dispositivo; desconectar", async () => {
    t = makeTestApp();
    writeFileSync(join(t.ghConfigDir, GH_HOST_TOKEN_FILE), "gho_SEGREDO123456", { mode: 0o600 });
    const s = await t.api("/api/github/auth");
    const text = await s.text();
    expect(text).not.toContain("gho_SEGREDO");
    expect(JSON.parse(text)).toMatchObject({
      source: "host",
      connected: true,
      login: "ana-exemplo",
      hostAvailable: true,
    });
    expect((await jsonOf(t.api("/api/github/auth", put({ source: "app" })))).source).toBe("app");

    const dev = await t.api("/api/github/auth/device", json({}));
    expect(dev.status).toBe(202);
    const device = (await dev.json()) as {
      code: string;
      verificationUri: string;
      expiresAt: string;
    };
    expect(device.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(device.verificationUri).toBe("https://github.com/login/device");
    expect(Date.parse(device.expiresAt)).toBeGreaterThan(Date.now());
    await t.api("/api/_test/github", json({ deviceComplete: true }));
    const done = t.events.find((e) => e.type === "github.auth_updated");
    expect(done).toMatchObject({ status: { connected: true, source: "app" } });

    expect((await t.api("/api/github/auth", { method: "DELETE" })).status).toBe(200);
    expect((await jsonOf(t.api("/api/github/auth"))).connected).toBe(false);
    const logs = readdirSync(join(t.dataDir, "logs")).map((f) =>
      readFileSync(join(t.dataDir, "logs", f), "utf8"),
    );
    for (const l of logs) expect(l).not.toContain("gho_SEGREDO");
  });
});

describe("F03/M3 api · seletor, plano e estimativa", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("preview privado agrupa Pessoais e organizações; sem login 409; rate limit 429; público com usuário", async () => {
    t = makeTestApp();
    const ok = await t.api("/api/sources/github/preview", json({ mode: "private" }));
    const body = (await ok.json()) as {
      authenticated: boolean;
      groups: Array<{ kind: string; repos: unknown[] }>;
    };
    expect(body.authenticated).toBe(true);
    expect(body.groups[0]?.kind).toBe("personal");
    expect(body.groups.length).toBeGreaterThan(1);
    await t.api("/api/_test/github", json({ rateLimited: true }));
    const limited = await t.api("/api/sources/github/preview", json({ mode: "private" }));
    expect(limited.status).toBe(429);
    expect((await jsonOf(limited)).error.code).toBe("github_rate_limited");
    await t.api("/api/_test/github", json({ rateLimited: false, authenticated: false }));
    const anon = await t.api("/api/sources/github/preview", json({ mode: "private" }));
    expect(anon.status).toBe(409);
    expect((await jsonOf(anon)).error.code).toBe("github_not_connected");
    const pub = await t.api(
      "/api/sources/github/preview",
      json({ mode: "public", login: "ana-exemplo" }),
    );
    expect(pub.status).toBe(200);
  });

  it("diagnóstico do plano pelo provider; null quando indisponível", async () => {
    t = makeTestApp();
    expect((await jsonOf(t.api("/api/plan/usage"))).usage.subscription).toBe("max");
    t.provider.setMode({ planUsage: null });
    expect((await jsonOf(t.api("/api/plan/usage"))).usage).toBeNull();
  });

  it("estimativa do GitHub com orçamento recomendado e fatia; CV pequeno autoconfirma (F03-13)", async () => {
    t = makeTestApp();
    const gh = await t.api(
      "/api/ingestions/estimate",
      json({ source: "github", mode: "private", repos: REPOS, depth: "quick", model: "haiku" }),
    );
    const g = (await gh.json()) as Record<string, unknown>;
    expect(g.totalTokens).toBeGreaterThan(0);
    expect(g.recommendedBudget).toBeLessThanOrEqual(15_000);
    expect(g.perRepo).toBeGreaterThan(0);
    expect(g.autoConfirm).toBe(false);
    expect(g.approximate).toBe(true);
    const { body: file } = await uploadFixture(t);
    const cv = (await jsonOf(
      t.api("/api/ingestions/estimate", json({ source: "cv", fileId: file.id })),
    )) as {
      totalTokens: number;
      autoConfirm: boolean;
    };
    expect(cv.autoConfirm).toBe(cv.totalTokens < 10_000);
  });
});

describe("F03/M3 api · execução do GitHub", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("criar enfileira o prepare; lista por fonte; confirmar enfileira um repositório por tarefa", async () => {
    t = makeTestApp();
    const { res, body } = await createGithubRun(t);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ source: "github", status: "estimating" });
    expect(t.queue.tasks.map((x) => x.type)).toEqual([INGEST_TASKS.githubPrepare]);
    const list = (await jsonOf(t.api("/api/ingestions?source=github"))) as {
      runs: Array<{ id: string }>;
    };
    expect(list.runs.map((r) => r.id)).toEqual([body.id]);
    expect((await t.api(`/api/ingestions/${body.id}/confirm`, json({}))).status).toBe(409);
    prepared(t, body.id);
    const c = await t.api(`/api/ingestions/${body.id}/confirm`, json({}));
    expect(c.status).toBe(200);
    expect(t.queue.tasks.filter((x) => x.type === INGEST_TASKS.githubRepo)).toHaveLength(3);
    expect(t.events.some((e) => e.type === "ingestion.updated")).toBe(true);
    const detail = (await jsonOf(t.api(`/api/ingestions/${body.id}`))) as Record<string, unknown>;
    expect(detail).toMatchObject({ source: "github", mode: "private", status: "queued" });
    expect(detail.report).toBeTruthy();
  });

  it("decisão no freio, cancelamento e erros de estado", async () => {
    t = makeTestApp();
    const { body } = await createGithubRun(t);
    prepared(t, body.id);
    t.repos.ingestionRuns.setStatus(body.id, "awaiting_decision");
    const later = await t.api(`/api/ingestions/${body.id}/decision`, json({ action: "later" }));
    expect((await jsonOf(later)).status).toBe("paused");
    const cont = await t.api(
      `/api/ingestions/${body.id}/decision`,
      json({ action: "continue", extraBudget: 20_000 }),
    );
    expect(cont.status).toBe(200);
    expect(t.queue.tasks.filter((x) => x.type === INGEST_TASKS.githubRepo)).toHaveLength(3);
    expect(t.repos.ingestionRuns.get(body.id)?.budget?.amount).toBeGreaterThan(20_000);
    expect(
      (await t.api(`/api/ingestions/${body.id}/decision`, json({ action: "later" }))).status,
    ).toBe(409);
    expect((await t.api(`/api/ingestions/${body.id}/cancel`, json({}))).status).toBe(200);
    expect(t.repos.ingestionRuns.get(body.id)?.status).toBe("cancelled");
    expect((await t.api(`/api/ingestions/${body.id}/cancel`, json({}))).status).toBe(409);
    expect((await t.api("/api/ingestions/nao-existe/cancel", json({}))).status).toBe(404);
  });

  it("retry de execução do GitHub com erro volta a preparar", async () => {
    t = makeTestApp();
    const { body } = await createGithubRun(t);
    t.repos.ingestionRuns.setStatus(body.id, "error", { error: "falhou" });
    const r = await t.api(`/api/ingestions/${body.id}/retry`, json({}));
    expect(r.status).toBe(200);
    expect(t.repos.ingestionRuns.get(body.id)?.status).toBe("estimating");
  });
});

describe("F03/M3 api · revisão com conflitos, tags e já lido", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("propostas trazem reconciliação; conflito sem resolução → 422; resolvido salva; tags só no perfil marcado", async () => {
    t = makeTestApp();
    const { body: file } = await uploadFixture(t);
    const run = t.repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    t.repos.facts.experiences.insert({
      company: "Acme Ltda",
      title: "Engenheira",
      startDate: "2021-03",
      isCurrent: true,
      tech: [],
      confidence: 1,
      verified: true,
    });
    const [conflictId, skillId] = t.repos.proposals.insertMany(
      run.id,
      [
        {
          kind: "experience",
          confidence: 0.9,
          data: {
            company: "Acme",
            title: "Engenheira Sênior",
            startDate: "2021-03",
            isCurrent: true,
            tech: [],
          },
        },
        { kind: "skill", confidence: 0.9, data: { name: "Rust", category: "language" } },
      ],
      [{ ref: "cv", quote: "Acme" }, null],
    );
    applyReconciliation(t.repos, run.id);
    t.repos.ingestionRuns.setStatus(run.id, "review");
    const list = (await jsonOf(t.api(`/api/ingestions/${run.id}/proposals`))) as {
      proposals: Array<{
        id: string;
        match: string;
        conflict: unknown;
        evidence: unknown;
        checkStatus: string;
      }>;
    };
    const c = list.proposals.find((p) => p.id === conflictId);
    expect(c?.match).toBe("conflict");
    expect(c?.conflict).toBeTruthy();
    expect(c?.evidence).toEqual({ ref: "cv", quote: "Acme" });
    const bad = await t.api(
      `/api/ingestions/${run.id}/review`,
      json({ decisions: [{ proposalId: conflictId, decision: "accepted" }] }),
    );
    expect(bad.status).toBe(422);
    expect((await jsonOf(bad)).error.code).toBe("conflict_unresolved");

    const profile = (await (
      await t.api("/api/profiles", json({ ...VALID_PROFILE, activate: true }))
    ).json()) as { id: string };
    const other = (await (
      await t.api(
        "/api/profiles",
        json({ ...VALID_PROFILE, name: "PM", targetTitle: "Product Manager" }),
      )
    ).json()) as { id: string };
    const ok = await t.api(
      `/api/ingestions/${run.id}/review`,
      json({
        decisions: [
          {
            proposalId: conflictId,
            decision: "accepted",
            resolution: { title: { choice: "use_new" } },
          },
          { proposalId: skillId, decision: "accepted", profiles: [other.id] },
        ],
      }),
    );
    expect(ok.status).toBe(200);
    expect(t.repos.facts.experiences.list()).toHaveLength(1);
    expect(t.repos.facts.experiences.list()[0]?.title).toBe("Engenheira Sênior");
    const rust = t.repos.facts.skills.list().find((s) => s.name === "Rust");
    expect(
      t.repos.emphasis.list(other.id).some((e) => e.factId === rust?.id && e.mode === "highlight"),
    ).toBe(true);
    expect(t.repos.emphasis.list(profile.id).some((e) => e.factId === rust?.id)).toBe(false);
  });

  it("reenviar o mesmo arquivo informa execuções anteriores (já lido); digest do arquivo editável", async () => {
    t = makeTestApp();
    const { body: file } = await uploadFixture(t);
    await t.api(
      "/api/ingestions",
      json({ fileId: file.id, options: { ocr: false, modelRead: false } }),
    );
    const { res, body } = await uploadFixture(t);
    expect(res.status).toBe(200);
    expect((body as unknown as { previousRuns: unknown[] }).previousRuns).toHaveLength(1);
    t.repos.digests.upsert({
      fileId: file.id,
      summary: "Resumo",
      keyPoints: ["a"],
      sections: [],
      meta: {},
      editedByUser: false,
      textPath: null,
    });
    const put1 = await t.api(
      `/api/files/${file.id}/digest`,
      put({ summary: "Resumo editado", keyPoints: ["b"], sections: [], meta: {} }),
    );
    expect(put1.status).toBe(200);
    expect((await jsonOf(t.api(`/api/files/${file.id}/digest`))).digest).toMatchObject({
      summary: "Resumo editado",
      editedByUser: true,
    });
  });
});

describe("F03/M3 api · repositórios, notificações, snapshots e configurações", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("repositórios com análises, digest editável, métricas e reanálise", async () => {
    t = makeTestApp();
    const repo = t.repos.repos.upsert({
      fullName: "ana-exemplo/api-pagamentos",
      owner: "ana-exemplo",
      url: "https://github.com/ana-exemplo/api-pagamentos",
      description: "API",
      isPrivate: false,
      isFork: false,
      isArchived: false,
      languages: { TypeScript: 100 },
      topics: [],
      stars: 1,
      pushedAt: null,
      defaultBranch: "main",
      headSha: "a".repeat(40),
      relevance: 0.5,
    });
    t.repos.repoDigests.upsert({
      repoId: repo.id,
      summary: "API de pagamentos",
      keyPoints: ["TS"],
      sections: [],
      meta: {},
      editedByUser: false,
    });
    expect(((await jsonOf(t.api("/api/repos"))) as { repos: unknown[] }).repos).toHaveLength(1);
    const d = (await jsonOf(t.api(`/api/repos/${repo.id}`))) as Record<string, unknown>;
    expect(d).toMatchObject({
      repo: { id: repo.id },
      digest: { summary: "API de pagamentos" },
      analyses: [],
    });
    await t.api(
      `/api/repos/${repo.id}/digest`,
      put({ summary: "Editado", keyPoints: ["x"], sections: [], meta: {} }),
    );
    expect(t.repos.repoDigests.get(repo.id)?.editedByUser).toBe(true);
    const re = await t.api(`/api/repos/${repo.id}/reanalyze`, json({ kind: "cover" }));
    expect(re.status).toBe(201);
    const run = t.repos.ingestionRuns.get(((await re.json()) as { id: string }).id);
    expect(run?.params).toMatchObject({ repos: [repo.fullName], kind: "cover" });
    expect(t.queue.tasks.at(-1)?.type).toBe(INGEST_TASKS.githubPrepare);
    expect((await t.api("/api/repos/nao-existe")).status).toBe(404);
  });

  it("notificações: lista abertas com contagem, marcar como lida, dispensar esconde sem resolver", async () => {
    t = makeTestApp();
    const { body } = await createGithubRun(t);
    t.repos.ingestionRuns.setStatus(body.id, "awaiting_decision");
    syncRunNotifications(t.repos, body.id);
    const l = (await jsonOf(t.api("/api/notifications"))) as {
      notifications: Array<{ id: string; kind: string }>;
      unresolved: number;
    };
    expect(l.unresolved).toBe(1);
    const n = l.notifications[0] as { id: string };
    expect((await t.api(`/api/notifications/${n.id}/read`, json({}))).status).toBe(200);
    expect((await t.api(`/api/notifications/${n.id}/dismiss`, json({}))).status).toBe(200);
    const after = (await jsonOf(t.api("/api/notifications?status=open"))) as {
      notifications: unknown[];
    };
    expect(after.notifications).toHaveLength(0);
    expect((await t.api("/api/notifications/nao-existe/read", json({}))).status).toBe(404);
  });

  it("sem rede: o preview responde pelo snapshot da listagem anterior (F03-9)", async () => {
    t = makeTestApp();
    const first = await t.api("/api/sources/github/preview", json({ mode: "private" }));
    expect(first.status).toBe(200);
    await t.api("/api/_test/github", json({ offline: true }));
    const again = await t.api("/api/sources/github/preview", json({ mode: "private" }));
    expect(again.status).toBe(200);
    const snaps = (await (await t.api("/api/snapshots")).json()) as {
      snapshots: Array<{ ref: string }>;
    };
    expect(snaps.snapshots.length).toBeGreaterThan(0);
  });

  it("snapshots e configurações da ingestão", async () => {
    t = makeTestApp();
    expect(await jsonOf(t.api("/api/snapshots"))).toMatchObject({ snapshots: [], totalBytes: 0 });
    expect((await t.api("/api/snapshots/nao-existe", { method: "DELETE" })).status).toBe(404);
    const s = (await jsonOf(t.api("/api/settings/ingest"))) as Record<string, unknown>;
    expect(s).toMatchObject({
      autoConfirmBelow: 10_000,
      reviewCheckModelEnabled: true,
      githubAuth: "host",
    });
    const upd = await t.api(
      "/api/settings/ingest",
      put({ reviewCheckModelEnabled: false, autoConfirmBelow: 0 }),
    );
    expect(await jsonOf(upd)).toMatchObject({
      reviewCheckModelEnabled: false,
      autoConfirmBelow: 0,
    });
  });
});

describe('Regressão 2026-10-11 · tarefa que falha de vez não deixa a execução em "Analisando"', () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("retry da execução com tarefa falha reenfileira só essa tarefa e volta a rodar", async () => {
    t = makeTestApp();
    const { body } = await createGithubRun(t);
    const run = t.repos.ingestionRuns.get(body.id);
    t.repos.ingestionRuns.setParams(body.id, {
      ...run?.params,
      failedTask: {
        queue: "ingest",
        type: "ingest.github.synthesis",
        key: body.id,
        payload: { runId: body.id },
      },
    });
    t.repos.ingestionRuns.setStatus(body.id, "error", { error: "Síntese: limite de turnos" });
    t.queue.tasks.length = 0;
    const r = await t.api(`/api/ingestions/${body.id}/retry`, json({}));
    expect(r.status).toBe(200);
    expect(t.queue.tasks.map((x) => x.type)).toEqual(["ingest.github.synthesis"]);
    const after = t.repos.ingestionRuns.get(body.id);
    expect(after?.status).toBe("running");
    expect(after?.params.failedTask).toBeUndefined();
  });

  it('retry de um job de tarefa na bandeja devolve a execução com erro a "running"', async () => {
    t = makeTestApp();
    const { body } = await createGithubRun(t);
    const jobId = `task__ingest.github.synthesis__${body.id}`;
    const at = new Date().toISOString();
    t.repos.jobs.upsertQueued({
      id: jobId,
      queue: "ingest",
      type: "ingest.github.synthesis",
      parentId: null,
      profileId: null,
      // formato real do espelho (enqueueTask grava a tarefa inteira; o runId fica em payload.payload)
      payload: {
        kind: "task",
        type: "ingest.github.synthesis",
        key: body.id,
        payload: { runId: body.id },
      },
      stage: "ingest.github.synthesis",
      at,
    });
    t.repos.jobs.applyEvent({ jobId, type: "failed", at, error: "limite de turnos" });
    t.repos.ingestionRuns.setStatus(body.id, "error", { error: "Síntese: limite de turnos" });
    const r = await t.api(`/api/jobs/${jobId}/retry`, json({}));
    expect(r.status).toBe(200);
    expect(t.repos.ingestionRuns.get(body.id)?.status).toBe("running");
  });
});

describe("Regressão 2026-10-11 · execução presa antes da correção se recupera ao abrir", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("running sem job ativo e com tarefa em erro vira erro com a tarefa guardada; o retry refaz só ela", async () => {
    t = makeTestApp();
    const { body } = await createGithubRun(t);
    // como na instância do dono: a preparação já terminou
    for (const j of t.repos.jobs.list({ status: "queued" }))
      t.repos.jobs.applyEvent({ jobId: j.id, type: "completed", at: new Date().toISOString() });
    t.repos.ingestionRuns.setStatus(body.id, "running");
    const at = new Date().toISOString();
    const jobId = `task__ingest.github.synthesis__${body.id}`;
    t.repos.jobs.upsertQueued({
      id: jobId,
      queue: "ingest",
      type: "ingest.github.synthesis",
      parentId: null,
      profileId: null,
      // formato real do espelho (enqueueTask grava a tarefa inteira; o runId fica em payload.payload)
      payload: {
        kind: "task",
        type: "ingest.github.synthesis",
        key: body.id,
        payload: { runId: body.id },
      },
      stage: "ingest.github.synthesis",
      at,
    });
    t.repos.jobs.applyEvent({
      jobId,
      type: "failed",
      at,
      error: "Reached maximum number of turns (1)",
    });
    const r = await t.api(`/api/ingestions/${body.id}`);
    expect(r.status).toBe(200);
    const run = t.repos.ingestionRuns.get(body.id);
    expect(run?.status).toBe("error");
    expect(run?.error).toMatch(/turns/);
    t.queue.tasks.length = 0;
    expect((await t.api(`/api/ingestions/${body.id}/retry`, json({}))).status).toBe(200);
    expect(t.queue.tasks.map((x) => x.type)).toEqual(["ingest.github.synthesis"]);
  });

  it("running com job ativo não é tocada", async () => {
    t = makeTestApp();
    const { body } = await createGithubRun(t);
    t.repos.ingestionRuns.setStatus(body.id, "running");
    const at = new Date().toISOString();
    t.repos.jobs.upsertQueued({
      id: `task__ingest.github.repo__${body.id}__a`,
      queue: "ingest",
      type: "ingest.github.repo",
      parentId: null,
      profileId: null,
      // formato real do espelho (enqueueTask grava a tarefa inteira; o runId fica em payload.payload)
      payload: {
        kind: "task",
        type: "ingest.github.repo",
        key: body.id,
        payload: { runId: body.id },
      },
      stage: "ingest.github.repo",
      at,
    });
    await t.api(`/api/ingestions/${body.id}`);
    expect(t.repos.ingestionRuns.get(body.id)?.status).toBe("running");
  });
});
