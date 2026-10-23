import type { FormField } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  assembleQuestions,
  classifyField,
  heuristicQuestions,
  prefillValue,
} from "../../src/applications/locate";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F12/M3 · localizar as perguntas (§4.6-1): campos óbvios (nome, e-mail, telefone, links, cidade) saem direto dos
 * dados, sem modelo; consentimento e autodeclaração são marcados por código (F12-12) e nunca recebem sugestão; o resto
 * vai para o Haiku, e o código confere o que ele devolve (campo inexistente, opção inventada, campo esquecido).
 */
const field = (ref: string, over: Partial<FormField> = {}): FormField => ({
  ref,
  control: "text",
  label: null,
  name: null,
  placeholder: null,
  help: null,
  section: null,
  required: false,
  maxLength: null,
  options: [],
  autocomplete: null,
  ...over,
});

describe("F12/M3 · heurística dos campos", () => {
  it("campos óbvios pelo autocomplete, pelo tipo ou pelo rótulo (pt e en)", () => {
    expect(classifyField(field("f1", { label: "Nome completo *" })).profileField).toBe("full_name");
    expect(classifyField(field("f1", { label: "First Name" })).profileField).toBe("first_name");
    expect(classifyField(field("f1", { label: "Sobrenome" })).profileField).toBe("last_name");
    expect(
      classifyField(field("f1", { control: "email", label: "Seu contato" })).profileField,
    ).toBe("email");
    expect(classifyField(field("f1", { label: "Celular (WhatsApp)" })).profileField).toBe("phone");
    expect(classifyField(field("f1", { autocomplete: "family-name" })).profileField).toBe(
      "last_name",
    );
    expect(classifyField(field("f1", { control: "url", label: "LinkedIn URL" })).profileField).toBe(
      "linkedin",
    );
    expect(classifyField(field("f1", { label: "Cidade onde mora" })).profileField).toBe("city");
    // parecido, mas não é o nome da pessoa
    expect(classifyField(field("f1", { label: "Nome da última empresa" })).profileField).toBeNull();
    expect(classifyField(field("f1", { label: "Nome social" })).profileField).toBeNull();
    // rótulo de nome num campo de texto longo não é campo óbvio
    expect(
      classifyField(field("f1", { control: "textarea", label: "Nome e descrição do projeto" }))
        .profileField,
    ).toBeNull();
  });

  it("consentimento e autodeclaração por código", () => {
    expect(
      classifyField(
        field("f1", { control: "checkbox", label: "Li e aceito a política de privacidade (LGPD)" }),
      ).consent,
    ).toBe(true);
    expect(
      classifyField(field("f1", { control: "checkbox", label: "I agree to the Terms" })).consent,
    ).toBe(true);
    expect(classifyField(field("f1", { control: "select", label: "Raça/cor" })).topic).toBe("race");
    expect(classifyField(field("f1", { control: "select", label: "Gender" })).topic).toBe("gender");
    expect(classifyField(field("f1", { label: "Orientação sexual" })).topic).toBe(
      "sexual_orientation",
    );
    expect(classifyField(field("f1", { label: "Você é PcD?" })).topic).toBe("disability");
    expect(classifyField(field("f1", { control: "date", label: "Data de nascimento" })).topic).toBe(
      "age",
    );
    expect(
      classifyField(
        field("f1", { control: "radio", label: "Você faz parte de algum grupo sub-representado?" }),
      ).topic,
    ).toBe("other");
    expect(classifyField(field("f1", { label: "Por que você quer trabalhar aqui?" }))).toEqual({
      profileField: null,
      consent: false,
      topic: null,
    });
  });

  it("perguntas da heurística e os campos que sobram para o modelo", () => {
    const fields = [
      field("f1", { label: "Nome completo", required: true }),
      field("f2", { control: "textarea", label: "Por que você?", maxLength: 500 }),
      field("f3", { control: "checkbox", label: "Aceito os termos de uso" }),
      field("f4", {
        control: "select",
        label: "Gênero",
        options: [
          { value: "f", label: "Feminino" },
          { value: "n", label: "Prefiro não informar" },
        ],
      }),
    ];
    const h = heuristicQuestions(fields);
    expect(h.questions.map((q) => [q.fieldRefs[0], q.kind, q.profileField, q.topic])).toEqual([
      ["f1", "short_text", "full_name", null],
      ["f3", "consent", null, null],
      ["f4", "self_declaration", null, "gender"],
    ]);
    expect(h.questions[2]?.options.map((o) => o.label)).toEqual([
      "Feminino",
      "Prefiro não informar",
    ]);
    expect(h.rest.map((f) => f.ref)).toEqual(["f2"]);
  });
});

describe("F12/M3 · montagem das perguntas", () => {
  const fields = [
    field("f1", { label: "Nome completo" }),
    field("f2", { label: "Experiência com" }),
    field("f3", { label: "Kafka (anos)", control: "number" }),
    field("f4", {
      control: "radio",
      label: "Disponível para viagens?",
      options: [
        { value: "s", label: "Sim" },
        { value: "n", label: "Não" },
      ],
    }),
    field("f5", { control: "textarea", label: "Carta", maxLength: 800 }),
    field("f6", { label: "Buscar CEP" }),
    field("f7", { label: "Pretensão salarial" }),
  ];

  it("na ordem da página; junta rótulos quebrados; opções e limite vêm dos campos; esquecido vira pergunta", () => {
    const h = heuristicQuestions(fields);
    const qs = assembleQuestions(fields, h, {
      questions: [
        {
          fieldRefs: ["f5"],
          question: "Carta de apresentação",
          kind: "long_text",
          required: false,
          section: null,
          topic: null,
        },
        {
          fieldRefs: ["f2", "f3"],
          question: "Quantos anos de experiência com Kafka?",
          kind: "number",
          required: true,
          section: null,
          topic: null,
        },
        {
          fieldRefs: ["f4", "f99"],
          question: "Você tem disponibilidade para viagens?",
          kind: "yes_no",
          required: false,
          section: null,
          topic: null,
        },
        // o modelo não pode tomar um campo que a heurística já resolveu
        {
          fieldRefs: ["f1"],
          question: "Nome",
          kind: "short_text",
          required: true,
          section: null,
          topic: null,
        },
      ],
      ignored: ["f6"],
    });
    expect(qs.map((q) => [q.id, q.fieldRefs.join("+"), q.kind, q.source])).toEqual([
      ["q1", "f1", "short_text", "heuristic"],
      ["q2", "f2+f3", "number", "model"],
      ["q3", "f4", "yes_no", "model"],
      ["q4", "f5", "long_text", "model"],
      ["q5", "f7", "short_text", "heuristic"],
    ]);
    expect(qs[2]?.options).toEqual([
      { value: "s", label: "Sim" },
      { value: "n", label: "Não" },
    ]);
    expect(qs[3]?.maxChars).toBe(800);
    expect(qs[4]?.question).toBe("Pretensão salarial");
  });

  it("sem o modelo (falhou ou nada para ele): cada campo vira pergunta pelo rótulo", () => {
    const qs = assembleQuestions(fields, heuristicQuestions(fields), null);
    expect(qs).toHaveLength(7);
    expect(qs.find((q) => q.fieldRefs[0] === "f4")?.kind).toBe("choice");
  });

  it("valor dos campos óbvios a partir dos dados da pessoa", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    seedFixture(repos, "engineer");
    repos.users.upsert({
      links: [
        { label: "LinkedIn", url: "https://www.linkedin.com/in/ana-exemplo" },
        { label: "GitHub", url: "https://github.com/ana-exemplo" },
      ],
    });
    expect(prefillValue(repos, "full_name")).toBe("Ana Maria Exemplo");
    expect(prefillValue(repos, "first_name")).toBe("Ana");
    expect(prefillValue(repos, "last_name")).toBe("Maria Exemplo");
    expect(prefillValue(repos, "email")).toBe("ana.exemplo@example.com");
    expect(prefillValue(repos, "phone")).toBe("+55 11 98765 4321");
    expect(prefillValue(repos, "linkedin")).toBe("https://www.linkedin.com/in/ana-exemplo");
    expect(prefillValue(repos, "github")).toBe("https://github.com/ana-exemplo");
    expect(prefillValue(repos, "portfolio")).toBeNull();
    expect(prefillValue(repos, "city")).toBe("Campinas");
  });
});

describe("F12/M3 · formulário no banco", () => {
  it("cria organizando, guarda as perguntas ou o erro, acha pela captura; 0020 entra sobre o banco anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0019_extension_capture_analysis" });
    expect(migrate(db).applied).toEqual(["0020_application_form"]);
    const repos = createRepos(db);
    const f = repos.applications.create({
      captureId: "c1",
      postingId: null,
      profileId: "p1",
      url: "https://acme.example/apply",
      title: "Candidatura",
      fields: [field("f1", { label: "Nome" })],
    });
    expect(f).toMatchObject({ status: "locating", questions: [], fields: [{ ref: "f1" }] });
    expect(repos.applications.byCapture("c1")?.id).toBe(f.id);
    repos.applications.setError(f.id, "modelo fora do ar");
    expect(repos.applications.get(f.id)).toMatchObject({
      status: "error",
      error: "modelo fora do ar",
    });
    const qs = assembleQuestions(f.fields, heuristicQuestions(f.fields), null);
    repos.applications.setQuestions(f.id, qs);
    expect(repos.applications.get(f.id)).toMatchObject({ status: "ready", error: null });
    expect(repos.applications.get(f.id)?.questions).toHaveLength(1);
  });
});
