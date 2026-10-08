import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURES, fixtureFile, makeTestApp, type TestApp, uploadFixture } from "./helpers";

describe("M4/api arquivos, texto livre e estimativa", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("POST /api/files salva o PDF em uploads/<sha>.pdf, devolve FileResponse com páginas; reenvio devolve o mesmo id", async () => {
    t = makeTestApp();
    const { res, body } = await uploadFixture(t);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      kind: "cv",
      mime: "application/pdf",
      pages: 2,
      originalName: "cv_text.pdf",
    });
    const rec = t.repos.sourceFiles.get(body.id);
    expect(rec).not.toBeNull();
    expect(existsSync(join(t.dataDir, rec?.path ?? "nope"))).toBe(true);
    const again = await uploadFixture(t);
    expect(again.res.status).toBe(200);
    expect(again.body.id).toBe(body.id);
    expect((await t.api(`/api/files/${body.id}`)).status).toBe(200);
    expect((await t.api("/api/files/nao-existe")).status).toBe(404);
  });

  it("rejeita extensão falsa (magic bytes), arquivo grande e requisição sem arquivo", async () => {
    t = makeTestApp();
    const fake = new File(
      [new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0, 0, 0, 0, 0, 0])],
      "virus.pdf",
      {
        type: "application/pdf",
      },
    );
    let form = new FormData();
    form.append("file", fake);
    let res = await t.api("/api/files", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "unsupported" } });

    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", {
      type: "application/pdf",
    });
    form = new FormData();
    form.append("file", big);
    res = await t.api("/api/files", { method: "POST", body: form });
    expect(res.status).toBe(413);

    form = new FormData();
    res = await t.api("/api/files", { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  it("POST /api/texts valida 200–50k chars e cria source_file(kind=text)", async () => {
    t = makeTestApp();
    const short = await t.api("/api/texts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "curto" }),
    });
    expect(short.status).toBe(400);
    const text = readFileSync(join(FIXTURES, "texto_livre.txt"), "utf8");
    const ok = await t.api("/api/texts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { id: string; kind: string; pages: number | null };
    expect(body.kind).toBe("text");
    expect(body.pages).toBeNull();
    expect(t.repos.sourceFiles.get(body.id)?.kind).toBe("text");
  });

  it("GET /api/files/:id/estimate lista as três chamadas por modelo para PDF e respeita ?modelRead=false", async () => {
    t = makeTestApp();
    const { body } = await uploadFixture(t);
    const full = (await (await t.api(`/api/files/${body.id}/estimate`)).json()) as {
      calls: Array<{ name: string; model: string; tokens: number }>;
      totalTokens: number;
    };
    expect(full.calls.map((c) => c.name)).toEqual(["readDocument", "extractFacts", "buildDigest"]);
    expect(full.calls.map((c) => c.model)).toEqual(["haiku", "haiku", "sonnet"]);
    expect(full.totalTokens).toBe(full.calls.reduce((s, c) => s + c.tokens, 0));
    const noRead = (await (
      await t.api(`/api/files/${body.id}/estimate?modelRead=false`)
    ).json()) as { calls: Array<{ name: string }> };
    expect(noRead.calls.map((c) => c.name)).toEqual(["extractFacts", "buildDigest"]);
  });

  it("DOCX e Markdown são aceitos; estimativa sem leitura pelo modelo (só PDF)", async () => {
    t = makeTestApp();
    const form = new FormData();
    form.append(
      "file",
      fixtureFile(
        "cv.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    );
    const res = await t.api("/api/files", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; pages: number | null };
    const est = (await (await t.api(`/api/files/${body.id}/estimate`)).json()) as {
      calls: Array<{ name: string }>;
    };
    expect(est.calls.map((c) => c.name)).toEqual(["extractFacts", "buildDigest"]);
  });
});
