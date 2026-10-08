import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, readDigestText, saveDigest } from "../src";

describe("digest (registro de contexto por arquivo, F01 §2.5)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("grava o texto canônico em digests/<sha>.txt e a linha em file_digest; re-extração preserva edição do usuário", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "narnia-data-"));
    dirs.push(dataDir);
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    const file = r.sourceFiles.insert({
      originalName: "cv.pdf",
      mime: "application/pdf",
      size: 10,
      sha256: "c".repeat(64),
      path: "uploads/c.pdf",
      kind: "cv",
    });
    const saved = saveDigest(r, dataDir, {
      fileId: file.id,
      sha256: file.sha256,
      text: "TEXTO CANÔNICO\nAcme Ltda 2021–2023",
      digest: {
        summary: "Currículo de engenheira de software.",
        keyPoints: ["Acme (2021–2023)"],
        sections: [{ title: "Experiência", start: 0, end: 30 }],
        meta: { pages: 2, language: "pt" },
      },
    });
    expect(saved.textPath).toBe(`digests/${"c".repeat(64)}.txt`);
    expect(existsSync(join(dataDir, saved.textPath as string))).toBe(true);
    expect(readFileSync(join(dataDir, saved.textPath as string), "utf8")).toContain("Acme Ltda");
    expect(readDigestText(dataDir, saved)).toContain("TEXTO CANÔNICO");
    expect(saved.editedByUser).toBe(false);

    r.digests.upsert({ ...saved, summary: "Resumo corrigido pelo usuário.", editedByUser: true });
    const again = saveDigest(r, dataDir, {
      fileId: file.id,
      sha256: file.sha256,
      text: "TEXTO NOVO",
      digest: {
        summary: "Resumo gerado de novo.",
        keyPoints: [],
        sections: [],
        meta: { pages: 2 },
      },
    });
    expect(again.summary).toBe("Resumo corrigido pelo usuário.");
    expect(again.editedByUser).toBe(true);
    expect(readDigestText(dataDir, again)).toBe("TEXTO NOVO");
    expect(again.meta.pages).toBe(2);
  });
});
