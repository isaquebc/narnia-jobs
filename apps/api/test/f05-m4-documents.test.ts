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
