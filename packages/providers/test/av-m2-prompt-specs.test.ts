import { describe, expect, it } from "vitest";
import {
  ClaudeCodeProvider,
  PROMPTS,
  type QueryFn,
  renderTemplate,
  type SdkQueryOptions,
  STRUCTURED_PROMPTS,
  structuredPromptVars,
} from "../src/index";

/**
 * Avaliações no Phoenix (M2, decisão AV-4): os 8 prompts estruturados têm uma fonte só. O template da mensagem do
 * usuário que vai para o Phoenix é o mesmo que o provider renderiza em cada chamada.
 */
function capture() {
  const prompts: string[] = [];
  const query = ((p: { prompt: string; options: SdkQueryOptions }) => {
    prompts.push(p.prompt);
    return (async function* () {
      yield { type: "result", subtype: "error_during_execution", is_error: true, result: "x" };
    })();
  }) as unknown as QueryFn;
  const provider = new ClaudeCodeProvider({
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    query,
    binaryPath: "/bin/claude",
  });
  return { prompts, provider };
}

describe("registro dos prompts estruturados", () => {
  it("14 operações (F06: + 3 da vaga; F05: CV e carta), nome narnia-*, system do arquivo, modelo padrão, schema e template sem sobra", () => {
    const ops = Object.keys(STRUCTURED_PROMPTS).sort();
    expect(ops).toEqual(
      [
        "analyzeProfiles",
        "analyzeRepo",
        "buildDigest",
        "chatTitle",
        "checkProposals",
        "coverLetterGenerate",
        "cvGenerate",
        "extractFacts",
        "pickFiles",
        "postingDuplicate",
        "postingExtract",
        "postingMerge",
        "readDocument",
        "synthesizeRun",
      ].sort(),
    );
    for (const [op, spec] of Object.entries(STRUCTURED_PROMPTS)) {
      expect(spec.name).toMatch(/^narnia-[a-z-]+$/);
      expect(spec.system()).toBe(PROMPTS[op as keyof typeof PROMPTS]());
      expect(["haiku", "sonnet"]).toContain(spec.defaultModel);
      expect(spec.jsonSchema).toMatchObject({ type: "object" });
      const used = new Set([...spec.userTemplate.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
      expect([...used].sort()).toEqual([...spec.variables].sort());
    }
    expect(STRUCTURED_PROMPTS.readDocument.tools).toEqual(["Read"]);
    expect(STRUCTURED_PROMPTS.extractFacts.tools).toEqual([]);
  });

  it("renderTemplate troca uma vez (conteúdo com chaves não é reinterpretado) e acusa variável faltando", () => {
    expect(renderTemplate("a {{x}} b {{x}}", { x: "{{y}}" })).toBe("a {{y}} b {{y}}");
    expect(() => renderTemplate("{{x}} {{z}}", { x: "1" })).toThrow(/z/);
  });

  it("o provider envia exatamente o template renderizado com as variáveis da entrada", async () => {
    const c = capture();
    const ef = { text: "Ana {{não é variável}}", locale: "pt-BR", model: "haiku" };
    await c.provider.extractFacts(ef).catch(() => undefined);
    const pf = {
      repo: "a/b",
      tree: ["README.md", "src/x.ts"],
      candidates: ["README.md"],
      maxFiles: 4,
      model: "haiku",
    };
    await c.provider.pickFiles(pf).catch(() => undefined);
    const bd = { text: "t", locale: "pt-BR", proposals: [], model: "sonnet" };
    await c.provider.buildDigest(bd).catch(() => undefined);
    const sr = {
      reports: [{ fullName: "a/b", report: { summary: "s" } as never }],
      metricsTable: "| a |",
      model: "sonnet",
    };
    await c.provider.synthesizeRun(sr).catch(() => undefined);
    const rd = { filePath: "/data/uploads/cv.pdf", locale: "pt-BR", model: "haiku" };
    await c.provider.readDocument(rd).catch(() => undefined);
    const r = (op: keyof typeof STRUCTURED_PROMPTS, input: unknown) =>
      renderTemplate(
        STRUCTURED_PROMPTS[op].userTemplate,
        (structuredPromptVars[op] as (i: unknown) => Record<string, string>)(input),
      );
    expect(c.prompts).toEqual([
      r("extractFacts", ef),
      r("pickFiles", pf),
      r("buildDigest", bd),
      r("synthesizeRun", sr),
      r("readDocument", rd),
    ]);
    expect(c.prompts[0]).toBe(
      "Idioma do documento: pt-BR.\n\n<experiencias_no_perfil>\n[]\n</experiencias_no_perfil>\n\n<documento>\nAna {{não é variável}}\n</documento>",
    );
    expect(c.prompts[4]).toContain('Leia o arquivo "cv.pdf"');
  });
});
