import { describe, expect, it } from "vitest";
import {
  declarationAnswer,
  matchDeclarationOption,
  PREFER_NOT,
} from "../../src/applications/self-declaration";
import { createRepos, migrate, openDatabase } from "../../src/db";

/**
 * F12-12 (decisão F12-22): a autodeclaração é perguntada à pessoa no chat e guardada só no narnia, numa tabela
 * própria (fora dos fatos, para nunca chegar ao CV); com o dado guardado, o código escolhe a opção da página.
 */
const opts = (...labels: string[]) => labels.map((label, i) => ({ value: `v${i}`, label }));

describe("F12-12 · autodeclaração guardada", () => {
  it("guarda por assunto (a mais nova vale), lista e apaga; 0024 entra sobre o banco anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0023_application_chat" });
    expect(migrate(db, { until: "0024_self_declaration" }).applied).toEqual([
      "0024_self_declaration",
    ]);
    const repos = createRepos(db);
    expect(repos.selfDeclarations.get("race")).toBeNull();
    repos.selfDeclarations.set("race", "Parda");
    repos.selfDeclarations.set("race", "Parda (mestiça)");
    repos.selfDeclarations.set("disability", PREFER_NOT);
    expect(repos.selfDeclarations.get("race")?.value).toBe("Parda (mestiça)");
    expect(repos.selfDeclarations.list().map((d) => d.topic)).toEqual(["disability", "race"]);
    repos.selfDeclarations.remove("race");
    expect(repos.selfDeclarations.get("race")).toBeNull();
  });
});

describe("F12-12 · opção da página pelo código, sem modelo", () => {
  it("casa sem acento, sem caixa e com o gênero gramatical da página", () => {
    expect(matchDeclarationOption("Parda", opts("Branca", "Preta", "Parda", "Amarela"))).toBe(
      "Parda",
    );
    expect(matchDeclarationOption("parda", opts("Branco(a)", "Pardo(a)", "Preto(a)"))).toBe(
      "Pardo(a)",
    );
    expect(
      matchDeclarationOption("Mulher", opts("Homem", "Mulher cis", "Mulher trans")),
    ).toBeNull();
    expect(matchDeclarationOption("não", opts("Sim", "Não"))).toBe("Não");
    expect(matchDeclarationOption("Feminino", opts("Masculino", "Feminino", "Outro"))).toBe(
      "Feminino",
    );
  });

  it("'prefiro não informar' acha a opção equivalente em pt e en; sem ela, nada é escolhido", () => {
    expect(matchDeclarationOption(PREFER_NOT, opts("Sim", "Não", "Prefiro não informar"))).toBe(
      "Prefiro não informar",
    );
    expect(matchDeclarationOption(PREFER_NOT, opts("Yes", "No", "I don't wish to answer"))).toBe(
      "I don't wish to answer",
    );
    expect(matchDeclarationOption(PREFER_NOT, opts("Decline to self-identify", "Yes"))).toBe(
      "Decline to self-identify",
    );
    expect(matchDeclarationOption(PREFER_NOT, opts("Sim", "Não"))).toBeNull();
  });

  it("ambíguo (casa com mais de uma opção) não escolhe: a pessoa decide", () => {
    expect(matchDeclarationOption("branca", opts("Branca", "Branca e indígena"))).toBe("Branca");
    expect(matchDeclarationOption("mulher", opts("Mulher cis", "Mulher trans"))).toBeNull();
  });

  it("valor da pergunta: a opção casada ou, em campo de texto, o que a pessoa declarou", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const q = { kind: "self_declaration" as const, topic: "race" as const };
    expect(declarationAnswer(repos, { ...q, options: opts("Branca", "Parda") })).toBeNull();
    repos.selfDeclarations.set("race", "Parda");
    expect(declarationAnswer(repos, { ...q, options: opts("Branca", "Parda") })).toBe("Parda");
    expect(declarationAnswer(repos, { ...q, options: [] })).toBe("Parda");
    expect(declarationAnswer(repos, { ...q, options: opts("Branco", "Preto") })).toBeNull();
    repos.selfDeclarations.set("race", PREFER_NOT);
    expect(declarationAnswer(repos, { ...q, options: [] })).toBeNull();
    expect(declarationAnswer(repos, { ...q, topic: null, options: opts("Parda") })).toBeNull();
  });
});
