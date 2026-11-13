import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRepos,
  fakeGmailAdd,
  fakeGmailFetch,
  fakeGmailState,
  finishGmailConnect,
  type GoogleClient,
  gmailSource,
  intakePostingFromMail,
  MAIL_LABEL,
  MAIL_SINCE_KEY,
  type MailClassifier,
  matchScoreOf,
  migrate,
  openDatabase,
  parseLocation,
  type Repos,
  runScheduledTask,
  startGmailConnect,
} from "../../src";
import { rawMail } from "./fixtures";

/**
 * F14/M4 · processamento: alerta das plataformas conhecidas pelo leitor por código, o resto pelo modelo; vagas do
 * feed sem duplicar; links abertos devagar, com a flag "link não abriu"; processado ganha `narnia-jobs` e lido;
 * fora do assunto fica intocado; candidatura, negativa e afins ficam classificadas para o M5.
 */
const client: GoogleClient = { clientId: "id-123456789", clientSecret: "s", source: "env" };
const T = Date.parse("2026-11-11T12:00:00Z");
const DAY = 86_400_000;
const JD = `Desenvolvedor Backend Sênior na Acme. ${"Requisitos: Node.js, PostgreSQL e filas. ".repeat(10)}`;

const out = (o: Partial<MailClassifyOutput>): MailClassifyOutput => ({
  class: "not_job",
  confidence: 90,
  company: null,
  title: null,
  postingUrl: null,
  jobs: [],
  stageHint: null,
  actions: [],
  process: null,
  interview: null,
  summary: "x",
  ...o,
});

describe("F14/M4 · processamento dos e-mails", () => {
  let repos: Repos;
  let dataDir: string;
  let state: ReturnType<typeof fakeGmailState>;
  let calls: string[];
  let extracts: string[];
  beforeEach(async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-mail-digest-"));
    state = fakeGmailState();
    calls = [];
    extracts = [];
    const f = fakeGmailFetch(state, { now: () => T });
    const { pending } = startGmailConnect({
      client,
      redirectUri: "http://localhost:8189/callback",
    });
    await finishGmailConnect({
      fetch: f,
      dataDir,
      client,
      pending,
      params: new URLSearchParams({ code: "code-ok", state: pending.state }),
    });
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 30 * DAY).toISOString());
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const pages: Record<string, () => Response> = {};
  const web = (async (u: string | URL) => {
    const url = String(u);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    const r = pages[url];
    return r ? r() : new Response("não achei", { status: 404 });
  }) as typeof fetch;

  const sync = (classify: MailClassifier | null = null) =>
    runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "schedule",
      now: new Date(T),
      publish: async () => {},
      mailSource: () =>
        gmailSource({
          fetch: fakeGmailFetch(state, { now: () => T }),
          dataDir,
          client: () => client,
        }),
      services: {
        classifyMail: classify,
        enqueuePostingExtract: async (id) => {
          extracts.push(id);
        },
        fetchOptions: {
          fetch: web,
          lookup: async () => ["93.184.216.34"],
          render: null,
          timeoutMs: 500,
        },
      },
    });
  const add = (id: string, o: Parameters<typeof rawMail>[0], daysAgo = 2) =>
    fakeGmailAdd(state, { id, internalDate: T - daysAgo * DAY, raw: rawMail(o).toString() });

  it("alerta do LinkedIn pelo leitor por código: vagas no feed, sem o modelo; processado ganha narnia-jobs e lido", async () => {
    add("alerta", {
      from: "LinkedIn <jobalerts-noreply@linkedin.com>",
      subject: "Desenvolvedor Backend: 2 vagas",
      html: `<a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=x">Desenvolvedor Backend Sênior</a><p>Acme Tecnologia · São Paulo, SP (Híbrido)</p>
             <a href="https://www.linkedin.com/comm/jobs/view/4099999999/">Engenheira de Dados</a><p>Globex · Remoto</p>`,
    });
    const classify: MailClassifier = async (i) => {
      calls.push(i.subject);
      return out({});
    };
    const r = await sync(classify);
    expect(r.status).toBe("done");
    expect(calls).toEqual([]);
    const feed = repos.postings.feed();
    expect(
      feed.map((p) => [
        p.title,
        p.company,
        p.city,
        p.state,
        p.workMode,
        p.source,
        p.linkStatus,
        p.feedState,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [
          "Desenvolvedor Backend Sênior",
          "Acme Tecnologia",
          "São Paulo",
          "SP",
          "hybrid",
          "email",
          "failed",
          "new",
        ],
        ["Engenheira de Dados", "Globex", null, null, "remote", "email", "failed", "new"],
      ]),
    );
    expect(feed[0]?.sourceRef?.gmailId).toBe("alerta");
    // a vaga guarda quando o e-mail chegou (pedido do dono 2026-11-12)
    expect(feed[0]?.sourceRef?.receivedAt).toBe(repos.mail.byGmailId("alerta")?.receivedAt);
    expect(repos.mail.byGmailId("alerta")).toMatchObject({
      status: "done",
      class: "job_alert",
      gmailSynced: true,
    });
    const label = state.labels.find((l) => l.name === MAIL_LABEL)?.id as string;
    const g = state.messages.find((m) => m.id === "alerta");
    expect(g?.labelIds).toContain(label);
    expect(g?.labelIds).not.toContain("UNREAD");
  });

  it("a mesma vaga em dois alertas não duplica (link canônico)", async () => {
    const html = `<a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=a">Dev Backend</a><p>Acme · Remoto</p>`;
    add("a1", { from: "LinkedIn <jobalerts-noreply@linkedin.com>", subject: "Vagas", html }, 3);
    add(
      "a2",
      {
        from: "LinkedIn <jobalerts-noreply@linkedin.com>",
        subject: "Vagas",
        html: html.replace("=a", "=b"),
      },
      2,
    );
    await sync();
    expect(repos.postings.feed()).toHaveLength(1);
  });

  it("e-mail sem leitor: o modelo classifica; alerta vira vaga; fora do assunto fica intocado; negativa sem candidatura vai para a revisão", async () => {
    add(
      "generico",
      {
        from: "Vagas Acme <vagas@acme.example>",
        subject: "Vagas para você",
        html: '<p>Analista de Dados</p><a href="https://vagas.acme.example/42">ver</a>',
      },
      4,
    );
    add(
      "curso",
      {
        from: "Escola <news@escola.example>",
        subject: "Vagas limitadas no curso",
        html: "<p>promo</p>",
      },
      3,
    );
    add(
      "nao",
      {
        from: "RH <rh@acme.example>",
        subject: "Sua candidatura",
        html: "<p>optamos por outros</p>",
      },
      2,
    );
    const classify: MailClassifier = async (i) => {
      calls.push(i.subject);
      if (i.subject.startsWith("Vagas para"))
        return out({
          class: "job_alert",
          jobs: [
            {
              title: "Analista de Dados",
              company: "Acme",
              location: "Remoto",
              url: "https://vagas.acme.example/42",
            },
          ],
        });
      if (i.subject.startsWith("Sua")) return out({ class: "rejection", company: "Acme" });
      return out({ class: "not_job" });
    };
    pages["https://vagas.acme.example/42"] = () =>
      new Response(
        `<html><head><title>Vaga</title></head><body><main><article><h1>Analista de Dados</h1><p>${JD}</p></article></main></body></html>`,
        {
          headers: { "content-type": "text/html" },
        },
      );
    await sync(classify);
    expect(calls).toEqual(["Vagas para você", "Vagas limitadas no curso", "Sua candidatura"]);
    const vaga = repos.postings.feed()[0];
    expect(vaga).toMatchObject({
      title: "Analista de Dados",
      linkStatus: "ok",
      status: "extracting",
    });
    expect(vaga?.jdText).toContain("Desenvolvedor Backend Sênior na Acme");
    expect(extracts).toEqual([vaga?.id]);
    expect(repos.mail.byGmailId("curso")).toMatchObject({
      status: "ignored",
      class: "not_job",
      gmailSynced: false,
    });
    expect(state.messages.find((m) => m.id === "curso")?.labelIds).toEqual(["INBOX", "UNREAD"]);
    // M5: negativa da Acme sem candidatura e sem cargo não liga a nada com segurança → revisão
    expect(repos.mail.byGmailId("nao")).toMatchObject({
      status: "review",
      class: "rejection",
      gmailSynced: false,
    });
  });

  it("revisão do M4: link inventado pelo modelo (fora dos links do e-mail) é descartado", async () => {
    add("g1", {
      from: "Vagas <vagas@acme.example>",
      subject: "Vagas para você",
      html: '<a href="https://vagas.acme.example/1">ver</a>',
    });
    await sync(async () =>
      out({
        class: "job_alert",
        jobs: [
          {
            title: "Com link do e-mail",
            company: "Acme",
            location: null,
            url: "https://vagas.acme.example/1",
          },
          {
            title: "Com link inventado",
            company: "Acme",
            location: null,
            url: "https://evil.example/x",
          },
        ],
      }),
    );
    const byTitle = Object.fromEntries(repos.postings.feed().map((p) => [p.title, p.postingUrl]));
    expect(byTitle["Com link do e-mail"]).toBe("https://vagas.acme.example/1");
    expect(byTitle["Com link inventado"]).toBeNull();
  });

  it("revisão do M4: descrição colada pela pessoa antes do link abrir não é sobrescrita", async () => {
    add("g2", {
      from: "Vagas <vagas@acme.example>",
      subject: "Vagas para você",
      html: '<a href="https://vagas.acme.example/42">ver</a>',
    });
    pages["https://vagas.acme.example/42"] = () =>
      new Response(`<html><body><main><article><p>${JD}</p></article></main></body></html>`);
    const classify = async () =>
      out({
        class: "job_alert",
        jobs: [
          { title: "Vaga", company: "Acme", location: null, url: "https://vagas.acme.example/42" },
        ],
      });
    const r1 = await runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "schedule",
      now: new Date(T),
      publish: async () => {},
      mailSource: () =>
        gmailSource({
          fetch: fakeGmailFetch(state, { now: () => T }),
          dataDir,
          client: () => client,
        }),
      services: { classifyMail: classify },
    });
    expect(r1.status).toBe("done");
    const id = repos.postings.feed()[0]?.id as string;
    repos.postings.update(id, { jdText: "Descrição colada pela pessoa" }, { source: "user" });
    await sync(classify);
    expect(repos.postings.get(id)?.jdText).toBe("Descrição colada pela pessoa");
    expect(repos.postings.get(id)?.linkStatus).toBe("ok");
    expect(extracts).toEqual([]);
  });

  it("revisão do M4: saída inválida do modelo duas vezes manda o e-mail para a revisão, sem travar os outros", async () => {
    add("ruim", { from: "RH <rh@acme.example>", subject: "Próximos passos", html: "<p>oi</p>" }, 3);
    add(
      "bom",
      { from: "RH <rh@globex.example>", subject: "Próximos passos", html: "<p>oi</p>" },
      2,
    );
    const classify: MailClassifier = async (i) => {
      if (i.from.includes("acme"))
        throw Object.assign(new Error("saída inválida"), { code: "invalid_output" });
      return out({ class: "update" });
    };
    await sync(classify);
    expect(repos.mail.byGmailId("bom")?.class).toBe("update");
    await sync(classify);
    expect(repos.mail.byGmailId("ruim")?.status).toBe("review");
  });

  it("modelo fora do ar: a rodada para sem marcar erro; a próxima continua", async () => {
    add("x", { from: "RH <rh@acme.example>", subject: "Próximos passos", html: "<p>oi</p>" });
    await sync(async () => {
      throw new Error("limite de uso");
    });
    expect(repos.mail.byGmailId("x")).toMatchObject({ status: "pending", class: "unknown" });
    await sync(async () => out({ class: "update" }));
    expect(repos.mail.byGmailId("x")?.class).toBe("update");
  });

  it("sem modelo nesta execução (ex.: só o leitor por código): os e-mails sem leitor esperam", async () => {
    add("x", { from: "RH <rh@acme.example>", subject: "Próximos passos", html: "<p>oi</p>" });
    await sync(null);
    expect(repos.mail.byGmailId("x")).toMatchObject({ status: "pending", class: "unknown" });
  });
});

describe("F14/M4 · peças", () => {
  it("local: cidade, UF e modo de trabalho", () => {
    expect(parseLocation("São Paulo, SP (Híbrido)")).toEqual({
      workMode: "hybrid",
      city: "São Paulo",
      state: "SP",
      country: "BR",
    });
    expect(parseLocation("Remoto")).toEqual({ workMode: "remote" });
    expect(parseLocation("Curitiba – PR")).toMatchObject({ city: "Curitiba", state: "PR" });
    expect(parseLocation(null)).toEqual({});
  });

  it("score: cobertura do melhor perfil menos 10 por risco; sem cobertura, sem score", () => {
    const pre = (coverage: number | null, risks: number[]) =>
      ({
        coverage,
        risksByProfile: Object.fromEntries(
          risks.map((n, i) => [`p${i}`, Array(n).fill({ type: "salary" })]),
        ),
      }) as never;
    expect(matchScoreOf(pre(0.9, [2, 0]))).toBe(90);
    expect(matchScoreOf(pre(0.9, [2]))).toBe(70);
    expect(matchScoreOf(pre(null, []))).toBeNull();
    expect(matchScoreOf(pre(0.05, [3]))).toBe(0);
  });

  it("vaga do e-mail sem link nem empresa e cargo iguais: cria; mesma empresa e cargo: acha a existente", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    const a = intakePostingFromMail(r, {
      title: "Dev",
      company: "Acme",
      location: null,
      url: null,
      gmailId: "g1",
      platform: null,
    });
    const b = intakePostingFromMail(r, {
      title: "Dev",
      company: "Acme",
      location: null,
      url: null,
      gmailId: "g2",
      platform: null,
    });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, posting: { id: a.posting.id } });
    expect(a.posting.linkStatus).toBeNull();
  });
});

describe("F14/M4 · revisão: o que vem do modelo e do e-mail é conferido", () => {
  it("link torto ou fora dos links do e-mail não entra; a vaga entra sem link", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    const v = intakePostingFromMail(r, {
      title: "Dev",
      company: "Acme",
      location: null,
      url: "vagas.com.br/v/1",
      gmailId: "g",
      platform: null,
    });
    expect(v.posting.postingUrl).toBeNull();
    expect(r.postings.feed()).toHaveLength(1);
    const js = intakePostingFromMail(r, {
      title: "Dev 2",
      company: "Acme",
      location: null,
      url: "javascript:alert(1)",
      gmailId: "g",
      platform: null,
    });
    expect(js.posting.postingUrl).toBeNull();
  });

  it("mesma empresa e cargo com links diferentes (SP e RJ) são vagas diferentes", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    const sp = intakePostingFromMail(r, {
      title: "Dev",
      company: "Acme",
      location: "São Paulo, SP",
      url: "https://vagas.acme.example/sp",
      gmailId: "g",
      platform: null,
    });
    const rj = intakePostingFromMail(r, {
      title: "Dev",
      company: "Acme",
      location: "Rio de Janeiro, RJ",
      url: "https://vagas.acme.example/rj",
      gmailId: "g",
      platform: null,
    });
    expect(rj.created).toBe(true);
    expect(rj.posting.id).not.toBe(sp.posting.id);
  });
});
