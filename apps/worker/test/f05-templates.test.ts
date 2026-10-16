import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepos, migrate, openDatabase, type Repos, seedFixture } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { processTask } from "../src/tasks";
import { buildZip } from "./zip-helper";

/** F05/M7 · template do usuário: validação no worker (prévia do CV de exemplo) e uso na geração com JS desligado. */
const MANIFEST = JSON.stringify({ name: "Meu modelo", locales: ["pt-BR"] });
const HTML = `<h1 class="meu">{{header.name}}</h1>{{#each experiences}}<h3>{{title}} · {{company}}</h3>{{/each}}`;

function harness() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-tpl-"));
  mkdirSync(join(dataDir, "templates"), { recursive: true });
  const renders: Array<{ html: string; js: boolean }> = [];
  const deps: WorkerDeps = {
    repos,
    dataDir,
    provider: new MockProvider(),
    ocr: {
      render: async () => [],
      createRecognizer: async () => ({
        recognize: async () => ({ text: "", confidence: 0 }),
        terminate: async () => {},
      }),
    },
    enqueue: async () => {},
    enqueueTask: async () => {},
    publish: async () => {},
    gh: () => {
      throw new Error("gh não usado");
    },
    documents: {
      browserWs: "ws://fake",
      render: async (html, _paper, js) => {
        renders.push({ html, js });
        return { ok: true, pdf: Buffer.from(html), blocked: [] };
      },
      inspect: async (pdf) => {
        const text = Buffer.from(pdf)
          .toString("utf8")
          .replace(/<[^>]+>/g, " ");
        return { text, pages: [{ width: 595, height: 842, items: [], links: [] }] };
      },
      checkLink: async () => ({ ok: true }),
      pages: async (_pdf, out) => {
        const p = join(out, "page-1.png");
        writeFileSync(p, "png");
        return [p];
      },
    },
  };
  const upload = (files: Record<string, string>) => {
    const t = repos.cvTemplates.create({
      name: "enviado",
      engine: "handlebars",
      path: "",
      manifest: {},
    });
    writeFileSync(join(dataDir, `templates/${t.id}.zip`), buildZip(files));
    return t;
  };
  const run = (type: string, payload: Record<string, unknown>) =>
    processTask(
      { kind: "task", type, key: "k", payload },
      { jobId: "j", progress: async () => {} },
      deps,
    );
  return {
    repos,
    ids,
    dataDir,
    deps,
    renders,
    upload,
    run,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

describe("F05/M7 worker · template do usuário", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("válido: monta o CV de exemplo sem JS, guarda a prévia e o nome do manifesto", async () => {
    h = harness();
    const t = h.upload({
      "template.html": HTML,
      "style.css": ".meu{color:#123}",
      "manifest.json": MANIFEST,
    });
    await h.run("template.validate", { templateId: t.id });
    expect(h.repos.cvTemplates.get(t.id)).toMatchObject({
      status: "valid",
      name: "Meu modelo",
      previewPath: `templates/${t.id}.png`,
    });
    expect(existsSync(join(h.dataDir, `templates/${t.id}.png`))).toBe(true);
    expect(h.renders[0]).toMatchObject({ js: false });
    expect(h.renders[0]?.html).toContain("Ana Maria Exemplo");
  });

  it("inválido: status inválido com os motivos, sem montar", async () => {
    h = harness();
    const t = h.upload({
      "template.html": "<script>1</script>",
      "style.css": "",
      "manifest.json": MANIFEST,
    });
    await h.run("template.validate", { templateId: t.id });
    expect(h.repos.cvTemplates.get(t.id)).toMatchObject({
      status: "invalid",
      validationErrors: ["<script> não é permitido."],
    });
    expect(h.renders).toEqual([]);
  });

  it("falha inesperada do navegador vira inválido com o motivo (não fica preso em validando)", async () => {
    h = harness();
    const t = h.upload({ "template.html": HTML, "style.css": "", "manifest.json": MANIFEST });
    h.deps.documents = {
      ...(h.deps.documents as NonNullable<typeof h.deps.documents>),
      render: async () => {
        throw new Error("navegador caiu");
      },
    };
    await h.run("template.validate", { templateId: t.id });
    expect(h.repos.cvTemplates.get(t.id)).toMatchObject({
      status: "invalid",
      validationErrors: ["Não consegui validar o modelo: navegador caiu"],
    });
  });

  it("CV com o template enviado: HTML do usuário, JavaScript desligado", async () => {
    h = harness();
    const t = h.upload({ "template.html": HTML, "style.css": "", "manifest.json": MANIFEST });
    await h.run("template.validate", { templateId: t.id });
    const doc = h.repos.documents.create({
      kind: "cv",
      profileId: h.ids.profileId,
      postingId: null,
      templateId: t.id,
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    const v = h.repos.documents.addVersion(doc.id, {
      source: "agent",
      instructions: null,
      factsVersion: 0,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    await h.run("cv.generate", { documentId: doc.id, versionId: v.id });
    const last = h.renders.at(-1);
    expect(last?.js).toBe(false);
    expect(last?.html).toContain('class="meu"');
    expect(h.repos.documents.versionById(v.id)?.status).toMatch(/^ready/);
  });
});
