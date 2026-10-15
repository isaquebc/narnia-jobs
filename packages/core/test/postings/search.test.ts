import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { relatedPostings, searchPostings } from "../../src/postings/search";

function repos() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

/** Correções do teste do dono (2026-10-15): busca por texto na página Vagas e vagas parecidas já registradas. */
describe("F06 core · busca de vagas", () => {
  it("acha por empresa, cliente, cargo, role (rótulo em pt-BR) e nome de contato, sem acento nem caixa", () => {
    const r = repos();
    const a = r.postings.create({
      company: "Accenture",
      client: "Itaú Unibanco",
      title: "Dev Java",
      role: "backend",
    });
    const b = r.postings.create({
      company: "Nubank",
      title: "Data Engineer",
      role: "data_engineering",
    });
    r.postingContacts.add(b.id, { name: "Joana Prado", origin: "linkedin" });
    const ids = (q: string) => searchPostings(r, q).map((p) => p.id);
    expect(ids("itau")).toEqual([a.id]);
    expect(ids("ACCENTURE")).toEqual([a.id]);
    expect(ids("java")).toEqual([a.id]);
    expect(ids("backend")).toEqual([a.id]);
    expect(ids("engenharia de dados")).toEqual([b.id]);
    expect(ids("joana")).toEqual([b.id]);
    expect(ids("  ")).toEqual([b.id, a.id]);
    expect(ids("inexistente")).toEqual([]);
    // várias palavras: todas precisam aparecer (em qualquer campo)
    expect(ids("nubank joana")).toEqual([b.id]);
    expect(ids("nubank itau")).toEqual([]);
  });

  it("vagas parecidas: mesma empresa (ou cliente) e mesmo role, sem a própria; sem empresa ou role não há", () => {
    const r = repos();
    const a = r.postings.create({ company: "Accenture", client: "Itaú", role: "backend" });
    const sameCompany = r.postings.create({
      company: "accenture",
      title: "Outra",
      role: "backend",
    });
    const viaClient = r.postings.create({
      company: "Itaú Unibanco",
      client: null,
      role: "backend",
    });
    const crossed = r.postings.create({ company: "Itaú", role: "backend" });
    r.postings.create({ company: "Accenture", role: "frontend" });
    r.postings.create({ company: "Nubank", role: "backend" });
    const ids = relatedPostings(r, a).map((p) => p.id);
    expect(ids).toContain(sameCompany.id);
    expect(ids).toContain(crossed.id);
    expect(ids).not.toContain(viaClient.id);
    expect(ids).not.toContain(a.id);
    expect(ids).toHaveLength(2);
    expect(relatedPostings(r, r.postings.create({ company: "Accenture" }))).toEqual([]);
    // a única vaga do banco não acusa nada
    const solo = repos();
    expect(relatedPostings(solo, solo.postings.create({ company: "X", role: "qa" }))).toEqual([]);
  });
});
