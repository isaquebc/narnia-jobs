import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CHAT_SETTING_KEYS, seedFixture } from "@narnia-jobs/core";
import { type ChatHandle, type ChatOpenOptions, MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/** Auditoria pós-F04 · bloco A (2026-10-12): escopo da sessão, perfil da sessão e leitura web restrita. */

async function connect(t: TestApp, sessionId?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
  if (sessionId) headers["x-narnia-session"] = sessionId;
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: { headers },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-auditoria-a", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: unknown) => (r as CallResult).content.map((c) => c.text ?? "").join("\n");
const isError = (r: unknown) => (r as CallResult).isError === true;

function session(t: TestApp, profileId: string, category: "career" | "ingest" | "clarify") {
  return t.repos.chatSessions.create({
    profileId,
    category,
    title: "x",
    provider: "mock",
    model: "sonnet",
  });
}

/** Segundo perfil criado pelo caminho de produção (tool do modo B), copiando os campos do primeiro. */
async function secondProfile(t: TestApp, fromId: string) {
  const src = t.repos.profiles.get(fromId);
  if (!src) throw new Error("perfil de origem ausente");
  const b = await connect(t);
  const r = await b.callTool({
    name: "profile_create",
    arguments: {
      name: "Perfil B",
      targetTitle: "Gerente de Produto",
      seniority: src.seniority,
      area: src.area,
      goal: src.goal,
      market: src.market,
      docLocale: src.docLocale,
    },
  });
  return (JSON.parse(text(r)) as { id: string }).id;
}

describe("auditoria A · categoria da sessão não amplia o escopo", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("clarify não vira career; career pode estreitar para ingest", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const clarify = session(t, ids.profileId, "clarify");
    const c1 = await connect(t, clarify.id);
    const denied = await c1.callTool({
      name: "session_set_category",
      arguments: { category: "career" },
    });
    expect(isError(denied)).toBe(true);
    expect(text(denied)).toContain("[category_not_allowed]");
    expect(t.repos.chatSessions.get(clarify.id)?.category).toBe("clarify");

    const career = session(t, ids.profileId, "career");
    const c2 = await connect(t, career.id);
    const ok = await c2.callTool({
      name: "session_set_category",
      arguments: { category: "ingest" },
    });
    expect(isError(ok)).toBe(false);
    expect(t.repos.chatSessions.get(career.id)?.category).toBe("ingest");
    const back = await (await connect(t, career.id)).callTool({
      name: "session_set_category",
      arguments: { category: "career" },
    });
    expect(isError(back)).toBe(true);
  });
});

describe("auditoria A · tools profile.* presas ao perfil da sessão", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("get_card usa o perfil da sessão mesmo com outro ativo; outro profileId é recusado", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const other = await secondProfile(t, ids.profileId);
    const s = session(t, ids.profileId, "career");
    t.repos.profiles.setActive(other);
    const c = await connect(t, s.id);
    const card = await c.callTool({ name: "profile_get_card", arguments: {} });
    expect(JSON.parse(text(card))).toMatchObject({ profileId: ids.profileId });
    const foreign = await c.callTool({ name: "profile_get_card", arguments: { profileId: other } });
    expect(text(foreign)).toContain("[profile_not_in_session]");
    for (const [name, args] of [
      ["profile_update_pitch", { profileId: other, pitch: "invadido" }],
      ["profile_update_emphasis", { profileId: other, items: [] }],
    ] as const) {
      const r = await c.callTool({ name, arguments: args });
      expect(isError(r), name).toBe(true);
      expect(text(r)).toContain("[profile_not_in_session]");
    }
    expect(t.repos.profiles.get(other)?.pitch ?? null).not.toBe("invadido");
    const own = await c.callTool({
      name: "profile_update_pitch",
      arguments: { profileId: ids.profileId, pitch: "meu pitch" },
    });
    expect(isError(own)).toBe(false);
  });

  it("profile_switch some do chat do app e continua no modo terminal", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const s = session(t, ids.profileId, "career");
    const inChat = (await (await connect(t, s.id)).listTools()).tools.map((x) => x.name);
    expect(inChat).not.toContain("profile_switch");
    expect(inChat).toContain("profile_get_card");
    const terminal = (await (await connect(t)).listTools()).tools.map((x) => x.name);
    expect(terminal).toContain("profile_switch");
    const r = await (await connect(t, s.id)).callTool({
      name: "profile_switch",
      arguments: { profileId: ids.profileId },
    });
    expect(text(r)).toContain("[tool_not_in_scope]");
  });
});

class SpyProvider extends MockProvider {
  opened: ChatOpenOptions[] = [];
  override openChat(o: ChatOpenOptions): ChatHandle {
    this.opened.push(o);
    return super.openChat(o);
  }
}

describe("auditoria A · leitura web só em domínio confiável", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("a sessão recebe canFetch ligado à lista atual de domínios confiáveis", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    seedFixture(t.repos, "engineer");
    const created = await t.api("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const sid = ((await created.json()) as { session: { id: string } }).session.id;
    await t.api(`/api/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "oi" }),
    });
    const canFetch = spy.opened[0]?.canFetch;
    expect(canFetch).toBeTypeOf("function");
    const fetchOk = canFetch as (u: string) => boolean;
    expect(fetchOk("https://www.ibge.gov.br/estatisticas")).toBe(true);
    expect(fetchOk("https://atacante.com/?d=dados")).toBe(false);
    expect(fetchOk("https://ibge.gov.br@atacante.com/")).toBe(false);
    // a lista é lida a cada chamada: domínio novo passa a valer sem reabrir a sessão
    t.repos.trustedDomains.add({ pattern: "atacante.com", trustTag: "jobboard" });
    expect(fetchOk("https://atacante.com/x")).toBe(true);
    // sem exigência de domínio confiável (escolha do usuário em Configurações › Chat), qualquer http(s)
    t.repos.settings.set(CHAT_SETTING_KEYS.requireTrustedResearch, false);
    expect(fetchOk("https://qualquer.io/")).toBe(true);
    expect(fetchOk("file:///etc/passwd")).toBe(false);
  });
});
