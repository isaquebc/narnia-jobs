import { describe, expect, it } from "vitest";
import {
  citationTerms,
  parseCitations,
  resolveCitations,
  shortRefs,
  uncitedClaims,
} from "../../src/chat/citations";
import { factIndexText } from "../../src/chat/fact-index";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { createPostingTools } from "../../src/postings/tools";
import { rebuildCard } from "../../src/profile/cards";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Citação conferida por código (F04-fix-fundamentacao, R5, FF-2): o recrutador cita o id curto que o índice e as
 * ferramentas mostram (`[f:…]` fato, `[r:…]` pesquisa, `[v:…]` vaga); o código confere se existe e devolve o rótulo do
 * balão; a frase com número ou termo dos fatos sem citação fica marcada.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  rebuildCard(repos, ids.profileId);
  return { repos, ids };
}

const ref = (id: string) => id.replace(/-/g, "").slice(-6).toLowerCase();

describe("ids curtos", () => {
  it("são os 6 últimos caracteres do id e crescem só quando dois colidem", () => {
    const refs = shortRefs([
      "0190aaaa-0000-7000-8000-00000a1b2c3d",
      "0190aaaa-0000-7000-8000-0000ff1b2c3d",
      "0190aaaa-0000-7000-8000-000000123456",
    ]);
    expect(refs.get("0190aaaa-0000-7000-8000-000000123456")).toBe("123456");
    expect(refs.get("0190aaaa-0000-7000-8000-00000a1b2c3d")).toBe("a1b2c3d");
    expect(refs.get("0190aaaa-0000-7000-8000-0000ff1b2c3d")).toBe("f1b2c3d");
  });

  it("o índice dos fatos mostra o id curto de cada fato", () => {
    const { repos, ids } = setup();
    const text = factIndexText(repos);
    const acme = ids.experienceIds[0] as string;
    expect(text).toContain(`[f:${ref(acme)}]`);
    expect(text).toContain(`[f:${ref(ids.achievementIds[0] as string)}]`);
    expect(text).toMatch(/Mentoria \(4\) \[f:[0-9a-f]{6,}\]/);
  });
});

describe("leitura das citações", () => {
  it("acha as citações soltas e as agrupadas no mesmo colchete", () => {
    expect(
      parseCitations("Reduziu o p95 [f:a1b2c3]. Fonte [r:00ff11; f:abcdef] e [v:123abc]."),
    ).toEqual([
      { token: "[f:a1b2c3]", refs: [{ kind: "f", ref: "a1b2c3" }] },
      {
        token: "[r:00ff11; f:abcdef]",
        refs: [
          { kind: "r", ref: "00ff11" },
          { kind: "f", ref: "abcdef" },
        ],
      },
      { token: "[v:123abc]", refs: [{ kind: "v", ref: "123abc" }] },
    ]);
  });

  it("ignora colchetes que não são citação", () => {
    expect(parseCitations("[link](https://x.com) [f:xyz] [nota: algo]")).toEqual([]);
  });
});

describe("conferência", () => {
  it("fato, pesquisa e vaga que existem viram rótulo do balão; id inventado fica inválido", () => {
    const { repos, ids } = setup();
    const acme = ids.experienceIds[0] as string;
    const src = repos.researchSources.add({
      profileId: ids.profileId,
      sessionId: null,
      url: "https://www.glassdoor.com.br/salarios",
      domain: "glassdoor.com.br",
      title: "Salários de backend sênior",
      excerpt: "média R$ 14.354",
      usedFor: "salary",
      trustTag: "survey",
    });
    const posting = repos.postings.create(
      { company: "Initech", title: "Backend Sênior" },
      { source: "user" },
    );
    const text = `Na Acme [f:${ref(acme)}], média de R$ 14.354 [r:${ref(src.id)}], vaga [v:${ref(posting.id)}] e [f:000000].`;
    const out = resolveCitations(repos, text);
    expect(out.map((c) => [c.kind, c.valid])).toEqual([
      ["f", true],
      ["r", true],
      ["v", true],
      ["f", false],
    ]);
    expect(out[0]).toMatchObject({ label: expect.stringContaining("Acme Pagamentos"), url: null });
    expect(out[1]).toMatchObject({
      label: "Salários de backend sênior",
      detail: expect.stringContaining("glassdoor.com.br"),
      url: "https://www.glassdoor.com.br/salarios",
    });
    expect(out[2]).toMatchObject({
      label: expect.stringContaining("Initech"),
      url: `/vagas/${posting.id}`,
    });
    expect(out[3]).toMatchObject({ label: null, url: null });
  });

  it("conquista, skill, projeto, formação e idioma também resolvem", () => {
    const { repos, ids } = setup();
    const all = [
      ids.achievementIds[0],
      ids.skillIds[0],
      ids.projectIds[0],
      ids.educationIds[0],
      ids.languageIds[0],
    ] as string[];
    const out = resolveCitations(repos, all.map((id) => `[f:${ref(id)}]`).join(" "));
    expect(out.every((c) => c.valid && c.label)).toBe(true);
  });
});

describe("frases sem citação", () => {
  it("marca frase com número ou termo dos fatos sem citação; pergunta e frase citada passam", () => {
    const { repos, ids } = setup();
    const terms = citationTerms(repos);
    expect(terms).toContain("Acme Pagamentos");
    const acme = ref(ids.experienceIds[0] as string);
    const text = [
      `Você reduziu o p95 de 800 para 300 ms na Acme Pagamentos [f:${acme}].`,
      "Espere uma contraproposta perto de R$ 18–20 mil.",
      "Na Acme Pagamentos você liderou a migração.",
      "Quer que eu pesquise 3 fontes?",
      "Vale revisar o resumo do perfil.",
    ].join(" ");
    expect(uncitedClaims(text, terms)).toEqual([
      "Espere uma contraproposta perto de R$ 18–20 mil.",
      "Na Acme Pagamentos você liderou a migração.",
    ]);
  });

  it("ignora números de lista, títulos e código", () => {
    const text = "## 2 pontos\n1. **Resumo** sem dado.\n`v2` é o nome do arquivo.";
    expect(uncitedClaims(text, [])).toEqual([]);
  });
});

describe("ferramentas de vaga", () => {
  it("busca e detalhe devolvem o ref v: da vaga", async () => {
    const { repos } = setup();
    const p = repos.postings.create(
      { company: "Initech", title: "Backend Sênior" },
      { source: "user" },
    );
    const tools = createPostingTools(repos, {
      ports: { intake: async () => ({ ok: false, code: "x", message: "x" }) },
    });
    expect((await tools["posting.get"]({ id: p.id })).ref).toBe(`v:${ref(p.id)}`);
    expect((await tools["posting.search"]({ query: "Initech" })).items[0]?.ref).toBe(
      `v:${ref(p.id)}`,
    );
  });
});
