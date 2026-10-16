import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzePostingText,
  createRepos,
  type DocumentRecord,
  matchKeywords,
  migrate,
  openDatabase,
  type PdfInspection,
  type Repos,
  seedFixture,
} from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { CvBrief, WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { processTask } from "../src/tasks";

/** F05/M2 · tarefa cv.generate com o mock e um navegador falso (o HTML vira o "PDF"; a leitura tira o texto e os links). */
const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

function fakeInspect(pagesFor: () => number) {
  return async (pdf: Uint8Array): Promise<PdfInspection> => {
    const html = Buffer.from(pdf).toString("utf8");
    const body = html.replace(/<style[\s\S]*?<\/style>/g, "");
    const text = decode(
      body
        .replace(/<(h2|p|li|h3|div|section|header|article)\b[^>]*>/g, "\n")
        .replace(/<[^>]+>/g, " "),
    );
    const links = [...body.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1] as string));
    const n = pagesFor();
    return {
      text,
      pages: Array.from({ length: n }, (_, i) => ({
        width: 595,
        height: 842,
        items: [],
        links: i === 0 ? links : [],
      })),
    };
  };
}

function harness(opts: { pages?: () => number; provider?: MockProvider } = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  repos.users.upsert({
    links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/ana-exemplo" }],
  });
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-cv-"));
  const published: WsEvent[] = [];
  const briefs: CvBrief[] = [];
  const provider = opts.provider ?? new MockProvider();
  const spy = Object.create(provider) as MockProvider;
  spy.cvGenerate = async (i) => {
    briefs.push(i.brief);
    return provider.cvGenerate(i);
  };
  spy.coverLetterGenerate = async (i) => {
    briefs.push(i.brief);
    return provider.coverLetterGenerate(i);
  };
  const deps: WorkerDeps = {
    repos,
    dataDir,
    provider: spy,
    ocr: {
      render: async () => [],
      createRecognizer: async () => ({
        recognize: async () => ({ text: "", confidence: 0 }),
        terminate: async () => {},
      }),
    },
    enqueue: async () => {},
    enqueueTask: async () => {},
    publish: async (e) => {
      published.push(e);
    },
    gh: () => {
      throw new Error("gh não usado");
    },
    documents: {
      browserWs: "ws://fake",
      render: async (html) => ({ ok: true, pdf: Buffer.from(html), blocked: [] }),
      inspect: fakeInspect(opts.pages ?? (() => 1)),
      checkLink: async () => ({ ok: true }),
      pages: async () => [],
    },
  };
  return {
    repos,
    ids,
    deps,
    dataDir,
    published,
    briefs,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

type H = ReturnType<typeof harness>;

function newDoc(h: H, over: Partial<DocumentRecord> = {}) {
  const doc = h.repos.documents.create({
    kind: "cv",
    profileId: h.ids.profileId,
    postingId: null,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
    ...over,
  });
  const v = h.repos.documents.addVersion(doc.id, {
    source: "agent",
    instructions: "Destaque a liderança",
    factsVersion: h.repos.settings.getFactsVersion(),
    postingUpdatedAt: null,
    profileHash: "h",
  });
  return { doc, v };
}

const run = (h: H, documentId: string, versionId: string) =>
  processTask(
    { kind: "task", type: "cv.generate", key: documentId, payload: { documentId, versionId } },
    { jobId: `task__cv.generate__${documentId}`, progress: async () => {} },
    h.deps,
  );

describe("F05/M2 worker · cv.generate", () => {
  let h: H;
  afterEach(() => h?.cleanup());

  it("CV do perfil: conteúdo, PDF salvo, ATS, links, uso registrado e eventos de cada etapa", async () => {
    h = harness();
    const { doc, v } = newDoc(h);
    const r = await run(h, doc.id, v.id);
    expect(r).toMatchObject({ status: "ready" });
    const done = h.repos.documents.versionById(v.id);
    expect(done).toMatchObject({
      status: "ready",
      attempts: 1,
      pagesRendered: 1,
      pdfPath: `documents/${doc.id}/v1/cv.pdf`,
    });
    expect(existsSync(join(h.dataDir, done?.pdfPath as string))).toBe(true);
    expect(done?.review?.passed).toBe(true);
    expect(done?.atsScore).toBeGreaterThanOrEqual(90);
    expect(h.briefs[0]?.instructions).toBe("Destaque a liderança");
    const content = done?.content as {
      header: { links: Array<{ kind: string }> };
      experiences: unknown[];
    };
    expect(content.header.links.map((l) => l.kind)).toEqual(["email", "whatsapp", "linkedin"]);
    expect(content.experiences.length).toBeGreaterThan(0);
    expect(h.repos.usageEvents.list().map((u) => u.category)).toContain("cv.generate");
    const statuses = h.published
      .filter((e) => e.type === "document.updated")
      .map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(["collecting", "generating", "validating", "reviewing", "ready"]);
    // aviso "pronto" na bandeja, com o link da aba do currículo
    const notice = h.published.find((e) => e.type === "notification.created") as {
      notification: { kind: string; actionUrl: string };
    };
    expect(notice.notification).toMatchObject({
      kind: "document.ready",
      actionUrl: `/perfis/${h.ids.profileId}/curriculo`,
    });
  });

  it("reprovou na conferência (3 páginas): regera com os apontamentos e passa", async () => {
    let n = 0;
    h = harness({ pages: () => (++n === 1 ? 3 : 1) });
    const { doc, v } = newDoc(h);
    await run(h, doc.id, v.id);
    const done = h.repos.documents.versionById(v.id);
    expect(done).toMatchObject({ status: "ready", attempts: 2 });
    expect(h.briefs).toHaveLength(2);
    expect(h.briefs[1]?.previousIssues).toContainEqual(expect.objectContaining({ area: "pages" }));
  });

  it("o revisor reprova uma vez: regera com o apontamento dele e passa", async () => {
    const provider = new MockProvider();
    provider.setMode({ cvReviewFailures: 1 });
    h = harness({ provider });
    const { doc, v } = newDoc(h);
    await run(h, doc.id, v.id);
    expect(h.repos.documents.versionById(v.id)).toMatchObject({ status: "ready", attempts: 2 });
    expect(h.briefs[1]?.previousIssues).toContainEqual(
      expect.objectContaining({ area: "layout", message: expect.stringMatching(/sobreposto/) }),
    );
    expect(h.repos.usageEvents.list().filter((u) => u.category === "cv.review")).toHaveLength(2);
  });

  it("o revisor reprova duas vezes: alerta 'não passou na revisão' com o apontamento", async () => {
    const provider = new MockProvider();
    provider.setMode({ cvReviewFailures: 2 });
    h = harness({ provider });
    const { doc, v } = newDoc(h);
    await run(h, doc.id, v.id);
    const done = h.repos.documents.versionById(v.id);
    expect(done?.status).toBe("ready_with_issues");
    expect(done?.review?.issues).toContainEqual(
      expect.objectContaining({ area: "layout", severity: "error" }),
    );
    expect(h.repos.notifications.list().map((n) => n.kind)).toEqual(["document.review_failed"]);
  });

  it("reprovou duas vezes: pronto com o alerta e os apontamentos guardados", async () => {
    h = harness({ pages: () => 3 });
    const { doc, v } = newDoc(h);
    await run(h, doc.id, v.id);
    const done = h.repos.documents.versionById(v.id);
    expect(done?.status).toBe("ready_with_issues");
    expect(done?.attempts).toBe(2);
    expect(done?.review?.passed).toBe(false);
    expect(done?.review?.issues).toContainEqual(
      expect.objectContaining({ area: "pages", severity: "error" }),
    );
    expect(done?.pdfPath).toBeTruthy();
  });

  it("carta em texto para a vaga: sem PDF, texto guardado e assinatura com o nome", async () => {
    h = harness();
    const text = "Backend Engineer\nCompany: Initech\nRequirements:\n- Node.js\n- Kafka";
    const p = h.repos.postings.create(
      { company: "Initech", title: "Backend Engineer", jdText: text },
      { source: "user" },
    );
    h.repos.postings.setPreAnalysis(p.id, {
      version: 1,
      keywords: matchKeywords(h.repos, analyzePostingText(text).keywords),
      ngrams: [],
      sectionsDetected: true,
      yearsMin: null,
      coverage: null,
      risksByProfile: {},
      createdAt: "2026-10-16T00:00:00Z",
    });
    const { doc, v } = newDoc(h, {
      kind: "cover_letter",
      postingId: p.id,
      format: "text",
      locale: "en-US",
    });
    await run(h, doc.id, v.id);
    const done = h.repos.documents.versionById(v.id);
    expect(done).toMatchObject({ status: "ready", pdfPath: null, pagesRendered: null });
    expect(done?.textBody).toContain("Ana Maria Exemplo");
    expect(done?.textBody).toContain("Initech");
  });

  it("cv.render (alteração do recrutador): sem o gerador, uma tentativa, conteúdo novo na versão 2", async () => {
    h = harness();
    const { doc, v } = newDoc(h);
    await run(h, doc.id, v.id);
    const before = h.briefs.length;
    const content = h.repos.documents.versionById(v.id)?.content as { summary: string };
    const { contentToCvDraft } = await import("@narnia-jobs/core");
    const draft = contentToCvDraft(content as never);
    draft.summary = "Resumo reescrito pelo recrutador.";
    const v2 = h.repos.documents.addVersion(doc.id, {
      source: "recruiter",
      instructions: null,
      factsVersion: 0,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    await processTask(
      {
        kind: "task",
        type: "cv.render",
        key: doc.id,
        payload: { documentId: doc.id, versionId: v2.id, cv: draft },
      },
      { jobId: "j2", progress: async () => {} },
      h.deps,
    );
    expect(h.briefs.length).toBe(before);
    const done = h.repos.documents.versionById(v2.id);
    expect(done).toMatchObject({ status: "ready", attempts: 1, version: 2 });
    expect((done?.content as { summary: string } | undefined)?.summary).toBe(
      "Resumo reescrito pelo recrutador.",
    );
  });

  it("modelo fora do ar: versão em erro com a mensagem, sem derrubar a fila", async () => {
    const provider = new MockProvider();
    provider.setMode({ errors: { cvGenerate: "modelo fora do ar" } });
    h = harness({ provider });
    const { doc, v } = newDoc(h);
    const r = await run(h, doc.id, v.id);
    expect(r).toMatchObject({ error: expect.stringContaining("modelo fora do ar") });
    expect(h.repos.documents.versionById(v.id)).toMatchObject({
      status: "error",
      error: expect.stringContaining("modelo fora do ar"),
    });
  });
});

// Chromium e leitura de PDF reais (worker da instância `claude`, com NARNIA_BROWSER_WS); links sem rede
describe.skipIf(!process.env.NARNIA_BROWSER_WS)(
  "F05/M2 worker · cv.generate com o navegador real",
  () => {
    let h: H;
    afterEach(() => h?.cleanup());

    it("CV do perfil com o mock: pronto na primeira, sem apontamento de layout, ATS ≥ 90 e páginas em PNG", async () => {
      h = harness();
      h.deps.documents = {
        browserWs: process.env.NARNIA_BROWSER_WS as string,
        checkLink: async () => ({ ok: true }),
      };
      const { doc, v } = newDoc(h);
      await run(h, doc.id, v.id);
      const done = h.repos.documents.versionById(v.id);
      expect(done?.review?.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(done).toMatchObject({ status: "ready", attempts: 1, pagesRendered: 1 });
      expect(done?.atsScore).toBeGreaterThanOrEqual(90);
      expect(existsSync(join(h.dataDir, `documents/${doc.id}/v1/pages/page-1.png`))).toBe(true);
    });
  },
);
