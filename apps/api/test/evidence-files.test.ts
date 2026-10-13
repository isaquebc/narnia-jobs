import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURES, makeTestApp, type TestApp, uploadFixture } from "./helpers";

/**
 * Evidências › Arquivos e textos (layout L3 "cartão de arquivo"; relato do dono em 2026-10-13: textos ingeridos não
 * apareciam em Evidências). Lista CVs e textos com o registro de contexto, as execuções e os fatos gerados.
 */
describe("evidências: arquivos e textos", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  const postText = async () => {
    const text = readFileSync(join(FIXTURES, "texto_livre.txt"), "utf8");
    const res = await t.api("/api/texts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return { text, body: (await res.json()) as { id: string } };
  };

  it("GET /api/files lista arquivos e textos (mais novos primeiro) com digest, execuções e contagem de fatos", async () => {
    t = makeTestApp();
    expect(await (await t.api("/api/files")).json()).toEqual({ files: [] });
    const cv = (await uploadFixture(t)).body;
    const { body: txt } = await postText();
    const run = t.repos.ingestionRuns.create({
      fileId: txt.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    const [a, b, c] = t.repos.proposals.insertMany(run.id, [
      { kind: "skill", confidence: 0.9, data: { name: "Go", category: "language" } },
      { kind: "skill", confidence: 0.9, data: { name: "Rust", category: "language" } },
      { kind: "skill", confidence: 0.9, data: { name: "Zig", category: "language" } },
    ]);
    t.repos.proposals.review(run.id, [
      { proposalId: a as string, decision: "accept" },
      { proposalId: b as string, decision: "reject" },
    ]);
    const res = (await (await t.api("/api/files")).json()) as {
      files: Array<Record<string, unknown>>;
    };
    expect(res.files.map((f) => f.id)).toEqual([txt.id, cv.id]);
    expect(res.files[0]).toMatchObject({
      kind: "text",
      digest: null,
      runs: [{ runId: run.id, status: run.status }],
      facts: { total: 3, accepted: 1, rejected: 1, pending: 1 },
    });
    expect(res.files[1]).toMatchObject({
      kind: "cv",
      originalName: "cv_text.pdf",
      runs: [],
      facts: { total: 0, accepted: 0, rejected: 0, pending: 0 },
    });
    expect(c).toBeTruthy();
  });

  it("GET /api/files/:id/text devolve o texto lido (texto livre: o próprio texto; sem leitura: null); 404 se não existe", async () => {
    t = makeTestApp();
    const { text, body } = await postText();
    const stored = readFileSync(
      join(t.dataDir, t.repos.sourceFiles.get(body.id)?.path ?? ""),
      "utf8",
    );
    const got = (await (await t.api(`/api/files/${body.id}/text`)).json()) as { text: string };
    expect(got).toEqual({ text: stored });
    expect(got.text).toContain(text.trim().slice(0, 40));
    const cv = (await uploadFixture(t)).body;
    expect(await (await t.api(`/api/files/${cv.id}/text`)).json()).toEqual({ text: null });
    expect((await t.api("/api/files/nao-existe/text")).status).toBe(404);
  });
});
