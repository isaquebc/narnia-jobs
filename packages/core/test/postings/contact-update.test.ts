import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { createPostingTools } from "../../src/postings/tools";

/**
 * Editar um contato da vaga pelo agente (pedido do dono, 2026-11-04): `posting.contact_update` muda só os campos
 * enviados, `null` apaga, quem indicou vem pelo nome; mesmo LinkedIn ou e-mail de outro contato da vaga é recusado.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const posting = repos.postings.create(
    { company: "Globex", title: "Backend Sr" },
    { source: "user" },
  );
  const changed: string[] = [];
  const tools = createPostingTools(repos, {
    ports: {
      intake: async () => ({ ok: false, code: "x", message: "x" }),
      changed: (id) => changed.push(id),
    },
  });
  return { repos, posting, tools, changed };
}

describe("posting.contact_update", () => {
  it("corrige só os campos enviados e apaga com null", async () => {
    const { repos, posting, tools, changed } = setup();
    const { id } = await tools["posting.contact_add"]({
      postingId: posting.id,
      name: "Ana Souza",
      origin: "linkedin",
      email: "ana@errado.com",
      phone: "+55 11 99999-0000",
      role: "recruiter",
    });
    const r = await tools["posting.contact_update"]({
      id,
      email: "ana.souza@globex.com",
      phone: null,
      linkedinUrl: "linkedin.com/in/ana-souza",
    });
    expect(r).toEqual({ id, updated: ["email", "phone", "linkedinUrl"] });
    expect(repos.postingContacts.get(id)).toMatchObject({
      name: "Ana Souza",
      origin: "linkedin",
      role: "recruiter",
      email: "ana.souza@globex.com",
      phone: null,
      linkedinUrl: "https://linkedin.com/in/ana-souza",
    });
    expect(changed).toContain(posting.id);
  });

  it("quem indicou pelo nome; não pode indicar a si mesmo", async () => {
    const { repos, posting, tools } = setup();
    const maria = await tools["posting.contact_add"]({
      postingId: posting.id,
      name: "Maria",
      origin: "other",
    });
    const joao = await tools["posting.contact_add"]({
      postingId: posting.id,
      name: "João",
      origin: "email",
    });
    await tools["posting.contact_update"]({ id: joao.id, referredBy: "maria" });
    expect(repos.postingContacts.get(joao.id)?.referredById).toBe(maria.id);
    await expect(
      tools["posting.contact_update"]({ id: joao.id, referredBy: "João" }),
    ).rejects.toThrow(/si mesm/);
    await tools["posting.contact_update"]({ id: joao.id, referredBy: null });
    expect(repos.postingContacts.get(joao.id)?.referredById).toBeNull();
  });

  it("recusa LinkedIn ou e-mail de outro contato da vaga, contato inexistente e pedido vazio", async () => {
    const { posting, tools } = setup();
    await tools["posting.contact_add"]({
      postingId: posting.id,
      name: "Ana",
      origin: "email",
      email: "ana@globex.com",
    });
    const b = await tools["posting.contact_add"]({
      postingId: posting.id,
      name: "Bia",
      origin: "other",
    });
    await expect(
      tools["posting.contact_update"]({ id: b.id, email: "ana@globex.com" }),
    ).rejects.toThrow(/Ana/);
    await expect(
      tools["posting.contact_update"]({ id: "01900000-0000-7000-8000-000000000000", name: "X" }),
    ).rejects.toThrow(/não encontrado/);
    await expect(tools["posting.contact_update"]({ id: b.id })).rejects.toThrow();
  });
});
