import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandQuery, listFactAliases } from "../../src/chat/fact-search";
import { ChatToolError, createChatTools } from "../../src/chat/tools";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { factSearchRecall, parseRecallCases } from "../../src/evals/search-recall";
import { rebuildCard } from "../../src/profile/cards";
import { type SeededIds, seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Busca de fatos do recrutador (F04-fix-fundamentacao, R1, 2026-10-29). A busca antiga juntava as palavras com "E": a
 * busca agrupada ("Kafka mensageria Redis") quase nunca achava nada e o recrutador fazia uma chamada por termo (recall
 * 19% no benchmark). Agora: termos com "OU" e ranking por quantos batem, várias consultas numa chamada, expansão pelo
 * dicionário canônico (pt/en, sinônimos), radical das palavras longas e apelidos aprendidos ligados a fatos (FF-1).
 */
let repos: Repos;
let ids: SeededIds;
beforeEach(() => {
  const db = openDatabase(":memory:");
  migrate(db);
  repos = createRepos(db);
  ids = seedFixture(repos, "engineer");
  rebuildCard(repos, ids.profileId);
});
afterEach(() => repos.db.close());

const tools = () => createChatTools(repos, { ingest: {} as never });
const lines = (r: { items: Array<{ kind: string; line: string }> }) =>
  r.items.map((i) => `${i.kind}: ${i.line}`).join("\n");

describe("expansão da consulta", () => {
  it("palavras sem as vazias, sinônimos e traduções do dicionário e o radical das palavras longas", () => {
    const k8s = expandQuery("k8s");
    expect(k8s).toContain("kubernetes");
    expect(expandQuery("mentoring")).toEqual(expect.arrayContaining(["mentoria", "mentoring"]));
    const iac = expandQuery("infraestrutura como código");
    expect(iac).not.toContain("como");
    expect(iac).toContain("infraestrutura como codigo");
    expect(expandQuery("liderança")).toContain("lider*");
  });
});

describe("fact_search do recrutador", () => {
  it("termos agrupados com OU: acha os fatos de qualquer um dos termos, os que batem mais primeiro", async () => {
    const r = await tools()["fact.search"]({ q: "Kafka mensageria RabbitMQ Redis fila" });
    expect(lines(r)).toMatch(/skill: Redis/);
    expect(lines(r)).toMatch(/project: fila-leve/);
  });

  it("várias consultas numa chamada: cada item diz quais consultas o acharam", async () => {
    const r = await tools()["fact.search"]({ queries: ["mentoria", "Kubernetes"] });
    const mentoria = r.items.find((i) => i.line.startsWith("Mentoria"));
    const k8s = r.items.find((i) => i.kind === "skill" && i.line.startsWith("Kubernetes"));
    expect(mentoria?.matched).toEqual(["mentoria"]);
    expect(k8s?.matched).toEqual(["Kubernetes"]);
  });

  it("sem q nem queries é recusado", async () => {
    await expect(tools()["fact.search"]({})).rejects.toThrow();
  });

  it("a busca das vagas (evidência das palavras-chave) continua exigindo todas as palavras", () => {
    expect(repos.factSearch.search("Kubernetes Python")).toEqual([]);
    expect(repos.factSearch.search("migração Kubernetes").length).toBeGreaterThan(0);
  });

  it("apelido aprendido: liga um termo a um fato que existe e a busca passa a achá-lo", async () => {
    const t = tools();
    expect(lines(await t["fact.search"]({ q: "orquestração de contêineres" }))).not.toMatch(
      /skill: Kubernetes/,
    );
    const k8s = repos.facts.skills.list().find((s) => s.name === "Kubernetes");
    await t["fact.alias_add"]({
      term: "orquestração de contêineres",
      kind: "skill",
      id: k8s?.id ?? "",
    });
    expect(lines(await t["fact.search"]({ q: "orquestração de contêineres" }))).toMatch(
      /skill: Kubernetes/,
    );
    expect(repos.factAliases.list()).toEqual([
      expect.objectContaining({
        term: "orquestração de contêineres",
        kind: "skill",
        factId: k8s?.id,
      }),
    ]);
    await expect(
      t["fact.alias_add"]({ term: "x y", kind: "skill", id: "nao-existe" }),
    ).rejects.toBeInstanceOf(ChatToolError);
  });

  it("benchmark de recall: termo exato, agrupado e tradução voltam inteiros; sinônimo quase", async () => {
    const cases = parseRecallCases(
      readFileSync(new URL("../../../../evals/search/recall.jsonl", import.meta.url), "utf8"),
    );
    const t = tools();
    const r = await factSearchRecall(cases, async (q) => (await t["fact.search"]({ q })).items);
    expect(r.byCategory.exato).toBe(1);
    expect(r.byCategory.agrupado).toBe(1);
    expect(r.byCategory.traducao).toBeGreaterThanOrEqual(0.75);
    expect(r.byCategory.sinonimo).toBeGreaterThanOrEqual(0.8);
  });
});

describe("apelidos aprendidos na tela", () => {
  it("lista com o rótulo do fato; apelido de fato apagado aparece sem rótulo (órfão)", () => {
    const k8s = repos.facts.skills.list().find((s) => s.name === "Kubernetes");
    repos.factAliases.add({ term: "orquestração", kind: "skill", factId: k8s?.id ?? "" });
    repos.factAliases.add({ term: "sumiu", kind: "project", factId: "nao-existe" });
    expect(listFactAliases(repos)).toEqual([
      expect.objectContaining({ term: "sumiu", factLabel: null }),
      expect.objectContaining({ term: "orquestração", kind: "skill", factLabel: "Kubernetes" }),
    ]);
  });
});
