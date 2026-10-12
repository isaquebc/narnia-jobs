import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, simulateWorker, type TestApp, TOKEN, uploadFixture } from "./helpers";

/**
 * Auditoria pós-F04 · bloco C: a skill `clarificar` do modo B (terminal, sem `X-Narnia-Session`) precisa de
 * `ingest_propose`; no terminal ela só vale para uma execução pronta para revisão, com `runId` explícito.
 */
async function connect(t: TestApp) {
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-audit-c", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: CallResult) => r.content.map((c) => c.text ?? "").join("\n");

async function startRun(t: TestApp) {
  const { body: file } = await uploadFixture(t);
  const created = await t.api("/api/ingestions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: file.id }),
  });
  return ((await created.json()) as { id: string }).id;
}

describe("auditoria C · ingest_propose no terminal (skill clarificar do modo B)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("aparece no tools/list sem sessão e propõe numa execução pronta para revisão", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const runId = await startRun(t);
    const [first] = simulateWorker(t, runId);
    if (!first) throw new Error("execução sem propostas");
    const before = t.repos.proposals.listByRun(runId).length;
    const client = await connect(t);
    expect((await client.listTools()).tools.map((x) => x.name)).toContain("ingest_propose");
    const r = (await client.callTool({
      name: "ingest_propose",
      arguments: {
        runId,
        proposals: [
          {
            proposal: first.proposal,
            evidence: { ref: "conversa", quote: "Acme Ltda — Engenheira de Software Sênior" },
          },
        ],
      },
    })) as CallResult;
    expect(r.isError, text(r)).toBeFalsy();
    expect(JSON.parse(text(r))).toEqual({ added: 1 });
    expect(t.repos.proposals.listByRun(runId)).toHaveLength(before + 1);
    await client.close();
  });

  it("recusa execução que ainda não está pronta para revisão", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const runId = await startRun(t);
    const [first] = simulateWorker(t, runId);
    if (!first) throw new Error("execução sem propostas");
    t.repos.ingestionRuns.setStatus(runId, "running");
    const client = await connect(t);
    const r = (await client.callTool({
      name: "ingest_propose",
      arguments: {
        runId,
        proposals: [{ proposal: first.proposal, evidence: { ref: "conversa", quote: "Acme" } }],
      },
    })) as CallResult;
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/\[run_not_reviewable\]/);
    await client.close();
  });
});
