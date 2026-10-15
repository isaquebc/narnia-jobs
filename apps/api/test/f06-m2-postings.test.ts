import { editPostingNote, seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F06/M2 · API da vaga: criar com poucos dados, editar, contatos, notas com confirmação (F06-17). */
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("F06/M2 · /api/postings", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("cria com o mínimo, lista, detalha, edita (origem usuário) e apaga", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    expect((await t.api("/api/postings", json({}))).status).toBe(400);
    const r = await t.api("/api/postings", json({ company: "Nubank", title: "Backend Engineer" }));
    expect(r.status).toBe(201);
    const { posting } = (await r.json()) as { posting: { id: string; fieldSources: object } };
    expect(posting.fieldSources).toEqual({ company: "user", title: "user" });
    expect(t.events).toContainEqual({ type: "posting.updated", postingId: posting.id });
    const list = (await (await t.api("/api/postings")).json()) as { postings: unknown[] };
    expect(list.postings).toHaveLength(1);
    const p = await t.api(
      `/api/postings/${posting.id}`,
      json(
        { jdText: "Requisitos: Go, Kafka", role: "backend", benefits: ["VR", "Plano de saúde"] },
        "PATCH",
      ),
    );
    expect(((await p.json()) as { posting: { benefits: string[] } }).posting.benefits).toEqual([
      "VR",
      "Plano de saúde",
    ]);
    expect(
      (await t.api(`/api/postings/${posting.id}`, json({ role: "chef" }, "PATCH"))).status,
    ).toBe(400);
    expect((await t.api(`/api/postings/${posting.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await t.api(`/api/postings/${posting.id}`)).status).toBe(404);
  });

  it("detalhe aponta outras vagas com a mesma identidade", async () => {
    t = makeTestApp();
    const a = t.repos.postings.create({ company: "Itaú", title: "Dev Backend" });
    const b = t.repos.postings.create({ company: "ITAU", title: "dev backend" });
    const d = (await (await t.api(`/api/postings/${b.id}`)).json()) as { duplicates: string[] };
    expect(d.duplicates).toEqual([a.id]);
  });

  it("contatos: adicionar, editar, recusar telefone inválido e remover", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({ company: "Nubank" });
    const c = (await (
      await t.api(`/api/postings/${p.id}/contacts`, json({ name: "Joana", origin: "linkedin" }))
    ).json()) as { contact: { id: string } };
    expect(
      (
        await t.api(
          `/api/postings/${p.id}/contacts`,
          json({ name: "X", origin: "whatsapp", phone: "abc" }),
        )
      ).status,
    ).toBe(400);
    const e = await t.api(
      `/api/postings/${p.id}/contacts/${c.contact.id}`,
      json({ email: "joana@nu.com" }, "PATCH"),
    );
    expect(((await e.json()) as { contact: { email: string } }).contact.email).toBe("joana@nu.com");
    expect(
      (await t.api(`/api/postings/${p.id}/contacts/${c.contact.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    const d = (await (await t.api(`/api/postings/${p.id}`)).json()) as { contacts: unknown[] };
    expect(d.contacts).toEqual([]);
  });

  it("nota do usuário alterada pelo recrutador vira pendência; confirmar aplica e resolve", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({ company: "Nubank", title: "Backend" });
    const n = (await (
      await t.api(`/api/postings/${p.id}/notes`, json({ body: "Primeira conversa" }))
    ).json()) as {
      note: { id: string };
    };
    // o recrutador edita pelas tools (M5); aqui direto pelo core
    editPostingNote(t.repos, n.note.id, "recruiter", "Primeira conversa: pediu portfólio");
    const open = t.repos.notifications.list().filter((x) => x.kind === "posting.note_pending");
    expect(open).toHaveLength(1);
    expect(open[0]?.actionUrl).toBe(`/vagas/${p.id}?nota=${n.note.id}`);
    const pending = (await (await t.api("/api/postings-pending-notes")).json()) as {
      notes: Array<{ note: { id: string }; posting: { company: string } }>;
    };
    expect(pending.notes.map((x) => [x.note.id, x.posting.company])).toEqual([
      [n.note.id, "Nubank"],
    ]);
    const c = await t.api(`/api/postings/${p.id}/notes/${n.note.id}/confirm`, { method: "POST" });
    expect(((await c.json()) as { note: { body: string } }).note.body).toMatch(/portfólio/);
    expect(t.repos.notifications.list().filter((x) => x.kind === "posting.note_pending")).toEqual(
      [],
    );
    expect(t.events).toContainEqual(expect.objectContaining({ type: "notification.updated" }));
  });

  it("recusar mantém o texto do usuário; nota de outra vaga dá 404", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({ company: "Nubank" });
    const other = t.repos.postings.create({ company: "Itaú" });
    const note = t.repos.postingNotes.add(p.id, "user", "minha");
    editPostingNote(t.repos, note.id, "recruiter", "dele");
    const r = await t.api(`/api/postings/${p.id}/notes/${note.id}/reject`, { method: "POST" });
    expect(((await r.json()) as { note: { body: string; pendingBody: null } }).note).toMatchObject({
      body: "minha",
      pendingBody: null,
    });
    expect(
      (await t.api(`/api/postings/${other.id}/notes/${note.id}/confirm`, { method: "POST" }))
        .status,
    ).toBe(404);
  });
});
