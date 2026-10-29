import { describe, expect, it } from "vitest";
import { factIndexText } from "../../src/chat/fact-index";
import { recruiterContext } from "../../src/chat/recruiter-context";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { rebuildCard } from "../../src/profile/cards";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Índice dos fatos no contexto do recrutador (F04-fix-fundamentacao, R2, FF-6): uma linha por fato, de todos os fatos
 * do usuário (o perfil é só o viés), na ordem da relevância do perfil ativo, com teto de tamanho. Sem ele, o
 * recrutador só via o cartão e dizia "mentoria não está no seu perfil" com "Mentoria (nível 4)" nos fatos.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  rebuildCard(repos, ids.profileId);
  return { repos, ids };
}

describe("índice dos fatos", () => {
  it("todos os fatos, uma linha cada, com as conquistas embaixo da experiência e o nível das skills", () => {
    const { repos } = setup();
    const text = factIndexText(repos);
    expect(text).toMatch(/Mentoria \(4\)/);
    expect(text).toMatch(/Acme Pagamentos · Engenheira de Software Sênior · 2023-02–atual/);
    expect(text).toMatch(/\n {2}- Reduziu a latência p95 do checkout \(de 800 ms para 300 ms\)/);
    expect(text).toMatch(/Unicamp · Ciência da Computação/);
    expect(text).toMatch(/fila-leve/);
    expect(text).toMatch(/Inglês \(C1\)/);
  });

  it("com teto, corta pelo fim e diz quantos ficaram para a busca", () => {
    const { repos } = setup();
    const text = factIndexText(repos, { maxChars: 400 });
    expect(text.length).toBeLessThan(560);
    expect(text).toMatch(/e mais \d+ fatos: use fact_search/);
  });

  it("entra no contexto do recrutador e o hash muda quando um fato muda", () => {
    const { repos } = setup();
    const before = recruiterContext(repos);
    expect(before.text).toMatch(/### Índice dos seus fatos/);
    const skill = repos.facts.skills.list().find((s) => s.name === "Go");
    repos.facts.skills.update(skill?.id ?? "", { level: 4 });
    expect(recruiterContext(repos).hash).not.toBe(before.hash);
  });
});
