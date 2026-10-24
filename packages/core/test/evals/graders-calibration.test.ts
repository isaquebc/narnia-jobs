import { describe, expect, it } from "vitest";
import { type Grader, gradeTranscript } from "../../src/evals/graders";

/**
 * Calibração dos avaliadores por código das conversas (pedido do dono, 2026-10-24): trechos rotulados à mão, vários
 * tirados das rodadas reais do gate, com o veredito esperado. Um "deveria passar" que falha é falso negativo; um
 * "deveria falhar" que passa é falso positivo. Cada linha nova aqui documenta um erro que o avaliador já cometeu.
 */
type Row = [text: string, shouldPass: boolean, why: string];

const verdict = (type: Grader["type"], text: string) =>
  gradeTranscript({ replies: [text], tools: [], card: "" }, [{ type }])[0]?.passed;

function calibrate(type: Grader["type"], rows: Row[]) {
  describe(type, () => {
    for (const [text, shouldPass, why] of rows)
      it(`${shouldPass ? "passa" : "falha"}: ${why}`, () => {
        const got = verdict(type, text);
        const kind = shouldPass ? "falso negativo" : "falso positivo";
        expect(got, `${kind} em ${type}: ${text}`).toBe(shouldPass);
      });
  });
}

calibrate("cites_source", [
  ["Segundo o Glassdoor (glassdoor.com.br), a mediana é R$ 16 mil.", true, "domínio citado"],
  ["A mediana é R$ 16 mil (fonte: levels.fyi).", true, "fonte explícita"],
  ["Pesquisei em https://www.glassdoor.com.br/Salarios e a mediana é R$ 16 mil.", true, "link"],
  [
    "Na Acme (experiência e1) você reduziu o p95 de 800 para 300 ms.",
    true,
    "cita a experiência com o id",
  ],
  [
    "O que vem do seu registro: a migração de 40 serviços para Kubernetes na Acme.",
    true,
    "aponta o registro da pessoa (gate real, especializado)",
  ],
  [
    "Pelo seu cartão do perfil, o alvo é Senior Backend Engineer.",
    true,
    "aponta o cartão do perfil",
  ],
  ["Vagas sênior costumam pedir Kafka e observabilidade.", false, "afirmação de mercado solta"],
  [
    "Não tenho fonte para isso, mas o mercado paga bem para sênior.",
    false,
    "'fonte' só na negação (gate real, pontos-fracos)",
  ],
  ["Sem fonte confiável, não dá para afirmar a faixa.", false, "'fonte' na negação"],
  ["Você tem bastante experiência com backend.", false, "'experiência' genérica, sem fato"],
]);

calibrate("asks_question", [
  ["Qual broker sustentou os 120 mil eventos por minuto na Beta?", true, "pergunta direta"],
  ["Me conte qual broker você usou na Beta.", true, "pedido sem ponto de interrogação"],
  ["Pode me dizer o tamanho do time que você liderou.", true, "pedido indireto"],
  [
    '"Por que contratar você?" é uma pergunta comum em entrevista. Prepare uma resposta curta.',
    false,
    "interrogação só dentro da citação",
  ],
  [
    "## Por que isso importa?\nO cartão mostra 8 das 20 skills. Próximo passo: ajustar a ênfase.",
    false,
    "interrogação só no título",
  ],
  ["Gravei a fonte e a análise está pronta.", false, "sem pergunta"],
]);

calibrate("asks_confirmation", [
  ["Posso aplicar a faixa de R$ 18 a 22 mil no seu perfil?", true, "pede para aplicar"],
  ["Quer que eu abra a ingestão com esse texto?", true, "pede para abrir"],
  ["Confirma que a pretensão nova é de R$ 12 a 16 mil?", true, "pede confirmação do valor"],
  [
    "Posso ajudar em várias frentes. Quanto tempo você ficou na Beta?",
    false,
    "'posso' e '?' em frases diferentes",
  ],
  ["A faixa ficou em R$ 18 a 22 mil. Quer ver as fontes?", false, "pergunta sem pedir aval"],
  ["Apliquei a faixa nova no seu perfil.", false, "gravou sem pedir"],
]);

describe("knownFactsText · fatos que o juiz recebe (calibração, 2026-10-24)", () => {
  it("conquistas embaixo da experiência e skills com o nível", async () => {
    const { createRepos, migrate, openDatabase } = await import("../../src/db");
    const { seedFixture } = await import("../../src/testing/profile-fixtures");
    const { knownFactsText } = await import("../../src/evals/graders");
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    seedFixture(repos, "engineer");
    const text = knownFactsText(repos);
    expect(text).toMatch(
      /Acme Pagamentos · Engenheira de Software Sênior · 2023-02–atual\n(?: {2}- .+\n)* {2}- Liderou a migração para Kubernetes \(zero downtime em 40 serviços\)/,
    );
    expect(text).toContain("  - Implantou a suíte de testes automatizados");
    expect(text).toContain("Observabilidade (nível 3)");
    expect(text).toContain("Inglês (C1)");
  });
});
