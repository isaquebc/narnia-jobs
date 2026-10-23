import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * Alteração pequena pedida na conversa (pedido do dono, 2026-10-23): `fact.propose_change` grava o registro da
 * alteração como fonte de uma ingestão em revisão; o fato só muda quando o usuário confirma. Sem decidir na conversa,
 * a alteração fica em Pendências.
 */
type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: CallResult) => r.content.map((c) => c.text ?? "").join("\n");

async function connect(t: TestApp, sessionId: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}`, "x-narnia-session": sessionId } },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-alteracao", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

describe("alteração de fato pela conversa (fact.propose_change)", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function setup() {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const sessionId = t.repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Conversa",
      provider: "mock",
      model: "sonnet",
    }).id;
    t.repos.chatMessages.add({
      sessionId,
      turnIndex: 0,
      role: "user",
      contentMd: "Meu cargo na primeira empresa era Tech Lead, corrige aí.",
      toolCalls: [],
      usage: null,
    });
    const client = await connect(t, sessionId);
    const id = ids.experienceIds[0] as string;
    const call = (args: Record<string, unknown>) =>
      client.callTool({
        name: "fact_propose_change",
        arguments: {
          kind: "experience",
          id,
          changes: { title: "Tech Lead" },
          reason: "O usuário corrigiu o cargo.",
          quote: "Meu cargo na primeira empresa era Tech Lead",
          ...args,
        },
      }) as Promise<CallResult>;
    return { t, id, sessionId, client, call };
  }

  it("cria a execução em revisão ligada à conversa, com o registro e a pendência; o fato não muda", async () => {
    const { t, id, sessionId, client, call } = await setup();
    const before = t.repos.facts.experiences.get(id)?.title;
    const r = await call({});
    expect(r.isError, text(r)).toBeFalsy();
    const out = JSON.parse(text(r)) as { runId: string; url: string; status: string };
    expect(out).toMatchObject({ status: "review", url: `/ingestao/${out.runId}` });
    expect(t.repos.facts.experiences.get(id)?.title).toBe(before);
    const run = t.repos.ingestionRuns.get(out.runId);
    expect(run).toMatchObject({ status: "review", chatSessionId: sessionId, source: "text" });

    const res = (await (await t.api(`/api/ingestions/${out.runId}`)).json()) as {
      factChange: { label: string; changes: unknown[]; quoteFound: boolean } | null;
      proposals: unknown[];
    };
    expect(res.factChange).toMatchObject({
      changes: [{ field: "title", before, after: "Tech Lead" }],
      quoteFound: true,
    });
    expect(res.proposals).toHaveLength(1);

    const pend = (await (await t.api("/api/notifications")).json()) as {
      notifications: Array<{ kind: string; title: string; actionUrl: string | null }>;
    };
    const mine = pend.notifications.filter((n) => n.actionUrl === `/ingestao/${out.runId}`);
    expect(mine.map((n) => n.kind)).toEqual(["review.pending"]);
    expect(mine[0]?.title).toMatch(/O recrutador quer alterar um dado seu/);
    await client.close();
  });

  it("confirmar aplica a alteração e fecha a pendência; manter não muda nada", async () => {
    const { t, id, client, call } = await setup();
    const first = JSON.parse(text(await call({}))) as { runId: string };
    const { proposals } = (await (await t.api(`/api/ingestions/${first.runId}`)).json()) as {
      proposals: Array<{ id: string }>;
    };
    const accept = await t.api(`/api/ingestions/${first.runId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decisions: [{ proposalId: proposals[0]?.id, decision: "accepted" }] }),
    });
    expect(accept.status).toBe(200);
    expect(t.repos.facts.experiences.get(id)?.title).toBe("Tech Lead");
    expect(t.repos.ingestionRuns.get(first.runId)?.status).toBe("done");
    const open = t.repos.notifications
      .list({ status: "all" })
      .filter((n) => n.subjectId === first.runId && n.kind === "review.pending");
    expect(open.every((n) => n.resolvedAt !== null)).toBe(true);

    const second = JSON.parse(
      text(await call({ changes: { title: "CTO" }, quote: "corrige aí" })),
    ) as { runId: string };
    const p2 = (await (await t.api(`/api/ingestions/${second.runId}`)).json()) as {
      proposals: Array<{ id: string }>;
    };
    await t.api(`/api/ingestions/${second.runId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decisions: [{ proposalId: p2.proposals[0]?.id, decision: "rejected" }],
      }),
    });
    expect(t.repos.facts.experiences.get(id)?.title).toBe("Tech Lead");
    await client.close();
  });

  it("recusa com erro claro (pedido fora da conversa, campo desconhecido); a mesma pendente não repete", async () => {
    const { client, call } = await setup();
    expect(text(await call({ quote: "frase inventada" }))).toMatch(/\[quote_not_found\]/);
    expect(text(await call({ changes: { salario: 1 } }))).toMatch(/\[invalid_change\]/);
    // a mesma alteração ainda pendente não abre outra: devolve a que já está esperando
    const a = JSON.parse(text(await call({}))) as { runId: string };
    const b = JSON.parse(text(await call({}))) as { runId: string };
    expect(b.runId).toBe(a.runId);
    await client.close();
  });
});
