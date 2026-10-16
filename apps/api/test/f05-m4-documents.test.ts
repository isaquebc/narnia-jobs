import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F05/M4 · /api/documents: gerar, atualizar, idioma não coberto, listar por perfil e vaga, baixar e apagar. */
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const JD_EN = `Senior Backend Engineer at Initech. Requirements: Node.js, TypeScript and Kubernetes in production for the payments team with the engineers of the platform.`;

describe("F05/M4 · /api/documents", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("gera o CV do perfil (202 + tarefa), lista pelo perfil, 'Atualizar' abre a versão 2 e emite document.updated", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const r = await t.api(
      "/api/documents",
      json({ kind: "cv", profileId: ids.profileId, instructions: "liderança" }),
    );
    expect(r.status).toBe(202);
    const { documents } = (await r.json()) as {
      documents: Array<{ document: { id: string }; current: { id: string; status: string } }>;
    };
    const doc = documents[0] as (typeof documents)[number];
    expect(doc.current.status).toBe("queued");
    expect(t.events).toContainEqual(
      expect.objectContaining({ type: "document.updated", documentId: doc.document.id }),
    );
    const list = (await (await t.api(`/api/documents?profileId=${ids.profileId}`)).json()) as {
      documents: unknown[];
    };
    expect(list.documents).toHaveLength(1);
    t.repos.documents.updateVersion(doc.current.id, { status: "ready" });
    const again = await t.api(
      `/api/documents/${doc.document.id}/regenerate`,
      json({ instructions: "mais curto" }),
    );
    expect(again.status).toBe(202);
    const view = (await again.json()) as { current: { version: number; instructions: string } };
    expect(view.current).toMatchObject({ version: 2, instructions: "mais curto" });
    // "Tentar de novo": os erros da revisão da versão atual vão para o gerador
    t.repos.documents.updateVersion((view.current as unknown as { id: string }).id, {
      status: "ready_with_issues",
      review: {
        passed: false,
        atsScore: 80,
        issues: [{ area: "ats", severity: "error", message: "ATS de 80%.", where: null }],
      },
    });
    const retry = await t.api(
      `/api/documents/${doc.document.id}/regenerate`,
      json({ acceptLanguage: true, fixIssues: true }),
    );
    expect(retry.status).toBe(202);
    expect(t.queue.tasks.at(-1)?.payload).toMatchObject({
      previousIssues: [{ area: "ats", message: "ATS de 80%.", where: null }],
    });
  });

  it("vaga em inglês sem inglês: 409 language_not_covered com o idioma; com acceptLanguage gera CV e carta juntos", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    for (const l of t.repos.facts.languages.list()) t.repos.facts.languages.remove(l.id);
    const p = t.repos.postings.create({ company: "Initech", jdText: JD_EN }, { source: "user" });
    const r = await t.api(
      "/api/documents",
      json({ kind: "cv", profileId: ids.profileId, postingId: p.id }),
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({
      error: { code: "language_not_covered", details: { language: "Inglês" } },
    });
    const ok = await t.api(
      "/api/documents",
      json({
        kind: "cv",
        profileId: ids.profileId,
        postingId: p.id,
        acceptLanguage: true,
        withCoverLetter: true,
        format: "text",
      }),
    );
    expect(ok.status).toBe(202);
    const { documents } = (await ok.json()) as {
      documents: Array<{ document: { kind: string; locale: string; format: string } }>;
    };
    expect(documents.map((d) => d.document.kind)).toEqual(["cv", "cover_letter"]);
    expect(documents[1]?.document).toMatchObject({ locale: "en-US", format: "text" });
    const byPosting = (await (await t.api(`/api/documents?postingId=${p.id}`)).json()) as {
      documents: unknown[];
    };
    expect(byPosting.documents).toHaveLength(2);
  });

  it("erros: carta sem vaga (400), perfil inexistente (404), documento inexistente (404)", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    expect(
      (await t.api("/api/documents", json({ kind: "cover_letter", profileId: ids.profileId })))
        .status,
    ).toBe(400);
    expect((await t.api("/api/documents", json({ kind: "cv", profileId: "nao" }))).status).toBe(
      404,
    );
    expect((await t.api("/api/documents/nao")).status).toBe(404);
  });

  it("baixa o PDF e a prévia da versão; carta em texto; apagar remove o documento", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const r = (await (
      await t.api("/api/documents", json({ kind: "cv", profileId: ids.profileId }))
    ).json()) as {
      documents: Array<{ document: { id: string }; current: { id: string } }>;
    };
    const { document, current } = r.documents[0] as (typeof r.documents)[number];
    const dir = join(t.dataDir, `documents/${document.id}/v1`);
    mkdirSync(join(dir, "pages"), { recursive: true });
    writeFileSync(join(dir, "cv.pdf"), "%PDF-1.7 teste");
    writeFileSync(join(dir, "pages", "page-1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    t.repos.documents.updateVersion(current.id, {
      status: "ready",
      pdfPath: `documents/${document.id}/v1/cv.pdf`,
      pagesRendered: 1,
    });
    const pdf = await t.api(`/api/documents/${document.id}/versions/1/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/attachment; filename\*=UTF-8''CV/);
    const png = await t.api(`/api/documents/${document.id}/versions/1/pages/1`);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect((await t.api(`/api/documents/${document.id}/versions/1/pages/9`)).status).toBe(404);
    expect(
      (await t.api(`/api/documents/${document.id}/versions/1/pages/..%2F..%2Fcv`)).status,
    ).toBe(400);
    expect((await t.api(`/api/documents/${document.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await t.api(`/api/documents/${document.id}`)).status).toBe(404);
  });
});

describe("F05/M4 · chat: tools do CV no escopo e links na mensagem", async () => {
  const { postingLinks } = await import("../src/chat/session-manager");
  const { inScope } = await import("../src/mcp/scopes");

  it("cv.* e ui.suggest_action na carreira e na vaga; fora da clarificação e da ingestão", () => {
    for (const name of ["cv.generate", "cv.get", "cv.edit", "cv.list", "ui.suggest_action"]) {
      expect(inScope(name, "career"), name).toBe(true);
      expect(inScope(name, "job"), name).toBe(true);
      expect(inScope(name, "clarify"), name).toBe(false);
      expect(inScope(name, "ingest"), name).toBe(false);
    }
    expect(inScope("cv.generate", null)).toBe(true);
  });

  it("postingLinks guarda os documentos gerados ou alterados e o botão sugerido (só caminho interno)", () => {
    const gen = postingLinks(
      "cv_generate",
      JSON.stringify({
        status: "queued",
        documents: [{ documentId: "d1", kind: "cv", url: "/vagas/v1?doc=d1" }],
      }),
    );
    expect(gen).toEqual({ documents: [{ id: "d1", kind: "cv", url: "/vagas/v1?doc=d1" }] });
    expect(
      postingLinks(
        "cv_edit",
        JSON.stringify({ documentId: "d1", kind: "cover_letter", url: "/vagas/v1?doc=d1" }),
      ),
    ).toEqual({
      documents: [{ id: "d1", kind: "cover_letter", url: "/vagas/v1?doc=d1" }],
    });
    expect(
      postingLinks(
        "ui_suggest_action",
        JSON.stringify({ label: "Gerar CV", url: "/vagas/v1?gerar=cv" }),
      ),
    ).toEqual({
      action: { label: "Gerar CV", url: "/vagas/v1?gerar=cv" },
    });
    expect(
      postingLinks(
        "ui_suggest_action",
        JSON.stringify({ label: "x", url: "https://golpe.example" }),
      ),
    ).toEqual({});
    expect(
      postingLinks(
        "cv_generate",
        JSON.stringify({ status: "needs_language_confirmation", documents: [] }),
      ),
    ).toEqual({});
  });
});

describe("F05/M5 · POST /api/user/links (atalho do CV para cadastrar o link que falta)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("acrescenta o link sem mexer no resto; repetido não duplica; só http(s)", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const r = await t.api(
      "/api/user/links",
      json({ label: "LinkedIn", url: "https://www.linkedin.com/in/ana" }),
    );
    expect(r.status).toBe(200);
    await t.api(
      "/api/user/links",
      json({ label: "LinkedIn", url: "https://www.linkedin.com/in/ana" }),
    );
    expect(t.repos.users.get()?.links).toEqual([
      { label: "LinkedIn", url: "https://www.linkedin.com/in/ana" },
    ]);
    expect(t.repos.users.get()?.email).toBe("ana.exemplo@example.com");
    expect(
      (await t.api("/api/user/links", json({ label: "x", url: "javascript:alert(1)" }))).status,
    ).toBe(400);
  });
});

describe("F05/M5 · ênfase por conquista (F02-3, §2.9)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("a lista de ênfases traz as conquistas com a experiência; ocultar uma conquista grava a ênfase", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const r = (await (await t.api(`/api/profiles/${ids.profileId}/emphasis`)).json()) as {
      items: Array<{ kind: string; id: string; label: string; sublabel: string | null }>;
    };
    const ach = r.items.filter((i) => i.kind === "achievement");
    expect(ach.length).toBe(ids.achievementIds.length);
    expect(ach.find((a) => a.label.startsWith("Reduziu a latência"))).toMatchObject({
      sublabel: "Acme Pagamentos · Engenheira de Software Sênior",
    });
    const put = await t.api(
      `/api/profiles/${ids.profileId}/emphasis`,
      json(
        {
          items: [{ kind: "achievement", id: ids.achievementIds[0], mode: "hidden", position: 0 }],
          kinds: ["achievement"],
        },
        "PUT",
      ),
    );
    expect(put.status).toBe(200);
    expect(t.repos.emphasis.list(ids.profileId)).toContainEqual(
      expect.objectContaining({ factKind: "achievement", mode: "hidden" }),
    );
  });
});

describe("F05/M6 · edição, troca de modelo e comparação de versões", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  async function readyCv() {
    const ids = seedFixture(t.repos, "engineer");
    const r = (await (
      await t.api("/api/documents", json({ kind: "cv", profileId: ids.profileId }))
    ).json()) as {
      documents: Array<{ document: { id: string }; current: { id: string } }>;
    };
    const { document, current } = r.documents[0] as (typeof r.documents)[number];
    const content = {
      meta: {
        kind: "cv",
        locale: "pt-BR",
        paper: "A4",
        profileId: ids.profileId,
        postingId: null,
        generatedAt: "2026-10-16T12:00:00Z",
      },
      header: {
        name: "Ana",
        title: "Engenheira",
        location: null,
        email: null,
        phone: null,
        links: [],
      },
      summary: "Resumo original.",
      experiences: [],
      skills: [],
      projects: [],
      education: [],
      languages: [],
      adjacent: [],
      sectionsOrder: ["summary"],
      omitted: [],
      provenance: { factIdsUsed: [], unverifiedFactIds: [] },
    };
    t.repos.documents.updateVersion(current.id, { status: "ready", content });
    return { ids, id: document.id };
  }

  it("PUT content: versão 2 com o conteúdo editado e cv.render; versão velha dá 409", async () => {
    t = makeTestApp();
    const { id } = await readyCv();
    const draft = {
      headline: "Engenheira",
      summary: "Resumo editado.",
      experiences: [],
      education: [],
      skills: [],
      projects: [],
      adjacent: [],
      sectionsOrder: ["summary"],
    };
    const r = await t.api(
      `/api/documents/${id}/content`,
      json({ baseVersion: 1, cv: draft }, "PUT"),
    );
    expect(r.status).toBe(202);
    expect(
      ((await r.json()) as { current: { version: number; source: string } }).current,
    ).toMatchObject({ version: 2, source: "edit" });
    expect(t.queue.tasks.at(-1)).toMatchObject({
      type: "cv.render",
      payload: { cv: { summary: "Resumo editado." } },
    });
    t.repos.documents.updateVersion(t.repos.documents.currentVersion(id)?.id as string, {
      status: "ready",
    });
    expect(
      (await t.api(`/api/documents/${id}/content`, json({ baseVersion: 1, cv: draft }, "PUT")))
        .status,
    ).toBe(409);
  });

  it("PATCH modelo e papel: re-render sem o gerador; modelo desconhecido 404; lista de modelos", async () => {
    t = makeTestApp();
    const { id } = await readyCv();
    const r = await t.api(
      `/api/documents/${id}`,
      json({ templateId: "compacto", paper: "Letter" }, "PATCH"),
    );
    expect(r.status).toBe(202);
    expect(
      ((await r.json()) as { document: { templateId: string; paper: string } }).document,
    ).toMatchObject({ templateId: "compacto", paper: "Letter" });
    expect(t.queue.tasks.at(-1)).toMatchObject({ type: "cv.render" });
    t.repos.documents.updateVersion(t.repos.documents.currentVersion(id)?.id as string, {
      status: "ready",
    });
    expect(
      (await t.api(`/api/documents/${id}`, json({ templateId: "nao-existe" }, "PATCH"))).status,
    ).toBe(404);
    const list = (await (await t.api("/api/cv-templates")).json()) as {
      templates: Array<{ id: string; name: string; origin: string }>;
    };
    expect(list.templates.map((x) => x.id)).toEqual(["classico", "moderno", "compacto"]);
  });

  it("diff entre versões: linhas que saíram e entraram", async () => {
    t = makeTestApp();
    const { id } = await readyCv();
    const v1 = t.repos.documents.getVersion(id, 1);
    const v2 = t.repos.documents.addVersion(id, {
      source: "edit",
      instructions: null,
      factsVersion: 0,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    t.repos.documents.updateVersion(v2.id, {
      status: "ready",
      content: { ...(v1?.content as object), summary: "Resumo novo." },
    });
    const d = (await (await t.api(`/api/documents/${id}/diff?from=1&to=2`)).json()) as {
      lines: Array<{ op: string; text: string }>;
    };
    expect(d.lines).toContainEqual({ op: "-", text: "Resumo original." });
    expect(d.lines).toContainEqual({ op: "+", text: "Resumo novo." });
    expect((await t.api(`/api/documents/${id}/diff?from=1&to=9`)).status).toBe(404);
  });
});

describe("F05/M7 · templates do usuário (/api/cv-templates)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  const upload = (bytes: Uint8Array, name = "modelo.zip") => {
    const form = new FormData();
    form.append("file", new Blob([bytes]), name);
    return t.api("/api/cv-templates", { method: "POST", body: form });
  };

  it("envia o .zip: guarda, cria em validação e enfileira template.validate; lista junto dos padrão; apaga", async () => {
    t = makeTestApp();
    const r = await upload(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2]));
    expect(r.status).toBe(202);
    const { template } = (await r.json()) as { template: { id: string; status: string } };
    expect(template.status).toBe("validating");
    expect(t.queue.tasks.at(-1)).toMatchObject({
      type: "template.validate",
      payload: { templateId: template.id },
    });
    const list = (await (await t.api("/api/cv-templates")).json()) as {
      templates: Array<{ id: string; origin: string; status: string }>;
    };
    expect(list.templates.map((x) => x.origin)).toEqual(["builtin", "builtin", "builtin", "user"]);
    expect((await t.api(`/api/cv-templates/${template.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect(
      ((await (await t.api("/api/cv-templates")).json()) as { templates: unknown[] }).templates,
    ).toHaveLength(3);
  });

  it("recusa arquivo acima de 5 MB e o que não é .zip", async () => {
    t = makeTestApp();
    expect((await upload(new Uint8Array(5 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(new Uint8Array([1, 2, 3]), "x.txt")).status).toBe(400);
  });

  it("documento pode usar um template enviado só depois de válido", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const tpl = t.repos.cvTemplates.create({
      name: "Meu",
      engine: "handlebars",
      path: "",
      manifest: {},
    });
    const r = (await (
      await t.api("/api/documents", json({ kind: "cv", profileId: ids.profileId }))
    ).json()) as {
      documents: Array<{ document: { id: string }; current: { id: string } }>;
    };
    const { document, current } = r.documents[0] as (typeof r.documents)[number];
    t.repos.documents.updateVersion(current.id, {
      status: "ready",
      content: {
        meta: { kind: "cv" },
        header: { title: "x" },
        summary: "s",
        experiences: [],
        education: [],
        skills: [],
        projects: [],
        adjacent: [],
        sectionsOrder: ["summary"],
      },
    });
    expect(
      (await t.api(`/api/documents/${document.id}`, json({ templateId: tpl.id }, "PATCH"))).status,
    ).toBe(404);
    t.repos.cvTemplates.update(tpl.id, { status: "valid" });
    expect(
      (await t.api(`/api/documents/${document.id}`, json({ templateId: tpl.id }, "PATCH"))).status,
    ).toBe(202);
  });
});

describe("F05/M7 · Configurações › concorrência dos processos", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET com padrão e limites; PUT grava o que veio; fora de 1 a 4 é 400", async () => {
    t = makeTestApp();
    const g = (await (await t.api("/api/settings/workers")).json()) as {
      concurrency: Record<string, number>;
      min: number;
      max: number;
    };
    expect(g).toEqual({
      concurrency: { ingest: 2, ocr: 1, extract: 2 },
      defaults: { ingest: 2, ocr: 1, extract: 2 },
      min: 1,
      max: 4,
    });
    const p = await t.api("/api/settings/workers", json({ extract: 3 }, "PUT"));
    expect(((await p.json()) as { concurrency: Record<string, number> }).concurrency.extract).toBe(
      3,
    );
    expect((await t.api("/api/settings/workers", json({ ocr: 9 }, "PUT"))).status).toBe(400);
  });
});
