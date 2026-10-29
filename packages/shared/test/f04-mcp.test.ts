import { describe, expect, it } from "vitest";
import {
  CHAT_TOOL_JSON_SCHEMAS,
  CHAT_TOOLS,
  ChatCategorySchema,
  ChatSessionSchema,
  TrustedDomainSchema,
  WsEventSchema,
} from "../src/index";

/** F04/M1 · tools novas do servidor MCP e eventos de chat (definição; handlers no core, exposição no M2). */
describe("F04/M1 shared · tools MCP do chat", () => {
  it("define as famílias evidence, fact, research, job, session, usage e ingest pela conversa", () => {
    expect(Object.keys(CHAT_TOOLS).sort()).toEqual(
      [
        "evidence.education.get",
        "evidence.education.list",
        "evidence.experience.get",
        "evidence.experience.list",
        "evidence.project.get",
        "evidence.project.list",
        "evidence.skill.get",
        "evidence.skill.list",
        "fact.alias_add",
        "fact.gaps",
        "fact.get",
        "fact.propose_change",
        "fact.search",
        "fact.timeline",
        "fact.unverified",
        "fact.verify",
        "ingest.confirm",
        "ingest.file",
        "ingest.github",
        "ingest.text",
        "job.list",
        "job.status",
        "research.apply",
        "research.list",
        "research.save",
        "session.get",
        "session.set_category",
        "usage.log",
      ].sort(),
    );
  });

  it("fact.search exige termo de pelo menos 2 caracteres, filtra por tipo e período e limita a 50", () => {
    const s = CHAT_TOOLS["fact.search"].input;
    expect(s.safeParse({ q: "react" }).success).toBe(true);
    expect(s.safeParse({ q: "r" }).success).toBe(false);
    expect(
      s.safeParse({ q: "go", kinds: ["skill", "experience"], from: "2020", to: "2024-06" }).success,
    ).toBe(true);
    expect(s.safeParse({ q: "go", kinds: ["identidade"] }).success).toBe(false);
    expect(s.safeParse({ q: "go", limit: 51 }).success).toBe(false);
  });

  it("listas paginam por limit/cursor; get pede id", () => {
    const l = CHAT_TOOLS["evidence.experience.list"].input;
    expect(l.safeParse({}).success).toBe(true);
    expect(l.safeParse({ limit: 10, cursor: "abc" }).success).toBe(true);
    expect(l.safeParse({ limit: 0 }).success).toBe(false);
    expect(CHAT_TOOLS["evidence.experience.get"].input.safeParse({}).success).toBe(false);
  });

  it("research.save exige URL válida, used_for e trecho; trust_tag fora do enum é recusado", () => {
    const r = CHAT_TOOLS["research.save"].input;
    const ok = {
      url: "https://www.ibge.gov.br/x",
      title: "IBGE",
      excerpt: "salário médio",
      usedFor: "salary",
    };
    expect(r.safeParse(ok).success).toBe(true);
    expect(r.safeParse({ ...ok, usedFor: undefined }).success).toBe(false);
    expect(r.safeParse({ ...ok, url: "não é url" }).success).toBe(false);
  });

  it("ingest.text/file/github: texto entre 200 e 50k; github com repos e modo; nada de fatos na saída", () => {
    const t = CHAT_TOOLS["ingest.text"].input;
    expect(t.safeParse({ text: "a".repeat(200) }).success).toBe(true);
    expect(t.safeParse({ text: "curto" }).success).toBe(false);
    expect(CHAT_TOOLS["ingest.file"].input.safeParse({ fileId: "f1" }).success).toBe(true);
    const g = CHAT_TOOLS["ingest.github"].input;
    expect(g.safeParse({ mode: "private", repos: ["ana/api"], depth: "quick" }).success).toBe(true);
    expect(g.safeParse({ mode: "private", repos: [], depth: "quick" }).success).toBe(false);
    const out = CHAT_TOOLS["ingest.github"].output.shape;
    expect(Object.keys(out).sort()).toEqual(
      ["estimatedTokens", "needsConfirmation", "runId", "status", "url"].sort(),
    );
  });

  it("session.set_category aceita só as categorias de chat; usage.log exige provider_session_id e turno", () => {
    expect(ChatCategorySchema.options).toEqual([
      "career",
      "clarify",
      "ingest",
      "interview",
      "discovery",
      "job",
    ]);
    expect(CHAT_TOOLS["session.set_category"].input.safeParse({ category: "career" }).success).toBe(
      true,
    );
    expect(CHAT_TOOLS["session.set_category"].input.safeParse({ category: "x" }).success).toBe(
      false,
    );
    const u = CHAT_TOOLS["usage.log"].input;
    const ok = {
      providerSessionId: "s1",
      turnIndex: 0,
      model: "sonnet",
      inputTokens: 10,
      outputTokens: 5,
    };
    expect(u.safeParse(ok).success).toBe(true);
    expect(u.safeParse({ ...ok, turnIndex: -1 }).success).toBe(false);
  });

  it("domínio confiável aceita máscara só no início ou rótulo inteiro", () => {
    const d = (pattern: string) => TrustedDomainSchema.shape.pattern.safeParse(pattern).success;
    expect(d("*.gov.br")).toBe(true);
    expect(d("glassdoor.*")).toBe(true);
    expect(d("ibge.gov.br")).toBe(true);
    expect(d("gov.*.br")).toBe(false);
    expect(d("https://ibge.gov.br")).toBe(false);
  });

  it("sessão de chat tem categoria, estado e perfil", () => {
    expect(ChatSessionSchema.shape.state.options).toEqual([
      "live",
      "hibernated",
      "archived",
      "error",
    ]);
  });

  it("eventos chat.* entram na união do WebSocket com sessionId", () => {
    const ok = [
      { type: "chat.delta", sessionId: "s1", text: "Olá" },
      { type: "chat.tool", sessionId: "s1", name: "fact.search", phase: "start" },
      {
        type: "chat.turn_end",
        sessionId: "s1",
        turnIndex: 0,
        usage: { inputTokens: 1, outputTokens: 2 },
      },
      { type: "chat.error", sessionId: "s1", error: "falhou" },
      { type: "chat.limit", sessionId: "s1", reason: "max_turns" },
      { type: "chat.session_updated", sessionId: "s1", state: "hibernated" },
    ];
    for (const e of ok) expect(WsEventSchema.safeParse(e).success, e.type).toBe(true);
    expect(WsEventSchema.safeParse({ type: "chat.delta", text: "sem sessão" }).success).toBe(false);
  });

  it("JSON Schema sem $schema e estável (snapshot)", () => {
    for (const s of Object.values(CHAT_TOOL_JSON_SCHEMAS)) {
      expect(s.input).not.toHaveProperty("$schema");
      expect(s.output).not.toHaveProperty("$schema");
    }
    expect(CHAT_TOOL_JSON_SCHEMAS).toMatchSnapshot();
  });
});
