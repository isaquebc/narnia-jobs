import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  addressForm,
  assembleMotivations,
  assumptionAsMotivation,
  MOTIVATION_MAX_CHARS,
  motivationsReviewed,
} from "../../src/profile/motivations";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F12-23 (pedido do dono, 2026-10-26): o que move a pessoa vira configuração por perfil (frases aceitas, editadas ou
 * recusadas; a recusada fica guardada e não volta), sugerida pelo histórico antes das respostas do formulário; o
 * tratamento segue o cadastro, nunca o nome.
 */
const setup = () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const { profileId } = seedFixture(repos, "engineer");
  return { db, repos, profileId };
};

describe("F12-23 · motivações do perfil", () => {
  it("0025 entra sobre o banco anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0024_self_declaration" });
    expect(migrate(db).applied).toEqual(["0025_profile_motivation"]);
  });

  it("guarda por perfil, com estado e origem; editar muda o texto e aceita; recusada continua guardada", () => {
    const { repos, profileId } = setup();
    const a = repos.profileMotivations.add({
      profileId,
      text: "Quero continuar trabalhando com pagamentos.",
      status: "suggested",
      source: "model",
    });
    const b = repos.profileMotivations.add({
      profileId,
      text: "Gosto de cuidar dos serviços de ponta a ponta.",
      status: "suggested",
      source: "model",
    });
    repos.profileMotivations.update(a.id, { text: "Quero seguir em pagamentos e checkout." });
    repos.profileMotivations.update(b.id, { status: "refused" });
    const list = repos.profileMotivations.list(profileId);
    expect(list.map((m) => [m.text, m.status])).toEqual([
      ["Quero seguir em pagamentos e checkout.", "accepted"],
      ["Gosto de cuidar dos serviços de ponta a ponta.", "refused"],
    ]);
    expect(repos.profileMotivations.get(a.id)?.source).toBe("model");
    const src = repos.profiles.get(profileId);
    if (!src) throw new Error("sem perfil");
    const { id: _i, userId: _u, isActive: _a, pitch: _p, personaOverrides: _o, ...rest } = src;
    const other = repos.profiles.clone(profileId, { ...rest, name: "Tech Lead" });
    expect(repos.profileMotivations.list(other.id)).toEqual([]);
    repos.profileMotivations.remove(b.id);
    expect(repos.profileMotivations.list(profileId)).toHaveLength(1);
  });

  it("revisado quando a pessoa aceita uma frase ou segue sem nenhuma (marcado no perfil)", () => {
    const { repos, profileId } = setup();
    expect(motivationsReviewed(repos, profileId)).toBe(false);
    const m = repos.profileMotivations.add({
      profileId,
      text: "Quero liderar times.",
      status: "suggested",
      source: "model",
    });
    expect(motivationsReviewed(repos, profileId)).toBe(false);
    repos.profileMotivations.update(m.id, { status: "accepted" });
    expect(motivationsReviewed(repos, profileId)).toBe(true);
    repos.profileMotivations.update(m.id, { status: "refused" });
    expect(motivationsReviewed(repos, profileId)).toBe(false);
    repos.profileMotivations.markReviewed(profileId);
    expect(repos.profileMotivations.reviewedAt(profileId)).toBeTruthy();
    expect(motivationsReviewed(repos, profileId)).toBe(true);
  });
});

describe("F12-23 · conferência das frases sugeridas", () => {
  const existing = [
    { text: "Quero continuar trabalhando com pagamentos.", status: "accepted" as const },
    { text: "Gosto de ser dono dos serviços.", status: "refused" as const },
  ];

  it("tira vazias, repetidas (inclusive das já guardadas, aceitas ou recusadas) e longas; limita a quantidade", () => {
    const out = assembleMotivations(
      {
        motivations: [
          { text: "  Quero continuar trabalhando com pagamentos!  ", origins: [] },
          { text: "gosto de ser DONO dos serviços", origins: [] },
          { text: "", origins: [] },
          { text: "Quero trabalhar com produtos de saúde.", origins: ["e1"] },
          { text: "quero trabalhar com produtos de saude", origins: [] },
          { text: "x".repeat(MOTIVATION_MAX_CHARS + 1), origins: [] },
          { text: "Gosto de mentorar pessoas.", origins: ["s3"] },
          { text: "Prefiro empresas de produto.", origins: [] },
        ],
      },
      existing,
      2,
    );
    expect(out).toEqual(["Quero trabalhar com produtos de saúde.", "Gosto de mentorar pessoas."]);
  });
});

describe("F12-23 · forma de tratamento pelo cadastro", () => {
  it("feminino, masculino ou neutro; sem escolha (ou valor desconhecido), neutro", () => {
    expect(addressForm("feminino")).toBe("feminino");
    expect(addressForm("ela/dela")).toBe("feminino");
    expect(addressForm("she/her")).toBe("feminino");
    expect(addressForm("masculino")).toBe("masculino");
    expect(addressForm("ele/dele")).toBe("masculino");
    expect(addressForm("he/him")).toBe("masculino");
    expect(addressForm("neutro")).toBe("neutro");
    expect(addressForm("elu/delu")).toBe("neutro");
    expect(addressForm(null)).toBe("neutro");
    expect(addressForm("")).toBe("neutro");
  });
});

describe("F12-23 · suposição do roleplay aceita vira motivação em primeira pessoa", () => {
  it("troca o 'Que você' e o verbo; sem verbo conhecido, só os possessivos; a pessoa pode editar depois", () => {
    expect(assumptionAsMotivation("Que você quer trabalhar com saúde.")).toBe(
      "Quero trabalhar com saúde.",
    );
    expect(assumptionAsMotivation("Que você se interessa por saúde e prevenção.")).toBe(
      "Me interesso por saúde e prevenção.",
    );
    expect(assumptionAsMotivation("Que você gosta de cuidar dos serviços de ponta a ponta.")).toBe(
      "Gosto de cuidar dos serviços de ponta a ponta.",
    );
    expect(assumptionAsMotivation("Que o trabalho remoto pesa na sua escolha.")).toBe(
      "O trabalho remoto pesa na minha escolha.",
    );
    expect(assumptionAsMotivation("Você prefere empresas de produto")).toBe(
      "Prefiro empresas de produto.",
    );
  });
});
