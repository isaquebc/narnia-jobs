import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN, uploadFixture } from "./helpers";

/**
 * Auditoria pós-F04 · bloco E1 (lacunas do plano no chat): ingestão pela conversa com estimativa e confirmação (§1.4,
 * §7), valor pesquisado que entra no perfil após confirmação (§1.5, §3), fonte fora da lista confirmada pelo usuário
 * (F04-5), `evidence.skill/education.get` (§2.3) e Configurações › Modo plugin (§4).
 */
async function connect(t: TestApp, sessionId?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
  if (sessionId) headers["x-narnia-session"] = sessionId;
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: { headers },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-auditoria-e1", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: unknown) => (r as CallResult).content.map((c) => c.text ?? "").join("\n");
const isError = (r: unknown) => (r as CallResult).isError === true;
const json = <T>(r: unknown) => JSON.parse(text(r)) as T;

function session(t: TestApp, profileId: string, category: "career" | "ingest" = "career") {
  return t.repos.chatSessions.create({
    profileId,
    category,
    title: "x",
    provider: "mock",
    model: "sonnet",
  });
}

const setThreshold = (t: TestApp, tokens: number) =>
  t.api("/api/settings/ingest", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoConfirmBelow: tokens }),
  });

const STORY =
  "Trabalhei quatro anos na Acme Pagamentos liderando o time de checkout, com seis pessoas. Migramos o monolito para serviços em Go e Kafka, reduzimos o tempo de aprovação de pagamentos de 900 ms para 250 ms e o churn caiu 12% no período.";

describe("auditoria E1 · ingestão pela conversa com estimativa e confirmação", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("abaixo do limite começa na hora; acima fica aguardando confirmação, sem enfileirar", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const s = session(t, ids.profileId);
    const client = await connect(t, s.id);
    const small = await client.callTool({ name: "ingest_text", arguments: { text: STORY } });
    expect(isError(small), text(small)).toBe(false);
    expect(json<{ needsConfirmation: boolean; status: string }>(small)).toMatchObject({
      needsConfirmation: false,
      status: "queued",
    });

    expect((await setThreshold(t, 1)).status).toBe(200);
    const before = t.queue.enqueued.length;
    const big = await client.callTool({
      name: "ingest_text",
      arguments: { text: `${STORY} Outra parte da história, diferente da primeira.` },
    });
    const out = json<{
      runId: string;
      needsConfirmation: boolean;
      status: string;
      estimatedTokens: number;
    }>(big);
    expect(out).toMatchObject({ needsConfirmation: true, status: "awaiting_confirmation" });
    expect(out.estimatedTokens).toBeGreaterThan(0);
    expect(t.queue.enqueued.length).toBe(before);
    expect(t.repos.ingestionRuns.get(out.runId)?.status).toBe("awaiting_confirmation");
    await client.close();
  });

  it("ingest_confirm enfileira só a execução criada por esta conversa", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    await setThreshold(t, 1);
    const mine = session(t, ids.profileId);
    const other = session(t, ids.profileId);
    const a = await connect(t, mine.id);
    const created = json<{ runId: string }>(
      await a.callTool({ name: "ingest_text", arguments: { text: STORY } }),
    );
    const b = await connect(t, other.id);
    const denied = await b.callTool({
      name: "ingest_confirm",
      arguments: { runId: created.runId },
    });
    expect(isError(denied)).toBe(true);
    expect(text(denied)).toContain("run_not_in_session");

    const ok = await a.callTool({ name: "ingest_confirm", arguments: { runId: created.runId } });
    expect(isError(ok), text(ok)).toBe(false);
    expect(json<{ status: string }>(ok).status).toBe("queued");
    expect(t.queue.enqueued.some((e) => e.runId === created.runId)).toBe(true);
    const again = await a.callTool({ name: "ingest_confirm", arguments: { runId: created.runId } });
    expect(text(again)).toContain("invalid_state");
    await a.close();
    await b.close();
  });

  it("a tela confirma a execução de texto/arquivo pela rota de sempre", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    await setThreshold(t, 1);
    const s = session(t, ids.profileId);
    const client = await connect(t, s.id);
    const { body: file } = await uploadFixture(t);
    const created = json<{ runId: string; status: string }>(
      await client.callTool({ name: "ingest_file", arguments: { fileId: file.id } }),
    );
    expect(created.status).toBe("awaiting_confirmation");
    const res = await t.api(`/api/ingestions/${created.runId}/confirm`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("queued");
    expect(t.queue.enqueued).toContainEqual({ runId: created.runId, stage: "ingest.read_text" });
    await client.close();
  });
});

describe("auditoria E1 · valor pesquisado entra no perfil depois de confirmado", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  async function researched(category: "career" = "career") {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    t.repos.profiles.update(ids.profileId, { needsResearch: ["salary", "availableFrom"] });
    const s = session(t, ids.profileId, category);
    const client = await connect(t, s.id);
    const saved = json<{ id: string }>(
      await client.callTool({
        name: "research_save",
        arguments: {
          url: "https://www.ibge.gov.br/explica/rendimento.php",
          title: "IBGE · Rendimento",
          excerpt: "Rendimento médio real habitual.",
          usedFor: "salary",
        },
      }),
    );
    return { ids, s, client, sourceId: saved.id };
  }

  it("research_apply grava o salário, tira o campo de needsResearch e marca a fonte como aceita", async () => {
    const { ids, client, sourceId } = await researched();
    const r = await client.callTool({
      name: "research_apply",
      arguments: {
        field: "salary",
        sourceId,
        salary: { min: 12000, max: 16000, currency: "BRL", period: "monthly" },
      },
    });
    expect(isError(r), text(r)).toBe(false);
    const p = t.repos.profiles.get(ids.profileId);
    expect(p?.salary).toEqual({ min: 12000, max: 16000, currency: "BRL", period: "monthly" });
    expect(p?.needsResearch).toEqual(["availableFrom"]);
    expect(t.repos.researchSources.get(sourceId)?.accepted).toBe(true);
    await client.close();
  });

  it("recusa campo sem valor, campo que não está pendente e fonte de outro perfil", async () => {
    const { client, sourceId } = await researched();
    const missing = await client.callTool({
      name: "research_apply",
      arguments: { field: "salary", sourceId },
    });
    expect(isError(missing)).toBe(true);
    const notPending = await client.callTool({
      name: "research_apply",
      arguments: { field: "contractTypes", sourceId, contractTypes: ["clt"] },
    });
    expect(text(notPending)).toContain("field_not_pending");
    const foreign = t.repos.researchSources.add({
      profileId: null,
      sessionId: null,
      url: "https://www.ibge.gov.br/x",
      domain: "ibge.gov.br",
      title: "x",
      excerpt: "x",
      usedFor: "salary",
      trustTag: "official",
      userConfirmed: false,
    });
    const r = await client.callTool({
      name: "research_apply",
      arguments: {
        field: "availableFrom",
        sourceId: foreign.id,
        availableFrom: "immediate",
      },
    });
    expect(text(r)).toContain("source_not_in_profile");
    await client.close();
  });

  it("fonte fora da lista: só com userConfirmed, registrada como confirmada pelo usuário", async () => {
    const { client } = await researched();
    const args = {
      url: "https://blog.exemplo.com/salarios",
      title: "Blog",
      excerpt: "Tabela",
      usedFor: "salary",
    };
    const denied = await client.callTool({ name: "research_save", arguments: args });
    expect(text(denied)).toContain("untrusted_domain");
    const ok = await client.callTool({
      name: "research_save",
      arguments: { ...args, userConfirmed: true },
    });
    expect(isError(ok), text(ok)).toBe(false);
    const saved = t.repos.researchSources.get(json<{ id: string }>(ok).id);
    expect(saved).toMatchObject({
      trustTag: "other",
      userConfirmed: true,
      domain: "blog.exemplo.com",
    });
    await client.close();
  });
});

describe("auditoria E1 · evidence.skill.get e evidence.education.get", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("devolvem o detalhe como os de experiência e projeto", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const s = session(t, ids.profileId);
    const client = await connect(t, s.id);
    const skillId = ids.skillIds[0] as string;
    const eduId = ids.educationIds[0] as string;
    const skill = await client.callTool({ name: "evidence_skill_get", arguments: { id: skillId } });
    expect(json<{ kind: string; id: string }>(skill)).toMatchObject({ kind: "skill", id: skillId });
    const edu = await client.callTool({ name: "evidence_education_get", arguments: { id: eduId } });
    expect(json<{ kind: string }>(edu).kind).toBe("education");
    const nf = await client.callTool({
      name: "evidence_skill_get",
      arguments: { id: "01NAOEXISTE0000000000000000" },
    });
    expect(text(nf)).toContain("fact_not_found");
    await client.close();
  });
});

describe("auditoria E1 · Configurações › Modo plugin", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("status traz URL do MCP, ferramentas pela sonda, comando e o último uso visto no terminal", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const first = (await (await t.api("/api/plugin/status")).json()) as Record<string, unknown>;
    expect(first).toMatchObject({
      command: "./start.sh install-plugin",
      lastSeenAt: null,
    });
    expect(String(first.mcpUrl)).toMatch(/\/mcp$/);
    expect(first.mcp).toMatchObject({ ok: true });
    expect((first.mcp as { tools: number }).tools).toBeGreaterThan(10);
    // o hook SessionStart do terminal busca o cartão em texto: é o sinal de "plugin em uso"
    expect((await t.api("/api/profiles/active/persona-card?format=text")).status).toBe(200);
    const after = (await (await t.api("/api/plugin/status")).json()) as {
      lastSeenAt: string | null;
    };
    expect(after.lastSeenAt).not.toBeNull();
  });
});
