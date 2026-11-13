import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMailApplications,
  applyMailProcess,
  applyMailUpdates,
  createRepos,
  migrate,
  openDatabase,
  type Repos,
  senderMatchesPosting,
  undoMail,
} from "../../src";
import { DEFAULT_STAGES } from "../../src/job-applications";
import { rawMail } from "../mail/fixtures";

/**
 * F15/M3 · e-mail → tarefas e fases (plano §2.3): a ação pedida vira tarefa (link só de remetente confiável ou do
 * domínio da vaga/empresa com autenticação), sem repetir; as fases trocam as etapas padrão e a atual vira sugestão;
 * com etapas editadas, ficam para "Usar estas fases"; o Desfazer devolve tudo.
 */
const out = (o: Partial<MailClassifyOutput>): MailClassifyOutput => ({
  class: "update",
  confidence: 95,
  company: "Acme",
  title: "Backend Sr",
  postingUrl: null,
  jobs: [],
  stageHint: null,
  interview: null,
  summary: "Resumo.",
  actions: [],
  process: null,
  ...o,
});
const ctx = { log: () => {}, item: () => {}, count: () => {}, publish: async () => {} };
const TRIAGEM = {
  kind: "screening" as const,
  title: "Fazer a triagem da Acme pelo WhatsApp",
  url: "https://triagem.example/start",
  dueAt: "2026-11-20T23:59:00-03:00",
};
const PROCESS = {
  stages: ["Inscrição", "Análise do currículo", "Pré-seleção", "Entrevista técnica", "Proposta"],
  current: "Pré-seleção",
};

describe("F15/M3 · tarefas e fases pelo e-mail", () => {
  let repos: Repos;
  let dataDir: string;
  let n = 0;
  beforeEach(() => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-f15-m3-"));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const mail = (
    cls: MailClassifyOutput,
    receivedAt: string,
    o: { risk?: "trusted" | "neutral"; from?: string; auth?: string | null } = {},
  ) => {
    const gmailId = `m${++n}`;
    const from = o.from ?? "rh@acme.example";
    writeFileSync(
      join(dataDir, `${gmailId}.eml`),
      rawMail({
        from: `RH <${from}>`,
        text: "Oi",
        ...(o.auth !== undefined ? { auth: o.auth } : {}),
      }),
    );
    const { record } = repos.mail.insert(
      {
        gmailId,
        threadId: "t1",
        fromAddr: from,
        fromName: "RH",
        replyTo: null,
        subject: "Próxima etapa",
        receivedAt,
        size: 1,
        labels: [],
        rawPath: `${gmailId}.eml`,
      },
      receivedAt,
    );
    repos.mail.setAssessment(
      record.id,
      { status: "pending", class: "candidate", riskLevel: o.risk ?? "trusted", riskReasons: [] },
      receivedAt,
    );
    repos.mail.setResult(
      record.id,
      { status: "pending", class: cls.class, confidence: cls.confidence, result: cls as never },
      receivedAt,
    );
    return record.id;
  };
  const run = async () => {
    await applyMailApplications({ repos, dataDir, ctx });
    return applyMailUpdates({ repos, dataDir, ctx });
  };
  const applied = async () => {
    mail(out({ class: "application_received" }), "2026-11-01T10:00:00.000Z");
    await run();
    const app = repos.jobApplications.list()[0];
    if (!app) throw new Error("sem candidatura");
    return app;
  };

  it("remetente confiável: tarefa com link, prazo e tags; fases trocam as etapas padrão; a atual vira sugestão; desfazer devolve", async () => {
    const app = await applied();
    expect(app.stages.map((s) => s.name)).toEqual([...DEFAULT_STAGES]);
    const id = mail(out({ actions: [TRIAGEM], process: PROCESS }), "2026-11-12T15:40:00.000Z");
    const r = await run();
    expect(r.todos).toBe(1);
    const [t] = repos.todos.list({}, "2026-11-12T16:00:00.000Z");
    expect(t).toMatchObject({
      title: "Fazer a triagem da Acme pelo WhatsApp",
      source: "email",
      kind: "screening",
      actionUrl: "https://triagem.example/start",
      dueAt: "2026-11-21T02:59:00.000Z",
      applicationId: app.id,
      mailMessageId: id,
    });
    expect(t?.tags).toEqual(["acme", "e-mail", "triagem"]);
    expect(repos.notifications.list().map((x) => x.kind)).toContain("todo.created");

    const now = repos.jobApplications.get(app.id);
    expect(now?.stages.map((s) => s.name)).toEqual(PROCESS.stages);
    // a fase atual do e-mail vira sugestão (sem acerto comprovado, nada move sozinho)
    expect(repos.stageSuggestions.open(app.id)[0]).toMatchObject({ toStageName: "Pré-seleção" });

    undoMail(repos, dataDir, id);
    expect(repos.todos.list({}, "2026-11-12T16:00:00.000Z")).toEqual([]);
    expect(repos.jobApplications.get(app.id)?.stages.map((s) => s.name)).toEqual([
      ...DEFAULT_STAGES,
    ]);
  });

  it("remetente neutro sem o domínio da vaga: tarefa sem link e com a tag confira; a mesma ação aberta não se repete", async () => {
    await applied();
    mail(out({ actions: [TRIAGEM] }), "2026-11-12T15:40:00.000Z", {
      risk: "neutral",
      from: "talentos@outra.example",
    });
    await run();
    mail(out({ actions: [TRIAGEM] }), "2026-11-13T15:40:00.000Z", {
      risk: "neutral",
      from: "talentos@outra.example",
    });
    await run();
    const todos = repos.todos.list({}, "2026-11-13T16:00:00.000Z");
    expect(todos).toHaveLength(1);
    expect(todos[0]?.actionUrl).toBeNull();
    expect(todos[0]?.tags).toContain("confira");
    expect(todos[0]?.note).toMatch(/Confira no e-mail/);
  });

  it("remetente neutro do domínio da empresa, com autenticação: o link vale; sem autenticação, não", async () => {
    await applied();
    mail(out({ actions: [TRIAGEM] }), "2026-11-12T15:40:00.000Z", { risk: "neutral" });
    await run();
    expect(repos.todos.list({}, "2026-11-13T00:00:00.000Z")[0]?.actionUrl).toBe(TRIAGEM.url);
    repos.todos.remove(repos.todos.list({}, "2026-11-13T00:00:00.000Z")[0]?.id as string);
    mail(out({ actions: [TRIAGEM] }), "2026-11-12T16:40:00.000Z", { risk: "neutral", auth: null });
    await run();
    expect(repos.todos.list({}, "2026-11-13T00:00:00.000Z")[0]?.actionUrl).toBeNull();
  });

  it("etapas editadas: as fases ficam como sugestão; Usar estas fases troca e marca a atual; desfazer devolve", async () => {
    const app = await applied();
    repos.jobApplications.setStages(app.id, [{ name: "Triagem" }, { name: "Case" }]);
    const id = mail(out({ process: PROCESS }), "2026-11-12T15:40:00.000Z");
    await run();
    expect(repos.jobApplications.get(app.id)?.stages.map((s) => s.name)).toEqual([
      "Triagem",
      "Case",
    ]);
    expect(
      (repos.mail.get(id)?.result as { processSuggestion?: unknown } | undefined)
        ?.processSuggestion,
    ).toEqual(PROCESS);
    const next = applyMailProcess(repos, id);
    expect(next.stages.map((s) => s.name)).toEqual(PROCESS.stages);
    expect(next.stages.find((s) => s.id === next.currentStageId)?.name).toBe("Pré-seleção");
    expect(
      (repos.mail.get(id)?.result as { processSuggestion?: unknown } | undefined)
        ?.processSuggestion,
    ).toBeUndefined();
    undoMail(repos, dataDir, id);
    expect(repos.jobApplications.get(app.id)?.stages.map((s) => s.name)).toEqual([
      "Triagem",
      "Case",
    ]);
  });

  it("fases com menos de 2 nomes ou só repetidas não mexem nas etapas", async () => {
    const app = await applied();
    mail(
      out({ process: { stages: ["Inscrição", "inscrição"], current: null } }),
      "2026-11-12T15:40:00.000Z",
    );
    await run();
    expect(repos.jobApplications.get(app.id)?.stages.map((s) => s.name)).toEqual([
      ...DEFAULT_STAGES,
    ]);
  });

  it("domínio da vaga ou da empresa: link da vaga, site da empresa ou o nome no domínio; quadro de vagas não", () => {
    const p = (o: object) => ({ company: "K&M", postingUrl: null, companyUrl: null, ...o });
    expect(senderMatchesPosting("noreplyhiring@kandm.example", p({}))).toBe(true);
    expect(
      senderMatchesPosting(
        "rh@mail.globex.example",
        p({ company: "Outra", companyUrl: "https://www.globex.example" }),
      ),
    ).toBe(true);
    expect(
      senderMatchesPosting(
        "no-reply@hire.lever.co",
        p({ postingUrl: "https://jobs.lever.co/kandm/1" }),
      ),
    ).toBe(false);
    expect(senderMatchesPosting("vagas@gmail.com", p({ company: "Gmail" }))).toBe(false);
    expect(senderMatchesPosting("rh@golpe.example", p({}))).toBe(false);
  });
});
