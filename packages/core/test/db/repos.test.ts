import type { FactProposal } from "@narnia-jobs/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { ProposalReviewError } from "../../src/db/repos/proposals";

const ISO = "2026-10-07T12:00:00.000Z";

function setup(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

describe("repos/settings", () => {
  it("get/set JSON e facts_version incrementado só por bumpFactsVersion", () => {
    const r = setup();
    expect(r.settings.get("onboarding_step")).toBeUndefined();
    r.settings.set("onboarding_step", 3);
    expect(r.settings.get("onboarding_step")).toBe(3);
    expect(r.settings.getFactsVersion()).toBe(0);
    expect(r.settings.bumpFactsVersion()).toBe(1);
    expect(r.settings.bumpFactsVersion()).toBe(2);
    expect(r.settings.getFactsVersion()).toBe(2);
  });
});

describe("repos/users (usuário único)", () => {
  it("cria no primeiro upsert, atualiza nos seguintes, nunca duplica", () => {
    const r = setup();
    expect(r.users.get()).toBeNull();
    const a = r.users.upsert({ fullName: "Ana Maria Exemplo", email: "ana@example.com" });
    const b = r.users.upsert({ city: "Campinas", country: "BR" });
    expect(b.id).toBe(a.id);
    expect(b.fullName).toBe("Ana Maria Exemplo");
    expect(b.city).toBe("Campinas");
    expect(r.users.count()).toBe(1);
  });

  it("complete() valida contra UserSchema: falha sem telefone e passa com todos os campos", () => {
    const r = setup();
    r.users.upsert({ fullName: "Ana Maria Exemplo", displayName: "Ana", email: "ana@example.com" });
    expect(() => r.users.complete()).toThrow();
    r.users.upsert({
      phone: { e164: "+5511987654321", country: "BR", national: "11987654321" },
      city: "Campinas",
      country: "BR",
      timezone: "America/Sao_Paulo",
      remotePref: "remote",
      relocation: { mode: "none", countries: [] },
      workAuth: [{ country: "BR", status: "citizen" }],
      links: [],
    });
    const u = r.users.complete();
    expect(u.phone.e164).toBe("+5511987654321");
    expect(u.timezone).toBe("America/Sao_Paulo");
  });
});

describe("repos/profiles", () => {
  it("cria, lista, ativa um por vez e atualiza campos de carreira", () => {
    const r = setup();
    const user = r.users.upsert({ fullName: "Ana" });
    const p1 = r.profiles.create({
      userId: user.id,
      name: "Eng. Software Sênior",
      targetTitle: "Senior Backend Engineer",
      altTitles: [],
      seniority: "senior",
      area: "software",
      goal: "new_job",
      market: "BR",
      docLocale: "pt-BR",
      salary: { min: 15000, max: 22000, currency: "BRL", period: "monthly" },
      contractTypes: ["clt"],
      locations: [{ country: "BR", remote: "remote" }],
      availableFrom: "immediate",
      needsResearch: [],
      isActive: true,
    });
    const p2 = r.profiles.create({
      userId: user.id,
      name: "PM",
      targetTitle: "Project Manager",
      altTitles: ["Delivery Manager"],
      seniority: "manager",
      area: "management",
      goal: "career_change",
      market: "BR",
      docLocale: "pt-BR",
      contractTypes: [],
      locations: [],
      needsResearch: ["salary", "contractTypes", "locations", "availableFrom"],
      isActive: false,
    });
    expect(r.profiles.list().map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(r.profiles.active()?.id).toBe(p1.id);
    r.profiles.setActive(p2.id);
    expect(r.profiles.active()?.id).toBe(p2.id);
    expect(r.profiles.get(p1.id)?.isActive).toBe(false);
    const upd = r.profiles.update(p1.id, {
      salary: { min: 6000, max: 9000, currency: "BRL", period: "monthly" },
      salaryBelowReference: true,
    });
    expect(upd.salary?.min).toBe(6000);
    expect(upd.salaryBelowReference).toBe(true);
    expect(r.profiles.get(p2.id)?.needsResearch).toEqual([
      "salary",
      "contractTypes",
      "locations",
      "availableFrom",
    ]);
  });
});

describe("repos/facts", () => {
  let r: Repos;
  beforeEach(() => {
    r = setup();
    r.users.upsert({ fullName: "Ana" });
  });

  it("CRUD de experiência + conquista e cada escrita incrementa facts_version", () => {
    const before = r.settings.getFactsVersion();
    const exp = r.facts.experiences.insert({
      company: "Acme Ltda",
      title: "Engenheira de Software Sênior",
      startDate: "2021-03",
      endDate: "2023-11",
      isCurrent: false,
      tech: ["Go", "Kubernetes"],
      confidence: 0.85,
      verified: true,
    });
    const ach = r.facts.achievements.insert({
      experienceId: exp.id,
      text: "Reduziu a latência p95 em 40%",
      metric: "40%",
      confidence: 0.7,
      verified: true,
    });
    expect(r.facts.experiences.list()).toHaveLength(1);
    expect(r.facts.achievements.listByExperience(exp.id)[0]?.id).toBe(ach.id);
    r.facts.experiences.update(exp.id, { title: "Staff Engineer" });
    expect(r.facts.experiences.get(exp.id)?.title).toBe("Staff Engineer");
    r.facts.achievements.remove(ach.id);
    r.facts.experiences.remove(exp.id);
    expect(r.facts.experiences.list()).toHaveLength(0);
    expect(r.settings.getFactsVersion()).toBe(before + 5);
  });

  it("skills normalizam o nome; education e languages gravam e listam", () => {
    const s = r.facts.skills.insert({
      name: "ReactJS ",
      category: "framework",
      level: 4,
      confidence: 1,
      verified: true,
    });
    expect(s.nameNormalized).toBe("reactjs");
    r.facts.education.insert({
      institution: "Unicamp",
      course: "Ciência da Computação",
      status: "completed",
      startDate: "2014",
      endDate: "2018",
      confidence: 0.95,
      verified: true,
    });
    r.facts.languages.insert({ name: "Inglês", level: "C1", confidence: 0.9, verified: true });
    expect(r.facts.education.list()[0]?.institution).toBe("Unicamp");
    expect(r.facts.languages.list()[0]?.level).toBe("C1");
    expect(r.facts.counts()).toEqual({
      experiences: 0,
      achievements: 0,
      education: 1,
      skills: 1,
      languages: 1,
      projects: 0, // F02-9
    });
  });
});

describe("repos/sourceFiles, readings, digests, ingestionRuns", () => {
  it("fluxo de uma ingestão: arquivo → run → leituras/segmentos → digest", () => {
    const r = setup();
    const file = r.sourceFiles.insert({
      originalName: "cv.pdf",
      mime: "application/pdf",
      size: 1234,
      sha256: "a".repeat(64),
      path: "uploads/aaaa.pdf",
      kind: "cv",
    });
    expect(r.sourceFiles.findBySha256("a".repeat(64))?.id).toBe(file.id);
    const run = r.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "haiku", facts: "haiku", digest: "sonnet" },
      options: { ocr: true, modelRead: true },
      depth: "quick",
    });
    expect(run.status).toBe("estimating");
    r.ingestionRuns.setEstimate(run.id, {
      documentTokens: 3000,
      factsTokens: 5000,
      digestTokens: 4000,
    });
    r.ingestionRuns.setStatus(run.id, "running");
    r.ingestionRuns.addUsage(run.id, "facts", { inputTokens: 5100, outputTokens: 800 });
    r.readings.insert({
      runId: run.id,
      kind: "text_layer",
      textPath: "digests/aaaa.text_layer.txt",
      quality: 0.9,
      pages: 2,
      durationMs: 120,
    });
    r.readings.replaceSegments(run.id, [
      {
        index: 0,
        sectionHint: "Experiência",
        text: "Acme 2021–2023",
        origin: "text_layer",
        agreement: 1,
        divergences: [],
      },
    ]);
    expect(r.readings.listByRun(run.id)).toHaveLength(1);
    expect(r.readings.segmentsByRun(run.id)[0]?.origin).toBe("text_layer");
    const digest = r.digests.upsert({
      fileId: file.id,
      summary: "Currículo de engenheira de software.",
      keyPoints: ["Acme (2021–2023)"],
      sections: [{ title: "Experiência", start: 0, end: 10 }],
      meta: { pages: 2, language: "pt" },
      editedByUser: false,
      textPath: "digests/aaaa.txt",
    });
    expect(digest.fileId).toBe(file.id);
    const got = r.ingestionRuns.get(run.id);
    expect(got?.status).toBe("running");
    expect(got?.estimate?.factsTokens).toBe(5000);
    expect(got?.usage?.facts?.inputTokens).toBe(5100);
    r.ingestionRuns.setStatus(run.id, "review");
    expect(r.ingestionRuns.get(run.id)?.status).toBe("review");
  });
});

describe("repos/proposals.review", () => {
  const proposals: FactProposal[] = [
    {
      kind: "identity",
      confidence: 0.9,
      data: {
        fullName: "Ana Maria Exemplo",
        email: "ana@example.com",
        city: "Campinas",
        country: "BR",
      },
    },
    {
      kind: "experience",
      confidence: 0.85,
      data: {
        company: "Acme Ltda",
        title: "Engenheira",
        startDate: "2021-03",
        endDate: "2023-11",
        isCurrent: false,
        tech: ["Go"],
      },
    },
    {
      kind: "achievement",
      confidence: 0.7,
      data: { experienceIndex: 0, text: "Reduziu latência em 40%", metric: "40%" },
    },
    {
      kind: "experience",
      confidence: 0.6,
      data: {
        company: "Globex",
        title: "Dev",
        startDate: "2018-01",
        endDate: "2021-02",
        isCurrent: false,
        tech: [],
      },
    },
    {
      kind: "education",
      confidence: 0.95,
      data: { institution: "Unicamp", course: "CC", status: "completed" },
    },
    { kind: "skill", confidence: 0.8, data: { name: "Go", category: "language", level: 4 } },
    { kind: "language", confidence: 0.9, data: { name: "Inglês", level: "C1" } },
    { kind: "link", confidence: 1, data: { label: "GitHub", url: "https://github.com/exemplo" } },
  ];

  function runWithProposals() {
    const r = setup();
    const file = r.sourceFiles.insert({
      originalName: "cv.pdf",
      mime: "application/pdf",
      size: 1,
      sha256: "b".repeat(64),
      path: "uploads/b.pdf",
      kind: "cv",
    });
    const run = r.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "haiku", facts: "haiku", digest: "sonnet" },
      options: { ocr: true, modelRead: true },
      depth: "quick",
    });
    const ids = r.proposals.insertMany(run.id, proposals);
    return { r, file, run, ids };
  }

  it("aceita, edita e rejeita: cria fatos verificados com fonte, atualiza o usuário único, resolve experienceIndex", () => {
    const { r, run, ids } = runWithProposals();
    r.users.upsert({ fullName: "Ana" });
    const before = r.settings.getFactsVersion();
    const result = r.proposals.review(run.id, [
      { proposalId: ids[0] as string, decision: "accept" },
      {
        proposalId: ids[1] as string,
        decision: "edit",
        editedData: { title: "Engenheira de Software Sênior" },
      },
      { proposalId: ids[2] as string, decision: "accept" },
      { proposalId: ids[3] as string, decision: "reject" },
      { proposalId: ids[4] as string, decision: "accept" },
      { proposalId: ids[5] as string, decision: "accept" },
      { proposalId: ids[6] as string, decision: "accept" },
      { proposalId: ids[7] as string, decision: "accept" },
    ]);
    expect(result.accepted).toBe(6);
    expect(result.edited).toBe(1);
    expect(result.rejected).toBe(1);
    expect(r.users.count()).toBe(1);
    const user = r.users.get();
    expect(user?.fullName).toBe("Ana Maria Exemplo");
    expect(user?.email).toBe("ana@example.com");
    expect(user?.links).toEqual([{ label: "GitHub", url: "https://github.com/exemplo" }]);
    const exps = r.facts.experiences.list();
    expect(exps).toHaveLength(1);
    expect(exps[0]?.title).toBe("Engenheira de Software Sênior");
    expect(exps[0]?.verified).toBe(true);
    expect(exps[0]?.sourceId).toBeTruthy();
    const ach = r.facts.achievements.listByExperience(exps[0]?.id as string);
    expect(ach).toHaveLength(1);
    const source = r.factSources.get(exps[0]?.sourceId as string);
    expect(source?.kind).toBe("cv");
    expect(source?.runId).toBe(run.id);
    expect(r.proposals.listByRun(run.id).map((p) => p.decision)).toEqual([
      "accepted",
      "edited",
      "accepted",
      "rejected",
      "accepted",
      "accepted",
      "accepted",
      "accepted",
    ]);
    expect(r.proposals.listByRun(run.id)[1]?.targetId).toBe(exps[0]?.id);
    expect(r.settings.getFactsVersion()).toBeGreaterThan(before);
  });

  it("recusa decisão para proposta de outro run e conquista cuja experiência foi rejeitada é ignorada", () => {
    const { r, run, ids } = runWithProposals();
    const other = r.ingestionRuns.create({
      fileId: r.sourceFiles.get(run.fileId as string)?.id as string,
      provider: "mock",
      models: { document: "haiku", facts: "haiku", digest: "sonnet" },
      options: { ocr: false, modelRead: false },
      depth: "quick",
    });
    expect(() =>
      r.proposals.review(other.id, [{ proposalId: ids[0] as string, decision: "accept" }]),
    ).toThrow(ProposalReviewError);
    const res = r.proposals.review(run.id, [
      { proposalId: ids[1] as string, decision: "reject" },
      { proposalId: ids[2] as string, decision: "accept" },
    ]);
    expect(res.skipped).toBe(1);
    expect(r.facts.achievements.count()).toBe(0);
    expect(r.proposals.listByRun(run.id)[2]?.decision).toBe("skipped");
  });

  it("revisar duas vezes a mesma proposta aceita não duplica o fato", () => {
    const { r, run, ids } = runWithProposals();
    r.proposals.review(run.id, [{ proposalId: ids[5] as string, decision: "accept" }]);
    r.proposals.review(run.id, [{ proposalId: ids[5] as string, decision: "accept" }]);
    expect(r.facts.skills.list()).toHaveLength(1);
  });
});

describe("repos/jobs (espelho da BullMQ)", () => {
  it("applyEvent é idempotente, respeita ordem e não rebaixa estado terminal", () => {
    const r = setup();
    r.jobs.upsertQueued({
      id: "run-1:extract.facts",
      queue: "extract",
      type: "extract.facts",
      parentId: "run-1",
      profileId: null,
      payload: { runId: "run-1" },
      stage: "queued",
      at: ISO,
    });
    expect(r.jobs.get("run-1:extract.facts")?.status).toBe("queued");
    r.jobs.applyEvent({ jobId: "run-1:extract.facts", type: "active", at: ISO, attempts: 1 });
    r.jobs.applyEvent({
      jobId: "run-1:extract.facts",
      type: "progress",
      at: ISO,
      progress: 40,
      stage: "extracting_facts",
    });
    r.jobs.applyEvent({
      jobId: "run-1:extract.facts",
      type: "progress",
      at: ISO,
      progress: 40,
      stage: "extracting_facts",
    });
    let j = r.jobs.get("run-1:extract.facts");
    expect(j?.status).toBe("active");
    expect(j?.progress).toBe(40);
    expect(j?.attempts).toBe(1);
    r.jobs.applyEvent({ jobId: "run-1:extract.facts", type: "stalled", at: ISO });
    expect(r.jobs.get("run-1:extract.facts")?.status).toBe("stalled");
    r.jobs.applyEvent({ jobId: "run-1:extract.facts", type: "active", at: ISO, attempts: 2 });
    r.jobs.applyEvent({
      jobId: "run-1:extract.facts",
      type: "completed",
      at: ISO,
      result: { proposals: 8 },
    });
    r.jobs.applyEvent({
      jobId: "run-1:extract.facts",
      type: "progress",
      at: ISO,
      progress: 50,
      stage: "late",
    });
    j = r.jobs.get("run-1:extract.facts");
    expect(j?.status).toBe("done");
    expect(j?.progress).toBe(100);
    expect(j?.result).toEqual({ proposals: 8 });
    expect(j?.finishedAt).toBe(ISO);
    r.jobs.upsertQueued({
      id: "run-1:extract.digest",
      queue: "extract",
      type: "extract.digest",
      parentId: "run-1",
      profileId: null,
      payload: {},
      stage: "queued",
      at: ISO,
    });
    r.jobs.applyEvent({ jobId: "run-1:extract.digest", type: "failed", at: ISO, error: "boom" });
    expect(r.jobs.get("run-1:extract.digest")?.status).toBe("error");
    expect(r.jobs.list({ parentId: "run-1" })).toHaveLength(2);
    expect(r.jobs.list({ status: "error" })).toHaveLength(1);
    expect(r.jobs.applyEvent({ jobId: "inexistente", type: "active", at: ISO })).toBe(false);
  });
});

describe("repos/usageEvents e salaryReferences", () => {
  it("grava eventos e soma por categoria; referência corrente por país troca ao inserir nova", () => {
    const r = setup();
    r.usageEvents.insert({
      id: "u1",
      ts: ISO,
      origin: "narnia",
      category: "ingest",
      jobId: null,
      sessionId: null,
      model: "haiku",
      inputTokens: 100,
      outputTokens: 20,
      cacheRead: 0,
      cacheWrite: 0,
      costUsdEst: 0.001,
    });
    r.usageEvents.insert({
      id: "u2",
      ts: ISO,
      origin: "narnia",
      category: "ingest",
      jobId: null,
      sessionId: null,
      model: "sonnet",
      inputTokens: 300,
      outputTokens: 50,
      cacheRead: 10,
      cacheWrite: 0,
      costUsdEst: 0.01,
    });
    r.usageEvents.insert({
      id: "u3",
      ts: ISO,
      origin: "narnia",
      category: "chat",
      jobId: null,
      sessionId: "s1",
      model: "sonnet",
      inputTokens: 1,
      outputTokens: 1,
      cacheRead: 0,
      cacheWrite: 0,
      costUsdEst: 0,
    });
    expect(r.usageEvents.summarizeByCategory()).toEqual([
      {
        category: "chat",
        events: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheRead: 0,
        cacheWrite: 0,
        costUsdEst: 0,
      },
      {
        category: "ingest",
        events: 2,
        inputTokens: 400,
        outputTokens: 70,
        cacheRead: 10,
        cacheWrite: 0,
        costUsdEst: 0.011,
      },
    ]);
    const seed = r.salaryReferences.current("BR");
    expect(seed?.source).toBe("dieese");
    expect(r.salaryReferences.current("PT")).toBeNull();
    r.salaryReferences.insert({
      country: "BR",
      source: "research",
      indicator: "salario_minimo_necessario",
      value: 7500,
      currency: "BRL",
      period: "monthly",
      referenceMonth: "2026-10",
      sourceUrl: "https://www.dieese.org.br/analisecestabasica/salarioMinimo.html",
      fetchedAt: ISO,
    });
    const cur = r.salaryReferences.current("BR");
    expect(cur?.value).toBe(7500);
    expect(cur?.isCurrent).toBe(true);
    expect(r.salaryReferences.list("BR")).toHaveLength(2);
    expect(r.salaryReferences.list("BR").filter((x) => x.isCurrent)).toHaveLength(1);
  });
});
