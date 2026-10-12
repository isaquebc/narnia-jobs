import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN, uploadFixture } from "./helpers";

/**
 * F04 M2 · servidor MCP em `/mcp` (F04-7, F04-11, F04-2): cliente oficial do SDK falando com o app em memória.
 * Dados montados pelos repositórios de produção (`seedFixture`), nunca à mão.
 */
const LONG_TEXT =
  "Trabalhei por cinco anos como engenheira de software na Acme Pagamentos, liderando a migração do monólito para " +
  "serviços em Go e Kubernetes, reduzindo o tempo de deploy de duas horas para quinze minutos. Antes disso fui " +
  "desenvolvedora na Beta Varejo, onde criei o motor de recomendação em Python que aumentou a conversão em 8%.";

async function connect(t: TestApp, headers: Record<string, string> = {}) {
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}`, ...headers } },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-f04", version: "0.0.0" });
  // o tipo do transporte do SDK não satisfaz exactOptionalPropertyTypes do projeto; em runtime é o mesmo objeto
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: CallResult) => r.content.map((c) => c.text ?? "").join("\n");

describe("F04/M2 · servidor MCP: autenticação e listagem", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("sem token devolve 401 (o /mcp não fica aberto como as rotas fora de /api)", async () => {
    t = makeTestApp();
    const r = await t.app.fetch(
      new Request("http://narnia.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("initialize e tools/list no modo B (sem sessão): carreira + ingestão, com ingest.propose (skill clarificar)", async () => {
    t = makeTestApp();
    const client = await connect(t);
    expect(client.getServerVersion()?.name).toBe("narnia-jobs");
    const names = (await client.listTools()).tools.map((x) => x.name);
    for (const n of [
      "profile_get_card",
      "fact_search",
      "evidence_experience_list",
      "ingest_text",
      "file_list",
    ])
      expect(names).toContain(n);
    // auditoria C: a skill clarificar do terminal precisa dela (só para execução pronta para revisão)
    expect(names).toContain("ingest_propose");
    const card = (await client.listTools()).tools.find((x) => x.name === "fact_search");
    expect(card?.inputSchema.type).toBe("object");
    expect(JSON.stringify(card?.inputSchema)).not.toContain("$schema");
    await client.close();
  });

  it("sessão de clarificação: lista só o escopo clarify e recusa tool fora dele com tool_not_in_scope", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const session = t.repos.chatSessions.create({
      profileId: ids.profileId,
      category: "clarify",
      title: "Clarificar",
      provider: "mock",
      model: "sonnet",
    });
    const client = await connect(t, { "x-narnia-session": session.id });
    const names = (await client.listTools()).tools.map((x) => x.name);
    expect(names).toContain("ingest_propose");
    expect(names).toContain("fact_search");
    expect(names).not.toContain("profile_switch");
    const r = (await client.callTool({
      name: "profile_switch",
      arguments: { profileId: ids.profileId },
    })) as CallResult;
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("tool_not_in_scope");
    await client.close();
  });
});

describe("F04/M2 · servidor MCP: tools/call", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("cada tool de leitura responde com dados do usuário semeado, sem erro", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const exp = t.repos.facts.experiences.list()[0];
    const client = await connect(t);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["profile_list", {}],
      ["profile_get_card", {}],
      ["file_list", {}],
      ["evidence_experience_list", { limit: 3 }],
      ["evidence_experience_get", { id: exp?.id }],
      ["evidence_project_list", {}],
      ["evidence_skill_list", {}],
      ["evidence_education_list", {}],
      ["fact_search", { q: "kubernet" }],
      ["fact_timeline", { from: "2015" }],
      ["fact_unverified", {}],
      ["research_list", {}],
      ["job_list", {}],
    ];
    for (const [name, args] of calls) {
      const r = (await client.callTool({ name, arguments: args })) as CallResult;
      expect(r.isError, `${name}: ${text(r)}`).toBeFalsy();
      expect(text(r).length, name).toBeGreaterThan(1);
    }
    const card = (await client.callTool({ name: "profile_get_card", arguments: {} })) as CallResult;
    expect(text(card)).toContain(ids.profileId === "" ? "" : "Resumo");
    await client.close();
  });

  it("ingest.text cria a execução pelo mesmo caminho da tela (fila), nada gravado em fatos", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const before = t.repos.facts.experiences.list().length;
    const client = await connect(t);
    const r = (await client.callTool({
      name: "ingest_text",
      arguments: { text: LONG_TEXT },
    })) as CallResult;
    expect(r.isError, text(r)).toBeFalsy();
    const out = JSON.parse(text(r)) as { runId: string; url: string; alreadyRead: boolean };
    expect(out.url).toBe(`/ingestao/${out.runId}`);
    expect(out.alreadyRead).toBe(false);
    expect(t.repos.ingestionRuns.get(out.runId)?.status).toBe("queued");
    expect(t.queue.enqueued.map((s) => s.stage)).toContain("ingest.read_text");
    expect(t.repos.facts.experiences.list()).toHaveLength(before);
    const again = (await client.callTool({
      name: "ingest_text",
      arguments: { text: LONG_TEXT },
    })) as CallResult;
    expect((JSON.parse(text(again)) as { alreadyRead: boolean }).alreadyRead).toBe(true);
    await client.close();
  });

  it("ingest.github cria a execução e sempre pede confirmação na tela", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const client = await connect(t);
    const r = (await client.callTool({
      name: "ingest_github",
      arguments: {
        mode: "public",
        repos: ["ana-exemplo/api-pagamentos"],
        depth: "quick",
        login: "ana-exemplo",
      },
    })) as CallResult;
    expect(r.isError, text(r)).toBeFalsy();
    const out = JSON.parse(text(r)) as { runId: string; needsConfirmation: boolean };
    expect(out.needsConfirmation).toBe(true);
    expect(t.repos.ingestionRuns.get(out.runId)?.source).toBe("github");
    expect(t.queue.tasks.map((x) => x.type)).toContain("ingest.github.prepare");
    await client.close();
  });

  it("erros chegam como isError com código e texto em pt-BR; entrada inválida vira invalid_input", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const client = await connect(t);
    const missing = (await client.callTool({
      name: "evidence_experience_get",
      arguments: { id: "00000000-0000-7000-8000-000000000000" },
    })) as CallResult;
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/\[fact_not_found\]/);
    const bad = (await client.callTool({ name: "fact_search", arguments: {} })) as CallResult;
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/\[invalid_input\]/);
    const unknown = (await client.callTool({ name: "nao_existe", arguments: {} })) as CallResult;
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/\[tool_not_found\]/);
    await client.close();
  });

  it("ingest.propose na sessão de clarificação só aceita a execução da própria sessão", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    // execução real da sessão, criada pela API como na tela
    const { body: file } = await uploadFixture(t);
    const created = await t.api("/api/ingestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileId: file.id }),
    });
    const run = (await created.json()) as { id: string };
    const session = t.repos.chatSessions.create({
      profileId: ids.profileId,
      category: "clarify",
      title: "Clarificar",
      provider: "mock",
      model: "sonnet",
      ingestionRunId: run.id,
    });
    const client = await connect(t, { "x-narnia-session": session.id });
    const r = (await client.callTool({
      name: "ingest_propose",
      arguments: { runId: "01a00000-0000-7000-8000-000000000002", proposals: [] },
    })) as CallResult;
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/\[run_not_in_session\]/);
    await client.close();
  });
});

describe("F04/M2 · rota do hook SessionStart", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET /api/profiles/active/persona-card devolve persona + cartão renderizados pelo template do plugin", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const r = await t.api("/api/profiles/active/persona-card");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { text: string; cardHash: string };
    expect(body.text).not.toMatch(/\{\{/);
    expect(body.text).toContain("Resumo");
    expect(body.cardHash.length).toBeGreaterThan(8);
  });

  it("sem perfil ativo devolve 404 no_profile", async () => {
    t = makeTestApp();
    const r = await t.api("/api/profiles/active/persona-card");
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("no_profile");
  });
});
