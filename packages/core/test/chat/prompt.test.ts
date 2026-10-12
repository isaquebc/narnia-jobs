import { describe, expect, it } from "vitest";
import { renderRecruiterPrompt } from "../../src/chat/prompt";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { buildPersona } from "../../src/profile/persona";
import { seedFixture } from "../../src/testing/profile-fixtures";

const TEMPLATE = `Você é um recrutador {{persona.recruiterSeniority}} especialista em {{persona.specialty}}.
Tom: {{persona.tone}}; honestidade: {{persona.honesty}}; rigor: {{persona.rigor}}.
Mercado {{persona.market}}, nível-alvo {{persona.targetLevel}}, idioma {{persona.language}}.
<cartao>
{{card}}
</cartao>
Fontes confiáveis: {{trusted_domains}}`;

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  return { repos, profile: repos.profiles.get(ids.profileId) };
}

describe("F04/M1 core · renderRecruiterPrompt (fonte única: template do plugin, F04-1)", () => {
  it("preenche persona, cartão e domínios; nada de placeholder sobrando", () => {
    const { repos, profile } = setup();
    if (!profile) throw new Error("perfil");
    const persona = buildPersona(profile);
    const out = renderRecruiterPrompt(TEMPLATE, {
      persona,
      card: "Ana · Engenheira de Software Sênior",
      trustedDomains: repos.trustedDomains.list(),
    });
    expect(out).toContain(`especialista em ${persona.specialty}`);
    expect(out).toContain("Ana · Engenheira de Software Sênior");
    expect(out).toContain("*.gov.br");
    expect(out).not.toMatch(/\{\{/);
  });

  it("reflete a persona configurada pelo usuário (F02-7) e ignora domínios desligados", () => {
    const { repos, profile } = setup();
    if (!profile) throw new Error("perfil");
    repos.trustedDomains.setEnabled("td-ibge", false);
    const persona = buildPersona({ ...profile, personaOverrides: { tone: "cordial" } });
    const out = renderRecruiterPrompt(TEMPLATE, {
      persona,
      card: "x",
      trustedDomains: repos.trustedDomains.list(),
    });
    expect(out).toContain("Tom: cordial");
    expect(out).not.toMatch(/(^|, )ibge\.gov\.br/);
  });

  it("falha se o template tiver placeholder desconhecido ou sem valor", () => {
    const { profile } = setup();
    if (!profile) throw new Error("perfil");
    expect(() =>
      renderRecruiterPrompt(`${TEMPLATE} {{persona.inexistente}}`, {
        persona: buildPersona(profile),
        card: "x",
        trustedDomains: [],
      }),
    ).toThrow(/placeholder/i);
  });
});
