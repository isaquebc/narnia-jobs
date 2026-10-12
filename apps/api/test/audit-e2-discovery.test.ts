import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedFixture } from "@narnia-jobs/core";
import { type ChatHandle, type ChatOpenOptions, MockProvider } from "@narnia-jobs/providers";
import type { AnyWsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { inScope, NATIVE_TOOLS, narrowsScope } from "../src/mcp/scopes";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * Auditoria pós-F04 · bloco E2 (18a) · entrevista de descoberta (passo 7 do primeiro uso, 02-fluxos): sessão de
 * categoria `discovery`, escopo só de leitura do perfil + lacunas + ingestão de texto (as respostas vão para a
 * revisão), sem pesquisa web; a orientação vem de `plugin/prompts/descoberta-contexto.md` no primeiro turno.
 */
class SpyProvider extends MockProvider {
  opened: ChatOpenOptions[] = [];
  sent: string[] = [];
  override openChat(o: ChatOpenOptions): ChatHandle {
    this.opened.push(o);
    const h = super.openChat(o);
    return {
      send: (text) => {
        this.sent.push(text);
        h.send(text);
      },
      events: h.events,
      interrupt: () => h.interrupt(),
      setModel: (m) => h.setModel(m),
      close: () => h.close(),
    };
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function waitFor(events: AnyWsEvent[], pred: (e: AnyWsEvent) => boolean, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = events.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("evento não chegou");
}

describe("auditoria E2 · entrevista de descoberta", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("escopo: lacunas, leitura do perfil e ingestão de texto; sem pesquisa, sem editar o perfil, sem web", () => {
    for (const n of [
      "fact.gaps",
      "profile.get_card",
      "evidence.experience.list",
      "fact.unverified",
      "ingest.text",
      "ingest.status",
      "ingest.confirm",
    ])
      expect(inScope(n, "discovery"), n).toBe(true);
    for (const n of ["research.save", "profile.update_pitch", "ingest.github", "ingest.propose"])
      expect(inScope(n, "discovery"), n).toBe(false);
    expect(NATIVE_TOOLS.discovery).toEqual([]);
    // a entrevista pode virar conversa de carreira só pela UI (ampliar); carreira → descoberta estreita
    expect(narrowsScope("career", "discovery")).toBe(true);
    expect(narrowsScope("discovery", "career")).toBe(false);
  });

  it("POST /api/sessions com categoria discovery; o 1º turno leva a orientação do plugin e o recrutador chama fact_gaps", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    seedFixture(t.repos, "engineer");
    const r = await t.api(
      "/api/sessions",
      json({ category: "discovery", title: "Entrevista de descoberta" }),
    );
    expect(r.status).toBe(201);
    const s = ((await r.json()) as { session: { id: string; category: string } }).session;
    expect(s.category).toBe("discovery");
    await t.api(
      `/api/sessions/${s.id}/messages`,
      json({ text: "Vamos começar a entrevista de descoberta." }),
    );
    await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === s.id);
    expect(spy.opened[0]?.tools).toEqual([]);
    expect(spy.sent[0]).toMatch(
      /entrevista de descoberta: pergunte só o que falta[\s\S]*fact_gaps/,
    );
    expect(spy.sent[0]).toMatch(/Vamos começar a entrevista de descoberta\.$/);
    const tools = t.repos.chatMessages.list(s.id).flatMap((m) => m.toolCalls.map((c) => c.name));
    expect(tools).toContain("fact_gaps");
    // a nota só vai no primeiro turno
    await t.api(`/api/sessions/${s.id}/messages`, json({ text: "trabalhei lá até 2019" }));
    await waitFor(
      t.events,
      (e) => e.type === "chat.turn_end" && e.sessionId === s.id && e.turnIndex === 1,
    );
    expect(spy.sent[1]).toBe("trabalhei lá até 2019");
  });

  it("pelo /mcp, a sessão de descoberta lista fact_gaps e recusa research_save", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const s = t.repos.chatSessions.create({
      profileId: ids.profileId,
      category: "discovery",
      title: "Entrevista de descoberta",
      provider: "mock",
      model: "sonnet",
    });
    const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}`, "x-narnia-session": s.id } },
      fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
    });
    const client = new Client({ name: "teste-e2-descoberta", version: "0.0.0" });
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    const names = (await client.listTools()).tools.map((x) => x.name);
    expect(names).toContain("fact_gaps");
    expect(names).not.toContain("research_save");
    const gaps = (await client.callTool({ name: "fact_gaps", arguments: {} })) as {
      isError?: boolean;
    };
    expect(gaps.isError).toBeFalsy();
    await client.close();
  });
});
