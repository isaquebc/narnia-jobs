import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factIndexOverflow } from "../../src/chat/fact-index";
import { createChatTools } from "../../src/chat/tools";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { conceptEmbedder, type Embedder } from "../../src/search/embedder";
import { createSemanticSearch, syncFactVectors } from "../../src/search/semantic";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * R6 (F04-fix-fundamentacao, FF-5, FF-7): busca por sentido opcional. Os vetores dos fatos são derivados (hash do texto
 * e modelo); a `fact_search` junta a busca por termos com a vetorial (RRF) quando a busca por sentido está ligada. Nos
 * testes, um vetorizador de conceitos determinístico (o modelo real só no benchmark).
 */
let repos: Repos;
let db: ReturnType<typeof openDatabase>;

/** "fintech" e "Acme Pagamentos" no mesmo conceito, sem palavra em comum. */
const CONCEPTS = [
  ["fintech", "pagamentos", "banco digital"],
  ["faculdade", "graduação", "ciência da computação", "bacharelado"],
  ["monitoramento", "observabilidade"],
];

function counting(e: Embedder) {
  const calls: string[][] = [];
  return {
    calls,
    embedder: {
      model: e.model,
      embed: async (texts: string[], role: "query" | "passage") => {
        calls.push(texts);
        return e.embed(texts, role);
      },
    } satisfies Embedder,
  };
}

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  repos = createRepos(db);
  seedFixture(repos, "engineer");
});
afterEach(() => db.close());

describe("vetorizador de conceitos (testes e e2e)", () => {
  it("determinístico e normalizado; conceito em comum aproxima textos sem palavra em comum", async () => {
    const e = conceptEmbedder(CONCEPTS);
    const [a, b, c] = await e.embed(["fintech", "Acme Pagamentos", "Unicamp"], "passage");
    const dot = (x?: Float32Array, y?: Float32Array) =>
      Array.from(x ?? []).reduce((s, v, i) => s + v * (y?.[i] ?? 0), 0);
    expect(dot(a, a)).toBeCloseTo(1);
    expect(dot(a, b)).toBeGreaterThan(0.5);
    expect(dot(a, c)).toBeLessThan(0.5);
    expect(await e.embed(["fintech"], "query")).toEqual(await e.embed(["fintech"], "query"));
  });
});

describe("syncFactVectors", () => {
  it("vetoriza todos os fatos uma vez; sem mudança, não chama o modelo de novo", async () => {
    const { embedder, calls } = counting(conceptEmbedder(CONCEPTS));
    const first = await syncFactVectors(repos, embedder);
    const total = (db.prepare("select count(*) as n from fact_fts").get() as { n: number }).n;
    expect(first).toEqual({ added: total, updated: 0, removed: 0 });
    calls.length = 0;
    expect(await syncFactVectors(repos, embedder)).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("fato editado é refeito; fato apagado sai; outro modelo refaz tudo", async () => {
    const e = conceptEmbedder(CONCEPTS);
    await syncFactVectors(repos, e);
    const skill = repos.facts.skills.list()[0];
    if (!skill) throw new Error("fixture sem skill");
    repos.facts.skills.update(skill.id, { name: "Observabilidade avançada" });
    expect(await syncFactVectors(repos, e)).toMatchObject({ updated: 1, removed: 0 });
    repos.facts.skills.remove(skill.id);
    expect(await syncFactVectors(repos, e)).toMatchObject({ removed: 1 });
    const other = { ...e, model: "outro-modelo" };
    const total = (db.prepare("select count(*) as n from fact_fts").get() as { n: number }).n;
    expect((await syncFactVectors(repos, other)).added).toBe(total);
  });
});

describe("busca por sentido", () => {
  it("acha pelo conceito o fato que a busca por termos não acha, com o filtro de tipo", async () => {
    const s = createSemanticSearch(repos, conceptEmbedder(CONCEPTS));
    const hits = await s.search("fintech", { limit: 5 });
    expect(hits[0]).toMatchObject({ kind: "experience" });
    const acme = repos.facts.experiences.list().find((x) => x.company.includes("Acme"));
    expect(hits.map((h) => h.id)).toContain(acme?.id);
    const onlySkills = await s.search("fintech", { kinds: ["skill"], limit: 5 });
    expect(onlySkills.every((h) => h.kind === "skill")).toBe(true);
  });

  it("fact_search junta termos e sentido (RRF) quando ligada; desligada, fica como antes", async () => {
    const plain = createChatTools(repos, { ingest: {} as never });
    const before = await plain["fact.search"]({ q: "fintech" });
    expect(before.items.some((i) => i.kind === "experience")).toBe(false);

    const semantic = createSemanticSearch(repos, conceptEmbedder(CONCEPTS));
    const t = createChatTools(repos, { ingest: {} as never, semantic });
    const after = await t["fact.search"]({ q: "fintech" });
    const acme = after.items.find((i) => i.kind === "experience" && i.line.includes("Acme"));
    expect(acme).toBeDefined();
    expect(acme?.matched).toEqual(["fintech"]);
    expect(acme?.bySense).toBe(true);
    // o que a busca por termos acha continua no topo
    const exact = await t["fact.search"]({ q: "Kubernetes" });
    expect(exact.items[0]?.line).toContain("Kubernetes");
    expect(exact.items[0]?.bySense).toBeUndefined();
  });

  it("erro do modelo não derruba a busca: volta a busca por termos", async () => {
    const broken: Embedder = {
      model: "quebrado",
      embed: async () => {
        throw new Error("modelo indisponível");
      },
    };
    const t = createChatTools(repos, {
      ingest: {} as never,
      semantic: createSemanticSearch(repos, broken),
    });
    const r = await t["fact.search"]({ q: "Kubernetes" });
    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe("factIndexOverflow (alerta do limite, FF-7)", () => {
  it("conta os fatos que ficaram fora do índice no contexto", () => {
    expect(factIndexOverflow(repos)).toBe(0);
    expect(factIndexOverflow(repos, { maxChars: 400 })).toBeGreaterThan(0);
  });
});
