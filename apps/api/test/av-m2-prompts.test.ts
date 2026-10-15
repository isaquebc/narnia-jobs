import { STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { MODEL_IDS, promptCatalog } from "../src/evals/prompt-catalog";
import { syncPrompts } from "../src/evals/prompt-sync";

/** Avaliações no Phoenix (M2, decisão AV-4): os 20 prompts do repositório versionados no Phoenix (F06-8: + especializado). */
describe("catálogo de prompts", () => {
  it("20 prompts: 9 estruturados, 2 agentes, 4 notas e 5 skills; nomes únicos narnia-*", () => {
    const c = promptCatalog();
    expect(c).toHaveLength(20);
    const kinds = c.reduce<Record<string, number>>((acc, p) => {
      acc[p.kind] = (acc[p.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds).toEqual({ structured: 9, agent: 2, note: 4, skill: 5 });
    expect(new Set(c.map((p) => p.name)).size).toBe(20);
    for (const p of c) {
      expect(p.name).toMatch(/^narnia-[a-z0-9-]+$/);
      expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(p.messages.every((m) => m.content.trim().length > 0)).toBe(true);
    }
    expect(c.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        "narnia-extract-facts",
        "narnia-recrutador",
        "narnia-recrutador-especializado",
        "narnia-nota-clarificar-contexto",
        "narnia-nota-ingestao-pronta",
        "narnia-skill-github-publico",
      ]),
    );
  });

  it("estruturado: system do arquivo, template do usuário, schema e modelo com id da API", () => {
    const ef = promptCatalog().find((p) => p.name === "narnia-extract-facts");
    expect(ef?.messages).toEqual([
      { role: "SYSTEM", content: STRUCTURED_PROMPTS.extractFacts.system() },
      { role: "USER", content: STRUCTURED_PROMPTS.extractFacts.userTemplate },
    ]);
    expect(ef?.jsonSchema).toEqual(STRUCTURED_PROMPTS.extractFacts.jsonSchema);
    expect(ef?.modelName).toBe(MODEL_IDS.haiku);
    expect(ef?.variables).toEqual(["locale", "experiences_json", "text"]);
  });

  it("persona sem frontmatter, com as variáveis do cartão e da persona; skill como system + mensagem", () => {
    const c = promptCatalog();
    const agent = c.find((p) => p.name === "narnia-recrutador");
    expect(agent?.messages[0]?.content).not.toMatch(/^---/);
    expect(agent?.variables).toEqual(expect.arrayContaining(["card", "trusted_domains"]));
    expect(agent?.tools).toEqual(expect.arrayContaining(["WebSearch"]));
    const skill = c.find((p) => p.name === "narnia-skill-recrutador");
    expect(skill?.messages.map((m) => m.role)).toEqual(["SYSTEM", "USER"]);
    expect(skill?.messages[1]?.content).toBe("{{mensagem}}");
  });

  it("o hash muda só quando muda o conteúdo", () => {
    const a = promptCatalog();
    const b = promptCatalog();
    expect(a.map((p) => p.hash)).toEqual(b.map((p) => p.hash));
  });
});

function fakePhoenix() {
  const prompts = new Map<
    string,
    {
      id: string;
      versions: Array<{ id: string; metadata: Record<string, unknown>; tags: string[] }>;
    }
  >();
  const calls: Array<{ op: string; vars?: Record<string, unknown> }> = [];
  let seq = 0;
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.includes("/v1/prompts/") && url.endsWith("/latest")) {
      const name = decodeURIComponent(url.split("/v1/prompts/")[1]?.split("/")[0] ?? "");
      const p = prompts.get(name);
      if (!p) return new Response("not found", { status: 404 });
      const v = p.versions.at(-1);
      return Response.json({ data: { id: v?.id, metadata: v?.metadata } });
    }
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: { input: Record<string, unknown> };
    };
    const input = body.variables?.input ?? {};
    if (body.query.includes("createChatPromptVersion")) {
      calls.push({ op: "version", vars: input });
      const entry = [...prompts.values()].find((p) => p.id === input.promptId);
      const pv = input.promptVersion as { metadata: Record<string, unknown> };
      entry?.versions.push({ id: `v${++seq}`, metadata: pv.metadata, tags: ["production"] });
      return Response.json({ data: { createChatPromptVersion: { id: entry?.id } } });
    }
    if (body.query.includes("createChatPrompt")) {
      calls.push({ op: "create", vars: input });
      const pv = input.promptVersion as { metadata: Record<string, unknown> };
      prompts.set(String(input.name), {
        id: `P${++seq}`,
        versions: [{ id: `v${++seq}`, metadata: pv.metadata, tags: ["production"] }],
      });
      return Response.json({ data: { createChatPrompt: { id: "x" } } });
    }
    return Response.json({
      data: {
        prompts: {
          edges: [...prompts.entries()].map(([name, p]) => ({ node: { id: p.id, name } })),
        },
      },
    });
  };
  return { calls, fetch: fetchFn, prompts };
}

describe("sincronização com o Phoenix", () => {
  it("primeira vez cria os 20 com a tag production, na ponte e com o commit; depois nada muda", async () => {
    const px = fakePhoenix();
    const o = {
      baseUrl: "http://phoenix:6006",
      fetch: px.fetch,
      customProviderId: "CP1",
      commit: "abc1234",
    };
    const first = await syncPrompts(promptCatalog(), o);
    expect(first.filter((r) => r.action === "created")).toHaveLength(20);
    const create = px.calls.find(
      (c) => c.op === "create" && c.vars?.name === "narnia-extract-facts",
    );
    expect(create?.vars).toMatchObject({
      name: "narnia-extract-facts",
      tags: [{ name: "production", description: expect.any(String) }],
      promptVersion: {
        templateFormat: "MUSTACHE",
        modelProvider: "ANTHROPIC",
        modelName: MODEL_IDS.haiku,
        customProviderId: "CP1",
        description: expect.stringContaining("abc1234"),
        metadata: { commit: "abc1234", kind: "structured" },
        responseFormat: { type: "json_schema", jsonSchema: { name: "extract_facts" } },
        invocationParameters: { anthropic: { maxTokens: expect.any(Number) } },
      },
    });
    const tpl = (
      (create?.vars?.promptVersion ?? {}) as {
        template: { messages: Array<{ role: string; content: Array<{ text: { text: string } }> }> };
      }
    ).template;
    expect(tpl.messages[1]?.content[0]?.text.text).toBe(
      STRUCTURED_PROMPTS.extractFacts.userTemplate,
    );
    const again = await syncPrompts(promptCatalog(), o);
    expect(again.every((r) => r.action === "unchanged")).toBe(true);
  });

  it("prompt alterado vira versão nova (tag production) no mesmo prompt", async () => {
    const px = fakePhoenix();
    const o = {
      baseUrl: "http://phoenix:6006",
      fetch: px.fetch,
      customProviderId: null,
      commit: null,
    };
    await syncPrompts(promptCatalog(), o);
    const changed = promptCatalog().map((p) =>
      p.name === "narnia-check-proposals"
        ? {
            ...p,
            hash: "f".repeat(64),
            messages: [...p.messages, { role: "USER" as const, content: "x" }],
          }
        : p,
    );
    const r = await syncPrompts(changed, o);
    expect(r.find((x) => x.name === "narnia-check-proposals")?.action).toBe("updated");
    expect(r.filter((x) => x.action === "updated")).toHaveLength(1);
    const v = px.calls.find((c) => c.op === "version");
    expect(v?.vars).toMatchObject({ tags: [{ name: "production" }] });
    expect(
      ((v?.vars?.promptVersion ?? {}) as Record<string, unknown>).customProviderId,
    ).toBeUndefined();
  });
});
