import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACHMENT_MAX_BYTES } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  addJobApplicationEntry,
  applyToPosting,
  attachmentPath,
  JobApplicationError,
  removeJobApplication,
  removeJobApplicationEntry,
  updateJobApplicationEntry,
} from "../../src/job-applications";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F07/M3 · notas e anexos datados (§0-5): texto e/ou arquivos (e-mail, imagem, PDF, vídeo…) com a data que a pessoa
 * escolhe (até hoje). Os arquivos ficam em `<dados>/job-applications/<id do anexo>`; apagar a nota ou a candidatura
 * apaga os arquivos. Registrar é atividade (desarquiva).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-entries-"));
  dirs.push(dataDir);
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const p = r.postings.create({ company: "Acme", title: "Backend" }, { source: "user" });
  const d = r.documents.create({
    kind: "cv",
    profileId,
    postingId: p.id,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const v = r.documents.addVersion(d.id, {
    source: "agent",
    instructions: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
  });
  r.documents.updateVersion(v.id, { status: "ready" });
  const app = applyToPosting(r, { postingId: p.id, cvVersionId: v.id, appliedOn: "2026-10-20" });
  return { r, app, dataDir };
}

const file = (name: string, type: string, text: string) => ({
  name,
  type,
  bytes: new TextEncoder().encode(text),
});
const now = new Date("2026-10-28T12:00:00.000Z");

describe("F07/M3 · notas e anexos", () => {
  it("nota com data escolhida e anexos; a lista vem da mais recente para a mais antiga", () => {
    const { r, app, dataDir } = setup();
    const a = addJobApplicationEntry(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-22", body: "E-mail da recrutadora marcando a conversa", files: [] },
      now,
    );
    const b = addJobApplicationEntry(
      r,
      dataDir,
      app.id,
      {
        occurredOn: "2026-10-27",
        body: null,
        files: [
          file("convite.png", "image/png", "png"),
          file("case.pdf", "application/pdf", "pdf"),
        ],
      },
      now,
    );
    expect(b.attachments.map((x) => [x.fileName, x.mime, x.size])).toEqual([
      ["convite.png", "image/png", 3],
      ["case.pdf", "application/pdf", 3],
    ]);
    const id = b.attachments[0]?.id ?? "";
    expect(readFileSync(attachmentPath(dataDir, id), "utf8")).toBe("png");
    expect(r.jobApplicationEntries.list(app.id).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(r.jobApplications.get(app.id)?.lastActivityAt).toBe(now.toISOString());
  });

  it("precisa de texto ou arquivo; data no futuro e arquivo acima de 100 MB são recusados", () => {
    const { r, app, dataDir } = setup();
    const add = (input: Parameters<typeof addJobApplicationEntry>[3]) => () =>
      addJobApplicationEntry(r, dataDir, app.id, input, now);
    expect(add({ occurredOn: "2026-10-27", body: "  ", files: [] })).toThrow(JobApplicationError);
    expect(add({ occurredOn: "2026-11-05", body: "x", files: [] })).toThrow(/futuro/);
    const big = {
      name: "v.mp4",
      type: "video/mp4",
      bytes: new Uint8Array(0),
      size: ATTACHMENT_MAX_BYTES + 1,
    };
    expect(add({ occurredOn: "2026-10-27", body: null, files: [big] })).toThrow(/100 MB/);
    expect(r.jobApplicationEntries.list(app.id)).toHaveLength(0);
  });

  it("editar muda texto e data; apagar a nota apaga os arquivos dela", () => {
    const { r, app, dataDir } = setup();
    const e = addJobApplicationEntry(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-27", body: "rascunho", files: [file("a.txt", "text/plain", "oi")] },
      now,
    );
    const edited = updateJobApplicationEntry(
      r,
      app.id,
      e.id,
      { body: "Feedback do case", occurredOn: "2026-10-26" },
      now,
    );
    expect(edited).toMatchObject({ body: "Feedback do case", occurredOn: "2026-10-26" });
    const path = attachmentPath(dataDir, e.attachments[0]?.id ?? "");
    expect(existsSync(path)).toBe(true);
    removeJobApplicationEntry(r, dataDir, app.id, e.id);
    expect(existsSync(path)).toBe(false);
    expect(r.jobApplicationEntries.list(app.id)).toHaveLength(0);
  });

  it("apagar a candidatura apaga as notas e os arquivos", () => {
    const { r, app, dataDir } = setup();
    const e = addJobApplicationEntry(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-27", body: null, files: [file("a.txt", "text/plain", "oi")] },
      now,
    );
    const path = attachmentPath(dataDir, e.attachments[0]?.id ?? "");
    removeJobApplication(r, dataDir, app.id);
    expect(existsSync(path)).toBe(false);
    expect(r.jobApplications.get(app.id)).toBeNull();
  });

  it("nota numa candidatura arquivada a desarquiva", () => {
    const { r, app, dataDir } = setup();
    r.jobApplications.update(app.id, { archived: true });
    addJobApplicationEntry(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-27", body: "voltou", files: [] },
      now,
    );
    expect(r.jobApplications.get(app.id)?.archivedAt).toBeNull();
  });
});
