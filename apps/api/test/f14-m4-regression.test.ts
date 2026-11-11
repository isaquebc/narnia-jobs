import { afterEach, describe, expect, it } from "vitest";
import { intakePosting } from "../src/services/postings";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14/M4 · testes de regressão das vagas (§2.0.1), escritos antes das mudanças do M4: o intake manual continua igual
 * (link que falha não cria vaga; texto e link juntos não buscam a página), o diálogo de arquivar mostra os motivos de
 * hoje, a captura sem vaga de e-mail parecida cria vaga nova, e a junção de duplicata leva os contatos inteiros
 * (defeito 4).
 */
const JD = `Desenvolvedor Backend Sênior na Acme. ${"Requisitos: Node.js, PostgreSQL e filas. ".repeat(8)}`;
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const publicDns = async () => ["93.184.216.34"];

describe("F14/M4 · RT-V1 e RT-V2 · intake manual", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());
  const intake = (url: string, f: typeof fetch, extra: Record<string, unknown> = {}) =>
    intakePosting(
      {
        repos: t.repos,
        queue: t.queue,
        dataDir: t.dataDir,
        fetchOptions: { fetch: f, lookup: publicDns, render: null, timeoutMs: 200, ...extra },
      },
      { url },
    );

  it("RT-V1: robots, erro HTTP e tempo esgotado: código do erro e nenhuma vaga gravada", async () => {
    t = makeTestApp();
    const robots = (async (u: string | URL) =>
      String(u).endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow: /", { status: 200 })
        : new Response("x")) as typeof fetch;
    expect(await intake("https://vagas.example/1", robots)).toMatchObject({
      ok: false,
      code: "robots",
    });
    const http500 = (async (u: string | URL) =>
      String(u).endsWith("/robots.txt")
        ? new Response("", { status: 404 })
        : new Response("erro", { status: 500 })) as typeof fetch;
    expect(await intake("https://vagas.example/2", http500)).toMatchObject({
      ok: false,
      code: "http_error",
    });
    const slow = (async (u: string | URL, init?: RequestInit) => {
      if (String(u).endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("abort"), { name: "AbortError" })),
        ),
      );
    }) as typeof fetch;
    expect(await intake("https://vagas.example/3", slow)).toMatchObject({
      ok: false,
      code: "timeout",
    });
    expect(t.repos.postings.list()).toHaveLength(0);
  });

  it("RT-V2: texto e link juntos gravam o link sem buscar a página", async () => {
    t = makeTestApp();
    let calls = 0;
    const r = await intakePosting(
      {
        repos: t.repos,
        queue: t.queue,
        dataDir: t.dataDir,
        fetchOptions: {
          fetch: (async () => {
            calls++;
            return new Response("x");
          }) as typeof fetch,
          lookup: publicDns,
          render: null,
        },
      },
      { text: JD, url: "https://vagas.example/9" },
    );
    expect(r.ok).toBe(true);
    expect(calls).toBe(0);
    if (r.ok) expect(r.posting.postingUrl).toBe("https://vagas.example/9");
  });
});

describe("F14/M4 · RT-V4 · arquivar", () => {
  it("os motivos que a pessoa escolhe são os 8 de hoje (o automático do feed não aparece)", async () => {
    const { PostingArchiveReasonSchema } = await import("@narnia-jobs/shared");
    expect(PostingArchiveReasonSchema.options).toEqual([
      "salary",
      "seniority",
      "stack",
      "work_mode",
      "location",
      "contract",
      "company",
      "other",
    ]);
  });
});

describe("F14/M4 · RT-V6 · captura da extensão", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("sem vaga de e-mail parecida, salvar a captura cria uma vaga nova", async () => {
    t = makeTestApp();
    await t.api(
      "/api/postings",
      json({ company: "Acme", title: "Outra vaga", postingUrl: "https://vagas.example/outra" }),
    );
    const cap = t.repos.extension.createCapture({
      kind: "page",
      url: "https://vagas.example/42",
      title: "Vaga",
      payload: { ok: true, text: JD, company: "Acme", title: "Backend", siteName: null } as never,
      deviceId: null,
    });
    const r = await t.api(`/api/extension/captures/${cap.id}/posting`, json({}));
    expect([200, 201]).toContain(r.status);
    expect(t.repos.postings.list()).toHaveLength(2);
  });
});

describe("F14/M4 · defeito 4 · junção de duplicata leva os contatos inteiros, sem repetir", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("LinkedIn, papel, data e resumo vão para a vaga salva; contato já existente não duplica", async () => {
    t = makeTestApp();
    const { decideDuplicate } = await import("@narnia-jobs/core");
    const saved = t.repos.postings.create(
      { company: "Acme", title: "Backend" },
      { source: "user" },
    );
    const fresh = t.repos.postings.create(
      { company: "Acme", title: "Backend" },
      { source: "user" },
    );
    t.repos.postingContacts.add(saved.id, {
      name: "Ana",
      origin: "email",
      email: "ana@acme.example",
    });
    t.repos.postingContacts.add(fresh.id, {
      name: "Ana",
      origin: "email",
      email: "ana@acme.example",
    });
    t.repos.postingContacts.add(fresh.id, {
      name: "Bruno",
      origin: "linkedin",
      linkedinUrl: "https://www.linkedin.com/in/bruno-exemplo",
      role: "recruiter",
      contactedOn: "2026-11-01",
      summary: "Falamos sobre a vaga",
    } as never);
    t.repos.postings.setDuplicate(fresh.id, {
      candidateId: saved.id,
      sameJob: true,
      confidence: 95,
      differences: [],
      rationale: "mesma vaga",
      checkedAt: new Date().toISOString(),
      decision: null,
    });
    decideDuplicate(t.repos, fresh.id, "update");
    const contacts = t.repos.postingContacts.list(saved.id);
    expect(contacts.map((c) => c.name).sort()).toEqual(["Ana", "Bruno"]);
    expect(contacts.find((c) => c.name === "Bruno")).toMatchObject({
      linkedinUrl: "https://www.linkedin.com/in/bruno-exemplo",
      role: "recruiter",
      contactedOn: "2026-11-01",
      summary: "Falamos sobre a vaga",
    });
  });
});
