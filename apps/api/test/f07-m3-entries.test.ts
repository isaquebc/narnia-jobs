import { existsSync } from "node:fs";
import { applyToPosting, attachmentPath, seedFixture } from "@narnia-jobs/core";
import type { JobApplicationEntry } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F07/M3 · notas e anexos pela API: multipart com a data, o texto e os arquivos; baixar (imagem, PDF e vídeo abrem no
 * navegador; o resto baixa); editar; apagar a nota ou a candidatura apaga os arquivos.
 */
type Body = { entry: JobApplicationEntry; entries: JobApplicationEntry[]; error: { code: string } };
const body = async (r: Response | Promise<Response>) => (await (await r).json()) as Body;

function seed(t: TestApp) {
  const { profileId } = seedFixture(t.repos, "engineer");
  const posting = t.repos.postings.create(
    { company: "Acme", title: "Backend" },
    { source: "user" },
  );
  const doc = t.repos.documents.create({
    kind: "cv",
    profileId,
    postingId: posting.id,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const v = t.repos.documents.addVersion(doc.id, {
    source: "agent",
    instructions: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
  });
  t.repos.documents.updateVersion(v.id, { status: "ready" });
  return applyToPosting(t.repos, {
    postingId: posting.id,
    cvVersionId: v.id,
    appliedOn: "2026-10-20",
  });
}

const form = (fields: Record<string, string>, files: File[] = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const file of files) f.append("files", file);
  return { method: "POST", body: f };
};

describe("F07/M3 · API das notas e anexos", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("cria com data, texto e arquivos; lista; baixa inline só o que é seguro", async () => {
    t = makeTestApp();
    const app = seed(t);
    const res = await t.api(
      `/api/job-applications/${app.id}/entries`,
      form({ occurredOn: "2026-10-22", body: "E-mail da recrutadora" }, [
        new File(["png"], "convite.png", { type: "image/png" }),
        new File(["<script>"], "pagina.html", { type: "text/html" }),
      ]),
    );
    expect(res.status).toBe(201);
    const { entry } = await body(res);
    expect(entry).toMatchObject({ occurredOn: "2026-10-22", body: "E-mail da recrutadora" });
    const [img, html] = entry.attachments;
    const list = await body(t.api(`/api/job-applications/${app.id}/entries`));
    expect(list.entries.map((e) => e.id)).toEqual([entry.id]);

    const got = await t.api(`/api/job-applications/${app.id}/attachments/${img?.id}`);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("content-disposition")).toMatch(
      /^inline; filename\*=UTF-8''convite\.png/,
    );
    expect(await got.text()).toBe("png");
    const danger = await t.api(`/api/job-applications/${app.id}/attachments/${html?.id}`);
    expect(danger.headers.get("content-type")).toBe("application/octet-stream");
    expect(danger.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect((await t.api(`/api/job-applications/outra/attachments/${img?.id}`)).status).toBe(404);
  });

  it("sem texto nem arquivo, data no futuro: 400; editar e apagar", async () => {
    t = makeTestApp();
    const app = seed(t);
    const empty = await t.api(
      `/api/job-applications/${app.id}/entries`,
      form({ occurredOn: "2026-10-22", body: " " }),
    );
    expect(empty.status).toBe(400);
    expect((await body(empty)).error.code).toBe("entry_empty");
    const future = await t.api(
      `/api/job-applications/${app.id}/entries`,
      form({ occurredOn: "2999-01-01", body: "x" }),
    );
    expect((await body(future)).error.code).toBe("future_date");

    const { entry } = await body(
      t.api(
        `/api/job-applications/${app.id}/entries`,
        form({ occurredOn: "2026-10-22", body: "rascunho" }, [
          new File(["a"], "a.txt", { type: "text/plain" }),
        ]),
      ),
    );
    const edited = await body(
      t.api(`/api/job-applications/${app.id}/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Feedback do case", occurredOn: "2026-10-21" }),
      }),
    );
    expect(edited.entry).toMatchObject({ body: "Feedback do case", occurredOn: "2026-10-21" });
    const path = attachmentPath(t.dataDir, entry.attachments[0]?.id ?? "");
    expect(existsSync(path)).toBe(true);
    expect(
      (await t.api(`/api/job-applications/${app.id}/entries/${entry.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect(existsSync(path)).toBe(false);
  });

  it("apagar a candidatura apaga os anexos", async () => {
    t = makeTestApp();
    const app = seed(t);
    const { entry } = await body(
      t.api(
        `/api/job-applications/${app.id}/entries`,
        form({ occurredOn: "2026-10-22" }, [new File(["a"], "a.txt", { type: "text/plain" })]),
      ),
    );
    const path = attachmentPath(t.dataDir, entry.attachments[0]?.id ?? "");
    expect((await t.api(`/api/job-applications/${app.id}`, { method: "DELETE" })).status).toBe(204);
    expect(existsSync(path)).toBe(false);
  });
});
