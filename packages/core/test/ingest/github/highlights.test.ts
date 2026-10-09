import { describe, expect, it } from "vitest";
import type { TreeEntry } from "../../../src/ingest/sources/github/collect";
import {
  candidatePathsForDepth,
  classifyPath,
  packContext,
  planCandidates,
  readmeForDepth,
} from "../../../src/ingest/sources/github/highlights";

const tree: TreeEntry[] = [
  { path: "README.md", size: 2400 },
  { path: "package.json", size: 900 },
  { path: "Dockerfile", size: 500 },
  { path: ".github/workflows/ci.yml", size: 700 },
  { path: "src/index.ts", size: 1200 },
  { path: "src/server.ts", size: 3200 },
  { path: "src/routes/payments.ts", size: 6400 },
  { path: "src/lib/money.ts", size: 1800 },
  { path: "test/payments.test.ts", size: 4200 },
  { path: "pnpm-lock.yaml", size: 180000 },
  { path: "docs/arquitetura.png", size: 90000 },
  { path: "node_modules/x/index.js", size: 100 },
  { path: "dist/bundle.js", size: 50000 },
];

const repo = {
  fullName: "ana-exemplo/api-pagamentos",
  description: "API de pagamentos",
  languages: { TypeScript: 52000 },
  topics: ["api"],
  stars: 42,
  pushedAt: "2026-09-28T12:00:00Z",
  isFork: false,
};

describe("F03/M2 highlights: destaques sem tokens (F03-3 §3)", () => {
  it("classifica manifestos, CI, pontos de entrada, testes e amostras; ignora lock, binário, vendor e build", () => {
    expect(classifyPath("package.json")).toBe("manifest");
    expect(classifyPath(".github/workflows/ci.yml")).toBe("manifest");
    expect(classifyPath("Dockerfile")).toBe("manifest");
    expect(classifyPath("src/index.ts")).toBe("entrypoint");
    expect(classifyPath("cmd/api/main.go")).toBe("entrypoint");
    expect(classifyPath("test/payments.test.ts")).toBe("test");
    expect(classifyPath("pkg/x_test.go")).toBe("test");
    expect(classifyPath("src/lib/money.ts")).toBe("sample");
    for (const p of [
      "pnpm-lock.yaml",
      "docs/arquitetura.png",
      "node_modules/x/index.js",
      "dist/bundle.js",
      "README.md",
    ]) {
      expect(classifyPath(p)).toBeNull();
    }
  });

  it("candidatos na ordem de prioridade: manifestos → entrypoints → testes → amostras", () => {
    const cats = planCandidates(tree).map((c) => c.category);
    const order = ["manifest", "entrypoint", "test", "sample"];
    expect([...cats].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(cats);
    expect(planCandidates(tree).map((c) => c.path)).not.toContain("pnpm-lock.yaml");
  });

  it("caminhos por profundidade: rápida só manifestos; equilibrada + entrypoints; profunda tudo", () => {
    expect(candidatePathsForDepth(tree, "quick").every((p) => classifyPath(p) === "manifest")).toBe(
      true,
    );
    expect(candidatePathsForDepth(tree, "balanced")).toEqual(
      expect.arrayContaining(["package.json", "src/index.ts"]),
    );
    expect(candidatePathsForDepth(tree, "balanced")).not.toContain("src/lib/money.ts");
    expect(candidatePathsForDepth(tree, "deep")).toEqual(
      expect.arrayContaining(["test/payments.test.ts", "src/lib/money.ts"]),
    );
  });

  it("README na rápida fica nas 60 primeiras linhas", () => {
    const long = Array.from({ length: 100 }, (_, i) => `linha ${i}`).join("\n");
    expect(readmeForDepth(long, "quick")?.split("\n")).toHaveLength(60);
    expect(readmeForDepth(long, "deep")?.split("\n")).toHaveLength(100);
    expect(readmeForDepth(null, "quick")).toBeNull();
  });

  it("monta o contexto na ordem de prioridade e respeita a fatia e o máximo por arquivo", () => {
    const files = [
      { path: "src/lib/money.ts", content: "s".repeat(3000), truncated: false },
      { path: "test/payments.test.ts", content: "t".repeat(3000), truncated: false },
      { path: "src/index.ts", content: "e".repeat(3000), truncated: false },
      { path: "package.json", content: "m".repeat(3000), truncated: false },
    ];
    const ctx = packContext({
      repo,
      readme: `# API\n${"r".repeat(3000)}`,
      commitMessages: ["feat: estorno parcial"],
      metricsTable: "| total | 87 |",
      files,
      sliceTokens: 2_500,
      maxCharsPerFile: 1_000,
    });
    expect(ctx.chars).toBeLessThanOrEqual(2_500 * 4);
    expect(ctx.tokens).toBeLessThanOrEqual(2_500);
    const pos = (s: string) => ctx.text.indexOf(s);
    expect(pos("ana-exemplo/api-pagamentos")).toBe(pos("ana-exemplo/api-pagamentos"));
    expect(pos("| total | 87 |")).toBeGreaterThan(-1);
    expect(pos("### README.md")).toBeLessThan(pos("### package.json"));
    expect(pos("### package.json")).toBeLessThan(pos("feat: estorno parcial"));
    expect(pos("feat: estorno parcial")).toBeLessThan(pos("### src/index.ts"));
    expect(ctx.text).not.toContain("m".repeat(1001));
    expect(ctx.included).toEqual([
      "README.md",
      "package.json",
      "src/index.ts",
      "test/payments.test.ts",
      "src/lib/money.ts",
    ]);
    expect(ctx.truncated).toEqual(expect.arrayContaining(["README.md", "package.json"]));
  });

  it("fatia pequena: metadados sempre entram; o resto para quando acaba, sem passar do limite", () => {
    const ctx = packContext({
      repo,
      readme: "r".repeat(5000),
      commitMessages: [],
      metricsTable: null,
      files: [{ path: "package.json", content: "m".repeat(5000), truncated: false }],
      sliceTokens: 300,
      maxCharsPerFile: 5_000,
    });
    expect(ctx.text).toContain("ana-exemplo/api-pagamentos");
    expect(ctx.chars).toBeLessThanOrEqual(1_200);
    expect(ctx.skipped).toContain("package.json");
  });

  it("repositório sem testes nem entrypoints só usa o que existe", () => {
    const only = planCandidates([
      { path: "package.json", size: 10 },
      { path: "lib/a.ts", size: 10 },
    ]);
    expect(only.map((c) => c.category)).toEqual(["manifest", "sample"]);
  });

  it("incremental: relatório anterior e diff entram logo após os metadados", () => {
    const ctx = packContext({
      repo,
      readme: "# API",
      commitMessages: [],
      metricsTable: null,
      files: [],
      sliceTokens: 5_000,
      maxCharsPerFile: 2_000,
      previousReport: {
        summary: "API madura",
        stack: ["Node.js"],
        highlights: ["estornos"],
        risks: [],
        suggestedProjects: [],
      },
      diffText: "Diff abc...def (2 commits)",
    });
    expect(ctx.text.indexOf("API madura")).toBeLessThan(ctx.text.indexOf("### README.md"));
    expect(ctx.text.indexOf("Diff abc...def")).toBeLessThan(ctx.text.indexOf("### README.md"));
  });
});
