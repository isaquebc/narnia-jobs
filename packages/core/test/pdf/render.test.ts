import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasPdftoppm, renderPdfPages } from "../../src/pdf";

const fixturePath = new URL("../fixtures/cv_scan.pdf", import.meta.url).pathname;

describe("pdf/render (pdftoppm → PNG por página)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("chama o pdftoppm com os argumentos certos e devolve os PNGs em ordem (exec injetado)", async () => {
    const out = mkdtempSync(join(tmpdir(), "narnia-render-"));
    dirs.push(out);
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec = async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      // simula pdftoppm com 11 páginas (zero-pad de 2 dígitos)
      for (let i = 1; i <= 11; i++)
        writeFileSync(join(out, `page-${String(i).padStart(2, "0")}.png`), "");
    };
    const pages = await renderPdfPages("/tmp/in.pdf", out, { dpi: 120, exec });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe("pdftoppm");
    expect(calls[0]?.args).toEqual(["-r", "120", "-png", "/tmp/in.pdf", join(out, "page")]);
    expect(pages).toHaveLength(11);
    expect(pages[0]).toBe(join(out, "page-01.png"));
    expect(pages[10]).toBe(join(out, "page-11.png"));
  });

  it("renderiza de verdade o PDF escaneado da fixture (pdftoppm presente no container)", async () => {
    expect(await hasPdftoppm()).toBe(true);
    const out = mkdtempSync(join(tmpdir(), "narnia-render-"));
    dirs.push(out);
    const pages = await renderPdfPages(fixturePath, out, { dpi: 72 });
    expect(pages).toHaveLength(3);
    for (const p of pages) expect(existsSync(p)).toBe(true);
  });
});
