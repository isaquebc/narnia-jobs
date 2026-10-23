import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type SeededIds, saveDigest, seedFixture } from "@narnia-jobs/core";
import { MOCK_DIGEST } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, simulateWorker, type TestApp, TOKEN, uploadFixture } from "./helpers";

/**
 * Auditoria pós-F04 · bloco E2 (19a): toda tool publicada pelo `/mcp` tem um `tools/call` de verdade, com dados montados
 * pelo caminho de produção (seed, upload, `POST /api/ingestions`, sessões pelo repositório) e falha de propósito se
 * aparecer tool nova sem caso. Antes, o §6.5 dizia "todas cobertas" e 13 nunca tinham sido chamadas.
 */
type Where = "terminal" | "career" | "clarify" | "fresh";
type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: CallResult) => r.content.map((c) => c.text ?? "").join("\n");

const STORY =
  "Trabalhei quatro anos na Acme Pagamentos liderando o time de checkout, com seis pessoas. Migramos o monolito para serviços em Go e Kafka, reduzimos o tempo de aprovação de pagamentos de 900 ms para 250 ms e o churn caiu 12% no período.";

interface Ctx {
  t: TestApp;
  ids: SeededIds;
  fileId: string;
  runId: string;
  jobId: string;
  /** Preenchidos ao longo da sequência (research_save → research_apply; ingest_text → ingest_confirm). */
  sourceId?: string;
  textRunId?: string;
  /** F06: vaga criada por posting_create e nota do usuário que o recrutador edita. */
  postingId?: string;
  noteId?: string;
  /** F05: documento gerado por cv_generate e o conteúdo lido por cv_get (para o cv_edit). */
  documentId?: string;
  draft?: unknown;
}

interface Case {
  where: Where;
  args: (c: Ctx) => Record<string, unknown>;
  after?: (c: Ctx, out: unknown) => void;
}

const first = (xs: string[], what: string) => {
  const x = xs[0];
  if (!x) throw new Error(`seed sem ${what}`);
  return x;
};

/** Em ordem: algumas dependem do resultado de outras. */
const CASES: Record<string, Case> = {
  profile_list: { where: "career", args: () => ({}) },
  profile_get_card: { where: "career", args: () => ({}) },
  profile_update_emphasis: {
    where: "career",
    args: (c) => ({
      profileId: c.ids.profileId,
      items: [
        { kind: "experience", id: first(c.ids.experienceIds, "experiência"), mode: "highlight" },
      ],
    }),
  },
  profile_update_pitch: {
    where: "career",
    args: (c) => ({ profileId: c.ids.profileId, pitch: "Backend sênior com foco em pagamentos." }),
  },
  profile_create: {
    where: "career",
    args: () => ({
      name: "Liderança",
      targetTitle: "Engineering Manager",
      seniority: "senior",
      area: "Engenharia",
      goal: "promotion",
      market: "BR",
      docLocale: "pt-BR",
    }),
  },
  file_list: { where: "career", args: () => ({}) },
  file_get_digest: { where: "career", args: (c) => ({ fileId: c.fileId }) },
  file_get_text: { where: "career", args: (c) => ({ fileId: c.fileId, from: 0, to: 200 }) },
  ingest_status: { where: "career", args: (c) => ({ runId: c.runId }) },
  ingest_propose: {
    where: "clarify",
    args: (c) => {
      const p = c.t.repos.proposals.listByRun(c.runId)[0];
      if (!p) throw new Error("execução sem propostas");
      return {
        runId: c.runId,
        proposals: [
          {
            proposal: p.proposal,
            evidence: { ref: "conversa", quote: "Acme Ltda — Engenheira de Software Sênior" },
          },
        ],
      };
    },
  },
  evidence_experience_list: { where: "career", args: () => ({ limit: 3 }) },
  evidence_experience_get: {
    where: "career",
    args: (c) => ({ id: first(c.ids.experienceIds, "experiência") }),
  },
  evidence_project_list: { where: "career", args: () => ({}) },
  evidence_project_get: {
    where: "career",
    args: (c) => ({ id: first(c.ids.projectIds, "projeto") }),
  },
  evidence_skill_list: { where: "career", args: () => ({}) },
  evidence_skill_get: { where: "career", args: (c) => ({ id: first(c.ids.skillIds, "skill") }) },
  evidence_education_list: { where: "career", args: () => ({}) },
  evidence_education_get: {
    where: "career",
    args: (c) => ({ id: first(c.ids.educationIds, "formação") }),
  },
  fact_search: { where: "career", args: () => ({ q: "kubernet" }) },
  fact_get: {
    where: "career",
    args: (c) => ({
      refs: [{ kind: "experience", id: first(c.ids.experienceIds, "experiência") }],
    }),
  },
  fact_timeline: { where: "career", args: () => ({ from: "2015" }) },
  fact_unverified: { where: "career", args: () => ({}) },
  fact_gaps: { where: "career", args: () => ({}) },
  fact_verify: {
    where: "career",
    args: (c) => ({ kind: "experience", id: first(c.ids.experienceIds, "experiência") }),
  },
  fact_propose_change: {
    where: "terminal",
    args: (c) => ({
      kind: "experience",
      id: first(c.ids.experienceIds, "experiência"),
      changes: { title: "Tech Lead" },
      reason: "O usuário corrigiu o cargo.",
      quote: "eu era Tech Lead",
    }),
  },
  research_save: {
    where: "career",
    args: () => ({
      url: "https://www.ibge.gov.br/salarios-ti",
      title: "Rendimento médio em TI",
      excerpt: "Faixa de 12 a 16 mil por mês para desenvolvedores sêniores.",
      usedFor: "salary",
    }),
    after: (c, out) => {
      c.sourceId = (out as { id: string }).id;
    },
  },
  research_apply: {
    where: "career",
    args: (c) => ({
      field: "salary",
      sourceId: c.sourceId,
      salary: { min: 12000, max: 16000, currency: "BRL", period: "monthly" },
    }),
  },
  research_list: { where: "career", args: () => ({}) },
  job_status: { where: "career", args: (c) => ({ jobId: c.jobId }) },
  job_list: { where: "career", args: () => ({}) },
  session_get: { where: "career", args: () => ({}) },
  usage_log: {
    where: "terminal",
    args: () => ({
      providerSessionId: "terminal-1",
      turnIndex: 0,
      model: "sonnet",
      inputTokens: 120,
      outputTokens: 40,
    }),
  },
  ingest_text: {
    where: "career",
    args: () => ({ text: STORY }),
    after: (c, out) => {
      c.textRunId = (out as { runId: string }).runId;
    },
  },
  ingest_confirm: { where: "career", args: (c) => ({ runId: c.textRunId }) },
  ingest_file: { where: "career", args: (c) => ({ fileId: c.fileId }) },
  ingest_github: {
    where: "career",
    args: () => ({
      mode: "public",
      repos: ["ana-exemplo/api-pagamentos"],
      depth: "quick",
      login: "ana-exemplo",
    }),
  },
  // F06: vaga e análise
  posting_create: {
    where: "career",
    args: () => ({
      text: `Desenvolvedor(a) Backend Sênior\nEmpresa: Globex · Remoto · CLT\n\nRequisitos:\n${"- Node.js, TypeScript e PostgreSQL\n".repeat(8)}`,
    }),
    after: (c, out) => {
      c.postingId = (out as { postingId: string }).postingId;
      c.noteId = c.t.repos.postingNotes.add(c.postingId, "user", "Falei com a Joana").id;
    },
  },
  posting_get: { where: "career", args: (c) => ({ id: c.postingId }) },
  posting_search: { where: "career", args: () => ({ query: "globex" }) },
  posting_update: {
    where: "career",
    args: (c) => ({ id: c.postingId, fields: { client: "Initech" } }),
  },
  posting_contact_add: {
    where: "career",
    args: (c) => ({ postingId: c.postingId, name: "Joana", origin: "linkedin" }),
  },
  posting_note_add: {
    where: "career",
    args: (c) => ({ postingId: c.postingId, body: "Pede inglês." }),
  },
  posting_note_update: {
    where: "career",
    args: (c) => ({ id: c.noteId, body: "Falei com a Joana; pediu portfólio" }),
  },
  analysis_save: {
    where: "career",
    args: (c) => ({
      postingId: c.postingId,
      analysis: {
        summary: "Boa aderência.",
        profiles: [
          {
            profileId: c.ids.profileId,
            fit: 72,
            rationale: "Backend sênior.",
            confidence: "medium",
          },
        ],
        recommendedProfileId: c.ids.profileId,
        recommendationRationale: "Único perfil.",
        matches: [
          {
            requirement: "Node.js",
            evidence: [{ kind: "skill", id: first(c.ids.skillIds, "skill") }],
            strength: "strong",
          },
        ],
        gaps: [
          {
            requirement: "AWS",
            severity: "minor",
            evidenceChecked: true,
            suggestion: "Estudar AWS.",
          },
        ],
        risks: [],
        atsKeywordsMissing: [],
        likelyQuestions: [],
        studyRecommendations: [],
        cvImprovements: [],
        seniority: { asked: "senior", profile: "senior", note: "Ok." },
      },
    }),
  },
  analysis_get: { where: "career", args: (c) => ({ postingId: c.postingId }) },
  posting_open_analysis: { where: "career", args: (c) => ({ postingId: c.postingId }) },
  // F05: CV (o worker não roda aqui: a versão recebe um conteúdo mínimo para o cv_get e o cv_edit)
  cv_generate: {
    where: "career",
    args: (c) => ({ kind: "cv", profileId: c.ids.profileId, instructions: "liderança" }),
    after: (c, out) => {
      const doc = (out as { documents: Array<{ documentId: string }> }).documents[0];
      if (!doc) throw new Error("cv_generate sem documento");
      c.documentId = doc.documentId;
      const v = c.t.repos.documents.currentVersion(doc.documentId);
      c.t.repos.documents.updateVersion(v?.id as string, {
        status: "ready",
        content: {
          meta: {
            kind: "cv",
            locale: "pt-BR",
            paper: "A4",
            profileId: c.ids.profileId,
            postingId: null,
            generatedAt: "2026-10-16T12:00:00Z",
          },
          header: {
            name: "Ana",
            title: "Engenheira",
            location: null,
            email: null,
            phone: null,
            links: [],
          },
          summary: "Engenheira backend.",
          experiences: [],
          skills: [],
          projects: [],
          education: [],
          languages: [],
          adjacent: [],
          sectionsOrder: ["summary"],
          omitted: [],
          provenance: { factIdsUsed: [], unverifiedFactIds: [] },
        },
      });
    },
  },
  cv_list: { where: "career", args: (c) => ({ profileId: c.ids.profileId }) },
  cv_get: {
    where: "career",
    args: (c) => ({ documentId: c.documentId }),
    after: (c, out) => {
      c.draft = (out as { draft: { cv: unknown } }).draft.cv;
    },
  },
  cv_edit: {
    where: "career",
    args: (c) => ({ documentId: c.documentId, baseVersion: 1, cv: c.draft }),
  },
  ui_suggest_action: {
    where: "career",
    args: (c) => ({
      action: "document.open",
      label: "Abrir o CV",
      params: { documentId: c.documentId },
    }),
  },
  // mudam o estado global ou da sessão: por último
  session_set_category: { where: "fresh", args: () => ({ category: "ingest" }) },
  profile_switch: { where: "terminal", args: (c) => ({ profileId: c.ids.profileId }) },
};

async function connect(t: TestApp, sessionId?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
  if (sessionId) headers["x-narnia-session"] = sessionId;
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: { headers },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-auditoria-e2", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

async function setup(): Promise<{ ctx: Ctx; clients: Record<Where, Client>; published: string[] }> {
  const t = makeTestApp();
  const ids = seedFixture(t.repos, "engineer");
  const { body: file } = await uploadFixture(t);
  const created = await t.api("/api/ingestions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: file.id }),
  });
  const runId = ((await created.json()) as { id: string }).id;
  simulateWorker(t, runId);
  // texto consolidado + registro de contexto como a etapa de digest do worker grava (file_get_text lê dali)
  const source = t.repos.sourceFiles.get(file.id);
  if (!source) throw new Error("arquivo não registrado");
  saveDigest(t.repos, t.dataDir, {
    fileId: file.id,
    sha256: source.sha256,
    text: "Acme Ltda — Engenheira de Software Sênior. Unicamp — Bacharelado em Ciência da Computação.",
    digest: MOCK_DIGEST,
  });
  const jobId = t.repos.jobs.list({}).find((j) => j.parentId === runId)?.id;
  if (!jobId) throw new Error("execução sem jobs");
  // o salário fica pendente de pesquisa para o research_apply ter o que gravar
  t.repos.profiles.update(ids.profileId, { needsResearch: ["salary"] });
  // sempre confirmar: o ingest_text da conversa fica aguardando o ingest_confirm
  await t.api("/api/settings/ingest", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoConfirmBelow: 0 }),
  });
  const session = (category: "career" | "clarify", ingestionRunId: string | null = null) =>
    t.repos.chatSessions.create({
      profileId: ids.profileId,
      category,
      title: category,
      provider: "mock",
      model: "sonnet",
      ingestionRunId,
    }).id;
  const clients: Record<Where, Client> = {
    terminal: await connect(t),
    career: await connect(t, session("career")),
    clarify: await connect(t, session("clarify", runId)),
    fresh: await connect(t, session("career")),
  };
  const published = new Set<string>();
  for (const c of Object.values(clients))
    for (const tool of (await c.listTools()).tools) published.add(tool.name);
  return {
    ctx: { t, ids, fileId: file.id, runId, jobId },
    clients,
    published: [...published].sort(),
  };
}

describe("auditoria E2 · tools/call de todas as tools publicadas pelo /mcp", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("toda tool publicada (terminal, carreira e clarificação) tem um caso nesta lista, e vice-versa", async () => {
    const { ctx, clients, published } = await setup();
    t = ctx.t;
    expect(published).toEqual(Object.keys(CASES).sort());
    for (const c of Object.values(clients)) await c.close();
  });

  it("cada tool responde sem erro com dados do caminho de produção", async () => {
    const { ctx, clients } = await setup();
    t = ctx.t;
    for (const [name, c] of Object.entries(CASES)) {
      const r = (await clients[c.where].callTool({ name, arguments: c.args(ctx) })) as CallResult;
      expect(r.isError, `${name}: ${text(r)}`).toBeFalsy();
      expect(text(r).length, name).toBeGreaterThan(1);
      c.after?.(ctx, JSON.parse(text(r)));
    }
    // efeitos que só a chamada real produz
    expect(ctx.t.repos.profiles.get(ctx.ids.profileId)?.needsResearch).toEqual([]);
    expect(ctx.t.repos.ingestionRuns.get(ctx.textRunId as string)?.status).not.toBe(
      "awaiting_confirmation",
    );
    for (const c of Object.values(clients)) await c.close();
  });
});
