import { createPostingTools, editPostingNote, seedFixture } from "@narnia-jobs/core";
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

  it("busca por texto (?q=) e vagas parecidas no detalhe (correções 2026-10-15)", async () => {
    t = makeTestApp();
    const a = t.repos.postings.create({ company: "Accenture", client: "Itaú", role: "backend" });
    const b = t.repos.postings.create({ company: "Nubank", role: "backend" });
    t.repos.postingContacts.add(b.id, { name: "Joana Prado", origin: "linkedin" });
    const list = async (q: string) =>
      (
        (await (await t.api(`/api/postings?q=${encodeURIComponent(q)}`)).json()) as {
          postings: Array<{ id: string }>;
        }
      ).postings.map((p) => p.id);
    expect(await list("joana")).toEqual([b.id]);
    expect(await list("itau")).toEqual([a.id]);
    expect(await list("")).toEqual([b.id, a.id]);
    const detail = async (id: string) =>
      ((await (await t.api(`/api/postings/${id}`)).json()) as { related: Array<{ id: string }> })
        .related;
    // só uma vaga dessa empresa: nada de alerta
    expect(await detail(a.id)).toEqual([]);
    const c = t.repos.postings.create({ company: "Itaú", role: "backend" });
    expect((await detail(a.id)).map((p) => p.id)).toEqual([c.id]);
  });

  it("contatos: LinkedIn, duplicata recusada (409) e fixar um por vaga (2026-10-19)", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({ company: "Nubank" });
    const add = (body: object) => t.api(`/api/postings/${p.id}/contacts`, json(body));
    const r = await add({
      name: "Joana",
      origin: "linkedin",
      linkedinUrl: "linkedin.com/in/joana-silva/",
    });
    expect(r.status).toBe(201);
    const joana = ((await r.json()) as { contact: { id: string; linkedinUrl: string } }).contact;
    expect(joana.linkedinUrl).toBe("https://linkedin.com/in/joana-silva");
    expect(
      (await add({ name: "J", origin: "linkedin", linkedinUrl: "evil.com/in/x" })).status,
    ).toBe(400);
    const dup = await add({
      name: "Joana Silva",
      origin: "linkedin",
      linkedinUrl: "https://www.linkedin.com/in/joana-silva",
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "duplicate_contact" } });
    const rui = (
      (await (await add({ name: "Rui", origin: "email", email: "rui@nu.com" })).json()) as {
        contact: { id: string };
      }
    ).contact;
    // editar para o e-mail de outro contato também é duplicata
    expect(
      (
        await t.api(
          `/api/postings/${p.id}/contacts/${joana.id}`,
          json({ email: "rui@nu.com" }, "PATCH"),
        )
      ).status,
    ).toBe(409);
    const pin = (id: string, pinned: boolean) =>
      t.api(`/api/postings/${p.id}/contacts/${id}/pin`, json({ pinned }));
    expect((await pin(joana.id, true)).status).toBe(200);
    await pin(rui.id, true);
    const d = (await (await t.api(`/api/postings/${p.id}`)).json()) as {
      contacts: Array<{ id: string; pinned: boolean }>;
    };
    expect(d.contacts.filter((c) => c.pinned).map((c) => c.id)).toEqual([rui.id]);
    expect(t.events).toContainEqual({ type: "posting.updated", postingId: p.id });
  });

  it("tool posting.contact_add: LinkedIn e, se já existe, devolve o contato existente sem duplicar", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({ company: "Nubank" });
    const tools = createPostingTools(t.repos, {
      ports: { intake: async () => ({ ok: false, code: "x", message: "x" }) },
    });
    const a = await tools["posting.contact_add"]({
      postingId: p.id,
      name: "Joana",
      origin: "linkedin",
      linkedinUrl: "linkedin.com/in/joana",
    });
    const b = await tools["posting.contact_add"]({
      postingId: p.id,
      name: "Joana Silva",
      origin: "linkedin",
      linkedinUrl: "https://www.linkedin.com/in/joana/",
    });
    expect(b).toEqual({ id: a.id, duplicate: true });
    expect(t.repos.postingContacts.list(p.id)).toHaveLength(1);
    const got = await tools["posting.get"]({ id: p.id });
    expect(got.contacts[0]?.line).toContain("https://linkedin.com/in/joana");
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

const JD_LONG = `Desenvolvedor(a) Backend Sênior
Empresa: Globex Consultoria · Cliente: Initech Bank
São Paulo - SP · Híbrido · CLT

Requisitos:
- 5+ anos com Java e Spring
- Kafka e PostgreSQL
- Docker e Kubernetes

Diferenciais:
- AWS`;

describe("F06/M4 · entrada da vaga e duplicata", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("texto: cria com a heurística, pré-análise instantânea e a extração na fila", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const r = await t.api("/api/postings/intake", json({ text: JD_LONG }));
    expect(r.status).toBe(201);
    const b = (await r.json()) as {
      posting: { id: string; status: string; title: string; preAnalysis: { keywords: unknown[] } };
      job: { type: string } | null;
    };
    expect(b.posting).toMatchObject({
      status: "extracting",
      title: "Desenvolvedor(a) Backend Sênior",
    });
    expect(b.posting.preAnalysis.keywords.length).toBeGreaterThan(3);
    expect(t.queue.tasks.map((x) => [x.queue, x.type, x.payload?.postingId])).toEqual([
      ["extract", "posting.extract", b.posting.id],
    ]);
  });

  it("texto curto demais: 422 orientando a colar a descrição ou preencher os campos", async () => {
    t = makeTestApp();
    const r = await t.api("/api/postings/intake", json({ text: "vaga backend" }));
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("text_too_short");
    // só campos: rascunho, sem extração
    const d = await t.api(
      "/api/postings/intake",
      json({ fields: { company: "Nubank", role: "backend" } }),
    );
    expect(d.status).toBe(201);
    expect(((await d.json()) as { job: unknown }).job).toBeNull();
  });

  it("URL interna é recusada antes de qualquer busca (anti-SSRF)", async () => {
    t = makeTestApp();
    const r = await t.api(
      "/api/postings/intake",
      json({ url: "http://127.0.0.1:3100/api/postings" }),
    );
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("blocked_host");
  });

  it("decisão da duplicata: só com comparação pendente; update junta na salva", async () => {
    t = makeTestApp();
    const saved = t.repos.postings.create({ company: "Itaú", title: "Dev" });
    const incoming = t.repos.postings.create({ company: "Itaú", title: "Dev", city: "Recife" });
    expect(
      (await t.api(`/api/postings/${incoming.id}/duplicate-decision`, json({ action: "update" })))
        .status,
    ).toBe(409);
    t.repos.postings.setDuplicate(incoming.id, {
      candidateId: saved.id,
      sameJob: true,
      confidence: 90,
      differences: [],
      rationale: "x",
      checkedAt: "2026-10-14T00:00:00.000Z",
      decision: null,
    });
    const r = await t.api(
      `/api/postings/${incoming.id}/duplicate-decision`,
      json({ action: "update" }),
    );
    expect(await r.json()).toEqual({ keptId: saved.id, removedId: incoming.id });
    expect(t.repos.postings.get(saved.id)?.city).toBe("Recife");
  });

  it("editar a JD refaz a pré-análise na hora; reextrair enfileira de novo", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const p = t.repos.postings.create({ company: "Acme", jdText: "texto antigo sem termos" });
    const r = await t.api(`/api/postings/${p.id}`, json({ jdText: JD_LONG }, "PATCH"));
    const b = (await r.json()) as {
      posting: { preAnalysis: { keywords: Array<{ term: string }> } };
    };
    expect(b.posting.preAnalysis.keywords.map((k) => k.term)).toContain("Kafka");
    expect((await t.api(`/api/postings/${p.id}/extract`, { method: "POST" })).status).toBe(202);
    expect(t.queue.tasks.at(-1)?.type).toBe("posting.extract");
  });
});
