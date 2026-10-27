import type { ApplicationQuestion, FormField } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { assembleQuestions, heuristicQuestions } from "../../src/applications/locate";
import { matchStep, mergeStepQuestions, stepQuestions } from "../../src/applications/steps";
import { createRepos, migrate, openDatabase } from "../../src/db";

/**
 * F12/M6 · formulário em várias etapas (§4.3): cada clique numa etapa nova entra no mesmo formulário em vez de criar
 * outro. A etapa é reconhecida pelo endereço e pelos campos (formulários de página única, como Workday e Gupy, trocam
 * os campos sem trocar o endereço); as perguntas de cada etapa guardam o número dela e ids próprios, para as respostas
 * das outras etapas não se perderem.
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

const step1 = [field("f1", { label: "Nome" }), field("f2", { label: "E-mail", control: "email" })];
const step2 = [
  field("f1", { label: "Por que você quer trabalhar aqui?", control: "textarea" }),
  field("f2", { label: "Pretensão salarial", control: "number" }),
];

const questionsOf = (fields: FormField[]) =>
  assembleQuestions(fields, heuristicQuestions(fields), null);

describe("F12/M6 · reconhecer a etapa", () => {
  const steps = [
    { n: 1, url: "https://acme.example/apply", fields: step1 },
    { n: 2, url: "https://acme.example/apply#etapa-2", fields: step2 },
  ];

  it("mesmo endereço (sem a âncora) e os mesmos campos: a etapa já lida", () => {
    expect(matchStep(steps, { url: "https://acme.example/apply#topo", fields: step1 })?.n).toBe(1);
    expect(matchStep(steps, { url: "https://acme.example/apply", fields: step2 })?.n).toBe(2);
  });

  it("os rótulos contam sem diferença de maiúsculas, acentos e espaços; o valor digitado nunca vem", () => {
    const same = [
      field("f1", { label: "  nome " }),
      field("f2", { label: "e-mail", control: "email" }),
    ];
    expect(matchStep(steps, { url: "https://acme.example/apply", fields: same })?.n).toBe(1);
  });

  it("campos novos no mesmo endereço (página única) ou outro endereço: etapa nova", () => {
    const step3 = [field("f1", { label: "Portfólio", control: "url" })];
    expect(matchStep(steps, { url: "https://acme.example/apply", fields: step3 })).toBeNull();
    expect(matchStep(steps, { url: "https://acme.example/apply/3", fields: step1 })).toBeNull();
  });
});

describe("F12/M6 · perguntas por etapa", () => {
  it("a etapa 1 mantém os ids de antes (q1…); as outras ganham ids próprios e o número da etapa", () => {
    expect(stepQuestions(questionsOf(step1), 1).map((q) => [q.id, q.step])).toEqual([
      ["q1", 1],
      ["q2", 1],
    ]);
    expect(stepQuestions(questionsOf(step2), 2).map((q) => [q.id, q.step])).toEqual([
      ["s2q1", 2],
      ["s2q2", 2],
    ]);
  });

  it("organizar uma etapa troca só as perguntas dela e mantém a ordem das etapas", () => {
    const one = stepQuestions(questionsOf(step1), 1);
    const two = stepQuestions(questionsOf(step2), 2);
    const merged = mergeStepQuestions(two, 1, one);
    expect(merged.map((q) => q.id)).toEqual(["q1", "q2", "s2q1", "s2q2"]);
    const again = mergeStepQuestions(
      merged,
      2,
      stepQuestions(questionsOf([step2[0] as FormField]), 2),
    );
    expect(again.map((q) => q.id)).toEqual(["q1", "q2", "s2q1"]);
  });

  it("pergunta gravada antes das etapas (sem número) conta como da etapa 1", () => {
    const legacy = questionsOf(step1).map(({ step: _s, ...q }) => q) as ApplicationQuestion[];
    const merged = mergeStepQuestions(legacy, 2, stepQuestions(questionsOf(step2), 2));
    expect(merged.map((q) => q.id)).toEqual(["q1", "q2", "s2q1", "s2q2"]);
  });
});

describe("F12/M6 · etapas no banco", () => {
  const create = (repos: ReturnType<typeof createRepos>) =>
    repos.applications.create({
      captureId: "c1",
      postingId: null,
      profileId: null,
      url: "https://acme.example/apply",
      title: "Etapa 1",
      fields: step1,
    });

  it("o formulário nasce com a etapa 1; a etapa nova vira a atual (endereço e título) e organiza só ela", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const f = create(repos);
    expect(f.steps.map((s) => [s.n, s.status])).toEqual([[1, "locating"]]);
    expect(f.currentStep).toBe(1);
    repos.applications.setStepQuestions(f.id, 1, stepQuestions(questionsOf(step1), 1));
    expect(repos.applications.get(f.id)).toMatchObject({ status: "ready" });

    const n = repos.applications.addStep(f.id, {
      url: "https://acme.example/apply/2",
      title: "Etapa 2",
      fields: step2,
    });
    expect(n).toBe(2);
    const g = repos.applications.get(f.id);
    expect(g).toMatchObject({
      status: "locating",
      currentStep: 2,
      url: "https://acme.example/apply/2",
      title: "Etapa 2",
    });
    expect(g?.steps.map((s) => [s.n, s.status])).toEqual([
      [1, "ready"],
      [2, "locating"],
    ]);
    // as perguntas da etapa 1 continuam na janela enquanto a 2 é organizada
    expect(g?.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    repos.applications.setStepQuestions(f.id, 2, stepQuestions(questionsOf(step2), 2), "aviso");
    expect(repos.applications.get(f.id)).toMatchObject({ status: "ready", error: "aviso" });
    expect(repos.applications.get(f.id)?.questions.map((q) => q.id)).toEqual([
      "q1",
      "q2",
      "s2q1",
      "s2q2",
    ]);

    // voltar à etapa 1 na aba: ela vira a atual de novo
    repos.applications.setCurrentStep(f.id, 1);
    expect(repos.applications.get(f.id)).toMatchObject({
      currentStep: 1,
      url: "https://acme.example/apply",
      title: "Etapa 1",
    });
  });

  it("Ler de novo marca todas as etapas para organizar; o erro vale para o formulário", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const f = create(repos);
    repos.applications.setStepQuestions(f.id, 1, stepQuestions(questionsOf(step1), 1));
    repos.applications.addStep(f.id, {
      url: "https://acme.example/apply/2",
      title: null,
      fields: step2,
    });
    repos.applications.setStepQuestions(f.id, 2, stepQuestions(questionsOf(step2), 2));
    repos.applications.setLocating(f.id);
    expect(repos.applications.get(f.id)?.steps.map((s) => s.status)).toEqual([
      "locating",
      "locating",
    ]);
    repos.applications.setError(f.id, "modelo fora do ar");
    expect(repos.applications.get(f.id)).toMatchObject({ status: "error" });
    expect(repos.applications.get(f.id)?.steps.map((s) => s.status)).toEqual(["error", "error"]);
  });

  it("0026 sobre o banco anterior: o formulário antigo vira a etapa 1, com as perguntas e os campos dele", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0025_profile_motivation" });
    const at = "2026-10-20T12:00:00.000Z";
    db.prepare(
      `insert into application_form (id, capture_id, url, title, fields_json, questions_json, status, created_at,
         updated_at) values ('a1', 'c1', 'https://acme.example/apply', 'Antigo', ?, ?, 'ready', ?, ?)`,
    ).run(JSON.stringify(step1), JSON.stringify(questionsOf(step1)), at, at);
    expect(migrate(db).applied).toEqual(expect.arrayContaining(["0026_application_steps"]));
    const repos = createRepos(db);
    const f = repos.applications.get("a1");
    expect(f).toMatchObject({ status: "ready", currentStep: 1 });
    expect(f?.steps).toEqual([
      {
        n: 1,
        url: "https://acme.example/apply",
        title: "Antigo",
        fields: step1,
        status: "ready",
        createdAt: at,
      },
    ]);
    // a etapa nova entra depois dela, sem perder as perguntas antigas
    expect(
      repos.applications.addStep("a1", {
        url: "https://acme.example/apply/2",
        title: null,
        fields: step2,
      }),
    ).toBe(2);
    expect(repos.applications.get("a1")?.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
  });
});

describe("F12/M6 · poda das capturas", () => {
  it("apaga só as capturas sem vaga nem formulário com mais de 30 dias; devolve os ids", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const old = new Date("2026-09-01T12:00:00.000Z");
    const recent = new Date("2026-10-20T12:00:00.000Z");
    const now = new Date("2026-10-27T12:00:00.000Z");
    const page = (at: Date) =>
      repos.extension.createCapture(
        { kind: "page", url: "https://x.example", title: null, payload: {}, deviceId: null },
        at,
      );
    const lonely = page(old);
    const saved = page(old);
    repos.extension.linkCapturePosting(saved.id, "v1");
    const withForm = page(old);
    repos.applications.create({
      captureId: withForm.id,
      postingId: null,
      profileId: null,
      url: "https://x.example",
      title: null,
      fields: step1,
    });
    const fresh = page(recent);
    expect(repos.extension.pruneCaptures(now)).toEqual([lonely.id]);
    expect(repos.extension.getCapture(lonely.id)).toBeNull();
    for (const c of [saved, withForm, fresh])
      expect(repos.extension.getCapture(c.id)).not.toBeNull();
  });
});
