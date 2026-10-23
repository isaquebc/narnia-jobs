import type { PostingMergeOutput, PreAnalysis } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  applyPostingMerge,
  createPostingFromIntake,
  decideDuplicate,
  duplicateCandidate,
  recordDuplicateCheck,
} from "../../src/postings/ingest";
import { seedFixture } from "../../src/testing/profile-fixtures";
import { JD_PT } from "./fixtures";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  seedFixture(repos, "engineer");
  return repos;
}

const merge = (over: Partial<PostingMergeOutput["fields"]> = {}): PostingMergeOutput => ({
  fields: {
    company: "Accenture",
    client: "Itaú Unibanco",
    title: "Desenvolvedor(a) Backend Sênior",
    role: "backend",
    seniority: "senior",
    city: "São Paulo",
    state: "SP",
    country: "BR",
    workMode: "hybrid",
    contractType: "clt",
    currency: "BRL",
    salaryMin: 15000,
    salaryMax: 20000,
    salaryPeriod: "monthly",
    benefits: ["Vale refeição"],
    responsibilities: [],
    skillsRequired: ["Java"],
    skillsNice: ["AWS"],
    companySummary: "Consultoria global.",
    postingUrl: null,
    companyUrl: null,
    jdText: null,
    publishedAt: null,
    ...over,
  },
  fieldSources: [
    { field: "company", source: "model" },
    { field: "city", source: "both" },
  ],
  keywords: [
    { term: "Java", section: "required", source: "both" },
    { term: "Spring Boot", section: "required", source: "model" },
    { term: "ZeroMQ", section: "nice", source: "model" },
  ],
});

/** F06/M4 core · pipeline da vaga sem o modelo: criar, aplicar merge e resolver duplicata. */
describe("F06/M4 core · pipeline da vaga", () => {
  it("criar pelo texto aplica a heurística na hora e fica extracting; campos do usuário vencem", () => {
    const repos = setup();
    const p = createPostingFromIntake(repos, {
      text: JD_PT,
      url: "https://vagas.exemplo.com/1",
      fields: { company: "Accenture" },
    });
    expect(p.status).toBe("extracting");
    expect(p).toMatchObject({
      company: "Accenture",
      title: "Desenvolvedor(a) Backend Sênior",
      contractType: "clt",
    });
    expect(p.fieldSources).toMatchObject({
      company: "user",
      title: "heuristic",
      jdText: "user",
      postingUrl: "user",
    });
    expect((p.preAnalysis as PreAnalysis).keywords.length).toBeGreaterThan(0);
  });

  it("sem texto: rascunho sem pré-análise", () => {
    const repos = setup();
    const p = createPostingFromIntake(repos, { fields: { company: "Nubank", role: "backend" } });
    expect(p).toMatchObject({ status: "draft", preAnalysis: null });
  });

  it("merge não sobrescreve campo do usuário; origem por campo; keywords com origem e evidência", () => {
    const repos = setup();
    const p = createPostingFromIntake(repos, {
      text: JD_PT,
      fields: { company: "Accenture Brasil" },
    });
    const u = applyPostingMerge(repos, p.id, merge());
    expect(u.company).toBe("Accenture Brasil");
    expect(u.fieldSources.company).toBe("user");
    expect(u.fieldSources.city).toBe("both");
    expect(u.fieldSources.companySummary).toBe("model");
    const pre = u.preAnalysis as PreAnalysis;
    expect(pre.keywords.map((k) => [k.term, k.source])).toEqual([
      ["Java", "both"],
      ["Spring", "model"],
      ["ZeroMQ", "model"],
    ]);
    expect(pre.keywords.find((k) => k.term === "ZeroMQ")?.category).toBe("other");
    expect(pre.ngrams.length).toBeGreaterThanOrEqual(0);
  });

  it("duplicata: candidata pelo hash; update leva campos, contatos e notas para a salva e apaga a nova", () => {
    const repos = setup();
    const saved = createPostingFromIntake(repos, {
      fields: { company: "Itaú", title: "Dev Backend" },
    });
    const incoming = createPostingFromIntake(repos, {
      fields: { company: "itau", title: "dev backend", city: "Recife" },
    });
    expect(duplicateCandidate(repos, incoming.id)?.id).toBe(saved.id);
    repos.postingContacts.add(incoming.id, { name: "Joana", origin: "linkedin" });
    repos.postingNotes.add(incoming.id, "user", "nota da nova");
    recordDuplicateCheck(repos, incoming.id, saved.id, {
      sameJob: true,
      confidence: 90,
      differences: [{ field: "cidade", saved: "não informado", incoming: "Recife" }],
      rationale: "Mesma vaga.",
    });
    expect(repos.postings.get(incoming.id)?.duplicate).toMatchObject({
      confidence: 90,
      decision: null,
    });
    const r = decideDuplicate(repos, incoming.id, "update");
    expect(r).toEqual({ keptId: saved.id, removedId: incoming.id });
    expect(repos.postings.get(saved.id)?.city).toBe("Recife");
    // campo do usuário na salva não é trocado pelo da nova só porque mudou a grafia
    expect(repos.postings.get(saved.id)?.company).toBe("Itaú");
    expect(repos.postingContacts.list(saved.id).map((c) => c.name)).toEqual(["Joana"]);
    expect(repos.postingNotes.list(saved.id).map((n) => n.body)).toEqual(["nota da nova"]);
    expect(repos.postings.get(incoming.id)).toBeNull();
  });

  it("duplicata: mesmo link (sem o rastreio) é candidata mesmo com o cargo escrito de outro jeito", () => {
    const repos = setup();
    const saved = createPostingFromIntake(repos, {
      url: "https://vagas.example/123?utm_source=linkedin",
      fields: { company: "Acme", title: "Engenheira Backend Sênior" },
    });
    createPostingFromIntake(repos, { fields: { company: "Outra", title: "Dev" } });
    const incoming = createPostingFromIntake(repos, {
      url: "https://vagas.example/123/",
      fields: { company: "Acme", title: "Senior Backend Engineer" },
    });
    expect(duplicateCandidate(repos, incoming.id)?.id).toBe(saved.id);
    // sem link igual nem identidade igual, não há candidata
    const other = createPostingFromIntake(repos, {
      url: "https://vagas.example/999",
      fields: { company: "Acme", title: "Designer" },
    });
    expect(duplicateCandidate(repos, other.id)).toBeNull();
  });

  it("duplicata decidida: capturas da extensão ligadas à nova passam para a salva (update e cancel)", () => {
    const repos = setup();
    const saved = createPostingFromIntake(repos, { fields: { company: "Itaú", title: "Dev" } });
    const out = { sameJob: true, confidence: 90, differences: [], rationale: "Mesma." };
    for (const action of ["update", "cancel"] as const) {
      const p = createPostingFromIntake(repos, { fields: { company: "Itaú", title: "Dev" } });
      const c = repos.extension.createCapture({
        kind: "page",
        url: "https://vagas.example/1",
        title: null,
        payload: {},
        deviceId: null,
      });
      repos.extension.linkCapturePosting(c.id, p.id);
      recordDuplicateCheck(repos, p.id, saved.id, out);
      decideDuplicate(repos, p.id, action);
      expect(repos.extension.getCapture(c.id)?.postingId).toBe(saved.id);
    }
  });

  it("duplicata: new mantém as duas com a decisão; cancel apaga a nova", () => {
    const repos = setup();
    const saved = createPostingFromIntake(repos, { fields: { company: "Itaú", title: "Dev" } });
    const a = createPostingFromIntake(repos, { fields: { company: "Itaú", title: "Dev" } });
    const out = { sameJob: false, confidence: 30, differences: [], rationale: "Outra." };
    recordDuplicateCheck(repos, a.id, saved.id, out);
    expect(decideDuplicate(repos, a.id, "new")).toEqual({ keptId: a.id, removedId: null });
    expect(repos.postings.get(a.id)?.duplicate?.decision).toBe("new");
    const b = createPostingFromIntake(repos, { fields: { company: "Itaú", title: "Dev" } });
    recordDuplicateCheck(repos, b.id, saved.id, out);
    expect(decideDuplicate(repos, b.id, "cancel")).toEqual({ keptId: null, removedId: b.id });
    expect(
      repos.postings
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual([saved.id, a.id].sort());
  });
});
