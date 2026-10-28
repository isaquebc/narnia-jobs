import { describe, expect, it } from "vitest";
import { canonicalTerm } from "../../src/postings/dictionary";
import { analyzePostingText } from "../../src/postings/heuristics";
import { JD_EN, JD_LEAD, JD_NO_HEADERS, JD_PT } from "./fixtures";

/** F06-1 · heurística sem tokens: dicionário + n-gramas, seções, senioridade, contrato, moeda, benefícios, local. */
describe("F06/M3 core · dicionário", () => {
  it("sinônimos levam ao canônico; termos ambíguos não casam pela palavra comum", () => {
    expect(canonicalTerm("ReactJS")?.canonical).toBe("React");
    expect(canonicalTerm("node")?.canonical).toBe("Node.js");
    expect(canonicalTerm("Postgres")?.canonical).toBe("PostgreSQL");
    expect(canonicalTerm("golang")?.canonical).toBe("Go");
    expect(canonicalTerm("Go")?.canonical).toBe("Go");
    expect(canonicalTerm("go")).toBeNull();
    expect(canonicalTerm("k8s")?.canonical).toBe("Kubernetes");
  });
});

describe("F06/M3 core · analyzePostingText", () => {
  it("pt-BR: separa obrigatórios, diferenciais, responsabilidades e benefícios", () => {
    const h = analyzePostingText(JD_PT);
    expect(h.sectionsDetected).toBe(true);
    const req = h.keywords.filter((k) => k.section === "required").map((k) => k.term);
    const nice = h.keywords.filter((k) => k.section === "nice").map((k) => k.term);
    expect(req).toEqual(
      expect.arrayContaining([
        "Java",
        "Spring",
        "Kafka",
        "PostgreSQL",
        "Redis",
        "Docker",
        "Kubernetes",
        "Inglês",
      ]),
    );
    expect(nice).toEqual(expect.arrayContaining(["AWS", "Terraform"]));
    expect(nice).not.toContain("Java");
    expect(h.fields.skillsRequired).toContain("Experiência com Kafka e mensageria");
    expect(h.fields.skillsNice).toEqual(["Conhecimento em AWS", "Experiência com Terraform"]);
    expect(h.fields.responsibilities?.[0]).toBe(
      "Desenvolver microsserviços em Java 17 com Spring Boot",
    );
    expect(h.fields.benefits).toEqual(["Vale refeição", "Plano de saúde", "Gympass", "PLR"]);
  });

  it("pt-BR: cargo, senioridade, role, contrato, modo, local, moeda e faixa", () => {
    const h = analyzePostingText(JD_PT);
    expect(h.fields).toMatchObject({
      title: "Desenvolvedor(a) Backend Sênior",
      seniority: "senior",
      role: "backend",
      contractType: "clt",
      workMode: "hybrid",
      city: "São Paulo",
      state: "SP",
      country: "BR",
      currency: "BRL",
      salaryMin: 15000,
      salaryMax: 20000,
      salaryPeriod: "monthly",
      client: "Itaú Unibanco",
    });
    expect(h.yearsMin).toBe(5);
  });

  it("en-US: aliases (ReactJS, Node.js, Go pela grafia), remoto, PJ, USD", () => {
    const h = analyzePostingText(JD_EN);
    const terms = h.keywords.map((k) => k.term);
    expect(terms).toEqual(
      expect.arrayContaining([
        "Go",
        "TypeScript",
        "Node.js",
        "React",
        "PostgreSQL",
        "gRPC",
        "Kubernetes",
        "Inglês",
        "Kafka",
        "Rust",
      ]),
    );
    expect(h.keywords.find((k) => k.term === "Rust")?.section).toBe("nice");
    expect(h.fields).toMatchObject({
      seniority: "senior",
      workMode: "remote",
      contractType: "pj",
      currency: "USD",
      salaryMin: 6000,
      salaryMax: 8000,
      salaryPeriod: "monthly",
    });
    expect(h.yearsMin).toBe(6);
    expect(h.fields.benefits).toEqual(["Home office allowance", "Stock options"]);
  });

  it("sem cabeçalhos: tudo obrigatório com a flag; presencial em Campinas/SP, PJ, pleno, frontend", () => {
    const h = analyzePostingText(JD_NO_HEADERS);
    expect(h.sectionsDetected).toBe(false);
    expect(h.keywords.every((k) => k.section === "required")).toBe(true);
    expect(h.keywords.map((k) => k.term)).toEqual(
      expect.arrayContaining(["React", "TypeScript", "Next.js"]),
    );
    expect(h.fields).toMatchObject({
      seniority: "pleno",
      role: "frontend",
      workMode: "onsite",
      city: "Campinas",
      state: "SP",
      contractType: "pj",
    });
  });

  it("gestão: role engineering_manager, senioridade manager, termos de liderança", () => {
    const h = analyzePostingText(JD_LEAD);
    expect(h.fields).toMatchObject({
      role: "engineering_manager",
      seniority: "manager",
      workMode: "remote",
    });
    expect(h.keywords.map((k) => k.term)).toEqual(
      expect.arrayContaining(["Gestão de pessoas", "OKR", "AWS"]),
    );
  });

  it("n-gramas: termo técnico fora do dicionário aparece; ruído não", () => {
    const h = analyzePostingText(
      `${JD_PT}\nUsamos o ZeroMQ e o Temporal.io no dia a dia. ZeroMQ é central.`,
    );
    expect(h.ngrams).toContain("ZeroMQ");
    expect(h.ngrams.join(" ")).not.toMatch(/equipe|dinâmica/i);
  });

  it("senioridade: Pleno/Sênior fica com a maior; ausência é null", () => {
    expect(analyzePostingText("Desenvolvedor Pleno/Sênior Java").fields.seniority).toBe("senior");
    expect(analyzePostingText("Vaga de desenvolvimento Java").fields.seniority).toBeUndefined();
  });
  it("F07/M2 · etapas do processo: seção com itens ou linha com setas; sem seção, nenhuma", () => {
    const h = analyzePostingText(
      `${JD_PT}\n\nEtapas do processo seletivo:\n1. Triagem com RH\n2. Case técnico\n3. Conversa com o CTO`,
    );
    expect(h.fields.hiringSteps).toEqual(["Triagem com RH", "Case técnico", "Conversa com o CTO"]);
    expect(
      analyzePostingText("Vaga Backend\nProcesso seletivo: Triagem → Entrevista técnica → Proposta")
        .fields.hiringSteps,
    ).toEqual(["Triagem", "Entrevista técnica", "Proposta"]);
    expect(analyzePostingText(JD_PT).fields.hiringSteps).toBeUndefined();
  });
});
