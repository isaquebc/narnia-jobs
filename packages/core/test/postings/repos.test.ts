import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { postingIdentityHash } from "../../src/postings/identity";

function repos() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

/** F06/M2 · vaga editável que cresce aos poucos, contatos, notas com confirmação e análises. */
describe("F06/M2 core · repositórios da vaga", () => {
  it("cria com poucos dados, marca a origem dos campos e calcula a identidade", () => {
    const r = repos();
    const p = r.postings.create(
      { company: "Nubank", title: "Backend Engineer", skillsRequired: ["Go"] },
      { source: "model" },
    );
    expect(p).toMatchObject({
      status: "draft",
      company: "Nubank",
      client: null,
      skillsRequired: ["Go"],
      benefits: [],
      fieldSources: { company: "model", title: "model", skillsRequired: "model" },
      identityHash: postingIdentityHash({ company: "Nubank", title: "Backend Engineer" }),
    });
  });

  it("update mexe só no que veio, marca usuário e recalcula a identidade", () => {
    const r = repos();
    const p = r.postings.create({ company: "Nubank", jdText: "texto" }, { source: "heuristic" });
    expect(p.identityHash).toBeNull();
    const u = r.postings.update(p.id, { role: "backend", benefits: ["VR"] });
    expect(u).toMatchObject({ jdText: "texto", role: "backend", benefits: ["VR"] });
    expect(u.fieldSources).toEqual({
      company: "heuristic",
      jdText: "heuristic",
      role: "user",
      benefits: "user",
    });
    expect(u.identityHash).not.toBeNull();
    const cleared = r.postings.update(p.id, { benefits: [] }, { source: "model" });
    expect(cleared.fieldSources.benefits).toBeUndefined();
    // origem por campo
    const m = r.postings.update(
      p.id,
      { city: "São Paulo", state: "SP" },
      {
        sources: { city: "both" },
        source: "model",
      },
    );
    expect(m.fieldSources).toMatchObject({ city: "both", state: "model" });
  });

  it("findByIdentity acha as outras vagas com o mesmo hash; lista mais recente primeiro", () => {
    const r = repos();
    const a = r.postings.create({ company: "Itaú", title: "Dev Backend" });
    const b = r.postings.create({ company: "itau", title: "dev backend" });
    r.postings.create({ company: "Itaú", title: "Dev Frontend" });
    expect(r.postings.findByIdentity(a.identityHash as string, a.id).map((x) => x.id)).toEqual([
      b.id,
    ]);
    expect(r.postings.list()).toHaveLength(3);
  });

  it("contatos: adicionar, editar e remover; cascata ao apagar a vaga", () => {
    const r = repos();
    const p = r.postings.create({ company: "Nubank" });
    const c = r.postingContacts.add(p.id, { name: "Joana", origin: "linkedin" });
    expect(r.postingContacts.update(c.id, { email: "joana@nu.com" })).toMatchObject({
      name: "Joana",
      email: "joana@nu.com",
      phone: null,
    });
    r.postingContacts.add(p.id, { name: "Rui", origin: "whatsapp", phone: "+55 11 99999-0000" });
    expect(r.postingContacts.list(p.id)).toHaveLength(2);
    r.postings.remove(p.id);
    expect(r.postingContacts.list(p.id)).toHaveLength(0);
  });

  it("notas: recrutador editando nota do usuário fica pendente até confirmar ou recusar (F06-17)", () => {
    const r = repos();
    const p = r.postings.create({ company: "Nubank" });
    const mine = r.postingNotes.add(p.id, "user", "Falei com a Joana dia 10");
    const edit = r.postingNotes.edit(
      mine.id,
      "recruiter",
      "Falei com a Joana dia 10; ela pediu portfólio",
    );
    expect(edit.pending).toBe(true);
    expect(edit.note).toMatchObject({
      body: "Falei com a Joana dia 10",
      pendingBody: expect.stringContaining("portfólio"),
    });
    expect(r.postingNotes.listPending().map((n) => n.id)).toEqual([mine.id]);
    expect(r.postingNotes.confirm(mine.id)).toMatchObject({
      body: "Falei com a Joana dia 10; ela pediu portfólio",
      pendingBody: null,
    });
    r.postingNotes.edit(mine.id, "recruiter", "outra");
    expect(r.postingNotes.reject(mine.id)).toMatchObject({
      pendingBody: null,
      body: expect.stringContaining("portfólio"),
    });
    // nota do recrutador: ele edita direto; o usuário também edita direto
    const his = r.postingNotes.add(p.id, "recruiter", "Vaga pede inglês");
    expect(r.postingNotes.edit(his.id, "recruiter", "Vaga pede inglês C1").pending).toBe(false);
    expect(r.postingNotes.edit(his.id, "user", "Inglês C1 ok").note.body).toBe("Inglês C1 ok");
    expect(r.postingNotes.listPending()).toEqual([]);
  });

  it("análises: histórico com a mais recente primeiro", () => {
    const r = repos();
    const p = r.postings.create({ company: "Nubank" });
    const base = {
      postingId: p.id,
      analysis: { fit: 70 },
      recommendedProfileId: null,
      factsVersion: 1,
      postingUpdatedAt: p.updatedAt,
      models: ["sonnet"],
      usage: null,
      chatSessionId: null,
    };
    r.jobAnalyses.add(base);
    const second = r.jobAnalyses.add({ ...base, analysis: { fit: 80 }, factsVersion: 2 });
    expect(r.jobAnalyses.latest(p.id)?.id).toBe(second.id);
    expect(r.jobAnalyses.list(p.id).map((a) => a.factsVersion)).toEqual([2, 1]);
  });
});
