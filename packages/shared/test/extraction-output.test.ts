import { describe, expect, it } from "vitest";
import {
  BuildDigestOutputSchema,
  ExtractFactsOutputSchema,
  extractFactsOutputToProposals,
  ReadDocumentOutputSchema,
} from "../src/index";

const factsOutput = {
  identity: {
    confidence: 0.9,
    fullName: "Ana Maria Exemplo",
    email: "ana.exemplo@example.com",
    country: "BR",
  },
  experiences: [
    {
      confidence: 0.8,
      company: "Acme Ltda",
      title: "Engenheira de Software",
      startDate: "2021-03",
      isCurrent: true,
      tech: ["Go"],
      achievements: [{ confidence: 0.7, text: "Reduziu latência p95 em 40%", metric: "40%" }],
    },
  ],
  education: [
    {
      confidence: 0.95,
      institution: "Unicamp",
      course: "Ciência da Computação",
      status: "completed",
    },
  ],
  skills: [{ confidence: 0.8, name: "Go", category: "language" }],
  languages: [{ confidence: 0.9, name: "Inglês", level: "C1" }],
  links: [{ confidence: 1, label: "GitHub", url: "https://github.com/exemplo" }],
};

describe("M2/shared · schemas de saída da extração", () => {
  it("ReadDocumentOutput exige texto e seções coerentes", () => {
    expect(
      ReadDocumentOutputSchema.safeParse({
        text: "abc",
        sections: [{ title: "Resumo", start: 0, end: 3 }],
      }).success,
    ).toBe(true);
    expect(ReadDocumentOutputSchema.safeParse({ text: "", sections: [] }).success).toBe(false);
  });

  it("ExtractFactsOutput aceita a saída típica e rejeita item sem confiança", () => {
    expect(ExtractFactsOutputSchema.safeParse(factsOutput).success).toBe(true);
    const semConf = { ...factsOutput, skills: [{ name: "Go", category: "language" }] };
    expect(ExtractFactsOutputSchema.safeParse(semConf).success).toBe(false);
  });

  it("BuildDigestOutput é o digest sem fileId e sem editedByUser", () => {
    const ok = BuildDigestOutputSchema.safeParse({
      summary: "Currículo...",
      keyPoints: ["Acme"],
      sections: [{ title: "Experiência", start: 0, end: 10 }],
      meta: { pages: 2, language: "pt" },
    });
    expect(ok.success).toBe(true);
    expect(
      BuildDigestOutputSchema.safeParse({
        summary: "x",
        keyPoints: [],
        sections: [],
        meta: {},
        fileId: "a",
      }).success,
    ).toBe(true);
  });

  it("converte a saída em propostas achatadas, ligando conquistas ao índice da experiência", () => {
    const proposals = extractFactsOutputToProposals(ExtractFactsOutputSchema.parse(factsOutput));
    const kinds = proposals.map((p) => p.kind);
    expect(kinds).toEqual([
      "identity",
      "experience",
      "achievement",
      "education",
      "skill",
      "language",
      "link",
    ]);
    const achievement = proposals.find((p) => p.kind === "achievement");
    expect(achievement?.kind === "achievement" && achievement.data.experienceIndex).toBe(0);
    const identity = proposals.find((p) => p.kind === "identity");
    expect(identity?.confidence).toBe(0.9);
    expect(identity?.kind === "identity" && identity.data.fullName).toBe("Ana Maria Exemplo");
  });

  it("sem identidade e sem experiências devolve só o que existe", () => {
    const { identity: _i, experiences: _e, ...rest } = factsOutput;
    const proposals = extractFactsOutputToProposals(
      ExtractFactsOutputSchema.parse({ ...rest, experiences: [] }),
    );
    expect(proposals.map((p) => p.kind)).toEqual(["education", "skill", "language", "link"]);
  });

  it("conquista de experiência do perfil vira achievement com experienceId; sem id, fica sem experiência", () => {
    const proposals = extractFactsOutputToProposals(
      ExtractFactsOutputSchema.parse({
        ...factsOutput,
        profileAchievements: [
          {
            confidence: 0.8,
            experienceId: "exp-acme",
            text: "Liderou 7 pessoas",
            metric: "7 pessoas",
          },
          { confidence: 0.6, text: "Criou o guia de onboarding" },
        ],
      }),
    );
    const achievements = proposals.filter((p) => p.kind === "achievement");
    expect(achievements.map((p) => p.data)).toEqual([
      { text: "Reduziu latência p95 em 40%", metric: "40%", experienceIndex: 0 },
      { experienceId: "exp-acme", text: "Liderou 7 pessoas", metric: "7 pessoas" },
      { text: "Criou o guia de onboarding" },
    ]);
  });

  it("saída sem profileAchievements (prompts antigos) continua válida", () => {
    const out = ExtractFactsOutputSchema.parse(factsOutput);
    expect(extractFactsOutputToProposals(out).filter((p) => p.kind === "achievement")).toHaveLength(
      1,
    );
  });
});
