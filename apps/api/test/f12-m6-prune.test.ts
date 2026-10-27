import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneCapturesNow } from "../src/routes/extension";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F12/M6 · poda das capturas (§5): a captura que não virou vaga nem formulário some depois de 30 dias, com o HTML que
 * a extensão mandou; a que virou fica.
 */
describe("poda das capturas", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("apaga a captura velha sem vaga nem formulário e o HTML dela; mantém as outras", () => {
    t = makeTestApp();
    const app = t;
    const dir = join(app.dataDir, "captures");
    mkdirSync(dir, { recursive: true });
    const page = (at: Date) => {
      const c = app.repos.extension.createCapture(
        { kind: "page", url: "https://x.example", title: null, payload: {}, deviceId: null },
        at,
      );
      writeFileSync(join(dir, `${c.id}.html`), "<html></html>");
      return c;
    };
    const old = page(new Date("2026-09-01T12:00:00.000Z"));
    const saved = page(new Date("2026-09-01T12:00:00.000Z"));
    app.repos.extension.linkCapturePosting(saved.id, "v1");
    const now = new Date("2026-10-27T12:00:00.000Z");
    expect(pruneCapturesNow({ repos: app.repos, dataDir: app.dataDir }, now)).toBe(1);
    expect(existsSync(join(dir, `${old.id}.html`))).toBe(false);
    expect(existsSync(join(dir, `${saved.id}.html`))).toBe(true);
    expect(app.repos.extension.getCapture(saved.id)).not.toBeNull();
  });
});
