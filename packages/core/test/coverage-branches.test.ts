/**
 * Testes de ramos opcionais e caminhos de erro (escritos após o comportamento existir, para fechar a cobertura
 * de ramos ≥ 80% exigida em F01 §6.5; registrados em §8 como "teste depois: cobertura").
 */
import { describe, expect, it } from "vitest";
import {
  consolidateReadings,
  createRepos,
  createTesseractRecognizer,
  detectArea,
  ExtractError,
  extractDocxText,
  extractPdfText,
  migrate,
  openDatabase,
  readDigestText,
  recordUsage,
  suggestProfile,
  yearsOfExperience,
} from "../src";
import { bool, json, num, omit, str } from "../src/db/sql";

function repos() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

describe("db/sql helpers", () => {
  it("json/bool/str/num/omit cobrem nulos, inválidos e remoção de chaves", () => {
    expect(json(null, [])).toEqual([]);
    expect(json("{bad", { a: 1 })).toEqual({ a: 1 });
    expect(json('{"a":2}', {})).toEqual({ a: 2 });
    expect(bool(1)).toBe(true);
    expect(bool(0)).toBe(false);
    expect(bool(true)).toBe(true);
    expect(str(undefined)).toBeNull();
    expect(str(5)).toBe("5");
    expect(num(null)).toBeNull();
    expect(num("3")).toBe(3);
    expect(omit({ a: 1, b: 2 }, ["b"])).toEqual({ a: 1 });
  });
});

describe("repos: ramos opcionais", () => {
  it("facts com campos opcionais presentes e ausentes; update de id inexistente lança", () => {
    const r = repos();
    r.users.upsert({ fullName: "Ana" });
    const exp = r.facts.experiences.insert({
      company: "Acme",
      title: "Eng",
      employmentType: "pj",
      startDate: "2020-01",
      endDate: "2021-01",
      isCurrent: false,
      location: "Campinas",
      summary: "Backend",
      tech: ["Go"],
      sourceId: null,
      confidence: 0.5,
      verified: false,
    });
    expect(exp.employmentType).toBe("pj");
    expect(exp.location).toBe("Campinas");
    expect(exp.summary).toBe("Backend");
    const edu = r.facts.education.insert({
      institution: "X",
      course: "Y",
      degree: "Bacharelado",
      startDate: "2010",
      endDate: "2014",
      status: "completed",
      confidence: 1,
      verified: true,
    });
    expect(edu.degree).toBe("Bacharelado");
    const ach = r.facts.achievements.insert({
      experienceId: exp.id,
      text: "Fez algo",
      confidence: 1,
      verified: true,
    });
    expect(ach.metric).toBeUndefined();
    const skill = r.facts.skills.insert({
      name: "Go",
      category: "language",
      confidence: 1,
      verified: true,
    });
    expect(skill.level).toBeUndefined();
    expect(r.facts.skills.update(skill.id, { level: 5 }).level).toBe(5);
    expect(() => r.facts.skills.update("nope", { level: 1 })).toThrow(/não encontrado/);
    expect(r.facts.experiences.get("nope")).toBeNull();
  });

  it("readings sem pages/usage/durationMs; segmentos sem sectionHint", () => {
    const r = repos();
    const f = r.sourceFiles.insert({
      mime: "text/plain",
      size: 1,
      sha256: "d".repeat(64),
      path: "uploads/d.txt",
      kind: "text",
    });
    expect(f.originalName).toBeNull();
    expect(r.sourceFiles.get("nope")).toBeNull();
    expect(r.sourceFiles.list()).toHaveLength(1);
    const run = r.ingestionRuns.create({
      fileId: f.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    expect(r.ingestionRuns.listByFile(f.id)).toHaveLength(1);
    expect(r.ingestionRuns.get("nope")).toBeNull();
    expect(() =>
      r.ingestionRuns.addUsage("nope", "facts", { inputTokens: 1, outputTokens: 1 }),
    ).toThrow();
    r.ingestionRuns.setStatus(run.id, "error", { error: "boom" });
    expect(r.ingestionRuns.get(run.id)?.error).toBe("boom");
    const reading = r.readings.insert({ runId: run.id, kind: "ocr", textPath: "x", quality: 0.5 });
    expect(reading.pages).toBeNull();
    expect(reading.usage).toBeNull();
    expect(reading.durationMs).toBeNull();
    r.readings.replaceSegments(run.id, [
      { index: 0, sectionHint: null, text: "a", origin: "ocr", agreement: 1, divergences: [] },
    ]);
    expect(r.readings.segmentsByRun(run.id)[0]?.sectionHint).toBeNull();
  });

  it("factSources com e sem referências; digests.get inexistente; settings sem facts_version volta 0", () => {
    const r = repos();
    const s1 = r.factSources.create({ kind: "manual" });
    expect(s1.fileId).toBeNull();
    expect(s1.runId).toBeNull();
    expect(s1.url).toBeNull();
    const s2 = r.factSources.create({ kind: "pesquisa", url: "https://example.com" });
    expect(r.factSources.get(s2.id)?.url).toBe("https://example.com");
    expect(r.factSources.get("nope")).toBeNull();
    expect(r.digests.get("nope")).toBeNull();
    r.db.exec("delete from settings where key = 'facts_version'");
    expect(r.settings.getFactsVersion()).toBe(0);
    expect(r.profiles.get("nope")).toBeNull();
    expect(() => r.profiles.update("nope", {})).toThrow();
    expect(() => r.profiles.setActive("nope")).toThrow();
    expect(r.profiles.active()).toBeNull();
    expect(r.users.get()).toBeNull();
    expect(() => r.users.complete()).toThrow(/não criado/);
  });

  it("proposals: edição sem dados e proposta desconhecida lançam códigos próprios", () => {
    const r = repos();
    const f = r.sourceFiles.insert({
      mime: "application/pdf",
      size: 1,
      sha256: "e".repeat(64),
      path: "u",
      kind: "cv",
    });
    const run = r.ingestionRuns.create({
      fileId: f.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: true, modelRead: true },
    });
    const [id] = r.proposals.insertMany(run.id, [
      { kind: "skill", confidence: 1, data: { name: "Go", category: "language" } },
    ]);
    expect(() =>
      r.proposals.review(run.id, [{ proposalId: id as string, decision: "edit" }]),
    ).toThrow(/sem dados/);
    expect(() => r.proposals.review(run.id, [{ proposalId: "nope", decision: "accept" }])).toThrow(
      /desconhecida/,
    );
    const res = r.proposals.review(run.id, [
      { proposalId: id as string, decision: "edit", editedData: { name: "Golang" } },
    ]);
    expect(res.edited).toBe(1);
    expect(r.facts.skills.list()[0]?.name).toBe("Golang");
  });

  it("jobs: evento cancelled e active com stage; list sem filtros", () => {
    const r = repos();
    const at = "2026-10-07T12:00:00.000Z";
    r.jobs.upsertQueued({
      id: "j",
      queue: "ingest",
      type: "t",
      parentId: null,
      profileId: "p",
      payload: {},
      stage: "queued",
      at,
    });
    r.jobs.applyEvent({ jobId: "j", type: "active", at, stage: "reading" });
    expect(r.jobs.get("j")?.stage).toBe("reading");
    r.jobs.applyEvent({ jobId: "j", type: "cancelled", at });
    expect(r.jobs.get("j")?.status).toBe("cancelled");
    expect(r.jobs.list()).toHaveLength(1);
    r.jobs.upsertQueued({
      id: "k",
      queue: "ocr",
      type: "t",
      parentId: null,
      profileId: null,
      payload: {},
      stage: "queued",
      at,
    });
    r.jobs.applyEvent({ jobId: "k", type: "failed", at });
    expect(r.jobs.get("k")?.error).toBe("erro desconhecido");
    r.jobs.applyEvent({ jobId: "k", type: "completed", at }); // terminal: ignorado
    expect(r.jobs.get("k")?.status).toBe("error");
  });
});

describe("extract/pdf: caminhos de erro", () => {
  it("DOCX corrompido e PDF corrompido lançam ExtractError(corrupt)", async () => {
    await expect(extractDocxText(Buffer.from("PK\x03\x04lixo word/"))).rejects.toMatchObject({
      code: "corrupt",
    });
    await expect(extractPdfText(Buffer.from("%PDF-1.4 lixo sem estrutura"))).rejects.toBeInstanceOf(
      ExtractError,
    );
  });
  it("digest sem textPath lança", () => {
    expect(() => readDigestText("/tmp", { textPath: null })).toThrow(/sem texto/);
  });
  it("recordUsage aceita id próprio e ts ausente", () => {
    const r = repos();
    const dir = `/tmp/narnia-usage-${Date.now()}`;
    const e = recordUsage(r, dir, {
      id: "fixo",
      origin: "narnia",
      category: "x",
      model: "haiku",
      jobId: null,
      sessionId: "s",
      inputTokens: 1,
      outputTokens: 1,
      cacheRead: 0,
      cacheWrite: 0,
      costUsdEst: 0,
    });
    expect(e.id).toBe("fixo");
    expect(e.ts).toMatch(/Z$/);
  });
});

describe("pdf/ocr: fábrica injetada", () => {
  it("mapeia texto ausente e confiança fora da escala; terminate repassa", async () => {
    let terminated = false;
    const rec = await createTesseractRecognizer(
      { langs: ["eng"], langPath: "/x" },
      async (langs, langPath) => {
        expect(langs).toEqual(["eng"]);
        expect(langPath).toBe("/x");
        return {
          async recognize() {
            return { data: { confidence: 250 } };
          },
          async terminate() {
            terminated = true;
          },
        };
      },
    );
    expect(await rec.recognize("p.png")).toEqual({ text: "", confidence: 1 });
    await rec.terminate();
    expect(terminated).toBe(true);
  });
});

describe("pdf/consolidate: ramos", () => {
  it("todas as leituras inúteis → vazio; linhas em número diferente usam alinhamento por similaridade; empate mantém a base", () => {
    expect(consolidateReadings([{ kind: "ocr", quality: 0.01, text: "x" }])).toEqual({
      text: "",
      segments: [],
      usedKinds: [],
    });
    const base =
      "EXPERIÊNCIA\nAcme Ltda — Engenheira — 2021 a 2023\n- Reduziu a latência em 40%\n- Liderou migração";
    const other = "EXPERIÊNCIA\nAcme Ltda — Engenheira — 2021 a 2023\n- Reduziu a latência em 40%";
    const r = consolidateReadings([
      { kind: "model_read", quality: 0.9, text: base },
      { kind: "ocr", quality: 0.6, text: other },
    ]);
    expect(r.segments[0]?.text).toContain("Liderou migração");
    const tie = consolidateReadings([
      { kind: "model_read", quality: 0.9, text: "SKILLS\nGo Python Kubernetes" },
      { kind: "ocr", quality: 0.6, text: "SKILLS\nGo Pyth0n Kubernetes" },
    ]);
    expect(tie.text).toContain("Python");
    expect(tie.segments[0]?.divergences[0]?.chosen).toBe("Python");
    const unmatched = consolidateReadings([
      {
        kind: "model_read",
        quality: 0.9,
        text: "FORMAÇÃO\nUnicamp 2014 a 2018 ciência da computação",
      },
      { kind: "ocr", quality: 0.6, text: "Texto totalmente diferente sem nada em comum aqui" },
    ]);
    expect(unmatched.segments[0]?.agreement).toBe(1);
  });
});

describe("profile/suggest: ramos", () => {
  it("datas inválidas caem no agora; áreas data/network/design; área por skills; sem experiência e área other", () => {
    expect(
      yearsOfExperience(
        [{ title: "x", startDate: "sem-data", isCurrent: true, tech: [] }],
        new Date("2026-10-07T00:00:00Z"),
      ),
    ).toBe(0);
    expect(detectArea(["Cientista de Dados"], [])).toBe("data");
    expect(detectArea(["Engenheiro de Redes"], [])).toBe("network");
    expect(detectArea(["UX Designer"], [])).toBe("design");
    expect(detectArea(["Analista"], [{ name: "Scrum", category: "management" }])).toBe(
      "management",
    );
    expect(detectArea(["Analista"], [{ name: "Go", category: "language" }])).toBe("software");
    expect(detectArea(["Analista"], [])).toBe("other");
    const none = suggestProfile({ experiences: [], skills: [] });
    expect(none.targetTitle).toBe("Profissional");
    const noneData = suggestProfile({
      experiences: [],
      skills: [{ name: "SQL", category: "data" }],
    });
    expect(noneData.area).toBe("other");
    const pleno = suggestProfile(
      {
        experiences: [{ title: "Dev", startDate: "2023-01", isCurrent: true, tech: [] }],
        skills: [],
      },
      new Date("2026-10-07T00:00:00Z"),
    );
    expect(pleno.seniority).toBe("pleno");
    const past = suggestProfile({
      experiences: [
        { title: "Dev A", startDate: "2019-01", endDate: "2020-01", isCurrent: false, tech: [] },
        { title: "Dev B", startDate: "2021-01", endDate: "2022-01", isCurrent: false, tech: [] },
      ],
      skills: [],
    });
    expect(past.targetTitle).toBe("Dev B");
  });
});
